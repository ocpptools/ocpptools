// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { SimulatorError } from './errors.js';
import { Simulator16 } from './profiles/1.6/index.js';
import { Simulator201 } from './profiles/2.0.1/index.js';
import type { Simulator16Options } from './profiles/1.6/index.js';
import type { Simulator201Options } from './profiles/2.0.1/index.js';

export type CreateSimulatorOptions =
	| ({ readonly version: '1.6' } & Simulator16Options)
	| ({ readonly version: '2.0.1' } & Simulator201Options);

/** Creates the simulator for the requested protocol version. */
export function createSimulator(
	options: { readonly version: '1.6' } & Simulator16Options,
): Simulator16;
export function createSimulator(
	options: { readonly version: '2.0.1' } & Simulator201Options,
): Simulator201;
export function createSimulator(options: CreateSimulatorOptions): Simulator16 | Simulator201;
export function createSimulator(options: CreateSimulatorOptions): Simulator16 | Simulator201 {
	if (options.version === '1.6') {
		const { version: _version, ...rest } = options;
		return new Simulator16(rest);
	}
	if (options.version === '2.0.1') {
		const { version: _version, ...rest } = options;
		return new Simulator201(rest);
	}
	throw new SimulatorError(
		'invalid-options',
		`Unsupported simulator version: ${String((options as { version?: unknown }).version)}`,
	);
}
