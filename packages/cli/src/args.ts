// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { OcppVersion } from '@ocpptools/core';

/** A command line that cannot be parsed. The CLI reports it and exits with 2. */
export class UsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UsageError';
	}
}

export interface HelpCommand {
	readonly kind: 'help';
}

export interface VersionCommand {
	readonly kind: 'version';
}

export interface ValidateCommand {
	readonly kind: 'validate';
	/** The frame file, or `-` for standard input. */
	readonly file: string;
	readonly version: OcppVersion;
	/** The request action of a CALLRESULT. */
	readonly action?: string;
	readonly json: boolean;
}

export interface SimulateCommand {
	readonly kind: 'simulate';
	/** The simulator config file, or `-` for standard input. */
	readonly configFile: string;
	/** The scenario file, or `-` for standard input. */
	readonly scenarioFile: string;
	readonly json: boolean;
}

export type ParsedCommand = HelpCommand | VersionCommand | ValidateCommand | SimulateCommand;

/** The text printed for `--help` and when the CLI runs without arguments. */
export function usage(): string {
	return `Usage:
  ocpptools validate <frame.json> --version <1.6|2.0.1> [--action <RequestAction>] [--json]
  ocpptools simulate --config <file> --scenario <file> [--json]
  ocpptools scenario run <file> --config <file> [--json]
  ocpptools --help
  ocpptools --version

Commands:
  validate   Validate an OCPP-J frame against the OCA JSON Schemas.
  simulate   Connect a charge point simulator and run a scenario.
  scenario   Alias for "scenario run <file> --config <file>".

Options:
  --version <version>  OCPP version of the frame: 1.6 or 2.0.1.
  --action <action>    Request action of a CALLRESULT, used to check its payload.
  --config <file>      Simulator config JSON file.
  --scenario <file>    Scenario JSON file.
  --json               Print the machine-readable result as JSON.
  -h, --help           Show this help and exit.
  -v, --version        Show the CLI version and exit.

Use "-" as a file name to read standard input.
`;
}

/**
 * Parses `process.argv.slice(2)`. The parser is strict: unknown options,
 * repeated options, and extra positionals are errors. Help wins over every
 * other argument.
 */
export function parseArgs(argv: readonly string[]): ParsedCommand {
	const args = [...argv];
	if (args.some((arg) => arg === '--help' || arg === '-h')) {
		return { kind: 'help' };
	}
	if (args.length === 0) {
		return { kind: 'help' };
	}
	const [first, ...rest] = args;
	if (first === 'help') {
		if (rest.length > 0) {
			throw new UsageError('help does not take arguments');
		}
		return { kind: 'help' };
	}
	if (first === 'version' || first === '--version' || first === '-v') {
		if (rest.length > 0) {
			throw new UsageError('--version does not take arguments');
		}
		return { kind: 'version' };
	}
	if (first === 'validate') {
		return parseValidate(rest);
	}
	if (first === 'simulate') {
		return parseSimulate(rest, false);
	}
	if (first === 'scenario') {
		if (rest[0] !== 'run') {
			throw new UsageError('Expected "scenario run <file> --config <file>"');
		}
		return parseSimulate(rest.slice(1), true);
	}
	throw new UsageError(`Unknown command: ${first ?? ''}`);
}

function parseValidate(args: readonly string[]): ValidateCommand {
	const values = new Map<string, string>();
	let file: string | undefined;
	let json = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? '';
		if (arg === '--json') {
			if (json) throw new UsageError('--json was given more than once');
			json = true;
			continue;
		}
		const option = optionName(arg);
		if (option !== undefined) {
			const value = optionValue(args, index, option, values);
			if (optionValueConsumed(args[index] ?? '')) index += 1;
			values.set(option, value);
			continue;
		}
		if (arg.startsWith('-') && arg !== '-') {
			throw new UsageError(`Unknown option for validate: ${arg}`);
		}
		if (file !== undefined) {
			throw new UsageError(`Unexpected argument for validate: ${arg}`);
		}
		file = arg;
	}

	if (file === undefined) {
		throw new UsageError('validate requires a frame file');
	}
	const rawVersion = values.get('--version');
	if (rawVersion === undefined) {
		throw new UsageError('validate requires --version <1.6|2.0.1>');
	}
	const version = parseVersion(rawVersion);
	const action = values.get('--action');
	if (action !== undefined && action.trim() === '') {
		throw new UsageError('--action must not be empty');
	}
	return {
		kind: 'validate',
		file,
		version,
		...(action === undefined ? {} : { action }),
		json,
	};
}

function parseSimulate(args: readonly string[], scenarioPositional: boolean): SimulateCommand {
	const values = new Map<string, string>();
	let json = false;
	let positional: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? '';
		if (arg === '--json') {
			if (json) throw new UsageError('--json was given more than once');
			json = true;
			continue;
		}
		const option = optionName(arg);
		if (option !== undefined) {
			if (option !== '--config' && option !== '--scenario') {
				throw new UsageError(`Unknown option for simulate: ${arg}`);
			}
			const value = optionValue(args, index, option, values);
			if (optionValueConsumed(args[index] ?? '')) index += 1;
			values.set(option, value);
			continue;
		}
		if (arg.startsWith('-') && arg !== '-') {
			throw new UsageError(`Unknown option for simulate: ${arg}`);
		}
		if (!scenarioPositional) {
			throw new UsageError(`Unexpected argument for simulate: ${arg}`);
		}
		if (positional !== undefined) {
			throw new UsageError(`Unexpected argument for scenario run: ${arg}`);
		}
		positional = arg;
	}

	const configFile = values.get('--config');
	if (configFile === undefined) {
		throw new UsageError('simulate requires --config <file>');
	}
	const flaggedScenario = values.get('--scenario');
	if (positional !== undefined && flaggedScenario !== undefined) {
		throw new UsageError('Give the scenario once, as a file or with --scenario');
	}
	const scenarioFile = positional ?? flaggedScenario;
	if (scenarioFile === undefined) {
		throw new UsageError('simulate requires --scenario <file>');
	}
	return { kind: 'simulate', configFile, scenarioFile, json };
}

function optionName(arg: string): '--version' | '--action' | '--config' | '--scenario' | undefined {
	for (const name of ['--version', '--action', '--config', '--scenario'] as const) {
		if (arg === name || arg.startsWith(`${name}=`)) return name;
	}
	return undefined;
}

function optionValue(
	args: readonly string[],
	index: number,
	option: string,
	values: Map<string, string>,
): string {
	if (values.has(option)) {
		throw new UsageError(`${option} was given more than once`);
	}
	const arg = args[index] ?? '';
	const inline = arg.startsWith(`${option}=`) ? arg.slice(option.length + 1) : undefined;
	if (inline !== undefined) {
		if (inline === '') throw new UsageError(`${option} requires a value`);
		return inline;
	}
	const next = args[index + 1];
	if (next === undefined || (next.startsWith('-') && next !== '-')) {
		throw new UsageError(`${option} requires a value`);
	}
	if (next === '') throw new UsageError(`${option} requires a value`);
	return next;
}

function optionValueConsumed(arg: string): boolean {
	return !arg.includes('=');
}

function parseVersion(value: string): OcppVersion {
	if (value === '1.6' || value === '2.0.1') return value;
	throw new UsageError(`Unsupported OCPP version: ${value}. Use 1.6 or 2.0.1`);
}
