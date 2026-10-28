// src/lib/server/ess/disiplinSanksi.ts
// Fase 2 (Rencana Automasi HR Lifecycle v2) — lengkapi /ess/disiplin dgn daftar sanksi_karyawan
// pribadi + tanda-terima digital (karyawan_ack_at) + form banding. Sengaja TIDAK membuat koleksi
// sanksi_banding baru (Directus instance ini dekat kuota koleksi) — banding memakai field yang
// SUDAH ADA di sanksi_karyawan: status='Banding' + catatan_banding (choice 'Banding' & field itu
// sudah ada di skema sebelum sesi ini, jadi ini bukan penambahan, cuma dipakai jalur ESS baru).

import { directusServerJson } from '$lib/server/directus';

export interface SanksiRecord {
	id: number;
	jenis_sanksi: string;
	kategori_pelanggaran: string | null;
	deskripsi_pelanggaran: string | null;
	tanggal_sanksi: string | null;
	tanggal_berlaku: string | null;
	tanggal_berakhir: string | null;
	status: string;
	catatan_banding: string | null;
	karyawan_ack_at: string | null;
}

const FIELDS =
	'id,jenis_sanksi,kategori_pelanggaran,deskripsi_pelanggaran,tanggal_sanksi,tanggal_berlaku,tanggal_berakhir,status,catatan_banding,karyawan_ack_at';

/** Sanksi milik karyawan ybs — HANYA yang sudah resmi terbit (bukan Draft, supaya karyawan tidak
 * lihat draf otomatis yang masih menunggu approval HR/window pembatalan 24 jam). */
export async function listMySanksi(karyawanId: number): Promise<SanksiRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[status][_neq]': 'Draft',
		fields: FIELDS,
		sort: '-tanggal_sanksi',
		limit: '100'
	});
	const result = await directusServerJson<{ data: SanksiRecord[] }>(`/items/sanksi_karyawan?${query.toString()}`);
	return result?.data || [];
}

async function findOwnedSanksi(sanksiId: number, karyawanId: number): Promise<SanksiRecord | null> {
	const result = await directusServerJson<{ data: (SanksiRecord & { karyawan_id: any }) | null }>(
		`/items/sanksi_karyawan/${sanksiId}?fields=${FIELDS},karyawan_id`
	).catch(() => null);
	const row = result?.data;
	if (!row) return null;
	const ownerId = typeof row.karyawan_id === 'object' ? row.karyawan_id?.id : row.karyawan_id;
	if (String(ownerId) !== String(karyawanId)) return null;
	return row;
}

/** Tanda terima digital: karyawan mengakui sudah membaca surat sanksi. Sekali saja (idempoten). */
export async function acknowledgeSanksi(sanksiId: number, karyawanId: number): Promise<SanksiRecord> {
	const sanksi = await findOwnedSanksi(sanksiId, karyawanId);
	if (!sanksi) throw new Error('Sanksi tidak ditemukan atau bukan milik Anda.');
	if (sanksi.karyawan_ack_at) return sanksi;

	const result = await directusServerJson<{ data: SanksiRecord }>(`/items/sanksi_karyawan/${sanksiId}`, {
		method: 'PATCH',
		body: JSON.stringify({ karyawan_ack_at: new Date().toISOString() })
	});
	return result?.data as SanksiRecord;
}

/** Ajukan banding — set status='Banding' + catatan_banding, HR meninjau lewat HrdEvaluasi.svelte. */
export async function submitBanding(sanksiId: number, karyawanId: number, alasanBanding: string): Promise<SanksiRecord> {
	if (!alasanBanding || alasanBanding.trim().length < 10) {
		throw new Error('Alasan banding wajib diisi (minimal 10 karakter).');
	}
	const sanksi = await findOwnedSanksi(sanksiId, karyawanId);
	if (!sanksi) throw new Error('Sanksi tidak ditemukan atau bukan milik Anda.');
	if (sanksi.status === 'Banding') throw new Error('Sanksi ini sudah dalam proses banding.');
	if (!['Aktif'].includes(sanksi.status)) {
		throw new Error('Hanya sanksi berstatus Aktif yang bisa dibanding.');
	}

	const result = await directusServerJson<{ data: SanksiRecord }>(`/items/sanksi_karyawan/${sanksiId}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'Banding', catatan_banding: alasanBanding.trim() })
	});

	await directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'disiplin_banding_diajukan',
			title: `Banding Sanksi Diajukan (Karyawan #${karyawanId})`,
			message: `Karyawan mengajukan banding atas ${sanksi.jenis_sanksi}. Alasan: ${alasanBanding.trim()}. Tinjau di HRD > Evaluasi & Sanksi.`,
			priority: 'high',
			department: 'hrd',
			action_url: '/hrd?tab=evaluasi&sanksi=sp',
			source_collection: 'sanksi_karyawan',
			source_id: String(sanksiId),
			read: false,
			created_at: new Date().toISOString()
		})
	}).catch(() => {});

	return result?.data as SanksiRecord;
}
