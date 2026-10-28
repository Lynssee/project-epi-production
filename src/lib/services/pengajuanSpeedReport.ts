// src/lib/services/pengajuanSpeedReport.ts
// R10 (Forecast Keuangan Global, rekomendasi laporan) — "Rapor Kecepatan Pengajuan": berapa
// hari rata-rata dari submit PA sampai cair, per kategori. Transparansi buat pengaju sendiri
// (bukan cross-user — hanya pengajuan_anggaran milik user login), mendorong akuntabilitas SLA
// internal tanpa perlu tanya-tanya ke Finance.
//
// Read-only, satu koleksi (pengajuan_anggaran), tanpa relasi bersarang.

import directus from './directus';
import { readItems } from '@directus/sdk';

export interface PengajuanSpeedRow {
	kategori: string;
	count: number;
	avgDays: number;
	minDays: number;
	maxDays: number;
}

export interface PengajuanSpeedReport {
	rows: PengajuanSpeedRow[];
	overallAvgDays: number;
	totalSelesai: number;
	totalMenunggu: number; // belum cair, tidak dihitung ke rata-rata (masih berjalan)
}

function diffDays(a: string, b: string): number {
	const ms = new Date(b).getTime() - new Date(a).getTime();
	return Math.max(0, Math.round(ms / 86400000));
}

/**
 * @param email created_by_email pemohon (dari authStore.user.email) — TIDAK bisa lihat
 *   punya orang lain, sengaja dibatasi ke milik sendiri.
 */
export async function fetchPengajuanSpeedReport(email: string | null | undefined): Promise<PengajuanSpeedReport> {
	const empty: PengajuanSpeedReport = { rows: [], overallAvgDays: 0, totalSelesai: 0, totalMenunggu: 0 };
	if (!email) return empty;

	try {
		const items = (await directus.request(
			readItems('pengajuan_anggaran' as any, {
				filter: { created_by_email: { _eq: email } },
				fields: ['id', 'kategori', 'date_created', 'tanggal_dicairkan', 'status'],
				limit: -1
			})
		)) as any[];

		const byKategori = new Map<string, number[]>();
		let totalMenunggu = 0;
		const allDays: number[] = [];

		for (const it of items) {
			if (!it.tanggal_dicairkan || !it.date_created) {
				totalMenunggu++;
				continue;
			}
			const days = diffDays(it.date_created, it.tanggal_dicairkan);
			const kategori = it.kategori || 'lainnya';
			if (!byKategori.has(kategori)) byKategori.set(kategori, []);
			byKategori.get(kategori)!.push(days);
			allDays.push(days);
		}

		const rows: PengajuanSpeedRow[] = [...byKategori.entries()]
			.map(([kategori, daysList]) => ({
				kategori,
				count: daysList.length,
				avgDays: Math.round((daysList.reduce((s, d) => s + d, 0) / daysList.length) * 10) / 10,
				minDays: Math.min(...daysList),
				maxDays: Math.max(...daysList)
			}))
			.sort((a, b) => b.count - a.count);

		return {
			rows,
			overallAvgDays: allDays.length ? Math.round((allDays.reduce((s, d) => s + d, 0) / allDays.length) * 10) / 10 : 0,
			totalSelesai: allDays.length,
			totalMenunggu
		};
	} catch (error) {
		console.warn('[pengajuanSpeedReport] Gagal memuat rapor kecepatan:', error);
		return empty;
	}
}
