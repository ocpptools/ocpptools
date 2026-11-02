// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: [
			'**/dist/**',
			'**/coverage/**',
			'docs/api/**',
			'**/node_modules/**',
			'**/*.tsbuildinfo',
			'.changeset/**',
			// Local, untracked scratch files.
			'personal/**',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ['*.config.*', '*.config.mjs', '*.config.ts', 'scripts/*.mjs'],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['**/*.{js,mjs,cjs}'],
		languageOptions: {
			globals: globals.node,
		},
	},
	{
		rules: {
			'@typescript-eslint/consistent-type-imports': [
				'error',
				{ prefer: 'type-imports', fixStyle: 'inline-type-imports' },
			],
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
		},
	},
	{
		files: ['**/*.test.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{
		files: [
			'**/*.config.*',
			'**/*.config.mjs',
			'**/*.config.ts',
			'scripts/**/*.mjs',
			'scripts/**/*.ts',
		],
		...tseslint.configs.disableTypeChecked,
	},
	prettier,
);
