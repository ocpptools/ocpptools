// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { defineConfig } from 'vitest/config';

export default defineConfig({
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
