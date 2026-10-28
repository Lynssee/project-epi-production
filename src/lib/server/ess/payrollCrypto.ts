// src/lib/server/ess/payrollCrypto.ts
// SERVER-ONLY. Port dari erp-epi-1/src/lib/services/hrdPayrollCrypto.js — hanya
// bagian unwrap/decrypt (server tidak pernah membuat DEK baru, hanya membuka
// yang sudah ada). Web Crypto API tersedia native di Node, identik dengan browser.

const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 600_000;
const CANARY_PLAINTEXT = 'HRIS-PAYROLL-KEY-VALID-2024';

function b64encode(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let binary = '';
	bytes.forEach((b) => (binary += String.fromCharCode(b)));
	return Buffer.from(binary, 'binary').toString('base64');
}

function b64decode(b64: string): Uint8Array {
	const binary = Buffer.from(b64, 'base64').toString('binary');
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function deriveKEK(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

async function importRawDEK(rawKey: ArrayBuffer): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function unwrapDEK(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
	const bytes = b64decode(wrapped);
	const iv = bytes.slice(0, IV_LENGTH);
	const ciphertext = bytes.slice(IV_LENGTH);
	const rawDEK = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ciphertext);
	return importRawDEK(rawDEK);
}

async function verifyCanary(canary: string, kek: CryptoKey): Promise<boolean> {
	try {
		const bytes = b64decode(canary);
		const iv = bytes.slice(0, IV_LENGTH);
		const data = bytes.slice(IV_LENGTH);
		const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, data);
		return new TextDecoder().decode(plaintext) === CANARY_PLAINTEXT;
	} catch {
		return false;
	}
}

export async function decryptJSON<T = any>(ciphertext: string, dek: CryptoKey): Promise<T> {
	const bytes = b64decode(ciphertext);
	const iv = bytes.slice(0, IV_LENGTH);
	const data = bytes.slice(IV_LENGTH);
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, data);
	return JSON.parse(new TextDecoder().decode(plaintext));
}

const FILE_MAGIC = new Uint8Array([0x48, 0x45, 0x31, 0x01]); // "HE1\x01"

export function isEncryptedFile(buffer: ArrayBuffer): boolean {
	if (buffer.byteLength < FILE_MAGIC.length) return false;
	const header = new Uint8Array(buffer, 0, FILE_MAGIC.length);
	return FILE_MAGIC.every((b, i) => header[i] === b);
}

export async function decryptFileBytes(buffer: ArrayBuffer, dek: CryptoKey): Promise<ArrayBuffer> {
	if (!isEncryptedFile(buffer)) return buffer;
	const iv = new Uint8Array(buffer, FILE_MAGIC.length, IV_LENGTH);
	const ciphertext = new Uint8Array(buffer, FILE_MAGIC.length + IV_LENGTH);
	return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, ciphertext);
}

export { deriveKEK, unwrapDEK, verifyCanary, b64decode };
