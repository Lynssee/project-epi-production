// src/lib/server/ess/trainingCertVerify.ts
// SERVER-ONLY. Kode verifikasi QR sertifikat pelatihan EPI Academy.
// Port persis erp-epi/src/lib/server/trainingCertVerify.js — kedua aplikasi HARUS menghasilkan hash
// identik (project-epi menerbitkan + menanam QR, erp-epi memverifikasi di halaman publik /verify/training),
// jadi secret harus SAMA di kedua env server.
//
// Stateless: tidak ada kolom hash di training_enrollment. Hash = HMAC-SHA256 atas identitas sertifikat,
// dihitung ulang saat verifikasi. Bila sertifikat dicabut/diterbitkan ulang (nomor/masa berlaku berubah),
// QR lama otomatis tidak cocok lagi.

import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';

/** Asal halaman publik verifikasi (erp-epi). Bisa dioverride via env tanpa ubah kode. */
export const DEFAULT_VERIFY_ORIGIN = process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390';

/** Akhiran judul file sertifikat berQR di Directus — penanda "sudah berQR" tanpa ubah skema. */
export const QR_FILE_SUFFIX = '-QR.pdf';

export interface CertHashInput {
	enrollmentId: number;
	sertifikatNo: string;
	karyawanId: number;
	programId: number;
	sertifikatExpired: string | null;
}

function getSecret(): string | null {
	return env.TRAINING_CERT_VERIFY_SECRET || env.HR_DOC_VERIFY_SECRET || null;
}

/** null bila secret belum di-set (sertifikat tetap terbit, tanpa QR). */
export function computeTrainingCertHash(input: CertHashInput): string | null {
	const secret = getSecret();
	if (!secret) return null;
	const payload = [
		'training-cert-v1',
		input.enrollmentId,
		input.sertifikatNo,
		input.karyawanId,
		input.programId,
		input.sertifikatExpired || ''
	].join('|');
	return createHmac('sha256', secret).update(payload).digest('hex');
}

export function buildTrainingCertVerifyUrl(input: CertHashInput): string | null {
	const hash = computeTrainingCertHash(input);
	if (!hash) return null;
	const origin = (env.TRAINING_CERT_VERIFY_ORIGIN || DEFAULT_VERIFY_ORIGIN).replace(/\/+$/, '');
	return `${origin}/verify/training/${input.enrollmentId}?h=${hash}`;
}

/** Judul file sertifikat -> apakah PDF-nya memuat QR. Sertifikat lama (tanpa akhiran) = belum berQR. */
export function isQrCertificateTitle(title: string | null | undefined): boolean {
	return typeof title === 'string' && title.toLowerCase().endsWith(QR_FILE_SUFFIX.toLowerCase());
}
