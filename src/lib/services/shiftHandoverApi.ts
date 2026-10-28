// src/lib/services/shiftHandoverApi.ts
// R5 (rekomendasi audit "Pertajam Modul Kiosk Produksi v2", 12 Sep 2026) — Serah-terima shift
// produksi. Koleksi `shift_handover` sudah ada di Directus tapi BELUM ADA UI sama sekali di
// project-epi sebelum ini (bukan sekadar "sambung ke koleksi yang sudah ada" seperti diasumsikan
// dokumen rencana). Ringkasan (output/reject/waste + defect teratas) memanfaatkan
// `jadwal_kerja_id` yang mulai diisi Fase 3D -- shift lama sebelum Fase 3D tidak akan
// punya ringkasan (jadwal_kerja_id null), itu bukan bug, hanya keterbatasan data lama.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem } from '@directus/sdk';
import { todayWib } from '$lib/utils/wibDate';

export interface KaryawanOption {
	id: number;
	nama_karyawan: string;
}

export async function fetchKaryawanOptions(): Promise<KaryawanOption[]> {
	try {
		return (await directus.request(
			readItems('karyawan' as any, {
				filter: { status: { _eq: 'On' } } as any,
				fields: ['id', 'nama_karyawan'],
				sort: ['nama_karyawan'],
				limit: -1
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Dua query terpisah (Aturan #2) -- shift_roster dulu, fallback jadwal statis karyawan. */
async function resolveJadwalKerjaId(karyawanId: number, tanggal: string): Promise<string | null> {
	try {
		const rows = (await directus.request(
			readItems('shift_roster' as any, {
				filter: { karyawan_id: { _eq: karyawanId }, tanggal: { _eq: tanggal }, status: { _eq: 'aktif' } } as any,
				fields: ['jadwal_kerja_id'],
				limit: 1
			})
		)) as any[];
		const fromRoster = rows?.[0]?.jadwal_kerja_id;
		if (fromRoster) return typeof fromRoster === 'object' ? fromRoster.id : fromRoster;
	} catch {
		/* lanjut ke fallback */
	}
	try {
		const rows = (await directus.request(
			readItems('karyawan' as any, { filter: { id: { _eq: karyawanId } } as any, fields: ['jadwal_kerja_id'], limit: 1 })
		)) as any[];
		const fromKaryawan = rows?.[0]?.jadwal_kerja_id;
		if (fromKaryawan) return typeof fromKaryawan === 'object' ? fromKaryawan.id : fromKaryawan;
	} catch {
		/* biarkan null */
	}
	return null;
}

export interface ShiftSummary {
	jadwalKerjaId: string | null;
	namaJadwal: string | null;
	tanggal: string;
	outputKg: number;
	rejectKg: number;
	wasteKg: number;
	entriCount: number;
	topDefectReasons: { reason: string; count: number }[];
}

const EMPTY_SUMMARY = (tanggal: string): ShiftSummary => ({
	jadwalKerjaId: null,
	namaJadwal: null,
	tanggal,
	outputKg: 0,
	rejectKg: 0,
	wasteKg: 0,
	entriCount: 0,
	topDefectReasons: []
});

/**
 * Ringkasan shift HARI INI untuk karyawan yang login -- seluruh entri spk_daily_log dengan
 * jadwal_kerja_id yang sama pada tanggal ini (bukan hanya milik karyawan ini sendiri; shift
 * adalah kerja tim, bukan personal). Dipakai untuk auto-isi catatan serah-terima.
 */
export async function fetchMyShiftSummary(karyawanId: number): Promise<ShiftSummary> {
	const tanggal = todayWib();
	const jadwalKerjaId = await resolveJadwalKerjaId(karyawanId, tanggal);
	if (!jadwalKerjaId) return EMPTY_SUMMARY(tanggal);

	try {
		const [jadwalRows, logRows] = await Promise.all([
			directus.request(
				readItems('jadwal_kerja' as any, { filter: { id: { _eq: jadwalKerjaId } } as any, fields: ['id', 'nama_jadwal'], limit: 1 })
			) as Promise<any[]>,
			directus.request(
				readItems('spk_daily_log' as any, {
					filter: { jadwal_kerja_id: { _eq: jadwalKerjaId }, tanggal: { _eq: tanggal } } as any,
					fields: ['output_kg', 'reject_kg', 'waste_kg', 'reject_reasons', 'waste_reasons'],
					limit: -1
				})
			) as Promise<any[]>
		]);

		const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
		const reasonCount = new Map<string, number>();
		let outputKg = 0, rejectKg = 0, wasteKg = 0;
		for (const r of logRows) {
			outputKg += num(r.output_kg);
			rejectKg += num(r.reject_kg);
			wasteKg += num(r.waste_kg);
			for (const reason of [...(r.reject_reasons || []), ...(r.waste_reasons || [])]) {
				reasonCount.set(reason, (reasonCount.get(reason) || 0) + 1);
			}
		}
		const topDefectReasons = [...reasonCount.entries()]
			.map(([reason, count]) => ({ reason, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 3);

		return {
			jadwalKerjaId,
			namaJadwal: jadwalRows?.[0]?.nama_jadwal || null,
			tanggal,
			outputKg: Math.round(outputKg * 100) / 100,
			rejectKg: Math.round(rejectKg * 100) / 100,
			wasteKg: Math.round(wasteKg * 100) / 100,
			entriCount: logRows.length,
			topDefectReasons
		};
	} catch (err) {
		handleDirectusError(err);
		return EMPTY_SUMMARY(tanggal);
	}
}

/** Bangun teks ringkasan otomatis -- operator boleh mengedit sebelum kirim. */
export function formatSummaryText(s: ShiftSummary): string {
	if (s.entriCount === 0) {
		return 'Belum ada entri produksi tercatat untuk shift ini hari ini.';
	}
	const lines = [
		`Ringkasan otomatis (${s.entriCount} entri): Output ${s.outputKg} kg, Reject ${s.rejectKg} kg, Waste ${s.wasteKg} kg.`
	];
	if (s.topDefectReasons.length > 0) {
		lines.push('Defect teratas: ' + s.topDefectReasons.map((d) => `${d.reason} (${d.count}x)`).join(', ') + '.');
	}
	return lines.join(' ');
}

export interface HandoverRow {
	id: number;
	tanggal: string;
	shift_label: string | null;
	karyawan_keluar_id: { id: number; nama_karyawan: string } | number;
	karyawan_masuk_id: { id: number; nama_karyawan: string } | number;
	catatan_keluar: string | null;
	catatan_masuk: string | null;
	diterima: boolean;
	confirmed_at: string | null;
	date_created: string;
}

export async function createShiftHandover(params: {
	karyawanKeluarId: number;
	karyawanMasukId: number;
	shiftLabel: string | null;
	catatanKeluar: string;
	shiftRosterId?: string | null;
}) {
	try {
		return await directus.request(
			createItem('shift_handover' as any, {
				tanggal: todayWib(),
				shift_label: params.shiftLabel,
				karyawan_keluar_id: params.karyawanKeluarId,
				karyawan_masuk_id: params.karyawanMasukId,
				catatan_keluar: params.catatanKeluar,
				diterima: false,
				shift_roster_id: params.shiftRosterId || null
			} as any)
		);
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

/** Serah-terima yang MENUNGGU diterima karyawan ini (masuk shift). */
export async function fetchPendingHandoversForMe(karyawanId: number): Promise<HandoverRow[]> {
	try {
		return (await directus.request(
			readItems('shift_handover' as any, {
				filter: { karyawan_masuk_id: { _eq: karyawanId }, diterima: { _eq: false } } as any,
				fields: ['id', 'tanggal', 'shift_label', 'karyawan_keluar_id.id', 'karyawan_keluar_id.nama_karyawan', 'catatan_keluar', 'date_created'],
				sort: ['-date_created'],
				limit: 20
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Riwayat serah-terima yang PERNAH saya buat (keluar shift), untuk lihat status diterima/belum. */
export async function fetchMyHandoverHistory(karyawanId: number): Promise<HandoverRow[]> {
	try {
		return (await directus.request(
			readItems('shift_handover' as any, {
				filter: { karyawan_keluar_id: { _eq: karyawanId } } as any,
				fields: [
					'id', 'tanggal', 'shift_label', 'karyawan_masuk_id.id', 'karyawan_masuk_id.nama_karyawan',
					'catatan_keluar', 'catatan_masuk', 'diterima', 'confirmed_at', 'date_created'
				],
				sort: ['-date_created'],
				limit: 10
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function confirmShiftHandover(id: number, catatanMasuk: string | null): Promise<void> {
	try {
		await directus.request(
			updateItem('shift_handover' as any, id, {
				diterima: true,
				confirmed_at: new Date().toISOString(),
				catatan_masuk: catatanMasuk || null
			} as any)
		);
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}
