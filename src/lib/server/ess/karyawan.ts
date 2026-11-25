// src/lib/server/ess/karyawan.ts
// Resolusi karyawan di server berdasarkan email Firebase — TIDAK PERNAH percaya
// karyawan_id yang dikirim dari klien (bisa dipalsukan untuk membaca/menulis data orang lain).

import { error } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';

export interface ServerKaryawan {
	id: number;
	nama_karyawan: string;
	email_company: string;
	divisi: string | null;
	divisi_id: number | null;
	posisi: string | null;
	jabatan_id: number | null;
	jadwal_kerja_id?: string | null;
	pola_kerja?: string | null;
}

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

function unwrapStringId(value: any): string | null {
	if (value == null) return null;
	const raw = typeof value === 'object' ? (value.id ?? null) : value;
	return raw == null || raw === '' ? null : String(raw);
}

export async function resolveKaryawanByEmail(email: string): Promise<ServerKaryawan | null> {
	if (!email) return null;
	const query = new URLSearchParams({
		'filter[email_company][_eq]': email.toLowerCase(),
		fields: 'id,nama_karyawan,email_company,divisi,divisi_id,posisi,jabatan_id',
		limit: '1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/karyawan?${query.toString()}`);
	const row = result?.data?.[0];
	if (!row) return null;
	return { ...row, divisi_id: unwrapId(row.divisi_id), jabatan_id: unwrapId(row.jabatan_id) };
}

export interface KaryawanBrief {
	id: number;
	nama_karyawan: string;
	divisi: string | null;
	posisi: string | null;
	foto: string | null;
}

/** Fetch data relasi karyawan terpisah (sesuai aturan Directus: separated relation fetch) */
export async function fetchKaryawanMapByIds(ids: (number | string)[]): Promise<Map<string, KaryawanBrief>> {
	const numericIds = [...new Set(ids.map((id) => Number(id)).filter((id) => !isNaN(id) && id > 0))];
	if (numericIds.length === 0) return new Map();

	try {
		const query = new URLSearchParams({
			'filter[id][_in]': numericIds.join(','),
			fields: 'id,nama_karyawan,divisi,posisi,foto',
			limit: '-1'
		});
		const result = await directusServerJson<{ data: KaryawanBrief[] }>(`/items/karyawan?${query.toString()}`);
		const map = new Map<string, KaryawanBrief>();
		for (const k of result?.data || []) {
			map.set(String(k.id), k);
		}
		return map;
	} catch {
		return new Map();
	}
}


// ── PC3-18 — resolusi identitas berlapis (samakan dengan admin getKaryawanByFirebaseUid) ─────────────────────────
// Pekerja lapangan login dengan akun Google/email pribadi; mencari HANYA lewat email_company membuat banyak orang
// "belum tertaut ke data karyawan" di lokasi proyek yang tak punya HRD. Urutan: firebase_uid → email → email_company.

const IDENTITY_FIELDS =
	'id,nama_karyawan,email_company,email,divisi,divisi_id,posisi,jabatan_id,status,firebase_uid,jadwal_kerja_id,pola_kerja';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_IDENTITY_CACHE = 500;
const identityCache = new Map<string, { at: number; value: ServerKaryawan }>();
const identityInflight = new Map<string, Promise<ServerKaryawan | null>>();

/** Untuk tes: kosongkan cache identitas & antrean in-flight. */
export function clearKaryawanIdentityCache() {
	identityCache.clear();
	identityInflight.clear();
}

function pruneIdentityCache(now: number) {
	if (identityCache.size < MAX_IDENTITY_CACHE) return;
	for (const [k, entry] of identityCache) {
		if (now - entry.at >= CACHE_TTL_MS) identityCache.delete(k);
	}
	if (identityCache.size >= MAX_IDENTITY_CACHE) {
		const oldestKey = identityCache.keys().next().value;
		if (oldestKey !== undefined) identityCache.delete(oldestKey);
	}
}

/** Murni. Baris kandidat aktif (status bukan "Off"), duplikat id dibuang. */
export function activeCandidates(rows: any[] | null | undefined): any[] {
	const seen = new Set<string>();
	const out: any[] = [];
	for (const k of rows || []) {
		if (String(k?.status ?? '').trim().toLowerCase() === 'off') continue;
		const key = String(k.id);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(k);
	}
	return out;
}

function toServerKaryawan(row: any): ServerKaryawan {
	const base: ServerKaryawan = {
		...row,
		divisi_id: unwrapId(row.divisi_id),
		jabatan_id: unwrapId(row.jabatan_id)
	};
	if (Object.prototype.hasOwnProperty.call(row, 'jadwal_kerja_id')) {
		base.jadwal_kerja_id = unwrapStringId(row.jadwal_kerja_id);
	}
	if (Object.prototype.hasOwnProperty.call(row, 'pola_kerja')) {
		base.pola_kerja = row.pola_kerja ? String(row.pola_kerja) : null;
	}
	return base;
}

function buildIdentityFilterQuery(uid: string, emailLower: string): string {
	const clauses: Array<{ field: string; value: string }> = [];
	if (uid) clauses.push({ field: 'firebase_uid', value: uid });
	if (emailLower) {
		clauses.push({ field: 'email', value: emailLower });
		clauses.push({ field: 'email_company', value: emailLower });
	}
	if (clauses.length === 1) {
		const c = clauses[0];
		return `filter[${c.field}][_eq]=${encodeURIComponent(c.value)}`;
	}
	return clauses
		.map((c, idx) => `filter[_or][${idx}][${c.field}][_eq]=${encodeURIComponent(c.value)}`)
		.join('&');
}

function pickByPriority(rows: any[], uid: string, emailLower: string): any | null {
	const active = activeCandidates(rows);
	if (active.length === 0) return null;

	const checks: Array<{ label: string; match: (r: any) => boolean }> = [];
	if (uid) {
		checks.push({
			label: `firebase_uid=${uid}`,
			match: (r) => String(r?.firebase_uid ?? '').trim() === uid
		});
	}
	if (emailLower) {
		checks.push({
			label: `email=${emailLower}`,
			match: (r) => String(r?.email ?? '').trim().toLowerCase() === emailLower
		});
		checks.push({
			label: `email_company=${emailLower}`,
			match: (r) => String(r?.email_company ?? '').trim().toLowerCase() === emailLower
		});
	}

	for (const tier of checks) {
		const matched = active.filter(tier.match);
		if (matched.length === 1) return matched[0];
		if (matched.length > 1) {
			console.error('[ess] identitas ambigu untuk', tier.label);
			throw error(409, 'Akun Anda cocok dengan lebih dari satu data karyawan. Hubungi HRD.');
		}
	}

	return null;
}

/**
 * Cari karyawan dari akun login dalam 1 round-trip Directus (`_or` atas firebase_uid, email, email_company),
 * lalu evaluasi prioritas ketat firebase_uid → email → email_company di memori.
 * Tepat 1 kandidat aktif → dipakai; >1 pada satu jalur → 409 (tak menebak identitas); tak ada → null.
 * Hasil di-cache 5 menit per uid/email dan di-coalesce untuk request paralel (hemat API).
 */
export async function resolveKaryawanForUser(
	user: { uid?: string | null; email?: string | null },
	fetchRows: (filterQuery: string) => Promise<any[]> = async (f) => {
		const r = await directusServerJson<{ data: any[] }>(`/items/karyawan?limit=10&fields=${IDENTITY_FIELDS}&${f}`);
		return r?.data || [];
	}
): Promise<ServerKaryawan | null> {
	const uid = user.uid ? String(user.uid).trim() : '';
	const emailLower = user.email ? String(user.email).trim().toLowerCase() : '';
	const cacheKey = uid ? `uid:${uid}` : emailLower ? `email:${emailLower}` : '';
	if (!cacheKey) return null;

	const now = Date.now();
	const cached = identityCache.get(cacheKey);
	if (cached) {
		if (now - cached.at < CACHE_TTL_MS) return cached.value;
		identityCache.delete(cacheKey);
	}

	const running = identityInflight.get(cacheKey);
	if (running) return running;

	const run = (async (): Promise<ServerKaryawan | null> => {
		const filterQuery = buildIdentityFilterQuery(uid, emailLower);
		const rawRows = await fetchRows(filterQuery);
		const chosen = pickByPriority(rawRows, uid, emailLower);
		if (!chosen) return null;

		const value = toServerKaryawan(chosen);
		const ts = Date.now();
		pruneIdentityCache(ts);
		identityCache.set(cacheKey, { at: ts, value });
		return value;
	})().finally(() => {
		if (identityInflight.get(cacheKey) === run) identityInflight.delete(cacheKey);
	});

	identityInflight.set(cacheKey, run);
	return run;
}
