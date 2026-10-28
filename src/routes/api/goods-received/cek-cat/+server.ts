// src/routes/api/goods-received/cek-cat/+server.ts
// Checklist visual kondisi cat saat diterima di site (Fase 4 QC Re-test Cat Keluar). Endpoint TERPISAH dari
// /confirm (jalur akuntansi) supaya checklist ini tidak pernah menggagalkan konfirmasi GR — klien memanggilnya
// best-effort setelah konfirmasi sukses. Hanya mencatat; tidak memblokir apa pun (Aturan #6).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGRActor } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';

interface CekRow {
	project_expense_id?: number | null;
	surat_jalan_item_id?: number | null;
	nama_barang?: string;
	segel_utuh?: boolean;
	tidak_bocor_karat?: boolean;
	homogen_diaduk?: boolean;
	catatan?: string | null;
}

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateGRActor(event);
	const body = await event.request.json().catch(() => null);
	const suratJalanId = Number(body?.suratJalanId);
	const rows: CekRow[] = Array.isArray(body?.rows) ? body.rows : [];
	if (!Number.isFinite(suratJalanId)) throw error(400, 'suratJalanId tidak valid.');
	if (rows.length === 0) return json({ saved: 0 });
	if (rows.length > 100) throw error(400, 'Terlalu banyak baris checklist.');

	const now = new Date().toISOString();
	const payload = rows.map((r) => {
		const segel = r.segel_utuh === true;
		const bocor = r.tidak_bocor_karat === true;
		const homogen = r.homogen_diaduk === true;
		return {
			surat_jalan_id: suratJalanId,
			project_expense_id: Number.isFinite(Number(r.project_expense_id)) ? Number(r.project_expense_id) : null,
			surat_jalan_item_id: Number.isFinite(Number(r.surat_jalan_item_id)) ? Number(r.surat_jalan_item_id) : null,
			nama_barang: String(r.nama_barang || '').slice(0, 255) || null,
			segel_utuh: segel,
			tidak_bocor_karat: bocor,
			homogen_diaduk: homogen,
			semua_baik: segel && bocor && homogen,
			catatan: r.catatan ? String(r.catatan).slice(0, 1000) : null,
			dicek_oleh: karyawan.nama_karyawan || null,
			dicek_pada: now
		};
	});

	try {
		await directusServerJson('/items/cek_kondisi_cat_terima', { method: 'POST', body: JSON.stringify(payload) });
	} catch (e: any) {
		console.error('[cek-cat] gagal menyimpan checklist kondisi cat:', e);
		throw error(502, e?.message || 'Gagal menyimpan checklist kondisi cat.');
	}
	return json({ saved: payload.length, bermasalah: payload.filter((p) => !p.semua_baik).length });
};
