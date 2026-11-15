// src/lib/server/keyService.ts
// Akses data Key Management (key_master / key_logs) untuk endpoint /api/satpam/kunci/*.
// Aturan #2: relasi diambil per-query terpisah (tanpa field expansion bersarang); Aturan #1: error tidak ditelan.
// Perubahan status kunci memakai CAS (directusCas) supaya dua satpam tidak bisa meminjamkan kunci yang sama.

import { directusServerJson } from '$lib/server/directus';
import { casPatchBody } from '$lib/server/directusCas';

export const KEY_FIELDS =
	'id,kode_kunci,nama_kunci,kategori,tipe_salinan,lokasi_kotak,nomor_hook,qr_tag,kendaraan_id,ruangan_id,status,pemegang_sekarang_id,is_restricted,is_active,catatan';
const LOG_FIELDS =
	'id,key_id,jenis_aksi,peminjam_id,petugas_satpam_id,waktu_pinjam,rencana_kembali,waktu_kembali,status_log,kondisi_fisik,catatan,gate_override_reason';

export interface KeyRow {
	id: number;
	kode_kunci: string;
	nama_kunci: string;
	kategori: string | null;
	tipe_salinan: string | null;
	lokasi_kotak: string | null;
	nomor_hook: string | null;
	qr_tag: string | null;
	kendaraan_id: number | null;
	ruangan_id: string | null;
	status: string;
	pemegang_sekarang_id: number | null;
	is_restricted: boolean | null;
	is_active: boolean | null;
	catatan: string | null;
}

export interface KeyLogRow {
	id: number;
	key_id: number;
	jenis_aksi: string | null;
	peminjam_id: number | null;
	petugas_satpam_id: number | null;
	waktu_pinjam: string | null;
	rencana_kembali: string | null;
	waktu_kembali: string | null;
	status_log: string | null;
	kondisi_fisik: string | null;
	catatan: string | null;
	gate_override_reason: string | null;
}

/**
 * Boolean dari Directus/SQLite bisa datang sebagai 0/1 bila field tak punya `cast-boolean` — jangan bandingkan `=== true`.
 * (Bug nyata 7 Nov 2026: kunci terbatas lolos gate karena `is_restricted === true` salah untuk nilai 1.)
 */
export function truthy(v: unknown): boolean {
	return v === true || v === 1 || v === '1' || v === 'true';
}
/** Kunci dianggap nonaktif hanya bila eksplisit false/0 (null/undefined = aktif, sesuai default skema). */
export function isNonaktif(v: unknown): boolean {
	return v === false || v === 0 || v === '0' || v === 'false';
}

/** Isi QR label = "KEY:<qr_tag>"; input manual boleh langsung kode kunci. Awalan dibuang, spasi dipangkas. */
export function parseKeyScan(raw: string | null | undefined): string {
	return String(raw ?? '')
		.trim()
		.replace(/^KEY:/i, '')
		.trim();
}

const qs = (p: Record<string, string>) => new URLSearchParams(p).toString();

export async function findKey(input: { keyId?: unknown; scan?: unknown }): Promise<KeyRow | null> {
	const id = Number(input.keyId);
	if (Number.isInteger(id) && id > 0) {
		const res = await directusServerJson<{ data: KeyRow[] }>(
			`/items/key_master?${qs({ 'filter[id][_eq]': String(id), fields: KEY_FIELDS, limit: '1' })}`
		);
		return res?.data?.[0] ?? null;
	}
	const token = parseKeyScan(input.scan as string);
	if (!token) return null;
	const res = await directusServerJson<{ data: KeyRow[] }>(
		`/items/key_master?${qs({
			'filter[_or][0][qr_tag][_eq]': token,
			'filter[_or][1][kode_kunci][_eq]': token,
			fields: KEY_FIELDS,
			limit: '1'
		})}`
	);
	return res?.data?.[0] ?? null;
}

export async function findActiveLog(keyId: number): Promise<KeyLogRow | null> {
	const res = await directusServerJson<{ data: KeyLogRow[] }>(
		`/items/key_logs?${qs({
			'filter[key_id][_eq]': String(keyId),
			'filter[status_log][_eq]': 'aktif',
			sort: '-id',
			fields: LOG_FIELDS,
			limit: '1'
		})}`
	);
	return res?.data?.[0] ?? null;
}

export async function fetchKaryawanNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
	const uniq = [...new Set(ids.filter((v): v is number => Number.isInteger(v) && (v as number) > 0))];
	const out = new Map<number, string>();
	if (uniq.length === 0) return out;
	const res = await directusServerJson<{ data: Array<{ id: number; nama_karyawan: string | null }> }>(
		`/items/karyawan?${qs({ 'filter[id][_in]': uniq.join(','), fields: 'id,nama_karyawan', limit: String(uniq.length) })}`
	);
	for (const r of res?.data || []) out.set(r.id, r.nama_karyawan || `#${r.id}`);
	return out;
}

export interface KeyListItem extends KeyRow {
	pemegang_nama: string | null;
	waktu_pinjam: string | null;
	rencana_kembali: string | null;
	log_id: number | null;
}

/** Daftar kunci aktif + pemegang + batas kembali (3 query terpisah: kunci, log aktif, nama karyawan). */
export async function listKeysWithHolder(): Promise<KeyListItem[]> {
	const keysRes = await directusServerJson<{ data: KeyRow[] }>(
		`/items/key_master?${qs({ 'filter[is_active][_neq]': 'false', sort: 'lokasi_kotak,nomor_hook,kode_kunci', fields: KEY_FIELDS, limit: '-1' })}`
	);
	const keys = keysRes?.data || [];
	const keluar = keys.filter((k) => k.status === 'dipinjam' || k.status === 'overnight_ijin');

	const logByKey = new Map<number, KeyLogRow>();
	if (keluar.length > 0) {
		const logsRes = await directusServerJson<{ data: KeyLogRow[] }>(
			`/items/key_logs?${qs({
				'filter[key_id][_in]': keluar.map((k) => k.id).join(','),
				'filter[status_log][_eq]': 'aktif',
				sort: 'id',
				fields: LOG_FIELDS,
				limit: '-1'
			})}`
		);
		for (const l of logsRes?.data || []) logByKey.set(l.key_id, l); // id terbesar menang
	}
	const names = await fetchKaryawanNames(keluar.map((k) => k.pemegang_sekarang_id));

	return keys.map((k) => {
		const log = logByKey.get(k.id);
		return {
			...k,
			pemegang_nama: k.pemegang_sekarang_id ? (names.get(k.pemegang_sekarang_id) ?? `#${k.pemegang_sekarang_id}`) : null,
			waktu_pinjam: log?.waktu_pinjam ?? null,
			rencana_kembali: log?.rencana_kembali ?? null,
			log_id: log?.id ?? null
		};
	});
}

/** CAS: ubah key_master hanya bila status sekarang ada di `dariStatus`. true = berhasil, false = kalah race. */
export async function casUpdateKey(keyId: number, dariStatus: string[], data: Record<string, unknown>): Promise<boolean> {
	const res = await directusServerJson<{ data: Array<{ id: number }> }>('/items/key_master', {
		method: 'PATCH',
		body: casPatchBody([{ id: { _eq: keyId } }, { status: { _in: dariStatus } }], data)
	});
	return (res?.data?.length ?? 0) > 0;
}

export async function createKeyLog(data: Record<string, unknown>): Promise<KeyLogRow> {
	const res = await directusServerJson<{ data: KeyLogRow }>('/items/key_logs', { method: 'POST', body: JSON.stringify(data) });
	return res.data;
}

export async function updateKeyLog(id: number, data: Record<string, unknown>): Promise<void> {
	await directusServerJson(`/items/key_logs/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export interface KunciKendaraanRow {
	id: number;
	kode_kunci: string;
	nama_kunci: string;
	kendaraan_id: number | null;
	tipe_salinan: string | null;
	lokasi_kotak: string | null;
	nomor_hook: string | null;
	status: string;
}

/**
 * Pilih satu kunci yang relevan untuk driver dari semua kunci sebuah kendaraan: salinan `utama` di kotak pos didahulukan;
 * salinan cadangan/brankas (`disimpan_khusus`) tidak pernah dipilih (tidak bisa dipinjam di pos). Murni (bisa diuji).
 */
export function pilihKunciKendaraan(rows: KunciKendaraanRow[], kendaraanId: number): KunciKendaraanRow | null {
	const cand = (rows || []).filter((r) => r.kendaraan_id === kendaraanId && r.status !== 'disimpan_khusus');
	if (cand.length === 0) return null;
	return [...cand].sort((a, b) => Number(b.tipe_salinan === 'utama') - Number(a.tipe_salinan === 'utama') || a.id - b.id)[0];
}

export interface OperationalKey {
	id: number;
	kode: string;
	nama: string;
	status: string;
	lokasi_kotak: string | null;
	nomor_hook: string | null;
	is_restricted: boolean;
	pemegang_id: number | null;
}

/**
 * Semua kunci operasional kotak pos (di slot / dipinjam / izin bawa pulang) — dasar checklist rekonsiliasi shift
 * dan gate G_SEC8. Kunci brankas (`disimpan_khusus`), hilang, rusak, dan nonaktif tidak termasuk. Urut kotak → slot.
 */
export async function fetchOperationalKeys(): Promise<OperationalKey[]> {
	const res = await directusServerJson<{ data: KeyRow[] }>(
		`/items/key_master?${qs({
			'filter[is_active][_neq]': 'false',
			'filter[status][_in]': 'tersedia,dipinjam,overnight_ijin',
			sort: 'lokasi_kotak,nomor_hook,kode_kunci',
			fields: 'id,kode_kunci,nama_kunci,status,lokasi_kotak,nomor_hook,is_restricted,pemegang_sekarang_id',
			limit: '-1'
		})}`
	);
	return (res?.data || []).map((k) => ({
		id: k.id,
		kode: k.kode_kunci,
		nama: k.nama_kunci,
		status: k.status,
		lokasi_kotak: k.lokasi_kotak ?? null,
		nomor_hook: k.nomor_hook ?? null,
		is_restricted: truthy(k.is_restricted),
		pemegang_id: k.pemegang_sekarang_id ?? null
	}));
}
