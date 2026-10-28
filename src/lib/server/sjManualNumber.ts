// src/lib/server/sjManualNumber.ts
// Penomoran SJ Manual dari lapangan — HARUS memakai format & collection yang sama
// dengan generateSJNumber() di erp-epi-1 (src/lib/services/suratJalanApi.js) supaya
// nomor SJ dari admin & lapangan tidak pernah bentrok (satu sequence bersama,
// dihitung dari collection surat_jalan yang sama di Directus).

import { directusServerJson } from './directus';

export async function allocateSjManualNomor(): Promise<{ nomor: string }> {
	const date = new Date();
	const year = date.getFullYear().toString().slice(-2);
	const month = (date.getMonth() + 1).toString().padStart(2, '0');
	const day = date.getDate().toString().padStart(2, '0');
	const prefix = `SJ/${year}${month}${day}/`;

	let nextSeq = 1;
	try {
		const res = await directusServerJson<{ data: { nomor_sj: string }[] }>(
			`/items/surat_jalan?filter[nomor_sj][_starts_with]=${encodeURIComponent(prefix)}&fields=nomor_sj&sort=-nomor_sj&limit=1`
		);
		const last = res?.data?.[0]?.nomor_sj;
		if (last) {
			const lastSeq = parseInt(last.split('/').pop() || '', 10);
			if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
		}
	} catch (e: any) {
		console.warn('[sjManualNumber] gagal ambil nomor terakhir, pakai fallback:', e?.message);
	}

	return { nomor: `${prefix}${nextSeq.toString().padStart(3, '0')}` };
}

export function generateSjManualQrToken(): string {
	return typeof crypto !== 'undefined' && crypto.randomUUID
		? crypto.randomUUID()
		: `qr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
