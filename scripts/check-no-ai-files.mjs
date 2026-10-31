// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Fails when any AI-assistant file is tracked by Git. `.gitignore` only stops
// a plain `git add`; this check also catches `git add -f` and fork pull requests.

import { execFileSync } from 'node:child_process';

const fileNames = new Set([
	'agents.md',
	'agents.local.md',
	'agent.md',
	'claude.md',
	'claude.local.md',
	'gemini.md',
	'gemini.local.md',
	'qwen.md',
	'.cursorrules',
	'.windsurfrules',
	'.clinerules',
	'.roorules',
	'.roomodes',
	'.goosehints',
	'opencode.json',
	'.mcp.json',
	'.mcp.local.json',
]);

const fileNamePatterns = [/\.prompt\.md$/, /^copilot-instructions(\.local)?\.md$/, /^\.aider/];

const directoryNames = new Set([
	'.claude',
	'.claude-flow',
	'.cursor',
	'.windsurf',
	'.continue',
	'.codex',
	'.gemini',
	'.robot',
	'.openhands',
	'.agents',
	'.opencode',
	'.kiro',
	'.roo',
	'.cline',
	'.augment',
	'.amazonq',
	'.junie',
	'.trae',
	'.copilot',
	'.caveman',
	'.prompts',
	'graphify-out',
]);

const githubAiDirectories = new Set(['instructions', 'prompts', 'agents', 'chatmodes']);

/** @param {string} path */
function isAiFile(path) {
	const segments = path.toLowerCase().split('/');
	const name = segments[segments.length - 1] ?? '';
	if (fileNames.has(name) || fileNamePatterns.some((pattern) => pattern.test(name))) {
		return true;
	}
	const directories = segments.slice(0, -1);
	if (directories.some((directory) => directoryNames.has(directory))) {
		return true;
	}
	return segments[0] === '.github' && githubAiDirectories.has(segments[1] ?? '');
}

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
	.split('\0')
	.filter(Boolean);
const offenders = tracked.filter(isAiFile);

if (offenders.length > 0) {
	console.error('AI-assistant files must not be versioned. Remove them from Git:');
	for (const path of offenders) {
		console.error(`  git rm --cached ${path}`);
	}
	process.exit(1);
}

console.log(`No AI-assistant files tracked (${tracked.length} files checked).`);
