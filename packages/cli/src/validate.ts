// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { readFile } from 'node:fs/promises';

import type { OcppVersion } from '@ocpptools/core';
import { createValidator, type ValidationIssue, type ValidationResult } from '@ocpptools/validator';

import { createCliValidator } from './schemas.js';
import { terminalSafe } from './text.js';

export interface ValidateFrameOptions {
	/** The action of the request a CALLRESULT answers. */
	readonly action?: string;
	/** Reads standard input when the file is `-`. */
	readonly stdin?: () => Promise<string>;
	/** Use the OCA schemas. When false, only the frame shape is checked. */
	readonly schema?: boolean;
}

/** Reads a text file, or standard input when the name is `-`. */
export async function readInput(file: string, stdin?: () => Promise<string>): Promise<string> {
	if (file === '-') {
		return stdin === undefined ? readStandardInput() : stdin();
	}
	try {
		return await readFile(file, 'utf8');
	} catch (error) {
		throw new Error(`Could not read ${file}: ${errorMessage(error)}`, { cause: error });
	}
}

/**
 * Reads a frame as JSON text and validates it with the official schemas. A
 * missing or unreadable file, or invalid JSON, throws: those are input errors,
 * not invalid frames.
 */
export async function validateFrameFile(
	file: string,
	version: OcppVersion,
	options: ValidateFrameOptions = {},
): Promise<ValidationResult> {
	const text = await readInput(file, options.stdin);
	let frame: unknown;
	try {
		frame = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(`The file ${file} is not valid JSON: ${errorMessage(error)}`, {
			cause: error,
		});
	}
	const validator =
		options.schema === false
			? createValidator({ version, schemas: { get: () => true } })
			: createCliValidator(version);
	return options.action === undefined
		? validator.validateFrame(frame)
		: validator.validateFrame(frame, { requestAction: options.action });
}

/** Formats a validation result for a terminal, including every issue path. */
export function formatValidationResult(result: ValidationResult, file: string): string {
	const label = file === '-' ? 'stdin' : terminalSafe(file);
	const lines = [`${result.valid ? 'Valid' : 'Invalid'}: ${label} (${result.status})`];
	for (const issue of result.issues) {
		lines.push(formatIssue(issue));
	}
	if (result.warnings.length > 0) {
		lines.push('Warnings:');
		for (const warning of result.warnings) {
			lines.push(formatIssue(warning));
		}
	}
	return `${lines.join('\n')}\n`;
}

function formatIssue(issue: ValidationIssue): string {
	const location = issue.pointer === '' ? '(root)' : terminalSafe(issue.pointer);
	return `  ${location} [${terminalSafe(issue.code)}] ${terminalSafe(issue.message)}`;
}

async function readStandardInput(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
	}
	return Buffer.concat(chunks).toString('utf8');
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message !== '' ? error.message : String(error);
}
