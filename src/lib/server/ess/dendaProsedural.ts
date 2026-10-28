// src/lib/server/ess/dendaProsedural.ts
// Sistem Denda Prosedural Karyawan — Fase 3 (transparansi lapangan / ESS).
// Sisi server: daftar denda_prosedural_log milik karyawan ybs + pengajuan klarifikasi ke HRD.
// SELALU lewat /api/ess/disiplin/denda-prosedural/*, klien tidak pernah akses Directus langsung.
//
// Ref: "(analyst) implementation_plan_Sistem Denda Prosedural Karyawan.md" §Fase 3.
// Prinsip: karyawan HANYA melihat (read-only). Tombol "Ajukan Klarifikasi" mengisi
// alasan_pembebasan sebagai PENGAJUAN — TIDAK mengubah status jadi 'dibebaskan'. HRD yang
// memutuskan lewat tab /hrd?tab=disiplin-denda > Log Kejadian.

import { directusServerJson } from '$lib/server/directus';

export interface DendaProseduralLog {
	id: number;
	rule_kode: string;
	tanggal_kejadian: string | null;
	periode_payroll: string | null;
	nominal: number;
	nominal_efektif: number;
	keterangan_otomatis: string | null;
	status: string; // pending | dikonfirmasi | dibatalkan | dibebaskan
	alasan_pembebasan: string | null;
	potongan_karyawan_id: number | null;
}

const FIELDS =
	'id,rule_kode,tanggal_kejadian,periode_payroll,nominal,nominal_efektif,keterangan_otomatis,status,alasan_pembebasan,potongan_karyawan_id';

/** Log milik karyawan ybs. Default: periode berjalan. `periode` = 'YYYY-MM' opsional. */
export async function listMyDendaProsedural(
	karyawanId: number,
	periode?: string
): Promise<DendaProseduralLog[]> {
	const filter: Record<string, string> = {
		'filter[karyawan_id][_eq]': String(karyawanId)
	};
	if (periode && /^\d{4}-\d{2}$/.test(periode)) {
		filter['filter[periode_payroll][_eq]'] = periode;
	}
	const query = new URLSearchParams({
		...filter,
		fields: FIELDS,
		sort: '-tanggal_kejadian',
		limit: '200'
	});
	const res = await directusServerJson<{ data: DendaProseduralLog[] }>(
		`/items/denda_prosedural_log?${query.toString()}`
	).catch(() => null);
	return res?.data || [];
}

async function findOwnedLog(logId: number, karyawanId: number): Promise<(DendaProseduralLog & { karyawan_id: any }) | null> {
	const res = await directusServerJson<{ data: (DendaProseduralLog & { karyawan_id: any }) | null }>(
		`/items/denda_prosedural_log/${logId}?fields=${FIELDS},karyawan_id`
	).catch(() => null);
	const row = res?.data;
	if (!row) return null;
	const ownerId = typeof row.karyawan_id === 'object' ? row.karyawan_id?.id : row.karyawan_id;
	if (String(ownerId) !== String(karyawanId)) return null;
	return row;
}

/**
 * Ajukan klarifikasi — menuliskan permintaan karyawan ke alasan_pembebasan dengan prefiks jelas,
 * TANPA mengubah status. HRD meninjau di tab Denda Prosedural. Idempoten-lunak: kalau sudah ada
 * pengajuan karyawan yang belum ditanggapi, tolak duplikat.
 */
export async function ajukanKlarifikasi(
	logId: number,
	karyawanId: number,
	alasan: string
): Promise<DendaProseduralLog> {
	const teks = (alasan || '').trim();
	if (teks.length < 10) throw new Error('Alasan klarifikasi wajib diisi (minimal 10 karakter).');

	const log = await findOwnedLog(logId, karyawanId);
	if (!log) throw new Error('Kejadian tidak ditemukan atau bukan milik Anda.');
	if (log.status === 'dibebaskan') throw new Error('Kejadian ini sudah dibebaskan HRD.');
	if (log.status === 'dibatalkan') throw new Error('Kejadian ini sudah dibatalkan.');
	if (log.potongan_karyawan_id) {
		throw new Error('Kejadian ini sudah masuk usulan potongan — ajukan lewat banding potongan, bukan di sini.');
	}
	const existing = log.alasan_pembebasan || '';
	if (existing.includes('[Klarifikasi karyawan]')) {
		throw new Error('Anda sudah mengajukan klarifikasi untuk kejadian ini. Tunggu tinjauan HRD.');
	}

	const stamp = new Date().toISOString().slice(0, 10);
	const gabung = `${existing ? existing + '\n' : ''}[Klarifikasi karyawan ${stamp}] ${teks}`;

	const res = await directusServerJson<{ data: DendaProseduralLog }>(
		`/items/denda_prosedural_log/${logId}`,
		{ method: 'PATCH', body: JSON.stringify({ alasan_pembebasan: gabung }) }
	);
	return res?.data as DendaProseduralLog;
}
