// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Browser demo page for docs/assets/browser-validator.*. Bundled by
// scripts/demos/record-browser.mjs; `schema-files.json` is generated there from
// the installed @ocpptools/schemas package.

import { createSchemaRegistry, createValidator } from '@ocpptools/validator';

import schemaFiles from './schema-files.json';

const validators = new Map();

function validatorFor(version) {
	let validator = validators.get(version);
	if (validator === undefined) {
		const schemas = createSchemaRegistry({
			version,
			files: schemaFiles[version],
			load: async (file) => {
				const response = await fetch(`schemas/${version}/${file}`);
				return response.json();
			},
		});
		validator = createValidator({ version, schemas });
		validators.set(version, validator);
	}
	return validator;
}

const frameInput = document.querySelector('#frame');
const versionInput = document.querySelector('#version');
const resultView = document.querySelector('#result');

function escape(text) {
	return String(text).replace(
		/[&<>"]/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char],
	);
}

function describe(input) {
	try {
		const frame = JSON.parse(input);
		const kind = { 2: 'CALL', 3: 'CALLRESULT', 4: 'CALLERROR' }[frame[0]] ?? 'frame';
		return frame[0] === 2 ? `${kind} ${frame[2]}` : kind;
	} catch {
		return 'frame';
	}
}

async function validate() {
	const version = versionInput.value;
	const input = frameInput.value;
	const result = await validatorFor(version).validateFrame(input);
	const valid = result.status === 'valid';
	const label = version === '1.6' ? '1.6J' : version;
	let html = `<span class="status ${valid ? 'valid' : 'invalid'}">${escape(result.status)}</span>`;
	html += `<span class="summary">OCPP ${escape(label)} ${escape(describe(input))}</span>`;
	if (result.issues.length > 0) {
		html += '<table><thead><tr><th>Pointer</th><th>Code</th><th>Message</th></tr></thead><tbody>';
		for (const issue of result.issues) {
			html += `<tr><td class="mono">${escape(issue.pointer)}</td><td class="mono">${escape(
				issue.code,
			)}</td><td>${escape(issue.message)}</td></tr>`;
		}
		html += '</tbody></table>';
	}
	resultView.innerHTML = html;
}

document.querySelector('#validate').addEventListener('click', () => {
	void validate();
});

document.querySelector('#clear').addEventListener('click', () => {
	frameInput.value = '';
	resultView.innerHTML = '<span class="placeholder">The result appears here.</span>';
	frameInput.focus();
});
