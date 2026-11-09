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
	create(input: {
		subject: string;
		keyRef: string;
		certificateType?: 'ChargingStationCertificate' | 'V2GCertificate';
	}): Promise<{ csrPem: string; keyRef: string }>;
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
	 * `simulated` keeps the historical certificate behavior. Omit it to infer
	 * `real` when a certificate validator is provided. `real` requires a
	 * validator. This mode controls certificate validation only; the other
	 * callbacks are independent and active when provided.
	 */
	mode?: 'simulated' | 'real';
	trustStore?: SecurityTrustStore201;
	validateCertificateChain?: (
		chain: readonly string[],
		purpose: CertificatePurpose201,
		context: CertificateValidationContext201,
	) => Promise<CertificateValidationResult201>;
	/** Generates a CSR without exposing private keys to the simulator. */
	csrProvider?: CsrProvider201;
	/** Optional revocation check for the leaf chain in CertificateSigned. */
	revocation?: RevocationChecker201;
	/** Accept `unknown` revocation results. `revoked` and malformed results always fail. */
	allowUnknownRevocation?: boolean;
	/** Upper bound for injected security callbacks. Defaults to 10 seconds. */
	callbackTimeoutMs?: number;
}

const DEFAULT_SECURITY_CALLBACK_TIMEOUT_MS = 10_000;
const MAX_SIGN_CERTIFICATE_CSR_LENGTH = 5500;

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

/**
 * Runs an injected security callback with the configured timeout. The timer
 * uses the simulator scheduler, so a fake clock controls it and disposal
 * clears it.
 */
export function runSecurityCallback201<T>(
	engine: EngineBase<Simulator201State>,
	security: SecurityOptions201 | undefined,
	callback: () => Promise<T>,
): Promise<T> {
	const timeoutMs = security?.callbackTimeoutMs ?? DEFAULT_SECURITY_CALLBACK_TIMEOUT_MS;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let cancelTimer = (): void => undefined;
		let cancelListen: () => void = () => undefined;
		const finish = (action: () => void): void => {
			if (settled) return;
			settled = true;
			cancelTimer();
			cancelListen();
			action();
		};
		cancelTimer = engine.scheduler.setTimeout(() => {
			if (settled) return;
			settled = true;
			cancelListen();
			reject(new SimulatorError('timeout', 'Security callback timed out'));
		}, timeoutMs);
		cancelListen = engine.scheduler.onCancel(() => {
			finish(() => reject(new SimulatorError('cancelled', 'Security callback was cancelled')));
		});
		let pending: Promise<T>;
		try {
			pending = Promise.resolve(callback());
		} catch (error) {
			finish(() => reject(callbackError(error)));
			return;
		}
		pending.then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(callbackError(error))),
		);
	});
}

function callbackError(error: unknown): Error {
	return error instanceof Error
		? error
		: new SimulatorError('callback-error', 'Security callback failed');
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
					const validator = security.validateCertificateChain;
					validation =
						validator === undefined
							? undefined
							: await runSecurityCallback201(engine, security, () =>
									validator([certificate], certificatePurposeForInstall(certificateType), {
										now: engine.now(),
										...(security.trustStore === undefined
											? {}
											: { trustStore: security.trustStore }),
									}),
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
				if (security?.mode === 'real') {
					await sendSecurityEvent201(engine, 'InvalidChargingStationCertificate').catch(
						() => undefined,
					);
				}
				return;
			}
			if (security?.mode === 'real') {
				const parts = splitPemCertificates(chain);
				if (
					hasNonPemContent(chain) ||
					parts.length === 0 ||
					!parts.every((part) => part.startsWith('-----BEGIN CERTIFICATE-----'))
				) {
					await rejectSignedCertificate(engine, context);
					return;
				}
				const purpose = certificatePurposeForSigned(certificateType);
				let validation;
				try {
					const validator = security.validateCertificateChain;
					validation =
						validator === undefined
							? undefined
							: await runSecurityCallback201(engine, security, () =>
									validator(parts, purpose, {
										now: engine.now(),
										...(security.trustStore === undefined
											? {}
											: { trustStore: security.trustStore }),
									}),
								);
				} catch {
					await rejectSignedCertificate(engine, context);
					return;
				}
				if (validation?.valid !== true) {
					await rejectSignedCertificate(engine, context);
					return;
				}
				if (!(await revocationAllows201(engine, security, parts, purpose))) {
					await rejectSignedCertificate(engine, context);
					return;
				}
				validatedChain = parts.join('\n');
			}
			const keys: Array<'ChargingStationCertificate' | 'V2GCertificate'> =
				certificateType === 'V2GCertificate'
					? ['V2GCertificate']
					: certificateType === 'ChargingStationCertificate'
						? ['ChargingStationCertificate']
						: ['ChargingStationCertificate', 'V2GCertificate'];
			for (const key of keys) engine.state.security.signedChains[key] = validatedChain;
			engine.state.security.events.push({
				type: 'CertificateSigned',
				timestamp: engine.ocppNow(),
			});
			await context.reply({ status: 'Accepted' });
		},
	};
}

function certificatePurposeForSigned(
	certificateType: unknown,
): 'ChargingStationCertificate' | 'V2GCertificate' | 'Both' {
	if (certificateType === 'V2GCertificate') return 'V2GCertificate';
	if (certificateType === 'ChargingStationCertificate') return 'ChargingStationCertificate';
	return 'Both';
}

async function revocationAllows201(
	engine: EngineBase<Simulator201State>,
	security: SecurityOptions201,
	chain: readonly string[],
	purpose: CertificatePurpose201,
): Promise<boolean> {
	const checker = security.revocation;
	if (checker === undefined) return true;
	let result: unknown;
	try {
		result = await runSecurityCallback201(engine, security, () =>
			checker.check({ chain, purpose, now: engine.now() }),
		);
	} catch {
		return false;
	}
	if (!isRecordValue(result)) return false;
	if (result['status'] === 'good') return true;
	if (result['status'] === 'revoked') return false;
	if (result['status'] === 'unknown') return security.allowUnknownRevocation === true;
	return false;
}

async function rejectSignedCertificate(
	engine: EngineBase<Simulator201State>,
	context: CallContext,
): Promise<void> {
	await context.reply({ status: 'Rejected' });
	await sendSecurityEvent201(engine, 'InvalidChargingStationCertificate').catch(() => undefined);
}

export async function sendSignCertificate201(
	engine: EngineBase<Simulator201State>,
	csr: string,
	certificateType?: 'ChargingStationCertificate' | 'V2GCertificate',
): Promise<JsonObject> {
	if (!validCsr201(csr)) {
		throw new SimulatorError(
			'invalid-options',
			`csr must be a single PEM certificate request of at most ${String(MAX_SIGN_CERTIFICATE_CSR_LENGTH)} characters`,
		);
	}
	if (
		certificateType !== undefined &&
		certificateType !== 'ChargingStationCertificate' &&
		certificateType !== 'V2GCertificate'
	) {
		throw new SimulatorError('invalid-options', 'certificateType is invalid');
	}
	return engine.sendCall('SignCertificate', {
		csr,
		...(certificateType === undefined ? {} : { certificateType }),
	});
}

export interface SignWithProviderInput201 {
	subject: string;
	keyRef: string;
	certificateType?: 'ChargingStationCertificate' | 'V2GCertificate';
}

export interface SignWithProviderResult201 {
	keyRef: string;
	response: JsonObject;
}

/** Generates a CSR through the injected provider and sends SignCertificate. */
export async function signWithProvider201(
	engine: EngineBase<Simulator201State>,
	security: SecurityOptions201 | undefined,
	input: SignWithProviderInput201,
): Promise<SignWithProviderResult201> {
	const provider = security?.csrProvider;
	if (provider === undefined) {
		throw new SimulatorError('unsupported-feature', 'A CSR provider is not configured');
	}
	if (
		typeof input.subject !== 'string' ||
		input.subject.trim() === '' ||
		typeof input.keyRef !== 'string' ||
		input.keyRef.trim() === ''
	) {
		throw new SimulatorError('invalid-options', 'subject and keyRef must be non-empty strings');
	}
	if (
		input.certificateType !== undefined &&
		input.certificateType !== 'ChargingStationCertificate' &&
		input.certificateType !== 'V2GCertificate'
	) {
		throw new SimulatorError('invalid-options', 'certificateType is invalid');
	}
	let created: unknown;
	try {
		created = await runSecurityCallback201(engine, security, () =>
			provider.create({
				subject: input.subject,
				keyRef: input.keyRef,
				...(input.certificateType === undefined ? {} : { certificateType: input.certificateType }),
			}),
		);
	} catch (error) {
		if (error instanceof SimulatorError) throw error;
		throw new SimulatorError('callback-error', 'The CSR provider failed');
	}
	if (
		!isRecordValue(created) ||
		typeof created['csrPem'] !== 'string' ||
		!validCsr201(created['csrPem']) ||
		typeof created['keyRef'] !== 'string' ||
		created['keyRef'].trim() === ''
	) {
		throw new SimulatorError('callback-error', 'The CSR provider returned an invalid result');
	}
	const response = await sendSignCertificate201(engine, created['csrPem'], input.certificateType);
	return { keyRef: created['keyRef'], response };
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
	const upper = value.toUpperCase();
	const begin = '-----BEGIN ';
	const end = '-----';
	let from = 0;
	for (;;) {
		const start = upper.indexOf(begin, from);
		if (start === -1) return false;
		const labelStart = start + begin.length;
		const labelEnd = upper.indexOf(end, labelStart);
		if (labelEnd === -1) {
			return upper.slice(labelStart).includes('PRIVATE KEY');
		}
		if (upper.slice(labelStart, labelEnd).includes('PRIVATE KEY')) return true;
		// Rescan from the label so overlapping delimiters cannot hide a key.
		from = labelStart;
	}
}

function validCsr201(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	if (value.length > MAX_SIGN_CERTIFICATE_CSR_LENGTH) return false;
	const trimmed = value.trim();
	if (trimmed.length === 0 || containsPrivateKey(trimmed)) return false;
	const begin = /^-----BEGIN (NEW )?CERTIFICATE REQUEST-----/.exec(trimmed);
	if (begin === null) return false;
	const ending =
		begin[1] === undefined
			? '-----END CERTIFICATE REQUEST-----'
			: '-----END NEW CERTIFICATE REQUEST-----';
	if (!trimmed.endsWith(ending)) return false;
	const body = trimmed.slice(begin[0].length, -ending.length).trim();
	if (body === '' || body.includes('-----BEGIN') || body.includes('-----END')) return false;
	return /^[A-Za-z0-9+/=\s]+$/.test(body);
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
