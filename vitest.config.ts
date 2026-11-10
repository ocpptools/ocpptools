// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Tests of one package run against the source of the packages it depends
		// on, not their `dist`, which may be missing or out of date.
		alias: {
			'@ocpptools/core': fileURLToPath(new URL('packages/core/src/index.ts', import.meta.url)),
			'@ocpptools/schema-utils': fileURLToPath(
				new URL('packages/schema-utils/src/index.ts', import.meta.url),
			),
			'@ocpptools/validator': fileURLToPath(
				new URL('packages/validator/src/index.ts', import.meta.url),
			),
			'@ocpptools/builder': fileURLToPath(
				new URL('packages/builder/src/index.ts', import.meta.url),
			),
			// Subpaths go before the package root: Vite matches aliases by prefix.
			'@ocpptools/simulator/browser': fileURLToPath(
				new URL('packages/simulator/src/browser/index.ts', import.meta.url),
			),
			'@ocpptools/simulator/node': fileURLToPath(
				new URL('packages/simulator/src/node/index.ts', import.meta.url),
			),
			'@ocpptools/simulator/1.6': fileURLToPath(
				new URL('packages/simulator/src/1.6.ts', import.meta.url),
			),
			'@ocpptools/simulator/2.0.1': fileURLToPath(
				new URL('packages/simulator/src/2.0.1.ts', import.meta.url),
			),
			'@ocpptools/simulator': fileURLToPath(
				new URL('packages/simulator/src/index.ts', import.meta.url),
			),
		},
	},
	test: {
		include: ['packages/*/test/**/*.test.ts', 'scripts/test/**/*.test.mjs'],
		environment: 'node',
		clearMocks: true,
		restoreMocks: true,
		mockReset: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			reportsDirectory: 'coverage',
			include: ['packages/*/src/**/*.ts'],
			exclude: ['packages/*/test/**', 'packages/*/dist/**'],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
	},
});
