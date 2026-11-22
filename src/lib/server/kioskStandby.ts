// src/lib/server/kioskStandby.ts
// Slideshow standby Kiosk Produksi (rekomendasi Budaya & Propaganda Fase 5): saat layar tidak disentuh > N detik (culture.kiosk_standby_idle_seconds)
// tampil bergilir: Visi & Misi → Motto → Nilai Inti → milestone rekan (ulang tahun/anniversary) → Peringkat 5 Gamifikasi musim berjalan →
// Kartu Kebanggaan Proyek. Satu endpoint ringan ber-cache 60 dtk; tiap bagian di-fetch TERPISAH & fail-soft (bagian yang gagal dilewati + dilog).
// Hanya teks/ nama & poin yang sudah tampil di aplikasi internal — tanpa data sensitif. Mati bila setelan culture.kiosk_standby_enabled = false.

import { directusServerJson } from '$lib/server/directus';
import { loadCultureSettings } from '$lib/server/ess/budayaHarian';
import { getBudaya } from '$lib/server/ess/budaya';
import { getWall } from '$lib/server/ess/belongingServer';
import { loadSpotlightTayang } from '$lib/server/ess/spotlight';

export type StandbySlide =
	| { type: 'visimisi'; visi: string; misi: string[] }
	| { type: 'motto'; motto: string }
	| { type: 'nilai'; nilai: { judul: string; arti_singkat: string; ikon: string; warna: string | null }[] }
	| { type: 'milestone'; items: { judul: string; tanggal: string | null }[] }
	| { type: 'peringkat'; musim: string; baris: { nama: string; poin: number }[] }
	| { type: 'spotlight'; judul: string; ringkasan: string; foto_id: string | null; pemimpin_nama: string | null };

export interface StandbyPayload {
	enabled: boolean;
	idleSeconds: number;
	slides: StandbySlide[];
}

const TTL_MS = 60_000;
let cache: { at: number; value: StandbyPayload } | null = null;

export interface StandbyParts {
	budaya?: { motto?: string; visi?: string; misi?: string[]; nilai?: any[] } | null;
	milestone?: { judul: string; tanggal_event: string | null }[] | null;
	peringkat?: { musim: string; baris: { nama: string; poin: number }[] } | null;
	spotlight?: { judul: string; ringkasan: string; foto_id: string | null; pemimpin_nama: string | null }[] | null;
}

/** Susun urutan slide dari bagian yang tersedia (murni; bagian kosong dilewati). */
export function buildSlides(p: StandbyParts): StandbySlide[] {
	const slides: StandbySlide[] = [];
	const b = p.budaya;
	if (b && (b.visi || (b.misi && b.misi.length))) slides.push({ type: 'visimisi', visi: b.visi || '', misi: (b.misi || []).slice(0, 5) });
	if (b?.motto) slides.push({ type: 'motto', motto: b.motto });
	if (b?.nilai && b.nilai.length) {
		slides.push({
			type: 'nilai',
			nilai: b.nilai.slice(0, 6).map((n: any) => ({ judul: String(n.judul ?? ''), arti_singkat: String(n.arti_singkat ?? ''), ikon: String(n.ikon ?? n.kode ?? ''), warna: n.warna ?? null }))
		});
	}
	if (p.milestone && p.milestone.length) slides.push({ type: 'milestone', items: p.milestone.slice(0, 6).map((m) => ({ judul: m.judul, tanggal: m.tanggal_event })) });
	if (p.peringkat && p.peringkat.baris.length) slides.push({ type: 'peringkat', musim: p.peringkat.musim, baris: p.peringkat.baris.slice(0, 5) });
	for (const s of p.spotlight || []) slides.push({ type: 'spotlight', judul: s.judul, ringkasan: s.ringkasan, foto_id: s.foto_id, pemimpin_nama: s.pemimpin_nama });
	return slides;
}

/** 5 teratas dari baris ledger (murni): jumlahkan poin per karyawan, urut turun, abaikan poin <= 0. */
export function topPeringkat(ledger: { karyawan_id: any; poin: any }[], limit = 5): { karyawan_id: string; poin: number }[] {
	const sum = new Map<string, number>();
	for (const r of Array.isArray(ledger) ? ledger : []) {
		if (r?.karyawan_id == null) continue;
		const k = String(r.karyawan_id);
		sum.set(k, (sum.get(k) || 0) + (Number(r.poin) || 0));
	}
	return [...sum.entries()]
		.filter(([, poin]) => poin > 0)
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([karyawan_id, poin]) => ({ karyawan_id, poin }));
}

async function loadPeringkat(): Promise<StandbyParts['peringkat']> {
	const musimRes = await directusServerJson<{ data: any[] }>(`/items/gamifikasi_musim?filter[status][_eq]=berjalan&sort=-tanggal_mulai&fields=id,kode&limit=1`);
	const musim = musimRes?.data?.[0];
	if (!musim) return null;
	const ledger = await directusServerJson<{ data: any[] }>(`/items/gamifikasi_ledger?filter[musim_id][_eq]=${musim.id}&fields=karyawan_id,poin&limit=-1`);
	const top = topPeringkat(ledger?.data || [], 5);
	if (!top.length) return null;
	const names = await directusServerJson<{ data: any[] }>(`/items/karyawan?filter[id][_in]=${top.map((t) => t.karyawan_id).join(',')}&fields=id,nama_karyawan&limit=-1`);
	const byId = new Map((names?.data || []).map((k) => [String(k.id), String(k.nama_karyawan ?? '')]));
	return { musim: String(musim.kode ?? ''), baris: top.map((t) => ({ nama: byId.get(t.karyawan_id) || `Karyawan #${t.karyawan_id}`, poin: t.poin })) };
}

const lembut = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
	try {
		return await fn();
	} catch (e) {
		console.warn(`[kioskStandby] bagian "${label}" dilewati:`, (e as Error)?.message);
		return null;
	}
};

export async function getStandby(): Promise<StandbyPayload> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
	const settings = await loadCultureSettings();
	const idleSeconds = Math.max(30, Math.min(900, Number(settings['culture.kiosk_standby_idle_seconds']) || 120));
	if (!settings['culture.kiosk_standby_enabled']) {
		const off = { enabled: false, idleSeconds, slides: [] };
		cache = { at: Date.now(), value: off };
		return off;
	}
	const [budaya, wall, peringkat, spotlight] = await Promise.all([
		lembut('budaya', () => getBudaya()),
		lembut('milestone', () => getWall({ id: 0 })),
		lembut('peringkat', loadPeringkat),
		lembut('spotlight', loadSpotlightTayang)
	]);
	const value: StandbyPayload = {
		enabled: true,
		idleSeconds,
		slides: buildSlides({
			budaya,
			milestone: wall?.events?.map((e) => ({ judul: e.judul, tanggal_event: e.tanggal_event })) ?? null,
			peringkat,
			spotlight: spotlight ?? null
		})
	};
	cache = { at: Date.now(), value };
	return value;
}

/** Hanya untuk test. */
export function clearStandbyCache(): void {
	cache = null;
}
