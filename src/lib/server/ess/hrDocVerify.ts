// src/lib/server/ess/hrDocVerify.ts
// SERVER-ONLY. Port persis dari erp-epi-1/src/lib/server/hrDocVerify.js — dua aplikasi
// (Admin erp-epi-1 dan Lapangan project-epi) HARUS menghasilkan hash yang identik untuk
// dokumen HR yang sama, jadi HR_DOC_VERIFY_SECRET harus di-set SAMA di kedua env server.

import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';

function getSecret(): string {
	const secret = env.HR_DOC_VERIFY_SECRET;
	if (!secret) {
		throw new Error('[hrDocVerify] HR_DOC_VERIFY_SECRET belum di-set di server env');
	}
	return secret;
}

function stableStringify(value: any): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	if (value && typeof value === 'object') {
		const keys = Object.keys(value).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/** verify_hash = SHA-256(nomor_dokumen + stableStringify(data_snapshot) + server_secret) */
export function computeVerifyHash(nomorDokumen: string, dataSnapshot: any): string {
	const secret = getSecret();
	const payload = `${nomorDokumen}${stableStringify(dataSnapshot || {})}${secret}`;
	return createHash('sha256').update(payload).digest('hex');
}
