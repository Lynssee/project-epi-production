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
}

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
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

const IDENTITY_FIELDS = 'id,nama_karyawan,email_company,email,divisi,divisi_id,posisi,jabatan_id,status,firebase_uid';
const CACHE_TTL_MS = 5 * 60 * 1000;
const identityCache = new Map<string, { at: number; value: ServerKaryawan }>();

/** Untuk tes: kosongkan cache identitas. */
export function clearKaryawanIdentityCache() {
	identityCache.clear();
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
	return { ...row, divisi_id: unwrapId(row.divisi_id), jabatan_id: unwrapId(row.jabatan_id) };
}

/**
 * Cari karyawan dari akun login. Tepat 1 kandidat aktif → dipakai; >1 pada satu jalur → 409 (tak menebak identitas);
 * tak ada → null. Hasil di-cache 5 menit per uid (authenticateEss dipanggil tiap request — hemat API).
 */
export async function resolveKaryawanForUser(
	user: { uid?: string | null; email?: string | null },
	fetchRows: (filterQuery: string) => Promise<any[]> = async (f) => {
		const r = await directusServerJson<{ data: any[] }>(`/items/karyawan?limit=3&fields=${IDENTITY_FIELDS}&${f}`);
		return r?.data || [];
	}
): Promise<ServerKaryawan | null> {
	const uid = user.uid ? String(user.uid) : '';
	const cached = uid ? identityCache.get(uid) : null;
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

	const tries: string[] = [];
	if (uid) tries.push(`filter[firebase_uid][_eq]=${encodeURIComponent(uid)}`);
	if (user.email) {
		const e = encodeURIComponent(user.email.toLowerCase());
		tries.push(`filter[email][_eq]=${e}`, `filter[email_company][_eq]=${e}`);
	}
	for (const f of tries) {
		const rows = activeCandidates(await fetchRows(f));
		if (rows.length === 1) {
			const value = toServerKaryawan(rows[0]);
			if (uid) identityCache.set(uid, { at: Date.now(), value });
			return value;
		}
		if (rows.length > 1) {
			console.error('[ess] identitas ambigu untuk', f);
			throw error(409, 'Akun Anda cocok dengan lebih dari satu data karyawan. Hubungi HRD.');
		}
	}
	return null;
}
