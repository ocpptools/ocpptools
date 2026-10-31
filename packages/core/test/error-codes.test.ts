// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import { describe, expect, expectTypeOf, it } from 'vitest';
import { OCPP_ERROR_CODES, isErrorCode, type OcppErrorCode } from '../src/index.js';

describe('OCPP_ERROR_CODES', () => {
	it('defines 10 codes for 1.6 and 12 for 2.0.1, without duplicates', () => {
		expect(OCPP_ERROR_CODES['1.6']).toHaveLength(10);
		expect(OCPP_ERROR_CODES['2.0.1']).toHaveLength(12);
		expect(new Set(OCPP_ERROR_CODES['1.6']).size).toBe(10);
		expect(new Set(OCPP_ERROR_CODES['2.0.1']).size).toBe(12);
	});

	it('keeps the 1.6 spelling of the violation codes', () => {
		expect(OCPP_ERROR_CODES['1.6']).toContain('FormationViolation');
		expect(OCPP_ERROR_CODES['1.6']).toContain('OccurenceConstraintViolation');
		expect(OCPP_ERROR_CODES['1.6']).not.toContain('FormatViolation');
		expect(OCPP_ERROR_CODES['1.6']).not.toContain('OccurrenceConstraintViolation');
	});

	it('uses the 2.0.1 names and adds the framework codes', () => {
		expect(OCPP_ERROR_CODES['2.0.1']).toContain('FormatViolation');
		expect(OCPP_ERROR_CODES['2.0.1']).toContain('OccurrenceConstraintViolation');
		expect(OCPP_ERROR_CODES['2.0.1']).toContain('RpcFrameworkError');
		expect(OCPP_ERROR_CODES['2.0.1']).toContain('MessageTypeNotSupported');
		expect(OCPP_ERROR_CODES['2.0.1']).not.toContain('FormationViolation');
		expect(OCPP_ERROR_CODES['2.0.1']).not.toContain('OccurenceConstraintViolation');
	});

	it('shares the codes that did not change between versions', () => {
		const shared = [
			'NotImplemented',
			'NotSupported',
			'InternalError',
			'ProtocolError',
			'SecurityError',
			'PropertyConstraintViolation',
			'TypeConstraintViolation',
			'GenericError',
		];
		for (const code of shared) {
			expect(OCPP_ERROR_CODES['1.6']).toContain(code);
			expect(OCPP_ERROR_CODES['2.0.1']).toContain(code);
		}
	});
});

describe('isErrorCode', () => {
	it('accepts the codes of the given version', () => {
		expect(isErrorCode('1.6', 'FormationViolation')).toBe(true);
		expect(isErrorCode('2.0.1', 'FormatViolation')).toBe(true);
	});

	it('rejects a code that belongs to the other version', () => {
		expect(isErrorCode('1.6', 'FormatViolation')).toBe(false);
		expect(isErrorCode('1.6', 'RpcFrameworkError')).toBe(false);
		expect(isErrorCode('2.0.1', 'FormationViolation')).toBe(false);
		expect(isErrorCode('2.0.1', 'OccurenceConstraintViolation')).toBe(false);
	});

	it('rejects unknown codes and non-string values', () => {
		expect(isErrorCode('1.6', 'notimplemented')).toBe(false);
		expect(isErrorCode('2.0.1', '')).toBe(false);
		expect(isErrorCode('1.6', 42)).toBe(false);
		expect(isErrorCode('2.0.1', null)).toBe(false);
		expect(isErrorCode('1.6', undefined)).toBe(false);
	});

	it('narrows the value to the version error code type', () => {
		const code: unknown = 'FormatViolation';
		if (isErrorCode('2.0.1', code)) {
			expectTypeOf(code).toEqualTypeOf<OcppErrorCode<'2.0.1'>>();
		}
	});
});

describe('OcppErrorCode', () => {
	it('is a separate union per version', () => {
		expectTypeOf<'FormationViolation'>().toExtend<OcppErrorCode<'1.6'>>();
		expectTypeOf<'FormatViolation'>().not.toExtend<OcppErrorCode<'1.6'>>();
		expectTypeOf<'FormatViolation'>().toExtend<OcppErrorCode<'2.0.1'>>();
		expectTypeOf<'FormationViolation'>().not.toExtend<OcppErrorCode<'2.0.1'>>();
	});

	it('is the union of both versions when no version is given', () => {
		expectTypeOf<OcppErrorCode<'1.6'>>().toExtend<OcppErrorCode>();
		expectTypeOf<OcppErrorCode<'2.0.1'>>().toExtend<OcppErrorCode>();
	});
});
