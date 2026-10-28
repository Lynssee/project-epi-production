// src/lib/server/ess/payrollUnlock.ts
// SERVER-ONLY. Unwrap DEK payroll pakai passphrase HR yang sama dengan Admin HRD,
// disimpan sebagai env var server-only — karyawan TIDAK PERNAH memegang passphrase/DEK.

import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { deriveKEK, unwrapDEK, verifyCanary, b64decode } from '$lib/server/ess/payrollCrypto';

interface EnkripsiConfig {
	salt: string;
	wrapped_dek: string;
	canary: string;
}

let cachedDEK: CryptoKey | null = null;
let cachedDEKPromise: Promise<CryptoKey> | null = null;

async function fetchEnkripsiConfig(): Promise<EnkripsiConfig | null> {
	const query = new URLSearchParams({ 'filter[key][_eq]': 'current', fields: 'enkripsi_config', limit: '1' });
	const result = await directusServerJson<{ data: { enkripsi_config: EnkripsiConfig }[] }>(
		`/items/konfigurasi_payroll_rate?${query.toString()}`
	);
	return result?.data?.[0]?.enkripsi_config || null;
}

/** Unwrap DEK payroll (cached in-memory selama proses server hidup — PBKDF2 600rb iterasi mahal). */
export async function getServerDEK(): Promise<CryptoKey> {
	if (cachedDEK) return cachedDEK;
	if (cachedDEKPromise) return cachedDEKPromise;

	cachedDEKPromise = (async () => {
		try {
			const passphrase = env.PAYROLL_DEK_PASSPHRASE;
			if (!passphrase) {
				throw error(503, 'Layanan slip gaji belum dikonfigurasi.');
			}

			const config = await fetchEnkripsiConfig();
			if (!config?.salt || !config?.wrapped_dek || !config?.canary) {
				throw error(503, 'Layanan slip gaji belum dikonfigurasi.');
			}

			const saltBytes = b64decode(config.salt);
			const kek = await deriveKEK(passphrase, saltBytes);
			const valid = await verifyCanary(config.canary, kek);
			if (!valid) {
				throw error(503, 'Layanan slip gaji belum dikonfigurasi.');
			}

			const dek = await unwrapDEK(config.wrapped_dek, kek);
			cachedDEK = dek;
			return dek;
		} catch (e) {
			// Jangan simpan promise yang reject — kegagalan transient (network,
			// Directus down) tidak boleh mengunci layanan sampai server restart.
			cachedDEKPromise = null;
			throw e;
		}
	})();

	return cachedDEKPromise;
}
