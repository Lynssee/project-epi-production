// src/lib/server/sampleRequestNumber.ts
// SERVER-ONLY. Alokasi nomor Request Sample Cat atomik (compare-and-swap di atas
// Directus REST) — pola sama dengan sjiNumber.ts. Format: SMP/YYYY/NNNN (reset per tahun).

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
			body: JSON.stringify({ kunci, jenis: 'sample_request', tahun, last_seq: 0 })
		});
		return created.data;
	} catch {
		const retry = await directusServerJson<{ data: any[] }>(
			`/items/doc_number_sequence?filter[kunci][_eq]=${encodeURIComponent(kunci)}&limit=1`
		);
		if (retry?.data?.length) return retry.data[0];
		throw new Error('Gagal membuat baris doc_number_sequence untuk Request Sample.');
	}
}

/** Alokasikan nomor Request Sample berikutnya, format SMP/{YYYY}/{NNNN}. */
export async function allocateSampleNomor(tanggal: Date = new Date()): Promise<{ nomor: string; seq: number }> {
	const tahun = tanggal.getFullYear();
	const kunci = `sample_request_${tahun}`;
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
			const nnnn = String(nextSeq).padStart(4, '0');
			return { nomor: `SMP/${tahun}/${nnnn}`, seq: nextSeq };
		}

		const refetch = await directusServerJson<{ data: any[] }>(
			`/items/doc_number_sequence?filter[kunci][_eq]=${encodeURIComponent(kunci)}&limit=1`
		);
		row = refetch?.data?.[0] || row;
	}

	throw new Error(`Gagal mengalokasikan nomor Request Sample setelah ${MAX_RETRY} percobaan.`);
}
