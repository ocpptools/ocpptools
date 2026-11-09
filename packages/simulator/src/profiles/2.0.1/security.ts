// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

import type { JsonObject } from '@ocpptools/core';

import type { EngineBase } from '../../engine.js';
import type { CallContext } from '../../rpc.js';
import { SimulatorError, isAlreadyCountedError } from '../../errors.js';
import type { Simulator201State } from './index.js';

export type CertificatePurpose201 =
	| 'V2GRootCertificate'
	| 'MORootCertificate'
	| 'CSMSRootCertificate'
	| 'ManufacturerRootCertificate'
	| 'ChargingStationCertificate'
	| 'V2GCertificate'
	/** CertificateSigned without a certificateType applies to both uses. */
	| 'Both';

export interface CertificateHashData201 {
	hashAlgorithm: 'SHA256' | 'SHA384' | 'SHA512';
	issuerNameHash: string;
	issuerKeyHash: string;
	serialNumber: string;
}

export interface CertificateSummary201 {
	subject: string;
	issuer: string;
	serialNumber: string;
	notBefore: number;
	notAfter: number;
	publicKeyAlgorithm: string;
	thumbprintSha256: string;
}

export interface CertificateValidationResult201 {
	valid: boolean;
	errors: readonly string[];
	hashData?: CertificateHashData201;
	chain?: readonly CertificateSummary201[];
}

export interface SecurityTrustStore201 {
	roots: Partial<Record<CertificatePurpose201, readonly string[]>>;
	intermediates?: readonly string[];
}

export interface RevocationChecker201 {
	check(input: {
		chain: readonly string[];
		purpose: CertificatePurpose201;
		now: number;
	}): Promise<{ status: 'good' | 'revoked' | 'unknown'; reason?: string }>;
}

export interface CsrProvider201 {
	create(input: { subject: string; keyRef: string }): Promise<{
		csrPem: string;
		keyRef: string;
	}>;
}

export interface Iso15118Codec201 {
	schemaVersion: string;
	encodeRequest(message: unknown): Promise<string>;
	decodeResponse(exi: string): Promise<unknown>;
	validateResponse?(response: unknown): Promise<{ valid: boolean; errors: readonly string[] }>;
}

export interface FirmwareVerifier201 {
	verify(input: {
		firmware: unknown;
		signature: string;
		certificateChain: readonly string[];
		trustStore: SecurityTrustStore201;
	}): Promise<{ valid: boolean; errors: readonly string[] }>;
}

export interface CertificateValidationContext201 {
	now: number;
	trustStore?: SecurityTrustStore201;
}

export interface SecurityOptions201 {
	/**
	 * `simulated` keeps the historical behavior. Omit it to infer `real` when a
	 * validator is provided. `real` requires a validator.
	 */
	mode?: 'simulated' | 'real';
	trustStore?: SecurityTrustStore201;
	validateCertificateChain?: (
		chain: readonly string[],
		purpose: CertificatePurpose201,
		context: CertificateValidationContext201,
	) => Promise<CertificateValidationResult201>;
}

export interface SimulatedCertificate201 {
	certificateType: string;
	hash: JsonObject;
	certificate: string;
	installedAt: number;
}

export interface SecurityState201 {
	certificates: SimulatedCertificate201[];
	signedChains: Record<string, string>;
	events: Array<{ type: string; timestamp: string; techInfo?: string }>;
	nextSerial: number;
}

export function createSecurityState201(): SecurityState201 {
	return { certificates: [], signedChains: {}, events: [], nextSerial: 1 };
}

export function createSecurityHandlers(
	engine: EngineBase<Simulator201State>,
	security?: SecurityOptions201,
): Record<string, (context: CallContext) => void | Promise<void>> {
	return {
		InstallCertificate: async (context) => {
			const certificateType = context.payload['certificateType'];
			const certificate = context.payload['certificate'];
			if (
				!validInstallUse(certificateType) ||
				typeof certificate !== 'string' ||
				certificate === ''
			) {
				await context.fail('FormatViolation', 'InstallCertificate fields are invalid');
				return;
			}
			if (containsPrivateKey(certificate)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			if (security?.mode === 'real') {
				let validation;
				try {
					validation = await security.validateCertificateChain?.(
						[certificate],
						certificatePurposeForInstall(certificateType),
						{
							now: engine.now(),
							...(security.trustStore === undefined ? {} : { trustStore: security.trustStore }),
						},
					);
				} catch {
					await context.reply({ status: 'Rejected' });
					return;
				}
				if (
					validation?.valid !== true ||
					!isRecordValue(validation.hashData) ||
					!validHashData(validation.hashData)
				) {
					await context.reply({ status: 'Rejected' });
					return;
				}
				engine.state.security.certificates.push({
					certificateType,
					certificate,
					installedAt: engine.now(),
					hash: validation.hashData as unknown as JsonObject,
				});
				await context.reply({ status: 'Accepted' });
				return;
			}
			const serial = `sim-${engine.state.security.nextSerial}`;
			engine.state.security.nextSerial += 1;
			engine.state.security.certificates.push({
				certificateType,
				certificate,
				installedAt: engine.now(),
				hash: {
					hashAlgorithm: 'SHA256',
					issuerNameHash: `issuer-${serial}`,
					issuerKeyHash: `key-${serial}`,
					serialNumber: serial,
				},
			});
			await context.reply({ status: 'Accepted' });
		},
		DeleteCertificate: async (context) => {
			const hash = objectValue(context.payload['certificateHashData']);
			if (hash === undefined || !validHashData(hash)) {
				await context.fail('FormatViolation', 'certificateHashData is invalid');
				return;
			}
			const serial = stringValue(hash['serialNumber']);
			const index = engine.state.security.certificates.findIndex(
				(item) =>
					item.hash['hashAlgorithm'] === hash['hashAlgorithm'] &&
					item.hash['issuerNameHash'] === hash['issuerNameHash'] &&
					item.hash['issuerKeyHash'] === hash['issuerKeyHash'] &&
					item.hash['serialNumber'] === serial,
			);
			if (index < 0) {
				await context.reply({ status: 'NotFound' });
				return;
			}
			engine.state.security.certificates.splice(index, 1);
			await context.reply({ status: 'Accepted' });
		},
		GetInstalledCertificateIds: async (context) => {
			const rawTypes = context.payload['certificateType'];
			const types = rawTypes === undefined ? undefined : certificateTypeArray(rawTypes);
			if (rawTypes !== undefined && types === undefined) {
				await context.fail('FormatViolation', 'certificateType is invalid');
				return;
			}
			const chain = engine.state.security.certificates
				.filter((item) => types === undefined || types.includes(item.certificateType))
				.map((item) => ({
					certificateType: item.certificateType,
					certificateHashData: item.hash,
				}));
			if (chain.length === 0) {
				await context.reply({ status: 'NotFound' });
				return;
			}
			await context.reply({ status: 'Accepted', certificateHashDataChain: chain });
		},
		CertificateSigned: async (context) => {
			const chain = context.payload['certificateChain'];
			const certificateType = context.payload['certificateType'];
			if (
				typeof chain !== 'string' ||
				chain === '' ||
				(certificateType !== undefined &&
					certificateType !== 'ChargingStationCertificate' &&
					certificateType !== 'V2GCertificate')
			) {
				await context.fail('FormatViolation', 'CertificateSigned fields are invalid');
				return;
			}
			let validatedChain = chain;
			if (containsPrivateKey(chain)) {
				await context.reply({ status: 'Rejected' });
				return;
			}
			if (security?.mode === 'real') {
				const parts = splitPemCertificates(chain);
				if (
					hasNonPemContent(chain) ||
					parts.length === 0 ||
					!parts.every((part) => part.startsWith('-----BEGIN CERTIFICATE-----'))
				) {
					await context.reply({ status: 'Rejected' });
					return;
				}
				let validation;
				try {
					validation = await security.validateCertificateChain?.(
						parts,
						certificateType === 'V2GCertificate'
							? 'V2GCertificate'
							: certificateType === 'ChargingStationCertificate'
								? 'ChargingStationCertificate'
								: 'Both',
						{
							now: engine.now(),
							...(security.trustStore === undefined ? {} : { trustStore: security.trustStore }),
						},
					);
				} catch {
					await context.reply({ status: 'Rejected' });
					return;
				}
				if (validation?.valid !== true) {
					await context.reply({ status: 'Rejected' });
					return;
				}
				validatedChain = parts.join('\n');
			}
			const key =
				certificateType === 'V2GCertificate' ? 'V2GCertificate' : 'ChargingStationCertificate';
			engine.state.security.signedChains[key] = validatedChain;
			engine.state.security.events.push({
				type: 'CertificateSigned',
				timestamp: engine.ocppNow(),
			});
			await context.reply({ status: 'Accepted' });
		},
	};
}

export async function sendSignCertificate201(
	engine: EngineBase<Simulator201State>,
	csr: string,
	certificateType?: 'ChargingStationCertificate' | 'V2GCertificate',
): Promise<JsonObject> {
	return engine.sendCall('SignCertificate', {
		csr,
		...(certificateType === undefined ? {} : { certificateType }),
	});
}

export async function sendGet15118EVCertificate201(
	engine: EngineBase<Simulator201State>,
	iso15118SchemaVersion: string,
	action: 'Install' | 'Update',
	exiRequest: string,
): Promise<JsonObject> {
	return engine.sendCall('Get15118EVCertificate', {
		iso15118SchemaVersion,
		action,
		exiRequest,
	});
}

export async function sendGetCertificateStatus201(
	engine: EngineBase<Simulator201State>,
	ocspRequestData: JsonObject,
): Promise<JsonObject> {
	return engine.sendCall('GetCertificateStatus', { ocspRequestData });
}

export async function sendSecurityEvent201(
	engine: EngineBase<Simulator201State>,
	type: string,
	techInfo?: string,
): Promise<void> {
	if (
		containsPrivateKeyMaterial(type) ||
		(techInfo !== undefined && containsPrivateKeyMaterial(techInfo))
	) {
		throw new SimulatorError(
			'invalid-options',
			'Security event text must not contain private key material',
		);
	}
	const timestamp = engine.ocppNow();
	engine.state.security.events.push({
		type,
		timestamp,
		...(techInfo === undefined ? {} : { techInfo }),
	});
	await engine.sendOrQueue('SecurityEventNotification', {
		type,
		timestamp,
		...(techInfo === undefined ? {} : { techInfo }),
	});
}

function certificatePurposeForInstall(certificateType: string): CertificatePurpose201 {
	switch (certificateType) {
		case 'V2GRootCertificate':
		case 'MORootCertificate':
		case 'CSMSRootCertificate':
		case 'ManufacturerRootCertificate':
			return certificateType;
		default:
			return 'CSMSRootCertificate';
	}
}

/** Splits a PEM bundle into individual certificate blocks. */
export function splitPemCertificates(value: string): string[] {
	const matches = value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
	return matches === null ? [] : matches;
}

function hasNonPemContent(value: string): boolean {
	return (
		value.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim() !== ''
	);
}

function containsPrivateKey(value: string): boolean {
	return /-----BEGIN [^-]*PRIVATE KEY[^-]*-----/.test(value);
}

/** True when a string contains a PEM private-key block. */
export function containsPrivateKeyMaterial(value: string): boolean {
	return containsPrivateKey(value);
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validInstallUse(value: unknown): value is string {
	return (
		value === 'V2GRootCertificate' ||
		value === 'MORootCertificate' ||
		value === 'CSMSRootCertificate' ||
		value === 'ManufacturerRootCertificate'
	);
}

function validGetUse(value: unknown): value is string {
	return value === 'V2GCertificateChain' || validInstallUse(value);
}

function certificateTypeArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const result: string[] = [];
	for (const entry of value) {
		if (!validGetUse(entry)) return undefined;
		result.push(entry);
	}
	return result;
}

function validHashData(hash: Record<string, unknown>): boolean {
	return (
		(hash['hashAlgorithm'] === 'SHA256' ||
			hash['hashAlgorithm'] === 'SHA384' ||
			hash['hashAlgorithm'] === 'SHA512') &&
		typeof hash['issuerNameHash'] === 'string' &&
		typeof hash['issuerKeyHash'] === 'string' &&
		typeof hash['serialNumber'] === 'string'
	);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export function reportSecurityError(engine: EngineBase<Simulator201State>, error: unknown): void {
	engine.events.emit({
		type: 'error',
		at: engine.now(),
		error: {
			name: 'SimulatorError',
			code: error instanceof SimulatorError ? error.code : 'internal-error',
			message: error instanceof Error ? error.message : 'Security flow failed',
		},
		fatal: false,
		countsAsError: !isAlreadyCountedError(error),
	});
}
