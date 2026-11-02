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
