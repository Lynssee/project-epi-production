// src/lib/server/ess/trainingCertificate.ts
// F4 Roadmap E-Learning: terbitkan sertifikat PDF server-side saat enrollment Lulus.
// Port dari src/lib/utils/trainingCertificate.js (erp-epi-1 admin) — logika & tampilan sama,
// hanya sumber data & upload dipindah ke directusServerJson/directusServerUpload (server-only).

import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import type { TrainingEnrollmentRecord, TrainingProgramRecord } from '$lib/server/ess/training';
import { buildTrainingCertVerifyUrl, QR_FILE_SUFFIX } from '$lib/server/ess/trainingCertVerify';

const COMPANY_NAME = 'PT Eltama Prima Indo';
const SIGNATORY_NAME = 'HRD Manager';
const SIGNATORY_TITLE = 'Human Resources Department';

function formatTanggal(dateStr: string | null | undefined) {
	return new Date(dateStr || Date.now()).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

const RESERVE_MAX_ATTEMPTS = 6;

/** Prefix nomor sertifikat: TRN/EPI/<YYYY>/<MM>/ — sama persis konvensi admin. */
export function certificatePrefix(now: Date = new Date()): string {
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	return `TRN/EPI/${yyyy}/${mm}/`;
}

/** Urutan berikutnya = nomor terbesar yang ada + 1 (bukan hitung baris — baris terhapus/diganti tak membuat nomor kembar). */
export function nextCertificateSeq(existingNumbers: Array<string | null | undefined>, prefix: string): number {
	let max = 0;
	for (const no of existingNumbers) {
		if (!no || !no.startsWith(prefix)) continue;
		const seq = parseInt(no.slice(prefix.length), 10);
		if (Number.isFinite(seq) && seq > max) max = seq;
	}
	return max + 1;
}

export function formatCertificateNumber(prefix: string, seq: number): string {
	return `${prefix}${String(seq).padStart(4, '0')}`;
}

/** Nomor sertifikat berikutnya (hanya baca, TIDAK mereservasi). Untuk penerbitan pakai reserveCertificateNumber. */
export async function generateCertificateNumber(): Promise<string> {
	const prefix = certificatePrefix();
	const query = new URLSearchParams({
		limit: '-1',
		fields: 'sertifikat_no',
		filter: JSON.stringify({ sertifikat_no: { _starts_with: prefix } })
	});
	const result = await directusServerJson<{ data: Array<{ sertifikat_no: string }> }>(`/items/training_enrollment?${query.toString()}`);
	return formatCertificateNumber(prefix, nextCertificateSeq((result?.data || []).map((r) => r.sertifikat_no), prefix));
}

// Serialkan reservasi dalam satu proses server (permintaan bersamaan di instance yang sama).
let reserveChain: Promise<unknown> = Promise.resolve();

async function claimersOf(sertifikatNo: string): Promise<number[]> {
	const query = new URLSearchParams({
		limit: '-1',
		fields: 'id',
		filter: JSON.stringify({ sertifikat_no: { _eq: sertifikatNo } })
	});
	const res = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/training_enrollment?${query.toString()}`);
	return (res?.data || []).map((r) => r.id);
}

async function setEnrollmentCertNo(enrollmentId: number, sertifikatNo: string | null): Promise<void> {
	await directusServerJson(`/items/training_enrollment/${enrollmentId}`, {
		method: 'PATCH',
		body: JSON.stringify({ sertifikat_no: sertifikatNo })
	});
}

async function reserveOnce(enrollmentId: number): Promise<string> {
	for (let attempt = 0; attempt < RESERVE_MAX_ATTEMPTS; attempt++) {
		const nomor = await generateCertificateNumber();
		// Klaim dulu (tulis), baru cek: penulis yang lebih akhir pasti melihat penulis sebelumnya, jadi
		// "dua-duanya merasa menang" tidak mungkin. Bila ada klaim lain, mundur + coba ulang dengan jeda acak.
		await setEnrollmentCertNo(enrollmentId, nomor);
		const claimers = await claimersOf(nomor);
		if (claimers.length === 1 && claimers[0] === enrollmentId) return nomor;
		await setEnrollmentCertNo(enrollmentId, null);
		await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 200)));
	}
	throw new Error(`Gagal mereservasi nomor sertifikat setelah ${RESERVE_MAX_ATTEMPTS} percobaan (bentrok permintaan bersamaan).`);
}

/** Reservasi nomor sertifikat unik untuk 1 enrollment — aman terhadap permintaan bersamaan (dalam proses & lintas instance). */
export function reserveCertificateNumber(enrollmentId: number): Promise<string> {
	const run = reserveChain.then(() => reserveOnce(enrollmentId));
	reserveChain = run.catch(() => undefined);
	return run;
}

interface BuildCertificateParams {
	enrollment: TrainingEnrollmentRecord;
	namaKaryawan: string;
	program: TrainingProgramRecord;
	sertifikatNo: string;
	masaBerlakuBulan: number | null;
	sertifikatExpired: string | null;
	/** URL verifikasi (memuat HMAC). null/kosong = PDF tanpa QR (secret verifikasi belum di-set). */
	verifyUrl?: string | null;
}

export async function buildCertificatePdf(params: BuildCertificateParams): Promise<Buffer> {
	const { jsPDF } = await import('jspdf');
	const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const centerX = pageWidth / 2;

	doc.setDrawColor(30, 64, 175);
	doc.setLineWidth(3);
	doc.rect(24, 24, pageWidth - 48, pageHeight - 48);
	doc.setLineWidth(0.75);
	doc.rect(32, 32, pageWidth - 64, pageHeight - 64);

	let y = 90;
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(20);
	doc.setTextColor(30, 64, 175);
	doc.text('EPI', centerX, y, { align: 'center' });
	y += 26;
	doc.setFontSize(11);
	doc.setTextColor(80);
	doc.setFont('helvetica', 'normal');
	doc.text(COMPANY_NAME, centerX, y, { align: 'center' });

	y += 40;
	doc.setFontSize(26);
	doc.setTextColor(20);
	doc.setFont('helvetica', 'bold');
	doc.text('SERTIFIKAT PELATIHAN', centerX, y, { align: 'center' });

	y += 34;
	doc.setFontSize(11);
	doc.setFont('helvetica', 'normal');
	doc.setTextColor(90);
	doc.text('Diberikan kepada:', centerX, y, { align: 'center' });

	y += 34;
	doc.setFontSize(22);
	doc.setFont('helvetica', 'bold');
	doc.setTextColor(20);
	doc.text(params.namaKaryawan || '-', centerX, y, { align: 'center' });

	y += 30;
	doc.setFontSize(11);
	doc.setFont('helvetica', 'normal');
	doc.setTextColor(90);
	doc.text('atas keikutsertaan dan kelulusan pada program pelatihan:', centerX, y, { align: 'center' });

	y += 26;
	doc.setFontSize(15);
	doc.setFont('helvetica', 'bold');
	doc.setTextColor(30, 64, 175);
	doc.text(params.program?.judul || '-', centerX, y, { align: 'center' });

	y += 22;
	doc.setFontSize(10);
	doc.setFont('helvetica', 'normal');
	doc.setTextColor(110);
	const nilaiText = params.enrollment?.nilai_akhir != null ? `Nilai Akhir: ${params.enrollment.nilai_akhir}` : '';
	doc.text(`Kategori: ${params.program?.kategori || '-'} · ${nilaiText}`, centerX, y, { align: 'center' });

	const footerY = pageHeight - 110;
	doc.setFontSize(9);
	doc.setTextColor(90);
	doc.text(`Nomor Sertifikat: ${params.sertifikatNo}`, 60, footerY);
	doc.text(`Tanggal Terbit: ${formatTanggal(new Date().toISOString())}`, 60, footerY + 14);
	if (params.masaBerlakuBulan) {
		doc.text(`Berlaku Sampai: ${formatTanggal(params.sertifikatExpired)}`, 60, footerY + 28);
	}

	if (params.verifyUrl) {
		const QRCode = (await import('qrcode')).default;
		const qrDataUrl = await QRCode.toDataURL(params.verifyUrl, { margin: 1, width: 256, errorCorrectionLevel: 'M' });
		const qrSize = 64;
		doc.addImage(qrDataUrl, 'PNG', centerX - qrSize / 2, footerY - 14, qrSize, qrSize);
		doc.setFontSize(7);
		doc.setTextColor(110);
		doc.text('Pindai untuk memverifikasi keaslian', centerX, footerY + qrSize - 6, { align: 'center' });
		doc.setFontSize(9);
		doc.setTextColor(90);
	}

	const sigX = pageWidth - 200;
	doc.line(sigX, footerY + 20, sigX + 140, footerY + 20);
	doc.setFont('helvetica', 'bold');
	doc.text(SIGNATORY_NAME, sigX + 70, footerY + 34, { align: 'center' });
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.text(SIGNATORY_TITLE, sigX + 70, footerY + 46, { align: 'center' });

	const arrayBuffer = doc.output('arraybuffer');
	return Buffer.from(arrayBuffer);
}

async function uploadCertificateFile(buffer: Buffer, filename: string): Promise<string> {
	const formData = new FormData();
	formData.append('title', filename);
	formData.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), filename);
	const res = await directusServerUpload(formData);
	if (!res.ok) throw new Error(`Gagal upload sertifikat: HTTP ${res.status}`);
	const body = await res.json();
	return body?.data?.id;
}

export interface IssuedCertificate {
	sertifikat_no: string;
	sertifikat_file: string;
	sertifikat_expired: string | null;
}

/** Alur lengkap: nomor sertifikat -> generate PDF -> upload -> field siap ditulis ke training_enrollment. */
export async function issueCertificate(
	enrollment: TrainingEnrollmentRecord,
	program: TrainingProgramRecord,
	namaKaryawan: string
): Promise<IssuedCertificate> {
	// Nomor direservasi (ditulis ke enrollment) supaya dua penerbitan bersamaan tidak mendapat nomor kembar.
	const sertifikatNo = await reserveCertificateNumber(enrollment.id);
	try {
		let sertifikatExpired: string | null = null;
		if (program?.masa_berlaku_bulan) {
			const exp = new Date();
			exp.setMonth(exp.getMonth() + Number(program.masa_berlaku_bulan));
			sertifikatExpired = exp.toISOString().slice(0, 10);
		}

		const verifyUrl = buildTrainingCertVerifyUrl({
			enrollmentId: enrollment.id,
			sertifikatNo,
			karyawanId: enrollment.karyawan_id,
			programId: program.id,
			sertifikatExpired
		});
		if (!verifyUrl) {
			console.error('[trainingCertificate] TRAINING_CERT_VERIFY_SECRET/HR_DOC_VERIFY_SECRET belum di-set — sertifikat terbit TANPA QR.');
		}

		const buffer = await buildCertificatePdf({
			enrollment,
			namaKaryawan,
			program,
			sertifikatNo,
			masaBerlakuBulan: program.masa_berlaku_bulan,
			sertifikatExpired,
			verifyUrl
		});

		const base = `Sertifikat-${sertifikatNo.replace(/\//g, '-')}-${(namaKaryawan || 'karyawan').replace(/\s+/g, '_')}`;
		// Akhiran -QR.pdf = penanda sertifikat berQR (dibaca endpoint unduh; sertifikat lama tanpa akhiran = belum berQR).
		const filename = verifyUrl ? `${base}${QR_FILE_SUFFIX}` : `${base}.pdf`;
		const fileId = await uploadCertificateFile(buffer, filename);

		return { sertifikat_no: sertifikatNo, sertifikat_file: fileId, sertifikat_expired: sertifikatExpired };
	} catch (e) {
		// Lepas reservasi supaya penerbitan berikutnya (idempotency finalizeLulusEnrollment) tidak terhenti oleh nomor "menggantung".
		try {
			await setEnrollmentCertNo(enrollment.id, null);
		} catch (releaseErr) {
			console.error('[trainingCertificate] gagal melepas reservasi nomor sertifikat:', releaseErr);
		}
		throw e;
	}
}
