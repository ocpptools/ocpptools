// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/index.js';

import { captureIo } from './helpers.js';

const directories: string[] = [];

async function fixture(name: string, value: unknown): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'ocpptools-cli-validate-'));
	directories.push(directory);
	const path = join(directory, name);
	await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
	return path;
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

function frame(...items: unknown[]): unknown[] {
	return items;
}

describe('validate command', () => {
	it('accepts valid OCPP 1.6 and 2.0.1 CALL frames', async () => {
		const legacy = await fixture(
			'boot-16.json',
			frame(2, 'id-1', 'BootNotification', {
				chargePointVendor: 'Acme',
				chargePointModel: 'AC-7',
			}),
		);
		const modern = await fixture(
			'boot-201.json',
			frame(2, 'id-2', 'BootNotification', {
				reason: 'PowerUp',
				chargingStation: { model: 'AC-22', vendorName: 'Acme' },
			}),
		);

		for (const [file, version] of [
			[legacy, '1.6'],
			[modern, '2.0.1'],
		] as const) {
			const captured = captureIo();
			await expect(runCli(['validate', file, '--version', version], captured.io)).resolves.toBe(0);
			expect(captured.stdout()).toContain('Valid:');
			expect(captured.stdout()).toContain('(valid)');
		}
	});

	it('rejects invalid 1.6 and 2.0.1 payloads with exit code 1', async () => {
		const legacy = await fixture('bad-16.json', frame(2, 'id-1', 'Heartbeat', { currentTime: 1 }));
		const modern = await fixture('bad-201.json', frame(2, 'id-2', 'Heartbeat', { currentTime: 1 }));

		for (const [file, version] of [
			[legacy, '1.6'],
			[modern, '2.0.1'],
		] as const) {
			const captured = captureIo();
			await expect(runCli(['validate', file, '--version', version], captured.io)).resolves.toBe(1);
			expect(captured.stdout()).toContain('Invalid:');
			expect(captured.stdout()).toMatch(/\/3/);
		}
	});

	it('checks a CALLRESULT payload when --action is given', async () => {
		const file = await fixture('heartbeat-response.json', frame(3, 'id-1', { currentTime: 1 }));

		const checked = captureIo();
		await expect(
			runCli(['validate', file, '--version', '1.6', '--action', 'Heartbeat'], checked.io),
		).resolves.toBe(1);
		expect(checked.stdout()).toContain('Invalid:');
		expect(checked.stdout()).toMatch(/\/2/);

		const unchecked = captureIo();
		await expect(runCli(['validate', file, '--version', '1.6'], unchecked.io)).resolves.toBe(0);
		expect(unchecked.stdout()).toContain('Warnings:');
		expect(unchecked.stdout()).toContain('unchecked-result');
	});

	it('prints the ValidationResult JSON with --json', async () => {
		const file = await fixture(
			'boot-16.json',
			frame(2, 'id-1', 'BootNotification', {
				chargePointVendor: 'Acme',
				chargePointModel: 'AC-7',
			}),
		);
		const captured = captureIo();
		await expect(
			runCli(['validate', file, '--version', '1.6', '--json'], captured.io),
		).resolves.toBe(0);
		const result = JSON.parse(captured.stdout()) as {
			status?: string;
			valid?: boolean;
			messageType?: number;
		};
		expect(result).toMatchObject({ status: 'valid', valid: true, messageType: 2 });
	});

	it('reads a frame from standard input', async () => {
		const captured = captureIo(() => Promise.resolve('[2,"id-1","Heartbeat",{}]'));
		await expect(runCli(['validate', '-', '--version', '1.6'], captured.io)).resolves.toBe(0);
		expect(captured.stdout()).toContain('Valid: stdin');
	});

	it('treats missing files, invalid JSON, and bad versions as input errors', async () => {
		const invalidJson = await fixture('frame.json', '{');
		const cases = [
			['validate', join(tmpdir(), 'definitely-missing-ocpptools.json'), '--version', '1.6'],
			['validate', invalidJson, '--version', '1.6'],
			['validate', invalidJson, '--version', '2.1'],
			['validate', invalidJson, '--version', '2.1.0'],
			['validate', invalidJson],
		];
		for (const args of cases) {
			const captured = captureIo();
			await expect(runCli(args, captured.io), args.join(' ')).resolves.toBe(2);
			expect(captured.stderr()).not.toBe('');
			expect(captured.stdout()).toBe('');
		}
	});
});
