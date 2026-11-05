import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
import { directusServerJson } from '$lib/server/directus';
import { bacaSetelan, koordinatorIdDari, muatDetailPA, muatPAKoordinator, ringkasPA, statusPekerja, tambahHari, validasiBukti } from './spjUpah';

const dx = vi.mocked(directusServerJson);
beforeEach(() => { dx.mockReset(); });

const PA = { id: 800, nomor_pengajuan: 'PA-0800', status: 'Dibukukan', total_amount: 3_000_000, tanggal_dicairkan: '2026-10-28', penerima_dana_type: 'koordinator_upah', dynamic_fields: { koordinator_upah: { manpower_id: 5 } } };
const RINCIAN = [1, 2, 3].map((m) => ({ id: m, pengajuan_anggaran_id: 800, manpower_id: m, jumlah: 1_000_000 }));
const baris = (m: number, o: any = {}) => ({ id: m * 10, pengajuan_anggaran_id: 800, manpower_id: m, jumlah_diterima: 1_000_000, metode: 'tunai', bukti_file_id: `f${m}`, status_verifikasi: 'menunggu', ...o });
const NAMA = new Map([['1', 'Yusuf'], ['2', 'Ali'], ['3', 'Budi']]);

describe('koordinatorIdDari / tambahHari', () => {
	it('objek, string JSON, relasi objek, kosong', () => {
		expect(koordinatorIdDari({ koordinator_upah: { manpower_id: 5 } })).toBe(5);
		expect(koordinatorIdDari(JSON.stringify({ koordinator_upah: { manpower_id: { id: 9 } } }))).toBe(9);
		expect(koordinatorIdDari({})).toBeNull();
		expect(koordinatorIdDari('{rusak')).toBeNull();
	});
	it('tambah hari lintas bulan', () => {
		expect(tambahHari('2026-10-30', 3)).toBe('2026-11-02');
		expect(tambahHari('2026-10-28', -90)).toBe('2026-07-30');
	});
});

describe('statusPekerja', () => {
	it('kosong → belum; hanya ditolak → ditolak; ada menunggu → menunggu; ada disetujui (tanpa menunggu) → disetujui', () => {
		expect(statusPekerja([])).toBe('belum');
		expect(statusPekerja([{ status_verifikasi: 'ditolak', bukti_file_id: 'f' }])).toBe('ditolak');
		expect(statusPekerja([{ status_verifikasi: 'menunggu', bukti_file_id: 'f' }])).toBe('menunggu');
		expect(statusPekerja([{ status_verifikasi: 'disetujui', bukti_file_id: 'f' }, { status_verifikasi: 'ditolak', bukti_file_id: 'g' }])).toBe('disetujui');
		expect(statusPekerja([{ status_verifikasi: 'disetujui', bukti_file_id: 'f' }, { status_verifikasi: 'menunggu', bukti_file_id: 'g' }])).toBe('menunggu');
	});
	it('baris tanpa file bukti tidak dianggap bukti', () => {
		expect(statusPekerja([{ status_verifikasi: 'disetujui', bukti_file_id: null }])).toBe('belum');
	});
});

describe('ringkasPA', () => {
	const dasar = { pa: PA, rincian: RINCIAN, nama: NAMA, hariIni: '2026-10-29' };
	it('2 dari 3 pekerja berbukti → belum lengkap; batas = cair + 3 hari; belum terlambat', () => {
		const r = ringkasPA({ ...dasar, distribusi: [baris(1), baris(2)] });
		expect(r).toMatchObject({ lengkap: false, terlambat: false, batas_tanggal: '2026-10-31', pekerja_belum_bukti: 1, total_diterima: 2_000_000, selisih: -1_000_000 });
		expect(r.pekerja.map((p) => [p.nama, p.status])).toEqual([['Yusuf', 'menunggu'], ['Ali', 'menunggu'], ['Budi', 'belum']]);
	});
	it('lewat batas dan belum lengkap → terlambat', () => {
		expect(ringkasPA({ ...dasar, hariIni: '2026-11-01', distribusi: [baris(1)] }).terlambat).toBe(true);
	});
	it('semua berbukti dan total = nominal → lengkap (tidak terlambat walau lewat batas)', () => {
		const r = ringkasPA({ ...dasar, hariIni: '2026-11-05', distribusi: [baris(1), baris(2), baris(3)] });
		expect(r).toMatchObject({ lengkap: true, terlambat: false });
	});
	it('baris ditolak tidak dihitung ke total dan pekerjanya dianggap belum', () => {
		const r = ringkasPA({ ...dasar, distribusi: [baris(1), baris(2), baris(3, { status_verifikasi: 'ditolak', catatan_verifikasi: 'foto buram' })] });
		expect(r.lengkap).toBe(false);
		expect(r.total_diterima).toBe(2_000_000);
		expect(r.pekerja[2]).toMatchObject({ status: 'ditolak', jumlah_diterima: 0 });
		expect(r.pekerja[2].baris[0].catatan_verifikasi).toBe('foto buram');
	});
	it('selisih total di luar toleransi → belum lengkap; toleransi melonggarkan', () => {
		const d = [baris(1), baris(2), baris(3, { jumlah_diterima: 900_000 })];
		expect(ringkasPA({ ...dasar, distribusi: d }).lengkap).toBe(false);
		expect(ringkasPA({ ...dasar, distribusi: d, toleransi: 100_000 }).lengkap).toBe(true);
	});
	it('nama tak dikenal → "Manpower #id"', () => {
		expect(ringkasPA({ ...dasar, nama: new Map(), distribusi: [] }).pekerja[0].nama).toBe('Manpower #1');
	});
});

describe('validasiBukti', () => {
	const ok = { pa: PA, manpowerKoordinator: 5, rincian: RINCIAN, distribusi: [] as any[], hariIni: '2026-10-29', masukan: { manpowerId: 1, jumlah: 1_000_000, metode: 'tunai', fotoByte: 200_000, fotoTipe: 'image/jpeg' } };
	it('masukan sah → tanpa kesalahan', () => {
		expect(validasiBukti(ok)).toEqual([]);
	});
	it('bukan koordinator / bukan jalur koordinator / belum cair / ditolak', () => {
		expect(validasiBukti({ ...ok, manpowerKoordinator: 6 }).join(' ')).toMatch(/bukan koordinator upah/);
		expect(validasiBukti({ ...ok, pa: { ...PA, penerima_dana_type: 'individu' } }).join(' ')).toMatch(/bukan jalur koordinator/);
		expect(validasiBukti({ ...ok, pa: { ...PA, tanggal_dicairkan: null } }).join(' ')).toMatch(/belum dicairkan/);
		expect(validasiBukti({ ...ok, pa: { ...PA, status: 'Rejected' } }).join(' ')).toMatch(/ditolak\/dibatalkan/);
	});
	it('pekerja di luar rincian, jumlah ≤ 0, metode salah', () => {
		expect(validasiBukti({ ...ok, masukan: { ...ok.masukan, manpowerId: 99 } }).join(' ')).toMatch(/tidak ada di rincian/);
		expect(validasiBukti({ ...ok, masukan: { ...ok.masukan, jumlah: 0 } }).join(' ')).toMatch(/lebih dari 0/);
		expect(validasiBukti({ ...ok, masukan: { ...ok.masukan, metode: 'cek' } }).join(' ')).toMatch(/tunai.*transfer/);
	});
	it('foto: wajib, harus gambar, maksimal 8 MB', () => {
		expect(validasiBukti({ ...ok, masukan: { ...ok.masukan, fotoByte: 0, fotoTipe: '' } }).join(' ')).toMatch(/Foto bukti wajib/);
		expect(validasiBukti({ ...ok, masukan: { ...ok.masukan, fotoTipe: 'application/pdf' } }).join(' ')).toMatch(/harus berupa foto/);
		expect(validasiBukti({ ...ok, masukan: { ...ok.masukan, fotoByte: 9 * 1024 * 1024 } }).join(' ')).toMatch(/terlalu besar/);
	});
	it('total melebihi nominal dicairkan ditolak; baris ditolak tidak dihitung; toleransi melonggarkan', () => {
		const penuh = [baris(1, { jumlah_diterima: 2_500_000 })];
		expect(validasiBukti({ ...ok, distribusi: penuh, masukan: { ...ok.masukan, jumlah: 600_000 } }).join(' ')).toMatch(/melebihi nominal yang dicairkan/);
		expect(validasiBukti({ ...ok, distribusi: [baris(1, { jumlah_diterima: 2_500_000, status_verifikasi: 'ditolak' })], masukan: { ...ok.masukan, jumlah: 600_000 } })).toEqual([]);
		expect(validasiBukti({ ...ok, distribusi: penuh, toleransi: 200_000, masukan: { ...ok.masukan, jumlah: 600_000 } })).toEqual([]);
	});
});

describe('I/O', () => {
	it('muatPAKoordinator: filter gaji+koordinator+cair+jendela 90 hari+bukan gugur; dicocokkan koordinator di JS', async () => {
		dx.mockResolvedValue({ data: [PA, { ...PA, id: 801, dynamic_fields: { koordinator_upah: { manpower_id: 6 } } }] });
		const r = await muatPAKoordinator(5, '2026-10-29');
		expect(r.map((p) => p.id)).toEqual([800]);
		const f = decodeURIComponent(String(dx.mock.calls[0][0]));
		expect(f).toContain('"tanggal_dicairkan":{"_gte":"2026-07-31"}');
		expect(f).toContain('"status":{"_nin":["Rejected","Dibatalkan"]}');
	});
	it('muatDetailPA: tanpa PA → tanpa query; dengan PA → 3 query terpisah', async () => {
		expect((await muatDetailPA([])).rincian).toEqual([]);
		expect(dx).not.toHaveBeenCalled();
		dx.mockImplementation(async (u: string) => (u.startsWith('/items/pengajuan_anggaran_manpower') ? { data: RINCIAN } : u.startsWith('/items/manpower?') ? { data: [{ id: 1, nama: 'Yusuf' }] } : { data: [] }));
		const r = await muatDetailPA([800]);
		expect(r.nama.get('1')).toBe('Yusuf');
		expect(dx).toHaveBeenCalledTimes(3);
	});
	it('bacaSetelan: nilai app_settings; gagal baca → default + peringatan', async () => {
		dx.mockResolvedValueOnce({ data: [{ setting_key: 'pa.distribusi.batas_hari', setting_value: '5' }, { setting_key: 'pa.distribusi.toleransi', setting_value: '' }] });
		expect(await bacaSetelan()).toEqual({ batasHari: 5, toleransi: 0 });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		dx.mockImplementation(async () => { throw new Error('403'); });
		expect(await bacaSetelan()).toEqual({ batasHari: 3, toleransi: 0 });
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
