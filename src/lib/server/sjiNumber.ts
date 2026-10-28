// src/lib/server/sjiNumber.ts
// SERVER-ONLY. Alokasi nomor SJI atomik, port minimal dari erp-epi-1/src/lib/server/docNumberSequence.js
// (compare-and-swap di atas Directus REST) — project-epi tidak share kode server dengan erp-epi-1,
// jadi diport tipis khusus untuk kebutuhan SJI, bukan sistem docNumberSequence umum.

import { directusServerJson } from './directus';

const MAX_RETRY = 8;

async function getOrCreateSequenceRow(kunci: string, tahun: number) {
	const existing = await directusServerJson<{ data: any[] }>(
		`/items/doc_number_sequence?filter[kunci][_eq]=${encodeURIComponent(kunci)}&limit=1`
	);
	if (existing?.data?.length) return existing.data[0];

	try {
		const created = await directusServerJson<{ data: any }>('/items/doc_number_sequence', {
			method: 'POST',
			body: JSON.stringify({ kunci, jenis: 'sji', tahun, last_seq: 0 })
		});
		return created.data;
	} catch {
		// Race saat pembuatan baris pertama — baca ulang, baris pasti sudah ada.
		const retry = await directusServerJson<{ data: any[] }>(
			`/items/doc_number_sequence?filter[kunci][_eq]=${encodeURIComponent(kunci)}&limit=1`
		);
		if (retry?.data?.length) return retry.data[0];
		throw new Error('Gagal membuat baris doc_number_sequence untuk SJI.');
	}
}

/** Alokasikan nomor SJI berikutnya secara atomik, format SJI/{YY}{MM}/{NNNN} (4 digit, reset per tahun). */
export async function allocateSjiNomor(tanggal: Date = new Date()): Promise<{ nomor: string; seq: number }> {
	const tahun = tanggal.getFullYear();
	const kunci = `sji_${tahun}`;
	let row = await getOrCreateSequenceRow(kunci, tahun);

	for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
		const nextSeq = Number(row.last_seq || 0) + 1;
		const result = await directusServerJson<{ data: any[] }>('/items/doc_number_sequence', {
			method: 'PATCH',
			body: JSON.stringify({
				query: { filter: { kunci: { _eq: kunci }, last_seq: { _eq: row.last_seq } } },
				data: { last_seq: nextSeq }
			})
		});

		if (Array.isArray(result?.data) && result.data.length > 0) {
			const yy = String(tahun).slice(-2);
			const mm = String(tanggal.getMonth() + 1).padStart(2, '0');
			const nnnn = String(nextSeq).padStart(4, '0');
			return { nomor: `SJI/${yy}${mm}/${nnnn}`, seq: nextSeq };
		}

		const refetch = await directusServerJson<{ data: any[] }>(
			`/items/doc_number_sequence?filter[kunci][_eq]=${encodeURIComponent(kunci)}&limit=1`
		);
		row = refetch?.data?.[0] || row;
	}

	throw new Error(`Gagal mengalokasikan nomor SJI setelah ${MAX_RETRY} percobaan (kontensi tinggi).`);
}
