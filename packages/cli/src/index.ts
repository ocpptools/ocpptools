// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { ScenarioRun } from '@ocpptools/simulator';

import { parseArgs, usage, type ParsedCommand } from './args.js';
import {
	applySimulatorConfig,
	createConfiguredSimulator,
	formatSimulationResult,
	loadScenarioFile,
	loadSimulatorConfig,
	runSimulation,
	type CliSimulator,
} from './simulate.js';
import { terminalSafe } from './text.js';
import { formatValidationResult, validateFrameFile } from './validate.js';
import { CLI_VERSION } from './version.js';

export { UsageError, parseArgs, usage } from './args.js';
export type {
	HelpCommand,
	ParsedCommand,
	SimulateCommand,
	ValidateCommand,
	VersionCommand,
} from './args.js';
export { createCliSchemaRegistry, createCliValidator } from './schemas.js';
export {
	applySimulatorConfig,
	createConfiguredSimulator,
	formatSimulationResult,
	loadScenarioFile,
	loadSimulatorConfig,
	parseScenario,
	parseSimulatorConfig,
	runSimulation,
} from './simulate.js';
export type {
	CliSimulator,
	CliStorageOptions,
	CommonCliConfig,
	SimulationOptions,
	SimulatorCliConfig,
} from './simulate.js';
export { formatValidationResult, readInput, validateFrameFile } from './validate.js';
export type { ValidateFrameOptions } from './validate.js';
export { CLI_VERSION } from './version.js';

/** Where the CLI writes. Tests pass a capture instead of the process streams. */
export interface CliIO {
	readonly stdout: (text: string) => void;
	readonly stderr: (text: string) => void;
	/** Reads standard input when a file name is `-`. */
	readonly stdin?: () => Promise<string>;
}

const processIo: CliIO = {
	stdout: (text) => {
		process.stdout.write(text);
	},
	stderr: (text) => {
		process.stderr.write(text);
	},
};

/** Runs the CLI and returns the process exit code. */
export async function runCli(argv: readonly string[], io: CliIO = processIo): Promise<number> {
	let command: ParsedCommand;
	try {
		command = parseArgs(argv);
	} catch (error) {
		io.stderr(`ocpptools: ${terminalSafe(errorMessage(error))}\n\n${usage()}`);
		return 2;
	}

	switch (command.kind) {
		case 'help':
			io.stdout(usage());
			return 0;
		case 'version':
			io.stdout(`ocpptools ${CLI_VERSION}\n`);
			return 0;
		case 'validate':
			return runValidateCommand(command, io);
		case 'simulate':
			return runSimulateCommand(command, io);
	}
}

async function runValidateCommand(
	command: Extract<ParsedCommand, { kind: 'validate' }>,
	io: CliIO,
): Promise<number> {
	let result;
	try {
		result = await validateFrameFile(command.file, command.version, {
			...(command.action === undefined ? {} : { action: command.action }),
			...(io.stdin === undefined ? {} : { stdin: io.stdin }),
		});
	} catch (error) {
		io.stderr(`ocpptools: ${terminalSafe(errorMessage(error))}\n`);
		return 2;
	}
	if (command.json) {
		io.stdout(`${JSON.stringify(result, null, 2)}\n`);
	} else {
		io.stdout(formatValidationResult(result, command.file));
	}
	return result.valid ? 0 : 1;
}

async function runSimulateCommand(
	command: Extract<ParsedCommand, { kind: 'simulate' }>,
	io: CliIO,
): Promise<number> {
	let config;
	let steps;
	try {
		config = await loadSimulatorConfig(command.configFile, io.stdin);
		steps = await loadScenarioFile(command.scenarioFile, io.stdin);
	} catch (error) {
		io.stderr(`ocpptools: ${terminalSafe(errorMessage(error))}\n`);
		return 2;
	}

	let simulator: CliSimulator;
	try {
		simulator = createConfiguredSimulator(config);
	} catch (error) {
		io.stderr(`ocpptools: invalid simulator config: ${terminalSafe(errorMessage(error))}\n`);
		return 2;
	}

	let interrupted: 'SIGINT' | 'SIGTERM' | undefined;
	let activeRun: ScenarioRun | undefined;
	const interrupt = (signal: 'SIGINT' | 'SIGTERM'): void => {
		interrupted = signal;
		if (activeRun === undefined) {
			simulator.disconnect();
			return;
		}
		activeRun.cancel();
		simulator.clearPendingCalls('Interrupted');
	};
	const onSigint = (): void => {
		interrupt('SIGINT');
	};
	const onSigterm = (): void => {
		interrupt('SIGTERM');
	};
	process.on('SIGINT', onSigint);
	process.on('SIGTERM', onSigterm);
	const unsubscribeValidation = simulator.on('validation', (event) => {
		if (event.errors.length === 0) return;
		const label = event.blocked ? 'blocked' : 'validation warning';
		io.stderr(
			`ocpptools: ${label}: ${terminalSafe(event.action)}: ${event.errors
				.map((error) => terminalSafe(error))
				.join('; ')}\n`,
		);
	});

	try {
		const result = await runSimulation(simulator, steps, {
			persist: config.storage !== undefined,
			requireReady: config.boot?.auto === true,
			applyConfig: (current) => applySimulatorConfig(current, config),
			onStart: (run) => {
				activeRun = run;
			},
			onLoadError: (message) => {
				io.stderr(`ocpptools: could not load saved state: ${terminalSafe(message)}\n`);
			},
			onSaveError: (message) => {
				io.stderr(`ocpptools: could not save state: ${terminalSafe(message)}\n`);
			},
		});
		if (command.json) {
			io.stdout(`${JSON.stringify(result, null, 2)}\n`);
		} else {
			io.stdout(formatSimulationResult(result));
		}
		if (interrupted !== undefined) {
			return interrupted === 'SIGINT' ? 130 : 143;
		}
		return result.status === 'completed' ? 0 : 3;
	} catch (error) {
		if (interrupted !== undefined) {
			io.stderr(`ocpptools: simulation cancelled by ${interrupted}\n`);
			return interrupted === 'SIGINT' ? 130 : 143;
		}
		io.stderr(`ocpptools: simulation failed: ${terminalSafe(errorMessage(error))}\n`);
		return 3;
	} finally {
		process.off('SIGINT', onSigint);
		process.off('SIGTERM', onSigterm);
		unsubscribeValidation();
		simulator.dispose();
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message !== '' ? error.message : String(error);
}
