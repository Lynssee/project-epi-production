// EPI Academy Fase 5 — sertifikat QR: hash HMAC, penomoran aman bentrok, PDF memuat QR, alur terbit.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const envMock: Record<string, string | undefined> = { TRAINING_CERT_VERIFY_SECRET: 'test-secret-qr', HR_DOC_VERIFY_SECRET: undefined };
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

// Simulasi minimal Directus: store training_enrollment in-memory + upload file.
type Row = { id: number; sertifikat_no: string | null };
const rows: Row[] = [];
const uploads: string[] = [];
let failUpload = false;
vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (endpoint: string, opts: { method?: string; body?: string } = {}) => {
		await new Promise((r) => setTimeout(r, Math.random() * 3)); // jitter agar interleaving nyata
		const [path, qs = ''] = endpoint.split('?');
		const params = new URLSearchParams(qs);
		if (opts.method === 'PATCH') {
			const id = Number(path.split('/').pop());
			const row = rows.find((r) => r.id === id)!;
			Object.assign(row, JSON.parse(opts.body || '{}'));
			return { data: row };
		}
		const filter = JSON.parse(params.get('filter') || '{}');
		const cond = filter.sertifikat_no || {};
		const data = rows.filter((r) => {
			if (cond._starts_with) return !!r.sertifikat_no && r.sertifikat_no.startsWith(cond._starts_with);
			if (cond._eq) return r.sertifikat_no === cond._eq;
			return true;
		});
		return { data: data.map((r) => ({ ...r })) };
	}),
	directusServerUpload: vi.fn(async (fd: FormData) => {
		if (failUpload) return { ok: false, status: 500, json: async () => ({}) };
		uploads.push(String(fd.get('title')));
		return { ok: true, status: 200, json: async () => ({ data: { id: `file-${uploads.length}` } }) };
	})
}));

const qrCalls: string[] = [];
vi.mock('qrcode', async (orig) => {
	const mod: any = await orig();
	const real = mod.default ?? mod;
	return { default: { ...real, toDataURL: vi.fn((text: string, o: unknown) => { qrCalls.push(text); return real.toDataURL(text, o); }) } };
});

const { computeTrainingCertHash, buildTrainingCertVerifyUrl, isQrCertificateTitle } = await import('./trainingCertVerify');
const { nextCertificateSeq, certificatePrefix, reserveCertificateNumber, buildCertificatePdf, issueCertificate } = await import('./trainingCertificate');

const base = { enrollmentId: 77, sertifikatNo: 'TRN/EPI/2026/10/0001', karyawanId: 12, programId: 5, sertifikatExpired: '2027-10-16' };
const enrollment: any = { id: 77, program_id: 5, karyawan_id: 12, status: 'Lulus', nilai_akhir: 90, sertifikat_no: null };
const program: any = { id: 5, judul: 'K3 Dasar', kategori: 'K3', masa_berlaku_bulan: 12 };

beforeEach(() => {
	rows.length = 0; uploads.length = 0; qrCalls.length = 0; failUpload = false;
	envMock.TRAINING_CERT_VERIFY_SECRET = 'test-secret-qr';
});

describe('computeTrainingCertHash', () => {
	it('deterministik & berubah bila satu bidang identitas berubah', () => {
		const h = computeTrainingCertHash(base)!;
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		expect(computeTrainingCertHash({ ...base })).toBe(h);
		for (const patch of [{ enrollmentId: 78 }, { sertifikatNo: 'TRN/EPI/2026/10/0002' }, { karyawanId: 13 }, { programId: 6 }, { sertifikatExpired: '2028-10-16' }, { sertifikatExpired: null }]) {
			expect(computeTrainingCertHash({ ...base, ...patch })).not.toBe(h);
		}
	});
	it('vektor paritas dengan erp-epi (harus sama di trainingCertVerify.test.js erp-epi)', () => {
		expect(computeTrainingCertHash(base)).toBe('dcc240c2bdc34426c5c3d966b1329ec55f79fe671a25b988c8560b75f608e614');
	});
	it('tanpa secret -> null (sertifikat terbit tanpa QR, bukan error)', () => {
		envMock.TRAINING_CERT_VERIFY_SECRET = undefined;
		expect(computeTrainingCertHash(base)).toBeNull();
		expect(buildTrainingCertVerifyUrl(base)).toBeNull();
	});
	it('fallback ke HR_DOC_VERIFY_SECRET', () => {
		const h = computeTrainingCertHash(base);
		envMock.TRAINING_CERT_VERIFY_SECRET = undefined;
		envMock.HR_DOC_VERIFY_SECRET = 'test-secret-qr';
		expect(computeTrainingCertHash(base)).toBe(h);
		envMock.HR_DOC_VERIFY_SECRET = undefined;
	});
	it('URL verifikasi memuat id enrollment (tanpa slash) + h', () => {
		const url = buildTrainingCertVerifyUrl(base)!;
		expect(url).toBe(`https://internal.eltamaprimaindo.com/verify/training/77?h=${computeTrainingCertHash(base)}`);
	});
	it('penanda judul file berQR', () => {
		expect(isQrCertificateTitle('Sertifikat-X-Budi-QR.pdf')).toBe(true);
		expect(isQrCertificateTitle('Sertifikat-X-Budi.pdf')).toBe(false);
		expect(isQrCertificateTitle(null)).toBe(false);
	});
});

describe('penomoran sertifikat', () => {
	const p = 'TRN/EPI/2026/10/';
	it('nomor maksimum + 1, bukan hitung baris (ada celah/hapus)', () => {
		expect(nextCertificateSeq([], p)).toBe(1);
		expect(nextCertificateSeq([`${p}0001`, `${p}0005`], p)).toBe(6);
		expect(nextCertificateSeq([`${p}0003`, null, 'TRN/EPI/2026/09/0099', `${p}abc`], p)).toBe(4);
	});
	it('reservasi bersamaan 8 enrollment -> semua nomor unik', async () => {
		for (let i = 1; i <= 8; i++) rows.push({ id: i, sertifikat_no: null });
		const nomor = await Promise.all(rows.map((r) => reserveCertificateNumber(r.id)));
		expect(new Set(nomor).size).toBe(8);
		expect(rows.map((r) => r.sertifikat_no).sort()).toEqual(nomor.slice().sort());
		const prefix = certificatePrefix();
		expect(nomor.every((n) => n.startsWith(prefix))).toBe(true);
	});
	it('menghormati nomor yang sudah ada (tidak kembar dengan baris lama)', async () => {
		const prefix = certificatePrefix();
		rows.push({ id: 1, sertifikat_no: `${prefix}0007` }, { id: 2, sertifikat_no: null });
		expect(await reserveCertificateNumber(2)).toBe(`${prefix}0008`);
	});
});

describe('PDF sertifikat', () => {
	const common = { enrollment, namaKaryawan: 'Budi', program, sertifikatNo: base.sertifikatNo, masaBerlakuBulan: 12, sertifikatExpired: '2027-10-16' };
	it('dengan verifyUrl -> memuat gambar QR; tanpa -> tidak (sertifikat lama tetap bisa dibangun)', async () => {
		const withQr = await buildCertificatePdf({ ...common, verifyUrl: 'https://x.test/verify/training/77?h=abc' });
		const noQr = await buildCertificatePdf({ ...common, verifyUrl: null });
		expect(withQr.subarray(0, 5).toString()).toBe('%PDF-');
		expect(withQr.toString('latin1')).toContain('/Subtype /Image');
		expect(noQr.toString('latin1')).not.toContain('/Subtype /Image');
	});
});

describe('alur terbit sertifikat (lulus -> terbit -> QR)', () => {
	it('issueCertificate: nomor direservasi, QR menaut ke URL verifikasi ber-HMAC, file bertanda -QR', async () => {
		rows.push({ id: 77, sertifikat_no: null });
		const cert = await issueCertificate(enrollment, program, 'Budi Santoso');
		expect(cert.sertifikat_no).toBe(rows[0].sertifikat_no);
		expect(cert.sertifikat_file).toBe('file-1');
		expect(uploads[0]).toMatch(/-QR\.pdf$/);
		expect(qrCalls).toHaveLength(1);
		const expected = buildTrainingCertVerifyUrl({
			enrollmentId: 77, sertifikatNo: cert.sertifikat_no, karyawanId: 12, programId: 5, sertifikatExpired: cert.sertifikat_expired
		});
		expect(qrCalls[0]).toBe(expected);
	});
	it('tanpa secret: tetap terbit, file TANPA akhiran -QR (ditandai belum berQR)', async () => {
		envMock.TRAINING_CERT_VERIFY_SECRET = undefined;
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		rows.push({ id: 77, sertifikat_no: null });
		await issueCertificate(enrollment, program, 'Budi');
		expect(qrCalls).toHaveLength(0);
		expect(isQrCertificateTitle(uploads[0])).toBe(false);
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});
	it('gagal upload -> reservasi nomor dilepas (tidak menggantung)', async () => {
		rows.push({ id: 77, sertifikat_no: null });
		failUpload = true;
		await expect(issueCertificate(enrollment, program, 'Budi')).rejects.toThrow(/upload/i);
		expect(rows[0].sertifikat_no).toBeNull();
	});
});
