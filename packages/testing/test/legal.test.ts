// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function files(directory: string): string[] {
	const entries = readdirSync(directory, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? files(path) : [path];
	});
}

const sourceFiles = files(join(root, 'src'));
const source = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
	string,
	Record<string, string> | undefined
>;
const readme = readFileSync(join(root, 'README.md'), 'utf8');

describe('legal and packaging boundary', () => {
	it('keeps schema, validator, simulator, Ajv, ws and Node out of runtime dependencies', () => {
		for (const bucket of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
			const dependencies = manifest[bucket] ?? {};
			for (const name of [
				'@ocpptools/schemas',
				'@ocpptools/validator',
				'@ocpptools/simulator',
				'ajv',
				'ajv-formats',
				'ws',
			]) {
				expect(dependencies[name], `${bucket} contains ${name}`).toBeUndefined();
			}
		}
		expect(manifest['dependencies']?.['@ocpptools/core']).toBeDefined();
	});

	it('does not import OCA data, validator, simulator, Ajv, ws or Node built-ins from source', () => {
		for (const specifier of [
			'@ocpptools/schemas',
			'@ocpptools/validator',
			'@ocpptools/simulator',
			'ajv',
			'ajv-formats',
			'ws',
			'node:',
		]) {
			expect(source.includes(`from '${specifier}`), specifier).toBe(false);
		}
	});

	it('ships no schema text or generated action catalogue', () => {
		for (const marker of [
			'OCPP 2.0.1 FINAL',
			'urn:OCPP',
			'"$schema"',
			'BootNotification',
			'Heartbeat',
		]) {
			expect(source.includes(marker), marker).toBe(false);
		}
	});

	it('keeps the README unpublished and uses synthetic examples', () => {
		expect(readme).toContain('unpublished');
		expect(readme).not.toContain('npm install @ocpptools/testing');
		expect(readme).toContain('Example');
		expect(readme).toMatch(/not\s+affiliated/);
	});

	it('declares the expected files and no OCA license file', () => {
		expect(manifest['files']).toEqual(['dist', 'NOTICE']);
		expect(existsSync(join(root, 'LICENSE-CC-BY-ND-4.0.txt'))).toBe(false);
	});

	it('has SPDX headers on every source file and no AI attribution', () => {
		for (const marker of ['Co-Authored-By:', 'Generated-by:', 'Assisted-by:']) {
			expect(`${source}
${readme}`).not.toContain(marker);
		}
		for (const file of sourceFiles) {
			const spdx = ['// SPDX-License-', 'Identifier: Apache-2.0'].join('');
			expect(readFileSync(file, 'utf8').startsWith(spdx)).toBe(true);
		}
	});
});
