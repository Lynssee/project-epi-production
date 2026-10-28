// src/lib/server/rangkap.ts
// SERVER-ONLY. BK Gate v2 — Fase 7 (sisi lapangan project-epi).
//
// CERMIN RINGAN dari erp-epi-1 `src/lib/server/rangkap.js`. Directus-nya SAMA (satu
// instance) — lapangan hanya BACA status lembar & MAJUKAN status (diserahkan →
// diterima_pic → discan/diarsip), tidak pernah membuat baris baru (itu wewenang
// admin gudang saat cetak, erp-epi) dan tidak mengulang validasi transisi penuh —
// sama seperti pola sjTracking.ts di file ini.

import { directusServerJson } from './directus';

export interface RangkapRow {
	id: number;
	surat_jalan_id: number;
	lembar_kode: string;
	lembar_nama: string;
	warna_hex: string | null;
	peruntukan_role: string | null;
	status: string;
	wajib_kembali: boolean;
	wajib_scan: boolean;
	deadline_kembali: string | null;
	dicetak_oleh: string | null;
}

const FIELDS =
	'id,surat_jalan_id,lembar_kode,lembar_nama,warna_hex,peruntukan_role,status,' +
	'wajib_kembali,wajib_scan,deadline_kembali,dicetak_oleh';

export async function listRangkapForSj(sjId: number | string): Promise<RangkapRow[]> {
	const res = await directusServerJson<{ data: RangkapRow[] }>(
		`/items/sj_dokumen_rangkap?filter[surat_jalan_id][_eq]=${encodeURIComponent(String(sjId))}&fields=${FIELDS}&sort=lembar_kode&limit=-1`
	).catch(() => ({ data: [] }));
	return res?.data || [];
}

/** Ringkasan cepat untuk layar gerbang satpam — dipakai bareng lookup SJ. */
export async function summarizeRangkapForGate(sjId: number | string) {
	const rows = await listRangkapForSj(sjId);
	const wajib = rows.filter((r) => r.wajib_kembali);
	const belumSerah = rows.filter((r) => r.status === 'belum_cetak' || r.status === 'dicetak');
	return {
		total: rows.length,
		wajib_kembali: wajib.length,
		belum_diserahkan: belumSerah.map((r) => ({ lembar: r.lembar_nama, kode: r.lembar_kode })),
		siap: rows.length > 0 && belumSerah.length === 0
	};
}

async function recomputeSjRangkapStatus(sjId: number | string) {
	const rows = await listRangkapForSj(sjId);
	const wajib = rows.filter((r) => r.wajib_kembali);
	const kembaliStatuses = ['diarsip', 'discan'];
	let status: string;
	if (rows.some((r) => r.status === 'hilang')) status = 'ada_hilang';
	else if (!rows.length) status = 'belum_cetak';
	else if (wajib.length && wajib.every((r) => kembaliStatuses.includes(r.status))) status = 'lengkap';
	else if (rows.every((r) => r.status === 'belum_cetak')) status = 'belum_cetak';
	else status = 'parsial';
	await directusServerJson(`/items/surat_jalan/${encodeURIComponent(String(sjId))}`, {
		method: 'PATCH',
		body: JSON.stringify({ rangkap_status: status })
	}).catch(() => {});
	return status;
}

/**
 * Majukan status satu lembar dari lapangan. HANYA maju (pola sjTracking.ts) — tidak
 * mengulang validasi state machine penuh, itu wewenang erp-epi.
 */
export async function advanceRangkapStatus(
	rangkapId: number | string,
	status: 'diserahkan' | 'diterima_pic' | 'diarsip',
	actorName: string | null
) {
	const now = new Date().toISOString();
	const patch: Record<string, unknown> = { status };
	if (status === 'diserahkan') { patch.diserahkan_at = now; patch.diserahkan_oleh = actorName; }
	if (status === 'diterima_pic') { patch.diterima_at = now; patch.diterima_oleh = actorName; }

	const rowRes = await directusServerJson<{ data: { surat_jalan_id: number | { id: number } } }>(
		`/items/sj_dokumen_rangkap/${encodeURIComponent(String(rangkapId))}?fields=surat_jalan_id`
	);
	const row = rowRes?.data;
	if (!row) throw new Error(`Lembar rangkap ${rangkapId} tidak ditemukan`);

	await directusServerJson(`/items/sj_dokumen_rangkap/${encodeURIComponent(String(rangkapId))}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});

	const sjId = typeof row.surat_jalan_id === 'object' ? row.surat_jalan_id.id : row.surat_jalan_id;
	await recomputeSjRangkapStatus(sjId);
	return { id: rangkapId, status };
}
