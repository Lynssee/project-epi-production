import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ get: null as any, paths: [] as string[] }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: (p: string) => { h.paths.push(p); return h.get(p); } }));

import { toPublicView, loadVerifikasi } from './verifikasiLoader';

const SENSITIF = {
	nama_pengaju: 'Rahasia Budi', bank_name: 'BCA', bank_account_number: '1234567890', bank_account_name: 'CV Rahasia',
	penerima_dana_nama: 'X', project_id: 7, tujuan_pengajuan: 'bocor', created_by_email: 'a@b.c', department: 'Finance',
	dibayar_oleh: 'fin@x', items: [{ nomor: 'PA-1' }], bukti_file: 'f1', alasan_dispensasi: 'rahasia'
};

describe('toPublicView — whitelist', () => {
	it('PA: hanya nomor, jenis, status, tanggal, nominal; disetujui menang atas diajukan', () => {
		const v = toPublicView('pa', { id: 1, nomor_pengajuan: 'PA-2610-0001', status: 'Approved', date_created: '2026-10-15T03:00:00Z', jumlah_disetujui: 800000, total_amount: 1000000, ...SENSITIF })!;
		expect(Object.keys(v).sort()).toEqual(['jenis', 'jenis_label', 'nomor', 'nominal', 'nominal_label', 'status', 'tanggal'].sort());
		expect(v).toMatchObject({ nomor: 'PA-2610-0001', status: 'Approved', nominal: 800000, nominal_label: 'Nominal disetujui' });
		const json = JSON.stringify(v);
		for (const s of ['Rahasia', 'BCA', '1234567890', 'bocor', 'a@b.c', 'Finance']) expect(json).not.toContain(s);
	});
	it('PA tanpa jumlah_disetujui memakai total diajukan dengan label sesuai', () => {
		expect(toPublicView('pa', { id: 2, nomor_pengajuan: 'PA-2', status: 'Pending', total_amount: 500 })).toMatchObject({ nominal: 500, nominal_label: 'Nominal diajukan' });
	});
	it('BDP: tidak membawa rekening/pembayar/rincian/bukti/alasan', () => {
		const v = toPublicView('bdp', { id: 3, nomor_voucher: 'BDP-202610-0003', status: 'selesai', tanggal_bayar: '2026-10-20', total_amount: 7851300, ...SENSITIF })!;
		expect(Object.keys(v).sort()).toEqual(['jenis', 'jenis_label', 'nomor', 'nominal', 'nominal_label', 'status', 'tanggal'].sort());
		expect(v).toMatchObject({ nomor: 'BDP-202610-0003', nominal: 7851300, tanggal: '2026-10-20' });
		const json = JSON.stringify(v);
		for (const s of ['BCA', 'fin@x', 'PA-1', 'rahasia', 'f1']) expect(json).not.toContain(s);
	});
	it('data kosong/bukan objek -> null; nomor cadangan memakai id', () => {
		expect(toPublicView('pa', null)).toBeNull();
		expect(toPublicView('bdp', 'x')).toBeNull();
		expect(toPublicView('pa', { id: 9 })!.nomor).toBe('#9');
	});
});

describe('loadVerifikasi', () => {
	beforeEach(() => { h.paths = []; });
	it('memilih koleksi & field minimal per jenis', async () => {
		h.get = vi.fn(async () => ({ data: { id: 1, nomor_pengajuan: 'PA-1', status: 'Approved', total_amount: 1 } }));
		await loadVerifikasi('pa', '1');
		expect(h.paths[0]).toBe('/items/pengajuan_anggaran/1?fields=id,nomor_pengajuan,status,date_created,jumlah_disetujui,total_amount');
		await loadVerifikasi('bdp', '2');
		expect(h.paths[1]).toBe('/items/batch_disbursement/2?fields=id,nomor_voucher,status,tanggal_bayar,date_created,total_amount');
	});
	it('Directus gagal / tidak ada -> null (tidak melempar)', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		h.get = vi.fn(async () => { throw new Error('403'); });
		expect(await loadVerifikasi('pa', '1')).toBeNull();
		h.get = vi.fn(async () => ({ data: null }));
		expect(await loadVerifikasi('pa', '1')).toBeNull();
	});
});
