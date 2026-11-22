// src/lib/server/ess/maintenanceSaya.ts
// Fase 5 (Laporan Bulanan Maintenance & Pertajam KPI): kartu "Kepatuhan PM & P2H Saya" di ess/maintenance-kpi.
// Fungsi hitung MURNI (`hitungPmP2h`) dipisah dari pembacaan Directus (`ringkasPmP2h`). Gagal baca = null + log jelas, BUKAN 0 (tidak menyesatkan).
import { directusServerJson } from '$lib/server/directus';

export interface PmP2hSaya {
	/** PM yang saya tutup pada periode aktif (pm_due_tracker.selesai_oleh = nama saya, last_done_date dalam periode). */
	pmSelesai: number;
	/** Dari pmSelesai: ditutup ≤ jatuh tempo. */
	pmTepat: number;
	pmTepatPct: number | null;
	/** Sesi P2H yang saya isi pada periode aktif. */
	p2hSesi: number;
	/** Jumlah hari berbeda saya mengisi P2H. */
	p2hHari: number;
	/** Sesi dengan hasil No-Go (item bermasalah terdeteksi — itu temuan baik, bukan pelanggaran). */
	p2hNoGo: number;
}

const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');

export function hitungPmP2h(
	pm: { due_date?: string | null; last_done_date?: string | null }[],
	p2h: { date?: string | null; overall_result?: string | null }[],
	noGoId: string | null
): PmP2hSaya {
	const pmSelesai = pm.filter((p) => day(p.last_done_date)).length;
	const pmTepat = pm.filter((p) => day(p.last_done_date) && day(p.due_date) && day(p.last_done_date) <= day(p.due_date)).length;
	return {
		pmSelesai,
		pmTepat,
		pmTepatPct: pmSelesai > 0 ? Math.round((pmTepat / pmSelesai) * 1000) / 10 : null,
		p2hSesi: p2h.length,
		p2hHari: new Set(p2h.map((s) => day(s.date)).filter(Boolean)).size,
		p2hNoGo: noGoId ? p2h.filter((s) => s.overall_result === noGoId).length : 0
	};
}

let noGoIdCache: string | null | undefined;
async function getNoGoId(): Promise<string | null> {
	if (noGoIdCache !== undefined) return noGoIdCache;
	const res = await directusServerJson<{ data: { id: string; name: string }[] }>(
		`/items/category?${new URLSearchParams({ 'filter[group][_eq]': 'p2h_result', fields: 'id,name', limit: '-1' }).toString()}`
	);
	noGoIdCache = (res?.data || []).find((c) => c.name === 'No-Go')?.id ?? null;
	return noGoIdCache;
}

export async function ringkasPmP2h(
	personnel: { id: string; name: string },
	period: { tanggal_mulai: string; tanggal_selesai: string } | null
): Promise<PmP2hSaya | null> {
	if (!period?.tanggal_mulai || !period?.tanggal_selesai) return null;
	const { tanggal_mulai: from, tanggal_selesai: to } = period;
	try {
		// Dua koleksi + kategori dibaca TERPISAH (Aturan #2); kolom ramping — TANPA signature p2h_session.
		const [pm, p2h, noGoId] = await Promise.all([
			directusServerJson<{ data: any[] }>(
				`/items/pm_due_tracker?${new URLSearchParams({
					'filter[selesai_oleh][_eq]': personnel.name,
					'filter[last_done_date][_between]': `${from},${to}`,
					fields: 'id,due_date,last_done_date',
					limit: '-1'
				}).toString()}`
			),
			directusServerJson<{ data: any[] }>(
				`/items/p2h_session?${new URLSearchParams({
					'filter[operator_id][_eq]': personnel.id,
					'filter[date][_between]': `${from},${to}`,
					fields: 'id,date,overall_result',
					limit: '-1'
				}).toString()}`
			),
			getNoGoId()
		]);
		return hitungPmP2h(pm?.data || [], p2h?.data || [], noGoId);
	} catch (err) {
		console.error('[ess/maintenanceSaya] gagal membaca PM/P2H pribadi (kartu disembunyikan, bukan 0):', err);
		return null;
	}
}
