// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export default [
	{
		path: 'dist/*.js',
		limit: '30 kB',
		disablePlugins: ['@size-limit/esbuild'],
	},
];
