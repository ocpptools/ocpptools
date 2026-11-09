// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

export interface CapturedIo {
	readonly io: {
		readonly stdout: (text: string) => void;
		readonly stderr: (text: string) => void;
		readonly stdin?: () => Promise<string>;
	};
	readonly stdout: () => string;
	readonly stderr: () => string;
}

export function captureIo(stdin?: () => Promise<string>): CapturedIo {
	let stdout = '';
	let stderr = '';
	return {
		io: {
			stdout: (text) => {
				stdout += text;
			},
			stderr: (text) => {
				stderr += text;
			},
			...(stdin === undefined ? {} : { stdin }),
		},
		stdout: () => stdout,
		stderr: () => stderr,
	};
}
