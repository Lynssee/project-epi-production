// src/lib/server/ess/apresiasi.ts
// Reward Stakeholder v2 Fase 5 — "Apresiasi Saya" (ESS). Karyawan melihat apresiasi yang
// diterima (read-only) dan boleh mengonfirmasi penerimaan DIRINYA SENDIRI dengan foto bukti.
// Sengaja TIDAK menampilkan nilai rupiah (HPP) ke karyawan. Konfirmasi hanya untuk baris yang
// karyawan_id-nya = pemanggil dan sudah 'diserahkan' (stok sudah terpotong di admin); serah
// terima ke pelanggan/vendor oleh admin lapangan belum ada di sini (butuh model izin sendiri).

import { error } from '@sveltejs/kit';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';

export interface ApresiasiItem {
	id: number;
	reference_no: string | null;
	item_nama: string;
	qty: number;
	status: string;
	status_kirim: string | null;
	nomor_resi: string | null;
	tanggal: string | null;
	program_nama: string | null;
	kategori_keperluan: string | null;
	sudah_ada_bukti: boolean;
	bisa_konfirmasi: boolean;
}

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function listApresiasiSaya(karyawanId: number): Promise<ApresiasiItem[]> {
	const filter = {
		_and: [{ penerima_tipe: { _eq: 'karyawan' } }, { karyawan_id: { _eq: karyawanId } }, { status: { _in: ['disetujui', 'diserahkan'] } }]
	};
	const res = await directusServerJson<{ data: any[] }>(
		`/items/merch_distribusi?filter=${enc(filter)}&sort=-tanggal&limit=200` +
			`&fields=id,reference_no,merch_item_id,qty,status,status_kirim,nomor_resi,tanggal,program_id,kategori_keperluan,bukti_terima`
	);
	const rows = res?.data || [];

	const itemIds = [...new Set(rows.map((r) => r.merch_item_id).filter((v) => v != null))];
	const progIds = [...new Set(rows.map((r) => r.program_id).filter((v) => v != null))];
	const itemName = new Map<any, string>();
	const progName = new Map<any, string>();
	if (itemIds.length) {
		const it = await directusServerJson<{ data: any[] }>(`/items/merch_items?filter=${enc({ id: { _in: itemIds } })}&fields=id,nama&limit=-1`);
		for (const m of it?.data || []) itemName.set(m.id, m.nama);
	}
	if (progIds.length) {
		const pr = await directusServerJson<{ data: any[] }>(`/items/reward_programs?filter=${enc({ id: { _in: progIds } })}&fields=id,nama_program&limit=-1`);
		for (const p of pr?.data || []) progName.set(p.id, p.nama_program);
	}

	return rows.map((r) => ({
		id: r.id,
		reference_no: r.reference_no ?? null,
		item_nama: itemName.get(r.merch_item_id) || 'Barang apresiasi',
		qty: Number(r.qty) || 0,
		status: r.status,
		status_kirim: r.status_kirim ?? null,
		nomor_resi: r.nomor_resi ?? null,
		tanggal: r.tanggal ?? null,
		program_nama: r.program_id != null ? progName.get(r.program_id) || null : null,
		kategori_keperluan: r.kategori_keperluan ?? null,
		sudah_ada_bukti: !!r.bukti_terima,
		bisa_konfirmasi: r.status === 'diserahkan' && r.status_kirim !== 'diterima'
	}));
}

/** Konfirmasi terima + foto bukti. Hanya baris milik pemanggil yang sudah diserahkan. */
export async function konfirmasiTerima(karyawanId: number, distribusiId: number, foto: File | null): Promise<void> {
	if (!Number.isInteger(distribusiId) || distribusiId <= 0) throw error(400, 'distribusi_id tidak valid');
	if (!foto || typeof foto === 'string' || foto.size === 0) throw error(400, 'Foto bukti wajib dilampirkan.');
	if (!String(foto.type || '').startsWith('image/')) throw error(400, 'Bukti harus berupa foto.');
	if (foto.size > MAX_PHOTO_BYTES) throw error(400, 'Ukuran foto maksimal 8 MB.');

	const cur = await directusServerJson<{ data: any }>(
		`/items/merch_distribusi/${distribusiId}?fields=id,penerima_tipe,karyawan_id,status,status_kirim`
	).catch(() => null);
	const row = cur?.data;
	if (!row) throw error(404, 'Data apresiasi tidak ditemukan.');
	if (row.penerima_tipe !== 'karyawan' || Number(row.karyawan_id) !== Number(karyawanId)) {
		throw error(403, 'Anda hanya bisa mengonfirmasi apresiasi untuk diri sendiri.');
	}
	if (row.status !== 'diserahkan') throw error(409, 'Barang belum diserahkan oleh admin — belum bisa dikonfirmasi.');
	if (row.status_kirim === 'diterima') throw error(409, 'Apresiasi ini sudah dikonfirmasi diterima.');

	const form = new FormData();
	form.append('file', foto, foto.name || `bukti-apresiasi-${distribusiId}.jpg`);
	const up = await directusServerUpload(form);
	if (!up.ok) throw error(502, 'Gagal mengunggah foto bukti. Coba lagi.');
	const fileId = (await up.json().catch(() => null))?.data?.id;
	if (!fileId) throw error(502, 'Foto terunggah tetapi ID file tidak terbaca.');

	await directusServerJson(`/items/merch_distribusi/${distribusiId}`, {
		method: 'PATCH',
		body: JSON.stringify({ bukti_terima: fileId, status_kirim: 'diterima' })
	});
}
