// src/lib/server/paktaSignature.ts
// ⚠️ SERVER-ONLY. Tanda tangan otomatis (HMAC) untuk Pakta Persetujuan SOP / Alur / Gate.
// SALINAN IDENTIK ada di erp-epi (src/lib/server/paktaSignature.js) — keduanya WAJIB menghasilkan kode yang sama
// (dijaga vektor uji tetap di kedua test). Rahasia: env DOKUMEN_VERIFIKASI_HMAC_SECRET (SENSITIF, sama di 2 repo),
// dengan pemisah domain "pakta" supaya kode pakta tak bisa ditukar dengan kode QR dokumen (PA/BDP/Grand PO).
//
// Deterministik (bukan token acak di DB): kode dihitung ulang dari baris konfirmasi yang sudah ada
// (karyawan_id + jenis + dokumen + versi + waktu + IP) → TANPA kolom baru di sop_read_confirmations, dan bukti
// tetap bisa diverifikasi kapan saja. Mengubah salah satu komponen (mis. versi atau waktu) mengubah kode.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PAKTA_DOC_TYPES = ['sop', 'flow', 'gate'] as const;
export type PaktaDocType = (typeof PAKTA_DOC_TYPES)[number];

const VERSI = 'pakta-v1';
const SIG_BYTES = 18; // 144 bit → 24 karakter base64url

export interface PaktaSignInput {
	karyawanId: number | string;
	docType: PaktaDocType;
	/** sop → id SOP, flow → flow_key, gate → gate_key */
	docKey: string | number;
	/** sop → version_seq, flow → version, gate → penanda versi aturan (mis. id log perubahan mode) */
	version: string | number;
	confirmedAt: string | Date;
	ip?: string | null;
}

export const isPaktaDocType = (t: unknown): t is PaktaDocType => PAKTA_DOC_TYPES.includes(t as PaktaDocType);

/** Rahasia dari env; null bila belum diset / terlalu pendek (min 16 karakter) → kode pakta dimatikan (bukan jalan tanpa rahasia). */
export function readPaktaSecret(raw: string | undefined | null): string | null {
	const s = String(raw ?? '').trim();
	return s.length >= 16 ? s : null;
}

/** Waktu kanonik: UTC detik penuh (milidetik dibuang agar tahan round-trip Directus). Tak valid → null. */
export function canonicalWaktu(v: string | Date | null | undefined): string | null {
	if (v == null || v === '') return null;
	const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
	if (!Number.isFinite(ms)) return null;
	return new Date(ms).toISOString().slice(0, 19) + 'Z';
}

function canonicalPayload(i: PaktaSignInput): string | null {
	const kid = String(i.karyawanId ?? '').trim();
	const key = String(i.docKey ?? '').trim();
	const ver = String(i.version ?? '').trim();
	const at = canonicalWaktu(i.confirmedAt);
	if (!/^[1-9]\d{0,11}$/.test(kid) || !isPaktaDocType(i.docType) || !key || !ver || !at) return null;
	if ([key, ver].some((x) => x.includes('|'))) return null; // pemisah tak boleh ada di dalam komponen
	return [VERSI, kid, i.docType, key, ver, at, String(i.ip ?? '').trim()].join('|');
}

export function signPakta(secret: string, input: PaktaSignInput): string {
	const payload = canonicalPayload(input);
	if (!secret || !payload) throw new Error('Parameter tanda tangan pakta tidak valid.');
	return createHmac('sha256', secret).update(payload).digest().subarray(0, SIG_BYTES).toString('base64url');
}

/** Perbandingan waktu-konstan; input salah bentuk → false (tidak melempar). */
export function verifyPakta(secret: string, input: PaktaSignInput, kode: unknown): boolean {
	try {
		if (!secret || typeof kode !== 'string' || kode.length !== 24) return false;
		const expected = Buffer.from(signPakta(secret, input));
		const given = Buffer.from(kode);
		return expected.length === given.length && timingSafeEqual(expected, given);
	} catch {
		return false;
	}
}

/** Kode siap tampil; null bila rahasia belum diset atau parameter tak valid (pemanggil tetap sukses mencatat konfirmasi). */
export function trySignPakta(secret: string | null, input: PaktaSignInput): string | null {
	if (!secret) return null;
	try {
		return signPakta(secret, input);
	} catch {
		return null;
	}
}
