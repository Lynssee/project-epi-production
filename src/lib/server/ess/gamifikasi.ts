// src/lib/server/ess/gamifikasi.ts
// Fase 11c (KPI Terpadu — link Gamifikasi Lapangan). Mesin poin sudah jalan di sisi
// Admin (erp-epi-1: /api/automation/gamifikasi-hitung, termasuk kategori 'kpi' yang
// sudah award poin dari kpi_management.total_skor/skor_potensi Finalized) — SELALU
// server-side, tidak pernah ditulis dari ESS. File ini murni BACA ledger yang sudah
// ada supaya karyawan lapangan bisa lihat poin/peringkat/badge miliknya.

import { directusServerJson } from '$lib/server/directus';

export interface GamifikasiMusim {
	id: string;
	kode: string;
	nama: string;
	status: string;
	tanggal_mulai: string;
	tanggal_selesai: string;
}

export interface GamifikasiBadge {
	id: string;
	badge_nama: string;
	badge_icon: string | null;
	tanggal_diraih: string;
}

export interface GamifikasiSummary {
	musim: GamifikasiMusim | null;
	poinSaya: number;
	peringkatSaya: number | null;
	totalPeserta: number;
	top10: { karyawan_id: string; nama_karyawan: string; total_poin: number }[];
	badgeSaya: GamifikasiBadge[];
}

async function getMusimAktif(): Promise<GamifikasiMusim | null> {
	const res = await directusServerJson<{ data: GamifikasiMusim[] }>(
		`/items/gamifikasi_musim?filter[status][_eq]=berjalan&sort=-tanggal_mulai&limit=1`
	);
	return res?.data?.[0] || null;
}

export async function getMyGamifikasiSummary(karyawanId: number): Promise<GamifikasiSummary> {
	const musim = await getMusimAktif();
	if (!musim) {
		return { musim: null, poinSaya: 0, peringkatSaya: null, totalPeserta: 0, top10: [], badgeSaya: [] };
	}

	const ledgerRes = await directusServerJson<{ data: { karyawan_id: string; poin: number }[] }>(
		`/items/gamifikasi_ledger?filter[musim_id][_eq]=${musim.id}&fields=karyawan_id,poin&limit=-1`
	);
	const byKaryawan = new Map<string, number>();
	for (const row of ledgerRes?.data || []) {
		const key = String(row.karyawan_id);
		byKaryawan.set(key, (byKaryawan.get(key) || 0) + (Number(row.poin) || 0));
	}
	const ranked = [...byKaryawan.entries()]
		.map(([karyawan_id, total_poin]) => ({ karyawan_id, total_poin }))
		.sort((a, b) => b.total_poin - a.total_poin);

	const myKey = String(karyawanId);
	const myIndex = ranked.findIndex((r) => r.karyawan_id === myKey);
	const poinSaya = myIndex >= 0 ? ranked[myIndex].total_poin : 0;
	const peringkatSaya = myIndex >= 0 ? myIndex + 1 : null;

	const top10Raw = ranked.slice(0, 10);
	const top10Ids = top10Raw.map((r) => r.karyawan_id);
	let namaById = new Map<string, string>();
	if (top10Ids.length > 0) {
		const karyawanRes = await directusServerJson<{ data: { id: number; nama_karyawan: string }[] }>(
			`/items/karyawan?filter[id][_in]=${top10Ids.join(',')}&fields=id,nama_karyawan&limit=-1`
		);
		namaById = new Map((karyawanRes?.data || []).map((k) => [String(k.id), k.nama_karyawan]));
	}
	const top10 = top10Raw.map((r) => ({ ...r, nama_karyawan: namaById.get(r.karyawan_id) || `Karyawan #${r.karyawan_id}` }));

	const badgeRes = await directusServerJson<{
		data: { id: string; tanggal_diraih: string; badge_id: { nama: string; icon: string | null } | null }[];
	}>(
		`/items/gamifikasi_badge_diraih?filter[karyawan_id][_eq]=${karyawanId}&fields=id,tanggal_diraih,badge_id.nama,badge_id.icon&sort=-tanggal_diraih&limit=-1`
	);
	const badgeSaya = (badgeRes?.data || []).map((b) => ({
		id: b.id,
		badge_nama: b.badge_id?.nama || 'Badge',
		badge_icon: b.badge_id?.icon || null,
		tanggal_diraih: b.tanggal_diraih
	}));

	return {
		musim,
		poinSaya,
		peringkatSaya,
		totalPeserta: ranked.length,
		top10,
		badgeSaya
	};
}
