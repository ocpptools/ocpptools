// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { CallErrorFrame, CallFrame, CallResultFrame, JsonObject } from '@ocpptools/core';

import { createFrameFactory, type FrameFactory, type FrameFactoryOptions } from './factory.js';

export interface SyntheticFixtures {
	call(): CallFrame;
	/** Uses the call's message ID when provided; otherwise the factory counter. */
	callResult(call?: CallFrame): CallResultFrame;
	/** Uses the call's message ID when provided; otherwise the factory counter. */
	callError(call?: CallFrame): CallErrorFrame;
	payload(): JsonObject;
	invalidFrames(): readonly unknown[];
}

class SyntheticFixturesImpl implements SyntheticFixtures {
	private readonly factory: FrameFactory;

	constructor(options: FrameFactoryOptions) {
		this.factory = createFrameFactory(options);
	}

	call(): CallFrame {
		return this.factory.call('Example', { value: 'example' });
	}

	callResult(call?: CallFrame): CallResultFrame {
		const source = call ?? this.factory.call('Example', { value: 'example' });
		return this.factory.callResult(source, { value: 'example' });
	}

	callError(call?: CallFrame): CallErrorFrame {
		const source = call ?? this.factory.call('Example', { value: 'example' });
		return this.factory.callError(source, 'InternalError', 'Example failure');
	}

	payload(): JsonObject {
		return {
			value: 'example',
			count: 1,
			enabled: true,
			items: ['a', 'b'],
		};
	}

	invalidFrames(): readonly unknown[] {
		return [
			'not json',
			[],
			[2],
			[2, '', 'Example', {}],
			[2, 'msg-1', '', {}],
			[2, 'msg-1', 'Example', []],
			[4, 'msg-1', 42, 'example', {}],
			[9, 'msg-1'],
		];
	}
}

/** Creates fresh synthetic fixtures. They use no OCA schema data. */
export function createSyntheticFixtures(options: FrameFactoryOptions = {}): SyntheticFixtures {
	return new SyntheticFixturesImpl(options);
}
