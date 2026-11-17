// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Records docs/assets/browser-validator.mp4 and docs/assets/browser-validator.gif
// with webreel.
//
// The page in scripts/demos/browser is bundled with the published
// @ocpptools/validator and @ocpptools/schemas packages from npm and served on
// 127.0.0.1:4173. Everything runs in a temporary workspace; only the rendered
// files are copied into docs/assets.
//
// Usage: node scripts/demos/record-browser.mjs

import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

import {
	createWorkspace,
	demosDir,
	isWindows,
	publishAsset,
	requireTool,
	run,
	runAsync,
} from './lib.mjs';

const VERSIONS = {
	validator: '0.3.1',
	schemas: '0.1.0',
	esbuild: '0.28.2',
	webreel: '0.1.4',
};
const PORT = 4173;

requireTool('ffmpeg', ['-version']);

const workspace = createWorkspace('browser-demo');
const site = join(workspace, 'site');
const src = join(workspace, 'src');
mkdirSync(site, { recursive: true });
mkdirSync(src, { recursive: true });

writeFileSync(join(workspace, 'package.json'), '{ "private": true }\n');
run(
	'npm',
	[
		'install',
		`@ocpptools/validator@${VERSIONS.validator}`,
		`@ocpptools/schemas@${VERSIONS.schemas}`,
		`esbuild@${VERSIONS.esbuild}`,
		`webreel@${VERSIONS.webreel}`,
		'--no-audit',
		'--no-fund',
	],
	{ cwd: workspace },
);
patchWebreel(join(workspace, 'node_modules'));

// Copy the official schemas unmodified and list them for the page.
const schemasRoot = join(workspace, 'node_modules', '@ocpptools', 'schemas', 'schemas');
const files = {};
for (const version of ['1.6', '2.0.1']) {
	files[version] = readdirSync(join(schemasRoot, version)).filter((name) => name.endsWith('.json'));
	cpSync(join(schemasRoot, version), join(site, 'schemas', version), { recursive: true });
}
writeFileSync(join(src, 'schema-files.json'), JSON.stringify(files));
copyFileSync(join(demosDir, 'browser', 'app.mjs'), join(src, 'app.mjs'));
copyFileSync(join(demosDir, 'browser', 'index.html'), join(site, 'index.html'));
copyFileSync(
	// Kept as webreel.json in the repository so ESLint does not lint it as a
	// `*.config.*` module; webreel discovers it as webreel.config.json.
	join(demosDir, 'browser', 'webreel.json'),
	join(workspace, 'webreel.config.json'),
);

run(
	join('node_modules', '.bin', 'esbuild'),
	[
		'src/app.mjs',
		'--bundle',
		'--format=esm',
		'--target=es2022',
		'--minify',
		'--outfile=site/app.js',
	],
	{ cwd: workspace },
);

const server = serve(site);
try {
	// webreel 0.1.4 can exit non-zero on Windows after "Done" while it removes
	// its temporary Chrome profile, so check for the output file instead.
	await runAsync(
		join('node_modules', '.bin', 'webreel'),
		['record', 'browser-validator', '--verbose'],
		{
			cwd: workspace,
		},
	);
} finally {
	server.close();
}

const video = join(workspace, 'videos', 'browser-validator.mp4');
if (!existsSync(video)) throw new Error('webreel did not produce browser-validator.mp4');

const gif = join(workspace, 'videos', 'browser-validator.gif');
run(
	'ffmpeg',
	[
		'-v',
		'error',
		'-y',
		'-i',
		video,
		'-vf',
		'fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
		gif,
	],
	{ shell: false },
);

publishAsset(video, 'browser-validator.mp4');
publishAsset(gif, 'browser-validator.gif');
console.log(`Workspace kept for inspection: ${workspace}`);

/**
 * Serves a directory on 127.0.0.1 only.
 *
 * @param {string} root
 */
function serve(root) {
	const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
	return createServer((request, response) => {
		const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname));
		const file = join(root, path === sep || path === '/' ? 'index.html' : path);
		if (!file.startsWith(root)) {
			response.writeHead(403).end();
			return;
		}
		readFile(file).then(
			(body) => {
				response.writeHead(200, {
					'content-type': types[extname(file)] ?? 'application/octet-stream',
				});
				response.end(body);
			},
			() => response.writeHead(404).end(),
		);
	}).listen(PORT, '127.0.0.1');
}

/**
 * Applies local fixes to webreel 0.1.4 in the temporary workspace. Each patch
 * fails loudly if the upstream code changed, so a new webreel version is
 * noticed instead of silently recording a broken video.
 *
 * - The type step resolved its target by the text to type instead of the
 *   selector.
 * - The recorder never read ffmpeg's output, so a full pipe could stall it.
 * - On Windows, `--enable-begin-frame-control` stalls Page.captureScreenshot,
 *   and "char" key events insert no text in chrome-headless-shell.
 *
 * @param {string} nodeModules
 */
function patchWebreel(nodeModules) {
	const patches = [
		{
			file: join(nodeModules, 'webreel', 'dist', 'lib', 'runner.js'),
			from: 'const box = await resolveTarget(client, step);\n                            const { x: tx, y: ty } = randomPointInBox(box);\n                            await clickAt(ctx, client, tx, ty);\n                            await client.Runtime.evaluate({\n                                expression: `document.querySelector(',
			to: 'const box = await resolveTarget(client, { selector: step.selector, within: step.within });\n                            const { x: tx, y: ty } = randomPointInBox(box);\n                            await clickAt(ctx, client, tx, ty);\n                            await client.Runtime.evaluate({\n                                expression: `document.querySelector(',
		},
		{
			file: join(nodeModules, '@webreel', 'core', 'dist', 'recorder.js'),
			from: 'const stdin = this.ffmpegProcess.stdin;',
			to: 'this.ffmpegProcess.stdout?.resume();\n        this.ffmpegProcess.stderr?.resume();\n        const stdin = this.ffmpegProcess.stdin;',
		},
	];
	if (isWindows) {
		patches.push(
			{
				file: join(nodeModules, '@webreel', 'core', 'dist', 'chrome.js'),
				from: '"--enable-begin-frame-control",\n',
				to: '',
			},
			{
				file: join(nodeModules, '@webreel', 'core', 'dist', 'actions.js'),
				from: 'await client.Input.dispatchKeyEvent({\n            type: "char",\n            key: char,\n            text: char,\n        });',
				to: 'await client.Input.insertText({ text: char });',
			},
		);
	}
	for (const patch of patches) {
		const original = readFileSync(patch.file, 'utf8').replaceAll('\r\n', '\n');
		if (!original.includes(patch.from)) {
			throw new Error(`webreel changed; review the patch for ${patch.file}`);
		}
		writeFileSync(patch.file, original.replace(patch.from, patch.to));
	}
}
