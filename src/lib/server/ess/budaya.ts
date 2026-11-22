// src/lib/server/ess/budaya.ts
// Visi/Misi/Motto/Manifesto (kolom tambahan singleton `company_identity`) + Nilai Inti (`company_core_values`)
// untuk /api/ess/budaya. Dua koleksi di-fetch TERPISAH & gagal-lunak (CLAUDE.md #2); kegagalan dilog jelas
// dan dikembalikan sebagai `errors`. Cache in-memory 10 menit (data jarang berubah) + de-dup inflight.
// Nama kolom harus sama dengan erp-epi/scripts/budaya-schema-fase1.mjs.

import { directusServerJson } from '$lib/server/directus';

export interface NilaiInti {
	id: number;
	kode: string;
	judul: string;
	arti_singkat: string;
	perilaku: { do: string[]; dont: string[] };
	ikon: string;
	warna: string | null;
	urutan: number;
}

export interface BudayaPayload {
	motto: string;
	visi: string;
	misi: string[];
	manifesto_budaya: string;
	video_budaya_url: string;
	nilai: NilaiInti[];
	errors: { identity?: string; nilai?: string };
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; data: BudayaPayload } | null = null;
let inflight: Promise<BudayaPayload> | null = null;

export function invalidateBudayaCache() {
	cache = null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strList = (a: unknown): string[] =>
	Array.isArray(a) ? a.map((s) => str(s)).filter(Boolean) : [];

/** Misi bisa array json, string JSON, atau teks per-baris. */
export function normalizeMisi(value: unknown): string[] {
	if (Array.isArray(value)) return strList(value).map(stripBullet);
	const t = str(value);
	if (!t) return [];
	if (t.startsWith('[')) {
		try {
			const p = JSON.parse(t);
			if (Array.isArray(p)) return strList(p).map(stripBullet);
		} catch {
			/* jatuh ke per-baris */
		}
	}
	return t.split(/\r?\n/).map((s) => stripBullet(s.trim())).filter(Boolean);
}
const stripBullet = (s: string) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();

export function normalizePerilaku(value: unknown): { do: string[]; dont: string[] } {
	let v: any = value;
	if (typeof v === 'string') {
		try {
			v = JSON.parse(v);
		} catch {
			v = null;
		}
	}
	return { do: strList(v?.do), dont: strList(v?.dont) };
}

export function normalizeNilai(rows: unknown): NilaiInti[] {
	if (!Array.isArray(rows)) return [];
	return rows
		.filter((r: any) => r && r.aktif !== false && str(r.judul))
		.map((r: any) => ({
			id: Number(r.id),
			kode: str(r.kode),
			judul: str(r.judul),
			arti_singkat: str(r.arti_singkat),
			perilaku: normalizePerilaku(r.perilaku_kunci),
			ikon: str(r.ikon),
			warna: /^#[0-9a-fA-F]{6}$/.test(str(r.warna)) ? str(r.warna) : null,
			urutan: Number(r.urutan ?? 0) || 0
		}))
		.sort((a, b) => a.urutan - b.urutan || a.judul.localeCompare(b.judul));
}

async function loadIdentity() {
	const res = await directusServerJson<{ data: any }>(
		'/items/company_identity?fields=id,visi,misi,motto,manifesto_budaya,video_budaya_url'
	);
	const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
	return row && typeof row === 'object' ? row : null;
}

async function loadNilai() {
	const res = await directusServerJson<{ data: any[] }>(
		'/items/company_core_values?fields=id,kode,judul,arti_singkat,perilaku_kunci,ikon,warna,urutan,aktif&filter[aktif][_eq]=true&sort=urutan,id&limit=-1'
	);
	return res?.data || [];
}

async function build(): Promise<BudayaPayload> {
	const errors: BudayaPayload['errors'] = {};
	const [identity, nilaiRows] = await Promise.all([
		loadIdentity().catch((e) => {
			console.error('[ess/budaya] gagal memuat identitas budaya (skema belum diterapkan?):', e?.message);
			errors.identity = e?.message || 'gagal';
			return null;
		}),
		loadNilai().catch((e) => {
			console.error('[ess/budaya] gagal memuat nilai inti (koleksi belum ada?):', e?.message);
			errors.nilai = e?.message || 'gagal';
			return [];
		})
	]);
	return {
		motto: str(identity?.motto),
		visi: str(identity?.visi),
		misi: normalizeMisi(identity?.misi),
		manifesto_budaya: str(identity?.manifesto_budaya),
		video_budaya_url: str(identity?.video_budaya_url),
		nilai: normalizeNilai(nilaiRows),
		errors
	};
}

export async function getBudaya(): Promise<BudayaPayload> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
	if (inflight) return inflight;
	inflight = build()
		.then((data) => {
			// Hasil gagal tidak di-cache agar langsung pulih begitu skema diterapkan.
			if (!data.errors.identity && !data.errors.nilai) cache = { at: Date.now(), data };
			return data;
		})
		.finally(() => {
			inflight = null;
		});
	return inflight;
}
