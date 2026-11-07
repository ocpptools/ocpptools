// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export default [
	{
		path: 'dist/*.js',
		limit: '7 kB',
		disablePlugins: ['@size-limit/esbuild'],
	},
	{
		// Dist + Ajv + ajv-formats + core + schema-utils, measured at 40.8 kB.
		import: '{ createValidator }',
		limit: '45 kB',
		modifyEsbuildConfig: (config) => ({ ...config, tsconfigRaw: '{}' }),
	},
];
