// src/lib/server/gaAssetIssue.ts
// Mencatat selisih barang (kurang / rusak / tidak ada) dari Cek Kelengkapan ATAU
// Lapor 1-barang (Barang per Ruangan via QR Patroli, Fase 4, 10 Sep 2026).
// Dipakai bersama oleh api/ga-ruangan/[areaId]/cek dan api/ga-ruangan/lapor supaya
// aturan "rusak -> tiket Service Desk GA otomatis" (keputusan Lead 10 Sep 2026)
// konsisten di kedua jalur, bukan diduplikasi.
//
// Aset HANYA berubah (area_id/qty/qty_rusak) saat movement.status = tercatat /
// dikonfirmasi -- laporan ini selalu masuk sebagai `menunggu_konfirmasi` (anti-
// manipulasi, §4.2 rencana). Admin GA yang mengonfirmasi lewat GaAssetSelisihInbox.

import { directusServerJson } from './directus';

export type StatusBaris = 'ada' | 'kurang' | 'rusak' | 'tidak_ada';

const TIPE_BY_STATUS: Record<Exclude<StatusBaris, 'ada'>, string> = {
	kurang: 'opname',
	rusak: 'perbaikan',
	tidak_ada: 'hilang'
};

export interface RecordAssetIssueInput {
	areaId: number;
	areaName: string;
	assetId: number;
	assetNama: string;
	status: Exclude<StatusBaris, 'ada'>;
	qtyAktual?: number | null;
	catatan?: string | null;
	foto?: string | null;
	karyawan: { id: number; nama_karyawan?: string | null };
	roomCheckId?: number | null;
	sumber: 'cek_ruangan' | 'lapangan';
}

/** Catat movement menunggu_konfirmasi, dan untuk status 'rusak' buat tiket Service Desk GA. */
export async function recordAssetIssue(input: RecordAssetIssueInput): Promise<{ movementId: number | null; ticketId: number | null }> {
	const { areaId, areaName, assetId, assetNama, status, qtyAktual, catatan, foto, karyawan, roomCheckId, sumber } = input;

	let movementId: number | null = null;
	try {
		const mov = await directusServerJson<{ data: any }>(`/items/ga_asset_movement`, {
			method: 'POST',
			body: JSON.stringify({
				asset_id: assetId,
				tipe: TIPE_BY_STATUS[status],
				sumber,
				status: 'menunggu_konfirmasi',
				ke_area_id: status === 'tidak_ada' ? null : areaId,
				ke: status === 'tidak_ada' ? 'Tidak ditemukan' : areaName,
				qty: qtyAktual ?? null,
				kondisi: status === 'rusak' ? 'rusak' : undefined,
				foto,
				oleh_id: karyawan.id,
				tanggal: new Date().toISOString(),
				catatan: catatan || (status === 'kurang' ? 'Qty tidak sesuai saat cek kelengkapan' : status === 'tidak_ada' ? 'Tidak ditemukan saat cek kelengkapan' : 'Dilaporkan rusak'),
				room_check_id: roomCheckId ?? null
			})
		});
		movementId = mov?.data?.id ?? null;
	} catch (err) {
		console.error(`[gaAssetIssue] gagal catat movement selisih aset ${assetId} (${status}):`, err);
	}

	let ticketId: number | null = null;
	if (status === 'rusak') {
		// Keputusan Lead (10 Sep 2026): laporan rusak LANGSUNG jadi tiket Service Desk GA.
		try {
			const ticket = await directusServerJson<{ data: any }>(`/items/ga_request`, {
				method: 'POST',
				body: JSON.stringify({
					jenis: 'perbaikan',
					pemohon_id: karyawan.id,
					deskripsi: `Perbaikan barang "${assetNama}" di ruangan ${areaName}${catatan ? ` — ${catatan}` : ''}`,
					prioritas: 'sedang',
					status: 'baru',
					ref: `ga_asset:${assetId}`,
					lampiran: foto || null
				})
			});
			ticketId = ticket?.data?.id ?? null;
		} catch (err) {
			// Tiket gagal dibuat TIDAK membatalkan movement yang sudah tercatat -- log jelas,
			// Admin GA tetap lihat laporannya di Inbox Selisih walau tiket belum ada.
			console.error(`[gaAssetIssue] gagal buat tiket Service Desk untuk aset ${assetId}:`, err);
		}
	}

	return { movementId, ticketId };
}
