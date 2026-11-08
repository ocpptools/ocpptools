// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';

import type { Scheduler } from './clock.js';
import { SimulatorError, errorSnapshot, type SimulatorErrorSnapshot } from './errors.js';
import type { EventEmitter } from './events.js';

interface EntityFields {
	readonly entityId?: number;
	/** OCPP 1.6 alias for `entityId`. */
	readonly connectorId?: number;
	/** OCPP 2.0.1 alias for `entityId`. */
	readonly evseId?: number;
}

export type ScenarioStep =
	| { readonly type: 'boot' }
	| { readonly type: 'heartbeat' }
	| ({ readonly type: 'status'; readonly status?: string } & EntityFields)
	| ({
			readonly type: 'authorize';
			readonly idToken?: string;
			/** OCPP 1.6 alias for `idToken`. */
			readonly idTag?: string;
	  } & EntityFields)
	| ({
			readonly type: 'start';
			readonly idToken?: string;
			/** OCPP 1.6 alias for `idToken`. */
			readonly idTag?: string;
	  } & EntityFields)
	| ({ readonly type: 'wait'; readonly ms: number } & EntityFields)
	| ({ readonly type: 'meter' } & EntityFields)
	| ({
			readonly type: 'stop';
			readonly reason?: string;
	  } & EntityFields)
	| { readonly type: 'call'; readonly action: string; readonly payload: JsonObject };

export interface ScenarioOptions {
	/** Stops transactions started by the scenario when it is cancelled. */
	readonly stopOnCancel?: boolean;
}

export type ScenarioStatus = 'completed' | 'failed' | 'cancelled';
export type ScenarioStepStatus = 'ok' | 'failed' | 'skipped';

export interface ScenarioStepResult {
	readonly index: number;
	readonly type: ScenarioStep['type'];
	readonly status: ScenarioStepStatus;
	readonly error?: SimulatorErrorSnapshot;
}

export interface ScenarioResult {
	readonly status: ScenarioStatus;
	readonly steps: readonly ScenarioStepResult[];
	readonly startedAt: number;
	readonly finishedAt: number;
	readonly error?: SimulatorErrorSnapshot;
}

export interface ScenarioRun {
	readonly done: Promise<ScenarioResult>;
	cancel(): void;
}

export interface ScenarioEngine {
	readonly scheduler: Scheduler;
	readonly events: EventEmitter;
	now(): number;
}

/** The version-specific operations a scenario can execute. */
export interface ScenarioAdapter {
	boot(): Promise<unknown>;
	heartbeat(): Promise<unknown>;
	status(step: Extract<ScenarioStep, { type: 'status' }>): Promise<unknown>;
	authorize(step: Extract<ScenarioStep, { type: 'authorize' }>): Promise<boolean>;
	start(step: Extract<ScenarioStep, { type: 'start' }>): Promise<{ ok: boolean; reason?: string }>;
	meter(step: Extract<ScenarioStep, { type: 'meter' }>): Promise<unknown>;
	stop(step: Extract<ScenarioStep, { type: 'stop' }>): Promise<unknown>;
	call(action: string, payload: JsonObject): Promise<JsonObject>;
}

/** Resolves the neutral entity ID, accepting both OCPP aliases. */
export function scenarioEntityId(step: EntityFields, fallback = 1): number {
	return step.entityId ?? step.connectorId ?? step.evseId ?? fallback;
}

/** Resolves the neutral token, accepting the 1.6 `idTag` alias. */
export function scenarioIdToken(step: {
	readonly idToken?: string;
	readonly idTag?: string;
}): string | undefined {
	return step.idToken ?? step.idTag;
}

/**
 * Runs one scenario sequentially. Expected step failures end the run with
 * `failed`; they never throw. A cancellation stops the current wait and marks
 * the run as `cancelled`.
 */
export function runScenario(
	engine: ScenarioEngine,
	adapter: ScenarioAdapter,
	steps: readonly ScenarioStep[],
	options: ScenarioOptions = {},
): ScenarioRun {
	let cancelled = false;
	let cancelWait: (() => void) | undefined;
	const stepsResult: ScenarioStepResult[] = [];
	const startedEntities = new Set<number>();
	const startedAt = engine.now();

	const emit = (
		phase: 'started' | 'step' | 'completed' | 'failed' | 'cancelled',
		index?: number,
		error?: SimulatorErrorSnapshot,
	): void => {
		engine.events.emit({
			type: 'scenario',
			at: engine.now(),
			phase,
			...(index === undefined ? {} : { step: index }),
			...(error === undefined ? {} : { error }),
		});
	};

	const wait = (ms: number): Promise<boolean> =>
		new Promise<boolean>((resolve) => {
			let settled = false;
			let unsubscribe = (): void => undefined;
			const finish = (completed: boolean): void => {
				if (settled) return;
				settled = true;
				cancelWait = undefined;
				unsubscribe();
				resolve(completed);
			};
			const cancel = engine.scheduler.setTimeout(() => finish(true), Math.max(0, ms));
			unsubscribe = engine.scheduler.onCancel(() => {
				cancel();
				finish(false);
			});
			cancelWait = () => {
				cancel();
				finish(false);
			};
		});

	const stopStarted = async (): Promise<void> => {
		for (const entityId of [...startedEntities]) {
			try {
				await adapter.stop({ type: 'stop', entityId, reason: 'Local' });
			} catch {
				// Cancellation cleanup is best effort.
			}
			startedEntities.delete(entityId);
		}
	};

	const done = (async (): Promise<ScenarioResult> => {
		emit('started');
		stepsLoop: for (const [index, step] of steps.entries()) {
			if (cancelled) {
				break;
			}
			emit('step', index);
			try {
				switch (step.type) {
					case 'boot': {
						const result = (await adapter.boot()) as { status?: unknown };
						if (result.status !== undefined && result.status !== 'Accepted') {
							throw new SimulatorError(
								'scenario-failed',
								`BootNotification ended with ${
									typeof result.status === 'string' ? result.status : 'an unknown status'
								}`,
							);
						}
						break;
					}
					case 'heartbeat':
						await adapter.heartbeat();
						break;
					case 'status':
						await adapter.status(step);
						break;
					case 'authorize': {
						const accepted = await adapter.authorize(step);
						if (!accepted) {
							throw new SimulatorError('scenario-failed', 'Authorization was rejected');
						}
						break;
					}
					case 'start': {
						const result = await adapter.start(step);
						if (!result.ok) {
							throw new SimulatorError(
								'scenario-failed',
								result.reason ?? 'The transaction did not start',
							);
						}
						startedEntities.add(scenarioEntityId(step));
						break;
					}
					case 'wait': {
						if (cancelled) {
							stepsResult.push({ index, type: step.type, status: 'skipped' });
							break stepsLoop;
						}
						if (!(await wait(step.ms))) {
							cancelled = true;
							stepsResult.push({ index, type: step.type, status: 'skipped' });
							break stepsLoop;
						}
						break;
					}
					case 'meter':
						await adapter.meter(step);
						break;
					case 'stop': {
						await adapter.stop(step);
						startedEntities.delete(scenarioEntityId(step));
						break;
					}
					case 'call':
						await adapter.call(step.action, step.payload);
						break;
					default: {
						const unreachable: never = step;
						throw new SimulatorError(
							'invalid-options',
							`Unknown scenario step: ${String((unreachable as { type?: unknown }).type)}`,
						);
					}
				}
				stepsResult.push({ index, type: step.type, status: 'ok' });
			} catch (error) {
				if (cancelled) {
					stepsResult.push({ index, type: step.type, status: 'skipped' });
					break;
				}
				const snapshot = errorSnapshot(error);
				stepsResult.push({
					index,
					type: step.type,
					status: 'failed',
					error: snapshot,
				});
				emit('failed', index, snapshot);
				return {
					status: 'failed',
					steps: stepsResult,
					startedAt,
					finishedAt: engine.now(),
					error: snapshot,
				};
			}
		}

		if (cancelled) {
			if (options.stopOnCancel === true) {
				await stopStarted();
			}
			emit('cancelled');
			return {
				status: 'cancelled',
				steps: stepsResult,
				startedAt,
				finishedAt: engine.now(),
			};
		}
		emit('completed');
		return {
			status: 'completed',
			steps: stepsResult,
			startedAt,
			finishedAt: engine.now(),
		};
	})();

	return {
		done,
		cancel: () => {
			if (cancelled) return;
			cancelled = true;
			cancelWait?.();
		},
	};
}
