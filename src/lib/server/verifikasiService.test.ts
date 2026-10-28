import { describe, it, expect, vi } from 'vitest';
import { verifikasiPublik, PESAN_TIDAK_DIKENAL, type VerifikasiDeps } from './verifikasiService';
import { signDokumen } from './verifikasiDokumen';

const SECRET = 'test-secret-0123456789abcdef';
const VIEW = { jenis: 'pa' as const, jenis_label: 'Pengajuan Anggaran', nomor: 'PA-1', status: 'Approved', tanggal: '2026-10-15', nominal: 1000, nominal_label: 'Nominal disetujui' };
const deps = (over: Partial<VerifikasiDeps> = {}): VerifikasiDeps => ({
	secret: SECRET,
	isRateLimited: () => false,
	load: vi.fn(async () => VIEW),
	now: () => new Date('2026-10-20T03:00:00Z'),
	...over
});
const ok = (over = {}) => ({ jenis: 'pa', id: '1', sig: signDokumen(SECRET, 'pa', 1), ip: '1.2.3.4', ...over });

describe('verifikasiPublik', () => {
	it('tanda tangan sah → 200 dengan data whitelist + waktu pemeriksaan', async () => {
		const r = await verifikasiPublik(ok(), deps());
		expect(r.status).toBe(200);
		expect((r as any).body.data).toEqual(VIEW);
		expect((r as any).body.diperiksa_pada).toBe('2026-10-20T03:00:00.000Z');
	});

	it('rahasia belum diset → 503 (fitur mati, TIDAK lolos tanpa verifikasi) dan tidak memuat data', async () => {
		const d = deps({ secret: null });
		expect((await verifikasiPublik(ok(), d)).status).toBe(503);
		expect(d.load).not.toHaveBeenCalled();
	});

	it('tanda tangan salah / hilang / milik dokumen lain → 404 seragam, TANPA memuat data', async () => {
		const d = deps();
		const salah = await verifikasiPublik(ok({ sig: 'x'.repeat(24) }), d);
		const hilang = await verifikasiPublik(ok({ sig: undefined }), d);
		const lain = await verifikasiPublik(ok({ id: '2' }), d); // sig milik id 1
		for (const r of [salah, hilang, lain]) {
			expect(r.status).toBe(404);
			expect((r as any).body.message).toBe(PESAN_TIDAK_DIKENAL);
		}
		expect(d.load).not.toHaveBeenCalled();
	});

	it('tidak ada oracle: dokumen tak ada (sig sah) memberi respons IDENTIK dengan tanda tangan salah', async () => {
		const tidakAda = await verifikasiPublik(ok(), deps({ load: vi.fn(async () => null) }));
		const salah = await verifikasiPublik(ok({ sig: 'y'.repeat(24) }), deps());
		expect(tidakAda).toEqual(salah);
	});

	it('jenis tak dikenal / id salah bentuk → 404 tanpa memuat data', async () => {
		const d = deps();
		for (const bad of [{ jenis: 'pr' }, { id: '0' }, { id: '1; DROP' }, { id: '007' }, { jenis: undefined }]) {
			expect((await verifikasiPublik(ok(bad), d)).status).toBe(404);
		}
		expect(d.load).not.toHaveBeenCalled();
	});

	it('rate limit per IP dan per dokumen → 429 sebelum menyentuh data', async () => {
		const d1 = deps({ isRateLimited: (k) => k.startsWith('verifikasi-ip:') });
		expect((await verifikasiPublik(ok(), d1)).status).toBe(429);
		const d2 = deps({ isRateLimited: (k) => k.startsWith('verifikasi-doc:') });
		expect((await verifikasiPublik(ok(), d2)).status).toBe(429);
		expect(d1.load).not.toHaveBeenCalled();
		expect(d2.load).not.toHaveBeenCalled();
	});

	it('percobaan dengan tanda tangan salah tetap dihitung oleh rate limit (anti tebak)', async () => {
		const keys: string[] = [];
		await verifikasiPublik(ok({ sig: 'z'.repeat(24) }), deps({ isRateLimited: (k) => { keys.push(k); return false; } }));
		expect(keys).toEqual(['verifikasi-ip:1.2.3.4', 'verifikasi-doc:pa:1']);
	});
});
