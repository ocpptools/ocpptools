// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export interface RttStat {
	readonly count: number;
	readonly totalMs: number;
	readonly lastMs: number;
	readonly maxMs: number;
	readonly averageMs: number;
}

export interface SimulatorMetrics {
	readonly errorCountLastMinute: number;
	readonly rttByAction: Readonly<Record<string, RttStat>>;
	readonly heartbeat: {
		readonly samples: number;
		readonly lastDriftMs?: number;
		readonly averageDriftMs?: number;
	};
}

interface MutableRtt {
	count: number;
	totalMs: number;
	lastMs: number;
	maxMs: number;
}

export class Metrics {
	private readonly rtt = new Map<string, MutableRtt>();
	private readonly errors: number[] = [];
	private readonly drifts: number[] = [];
	private lastHeartbeatAt: number | undefined;

	recordRtt(action: string, rttMs: number): void {
		const current = this.rtt.get(action) ?? {
			count: 0,
			totalMs: 0,
			lastMs: 0,
			maxMs: 0,
		};
		current.count += 1;
		current.totalMs += rttMs;
		current.lastMs = rttMs;
		current.maxMs = Math.max(current.maxMs, rttMs);
		this.rtt.set(action, current);
	}

	recordError(at: number): void {
		this.errors.push(at);
	}

	recordHeartbeat(intervalMs: number, at: number): void {
		if (this.lastHeartbeatAt !== undefined) {
			const actual = at - this.lastHeartbeatAt;
			this.drifts.push(actual - intervalMs);
			if (this.drifts.length > 100) {
				this.drifts.shift();
			}
		}
		this.lastHeartbeatAt = at;
	}

	resetHeartbeat(): void {
		this.lastHeartbeatAt = undefined;
	}

	snapshot(now: number): SimulatorMetrics {
		const threshold = now - 60_000;
		while (this.errors.length > 0 && (this.errors[0] ?? 0) < threshold) {
			this.errors.shift();
		}
		const rttByAction: Record<string, RttStat> = {};
		for (const [action, stat] of this.rtt) {
			rttByAction[action] = {
				count: stat.count,
				totalMs: stat.totalMs,
				lastMs: stat.lastMs,
				maxMs: stat.maxMs,
				averageMs: stat.count === 0 ? 0 : stat.totalMs / stat.count,
			};
		}
		const average =
			this.drifts.length === 0
				? undefined
				: this.drifts.reduce((sum, value) => sum + value, 0) / this.drifts.length;
		return {
			errorCountLastMinute: this.errors.length,
			rttByAction,
			heartbeat: {
				samples: this.drifts.length,
				...(this.drifts.length === 0
					? {}
					: {
							lastDriftMs: this.drifts[this.drifts.length - 1],
							averageDriftMs: average,
						}),
			},
		};
	}

	reset(): void {
		this.rtt.clear();
		this.errors.length = 0;
		this.drifts.length = 0;
		this.lastHeartbeatAt = undefined;
	}
}
