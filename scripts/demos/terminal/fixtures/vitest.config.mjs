// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Vitest config of the recording workspace for docs/assets/testing-vitest.gif.
// The verbose reporter is unchanged except for its first line: Vitest prints
// the absolute project root there, which would show a local temporary path in
// the recording.

import { defineConfig } from 'vitest/config';
import { VerboseReporter } from 'vitest/node';

class DemoReporter extends VerboseReporter {
	/** @param {import('vitest/node').Vitest} ctx */
	onInit(ctx) {
		const printBanner = ctx.logger.printBanner;
		ctx.logger.printBanner = () => {
			ctx.logger.log(`\n RUN  v${ctx.version}\n`);
		};
		try {
			super.onInit(ctx);
		} finally {
			ctx.logger.printBanner = printBanner;
		}
	}
}

export default defineConfig({
	test: {
		include: ['*.test.mjs'],
		reporters: [new DemoReporter()],
	},
});
