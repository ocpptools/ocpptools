// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** @type {import("prettier").Config} */
export default {
	useTabs: true,
	tabWidth: 2,
	printWidth: 100,
	singleQuote: true,
	semi: true,
	trailingComma: 'all',
	endOfLine: 'lf',
	overrides: [
		{
			files: ['*.json', '*.jsonc', '*.yml', '*.yaml', '*.md', '*.mdx'],
			options: {
				useTabs: false,
				tabWidth: 2,
			},
		},
	],
};
