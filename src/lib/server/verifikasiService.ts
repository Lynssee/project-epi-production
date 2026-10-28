// src/lib/server/verifikasiService.ts
// ⚠️ SERVER-ONLY. Logika endpoint verifikasi PUBLIK (tanpa login) — dipisah dari +server.ts supaya perilaku keamanannya
// bisa dites dengan dependensi palsu. Prinsip:
//  - Tanda tangan HMAC wajib; salah tanda tangan / id tak ada / jenis tak dikenal → respons 404 SERAGAM
//    (tidak ada "oracle" yang membedakan dokumen ada vs tidak ada).
//  - Rahasia belum diset → 503 (fitur mati), BUKAN lolos tanpa verifikasi.
//  - Rate limit per IP dan per dokumen (mencegah menebak tanda tangan / memukul Directus).
//  - Data yang keluar = whitelist minimal (verifikasiLoader.toPublicView).
import { verifyDokumen, canonicalId, isJenisVerifikasi, type JenisVerifikasi } from '$lib/server/verifikasiDokumen';
import type { VerifikasiView } from '$lib/server/verifikasiLoader';

export const PESAN_TIDAK_DIKENAL = 'Dokumen tidak dapat diverifikasi. Pastikan QR dipindai dari dokumen asli yang dicetak sistem.';

export interface VerifikasiDeps {
	secret: string | null;
	isRateLimited: (key: string, o: { windowMs: number; max: number }) => boolean;
	load: (jenis: JenisVerifikasi, id: string) => Promise<VerifikasiView | null>;
	now?: () => Date;
}

export type VerifikasiResult =
	| { status: 200; body: { data: VerifikasiView; diperiksa_pada: string } }
	| { status: 404 | 429 | 503; body: { message: string } };

export async function verifikasiPublik(
	input: { jenis: unknown; id: unknown; sig: unknown; ip: string },
	deps: VerifikasiDeps
): Promise<VerifikasiResult> {
	if (!deps.secret) return { status: 503, body: { message: 'Verifikasi dokumen belum diaktifkan. Hubungi admin.' } };

	const win = 15 * 60_000;
	if (deps.isRateLimited(`verifikasi-ip:${input.ip}`, { windowMs: win, max: 60 })) {
		return { status: 429, body: { message: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' } };
	}
	const cid = canonicalId(input.id);
	if (cid && deps.isRateLimited(`verifikasi-doc:${input.jenis}:${cid}`, { windowMs: win, max: 30 })) {
		return { status: 429, body: { message: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' } };
	}

	const gagal: VerifikasiResult = { status: 404, body: { message: PESAN_TIDAK_DIKENAL } };
	if (!isJenisVerifikasi(input.jenis) || !cid) return gagal;
	if (!verifyDokumen(deps.secret, input.jenis, cid, input.sig)) return gagal;

	const view = await deps.load(input.jenis, cid);
	if (!view) return gagal;
	return { status: 200, body: { data: view, diperiksa_pada: (deps.now?.() ?? new Date()).toISOString() } };
}
