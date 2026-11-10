// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** Where a plain-JSON violation happened, from the root. */
export type PlainJsonPath = readonly (string | number)[];

/** A value cannot be represented as a plain JSON value. Internal to the package. */
export class PlainJsonError extends Error {
	readonly path: PlainJsonPath;

	constructor(message: string, path: PlainJsonPath = []) {
		super(message);
		this.name = 'PlainJsonError';
		this.path = path;
	}
}

export interface PlainJsonLimits {
	readonly maxDepth: number;
	readonly maxNodes: number;
}

const DEFAULT_LIMITS: PlainJsonLimits = {
	maxDepth: 64,
	maxNodes: 10_000,
};

interface State {
	readonly limits: PlainJsonLimits;
	readonly stack: WeakSet<object>;
	nodes: number;
}

function describe(path: PlainJsonPath): string {
	if (path.length === 0) return '$';
	let text = '$';
	for (const segment of path) {
		text += typeof segment === 'number' ? `[${String(segment)}]` : `.${segment}`;
	}
	return text;
}

function fail(path: PlainJsonPath, message: string): never {
	throw new PlainJsonError(`${message} at ${describe(path)}`, path);
}

function isCanonicalIndex(key: string, length: number): boolean {
	if (!/^(0|[1-9]\d*)$/.test(key)) return false;
	const index = Number(key);
	return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function visit(value: unknown, path: PlainJsonPath, depth: number, state: State): void {
	state.nodes += 1;
	if (state.nodes > state.limits.maxNodes) {
		fail(path, 'The value exceeds the configured node limit');
	}
	if (depth > state.limits.maxDepth) {
		fail(path, 'The value exceeds the configured depth limit');
	}

	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) fail(path, 'Non-finite numbers are not JSON');
		return;
	}
	if (typeof value !== 'object') {
		fail(path, `${typeof value} is not a JSON value`);
	}
	if (state.stack.has(value)) fail(path, 'Cycles are not JSON');

	state.stack.add(value);
	try {
		if (Array.isArray(value)) {
			if (Object.getOwnPropertySymbols(value).length > 0) {
				fail(path, 'Symbol keys are not JSON');
			}
			for (const key of Reflect.ownKeys(value)) {
				if (key === 'length') continue;
				if (typeof key === 'symbol') fail(path, 'Symbol keys are not JSON');
				if (!isCanonicalIndex(key, value.length)) {
					fail([...path, key], 'Only array indexes are allowed on an array');
				}
			}
			for (let index = 0; index < value.length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
				if (descriptor === undefined) fail([...path, index], 'Sparse arrays are not JSON');
				if (descriptor.get !== undefined || descriptor.set !== undefined) {
					fail([...path, index], 'Accessors are not JSON');
				}
				if (descriptor.enumerable !== true) {
					fail([...path, index], 'Non-enumerable array items are not JSON');
				}
				visit(descriptor.value, [...path, index], depth + 1, state);
			}
			return;
		}

		const prototype = Reflect.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			fail(path, 'Only plain objects are JSON');
		}
		if (Object.getOwnPropertySymbols(value).length > 0) {
			fail(path, 'Symbol keys are not JSON');
		}
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key === 'symbol') fail(path, 'Symbol keys are not JSON');
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor === undefined) continue;
			if (descriptor.get !== undefined || descriptor.set !== undefined) {
				fail([...path, key], 'Accessors are not JSON');
			}
			if (descriptor.enumerable !== true) {
				fail([...path, key], 'Non-enumerable properties are not JSON');
			}
			visit(descriptor.value, [...path, key], depth + 1, state);
		}
	} finally {
		state.stack.delete(value);
	}
}

/** Validates that a value has a plain JSON form. It never invokes getters or `toJSON`. */
export function assertPlainJson(value: unknown, limits: PlainJsonLimits = DEFAULT_LIMITS): void {
	if (!Number.isSafeInteger(limits.maxDepth) || limits.maxDepth <= 0) {
		throw new PlainJsonError('maxDepth must be a positive safe integer');
	}
	if (!Number.isSafeInteger(limits.maxNodes) || limits.maxNodes <= 0) {
		throw new PlainJsonError('maxNodes must be a positive safe integer');
	}
	visit(value, [], 0, {
		limits,
		stack: new WeakSet<object>(),
		nodes: 0,
	});
}

/** Whether a value is a plain JSON object, not an array, null, or a class instance. */
export function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
