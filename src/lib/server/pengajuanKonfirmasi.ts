// src/lib/server/pengajuanKonfirmasi.ts
// Logika bersama layar konfirmasi pemohon (Pengajuan Darurat Atas Nama): pembentuk detail + pemeriksaan
// tautan token (mirror erp-epi src/lib/server/onBehalfToken.js — admin tetap otoritas akhir saat POST).

import { createHash, timingSafeEqual } from 'node:crypto';
import { directusServerJson } from '$lib/server/directus';

/** Hash non-kriptografis (cyrb53) — WAJIB identik dgn erp-epi src/lib/utils/paOnBehalf.js (dijaga test paritas). */
function cyrb53(str: string, seed = 0): string {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Versi isi PA/PR (sidik jari yang ditandatangani pemohon). Salinan dari erp-epi onBehalfVersion(). */
export function onBehalfVersion(rec: any, items: any[]): string {
	const n = (v: any) => (Number(v) || 0).toFixed(2);
	const rows = [...(items || [])].sort((a, b) => Number(a?.id) - Number(b?.id));
	const total = rows.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.harga) || 0), 0);
	const lines = rows.map((it) => String(it.deskripsi ?? it.nama_barang ?? '').trim() + ':' + n(it.quantity) + ':' + n(it.harga));
	const head = [
		String(rec?.tujuan_pengajuan ?? '').trim(),
		String(idOf(rec?.project_id) ?? ''),
		String(rec?.penerima_dana_nama ?? '').trim(),
		String(rec?.bank_name ?? '').trim(),
		String(rec?.bank_account_number ?? '').trim(),
		String(rec?.bank_account_name ?? '').trim(),
		n(total)
	];
	return cyrb53([...head, ...lines].join('|'));
}

export const STATUS_MENUNGGU = 'Menunggu Konfirmasi Pemohon';
export const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

export function cfg(jenis: string) {
	return jenis === 'pr'
		? {
				collection: 'pengajuan',
				ownerField: 'pengaju_karyawan_id',
				itemsCollection: 'items_pengajuan',
				itemsFk: 'request_id',
				fields:
					'id,status,is_on_behalf,pemohon_status,pengaju_karyawan_id,pengisi_karyawan_id,alasan_darurat,nama_pengaju,department,urgency,tujuan_pengajuan,tanggal_dibutuhkan,payment_method,comments,project_id,kategori_pembelian,date_created,pemohon_token,pemohon_token_expires_at',
				itemFields: 'id,nama_barang,quantity,units,harga,notes'
			}
		: {
				collection: 'pengajuan_anggaran',
				ownerField: 'pengaju_id',
				itemsCollection: 'items_pengajuan_anggaran',
				itemsFk: 'pengajuan_anggaran_id',
				fields:
					'id,nomor_pengajuan,status,is_on_behalf,pemohon_status,pengaju_id,pengisi_karyawan_id,alasan_darurat,nama_pengaju,department,urgency,tujuan_pengajuan,tanggal_dibutuhkan,payment_method,comments,project_id,total_amount,penerima_dana_nama,bank_name,bank_account_number,bank_account_name,lokasi_kebutuhan,date_created,pemohon_token,pemohon_token_expires_at',
				itemFields: 'id,deskripsi,quantity,units,harga'
			};
}

export async function loadRecord(jenis: string, id: number) {
	const c = cfg(jenis);
	const rec = (await directusServerJson<any>(`/items/${c.collection}/${id}?fields=${c.fields}`).catch(() => null))?.data;
	return rec?.id ? rec : null;
}

/** Detail untuk layar konfirmasi. `record` JANGAN diteruskan mentah ke klien — pakai buildDetail(). */
export async function buildDetail(jenis: string, rec: any) {
	const c = cfg(jenis);
	// Relasi diambil terpisah (aturan Directus: tanpa nested).
	const [itemsRes, pengisiRes, projectRes] = await Promise.all([
		directusServerJson<any>(`/items/${c.itemsCollection}?filter[${c.itemsFk}][_eq]=${rec.id}&fields=${c.itemFields}&limit=-1`).catch(() => null),
		rec.pengisi_karyawan_id
			? directusServerJson<any>(`/items/karyawan/${idOf(rec.pengisi_karyawan_id)}?fields=nama_karyawan`).catch(() => null)
			: Promise.resolve(null),
		rec.project_id ? directusServerJson<any>(`/items/projects/${idOf(rec.project_id)}?fields=name`).catch(() => null) : Promise.resolve(null)
	]);
	const items = itemsRes?.data || [];
	const total =
		jenis === 'anggaran'
			? Number(rec.total_amount) || 0
			: items.reduce((s: number, it: any) => s + (parseFloat(it.harga) || 0) * (parseFloat(it.quantity) || 0), 0);
	const { pemohon_token: _t, pemohon_token_expires_at: _e, ...safe } = rec;
	return {
		jenis,
		record: safe,
		items,
		total,
		pengisiNama: pengisiRes?.data?.nama_karyawan || null,
		projectNama: projectRes?.data?.name || null,
		menunggu: rec.status === STATUS_MENUNGGU && rec.pemohon_status === 'menunggu',
		// Dikirim balik saat konfirmasi: server menolak bila isi berubah sejak layar dibuka.
		versi: onBehalfVersion(rec, items)
	};
}

const hashToken = (token: string) => createHash('sha256').update(String(token ?? '')).digest('hex');
const phoneTail = (noHp: any) => {
	const d = String(noHp ?? '').replace(/\D/g, '');
	return d.length >= 4 ? d.slice(-4) : null;
};
const safeEq = (a: string, b: string) => {
	const x = Buffer.from(String(a ?? ''));
	const y = Buffer.from(String(b ?? ''));
	return x.length === y.length && timingSafeEqual(x, y);
};

export function checkTokenAccess(p: {
	storedHash?: string | null;
	expiresAt?: string | null;
	givenToken?: string;
	pemohonNoHp?: string | null;
	tail?: string;
	now?: number;
}): { ok: true } | { ok: false; httpStatus: number; message: string } {
	const now = p.now ?? Date.now();
	const GENERIC = { ok: false as const, httpStatus: 403, message: 'Tautan tidak valid atau sudah tidak berlaku. Buka lewat login dashboard lapangan atau minta admin mengirim ulang.' };
	if (!p.storedHash || !p.givenToken) return GENERIC;
	if (!safeEq(hashToken(p.givenToken), p.storedHash)) return GENERIC;
	const exp = p.expiresAt ? new Date(p.expiresAt).getTime() : 0;
	if (!exp || exp < now) return { ok: false, httpStatus: 410, message: 'Tautan sudah kedaluwarsa. Buka lewat login dashboard lapangan atau minta admin mengirim ulang.' };
	const expected = phoneTail(p.pemohonNoHp);
	if (!expected) return { ok: false, httpStatus: 403, message: 'Verifikasi nomor HP tidak tersedia untuk akun ini. Gunakan login dashboard lapangan.' };
	if (!/^\d{4}$/.test(String(p.tail ?? '')) || !safeEq(String(p.tail), expected)) return { ok: false, httpStatus: 403, message: '4 digit terakhir nomor HP tidak cocok.' };
	return { ok: true };
}
