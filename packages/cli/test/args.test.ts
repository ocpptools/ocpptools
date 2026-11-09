// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, it } from 'vitest';

import { parseArgs, UsageError } from '../src/args.js';
import { runCli } from '../src/index.js';
import { CLI_VERSION } from '../src/version.js';

import { captureIo } from './helpers.js';

describe('arguments', () => {
	it('shows help without arguments or with a help flag', () => {
		expect(parseArgs([])).toEqual({ kind: 'help' });
		expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
		expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
		expect(parseArgs(['help'])).toEqual({ kind: 'help' });
		expect(parseArgs(['validate', '--help'])).toEqual({ kind: 'help' });
	});

	it('parses the version command', () => {
		expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
		expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
		expect(parseArgs(['version'])).toEqual({ kind: 'version' });
	});

	it('parses validate in both value forms', () => {
		expect(parseArgs(['validate', 'frame.json', '--version', '1.6'])).toEqual({
			kind: 'validate',
			file: 'frame.json',
			version: '1.6',
			json: false,
		});
		expect(parseArgs(['validate', '-', '--version=2.0.1', '--action=Heartbeat', '--json'])).toEqual(
			{
				kind: 'validate',
				file: '-',
				version: '2.0.1',
				action: 'Heartbeat',
				json: true,
			},
		);
	});

	it('parses simulate and the scenario run alias', () => {
		expect(parseArgs(['simulate', '--config', 'cp.json', '--scenario', 'run.json'])).toEqual({
			kind: 'simulate',
			configFile: 'cp.json',
			scenarioFile: 'run.json',
			json: false,
		});
		expect(parseArgs(['scenario', 'run', 'run.json', '--config=cp.json', '--json'])).toEqual({
			kind: 'simulate',
			configFile: 'cp.json',
			scenarioFile: 'run.json',
			json: true,
		});
	});

	it('rejects malformed command lines', () => {
		const cases = [
			['unknown'],
			['validate', 'frame.json'],
			['validate', 'frame.json', '--version', '2.1'],
			['validate', 'frame.json', '--version', '1.6', '--bogus'],
			['validate', 'a.json', 'b.json', '--version', '1.6'],
			['validate', 'frame.json', '--version', '1.6', '--version', '2.0.1'],
			['validate', 'frame.json', '--version', '--json'],
			['simulate', '--config', 'cp.json'],
			['simulate', '--scenario', 'run.json'],
			['simulate', 'extra', '--config', 'cp.json', '--scenario', 'run.json'],
			['scenario', 'run', 'run.json'],
			['scenario', 'run', 'a.json', 'b.json', '--config', 'cp.json'],
		];
		for (const args of cases) {
			expect(() => parseArgs(args), args.join(' ')).toThrow(UsageError);
		}
	});

	it('prints help and version with exit code 0', async () => {
		const help = captureIo();
		await expect(runCli([], help.io)).resolves.toBe(0);
		expect(help.stdout()).toContain('Usage:');
		expect(help.stdout()).toContain('ocpptools validate');

		const version = captureIo();
		await expect(runCli(['--version'], version.io)).resolves.toBe(0);
		expect(version.stdout()).toBe(`ocpptools ${CLI_VERSION}\n`);

		const aliases = captureIo();
		await expect(runCli(['help'], aliases.io)).resolves.toBe(0);
		expect(aliases.stdout()).toContain('Usage:');
	});

	it('prints usage errors to stderr with exit code 2', async () => {
		const captured = captureIo();
		await expect(runCli(['--unknown'], captured.io)).resolves.toBe(2);
		expect(captured.stderr()).toContain('Unknown command');
		expect(captured.stderr()).toContain('Usage:');
		expect(captured.stdout()).toBe('');
	});
});
