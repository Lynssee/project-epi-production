// src/lib/server/verifikasiDokumen.ts
// ⚠️ SERVER-ONLY. Tanda tangan HMAC untuk QR "Verifikasi Keaslian Dokumen" (Fase 3 §5.2 rencana Ekspor Lifecycle).
// SALINAN IDENTIK ada di erp-epi (src/lib/server/verifikasiDokumen.js) — keduanya WAJIB menghasilkan tanda tangan yang
// sama (dijaga vektor uji tetap di kedua test). Rahasia: env DOKUMEN_VERIFIKASI_HMAC_SECRET (SENSITIF, sama di 2 repo).
//
// Mengapa HMAC deterministik (bukan token acak di DB): QR yang dicetak ulang tetap valid, tanpa koleksi baru.
// Mengapa perlu: tanpa tanda tangan, siapa pun bisa menebak /verifikasi/pa/1, /2, /3… dan membaca nomor/nominal PA
// orang lain. Dengan tanda tangan, hanya pemegang QR yang dicetak sistem yang bisa membuka halaman verifikasi.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const JENIS_VERIFIKASI = ['pa', 'bdp'] as const;
export type JenisVerifikasi = (typeof JENIS_VERIFIKASI)[number];

const VERSI = 'v1';
const SIG_BYTES = 18; // 144 bit → 24 karakter base64url

export const isJenisVerifikasi = (j: unknown): j is JenisVerifikasi => JENIS_VERIFIKASI.includes(j as JenisVerifikasi);

/** id positif bulat kanonik ("007" / "1e3" / "-1" ditolak) → string; selain itu null. */
export function canonicalId(id: unknown): string | null {
	const s = String(id ?? '').trim();
	if (!/^[1-9]\d{0,11}$/.test(s)) return null;
	return s;
}

/** Rahasia dari env; null bila belum diset / terlalu pendek (min 16 karakter) → fitur QR dimatikan, bukan jalan tanpa rahasia. */
export function readSecret(raw: string | undefined | null): string | null {
	const s = String(raw ?? '').trim();
	return s.length >= 16 ? s : null;
}

export function signDokumen(secret: string, jenis: JenisVerifikasi, id: string | number): string {
	const cid = canonicalId(id);
	if (!secret || !isJenisVerifikasi(jenis) || !cid) throw new Error('Parameter tanda tangan dokumen tidak valid.');
	return createHmac('sha256', secret).update(`${VERSI}|${jenis}|${cid}`).digest().subarray(0, SIG_BYTES).toString('base64url');
}

/** Perbandingan waktu-konstan; input apa pun yang salah bentuk → false (tidak melempar). */
export function verifyDokumen(secret: string, jenis: unknown, id: unknown, sig: unknown): boolean {
	try {
		if (!secret || !isJenisVerifikasi(jenis) || typeof sig !== 'string' || sig.length !== 24) return false;
		const cid = canonicalId(id);
		if (!cid) return false;
		const expected = Buffer.from(signDokumen(secret, jenis, cid));
		const given = Buffer.from(sig);
		return expected.length === given.length && timingSafeEqual(expected, given);
	} catch {
		return false;
	}
}

export function buildVerifyUrl(base: string, jenis: JenisVerifikasi, id: string | number, sig: string): string {
	const b = String(base || '').replace(/\/+$/, '');
	return `${b}/verifikasi/${jenis}/${canonicalId(id)}?s=${encodeURIComponent(sig)}`;
}
