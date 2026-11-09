// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export default [
	{
		path: 'dist/index.js',
		limit: '1 kB',
		disablePlugins: ['@size-limit/esbuild'],
	},
	{
		path: 'dist/1.6.js',
		limit: '1 kB',
		disablePlugins: ['@size-limit/esbuild'],
	},
	{
		path: 'dist/2.0.1.js',
		limit: '1 kB',
		disablePlugins: ['@size-limit/esbuild'],
	},
	{
		path: 'dist/browser/index.js',
		limit: '1 kB',
		disablePlugins: ['@size-limit/esbuild'],
	},
	{
		path: 'dist/node/index.js',
		limit: '1 kB',
		disablePlugins: ['@size-limit/esbuild'],
	},
];
