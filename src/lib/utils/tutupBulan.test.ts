import { describe, it, expect } from 'vitest';
import { periodRange, buildChecklist, closeWarnings, validateNarasiInput, collectPhotos, photoCandidatesOf, MAX_PHOTOS } from './tutupBulan';

const rep = (d: string, status = 'submitted', extra: any = {}) => ({ date: `${d}T08:00:00`, status, ...extra });

describe('periodRange', () => {
	it('batas bulan & Februari kabisat; periode salah → null', () => {
		expect(periodRange('2026-12')).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01', days: 31 });
		expect(periodRange('2028-02')?.days).toBe(29);
		expect(periodRange('2026-00')).toBeNull();
	});
});

describe('buildChecklist', () => {
	it('bulan lalu: target seluruh bulan, hari kosong terdaftar, draf/ditolak tidak dihitung', () => {
		const reports = [rep('2026-10-01'), rep('2026-10-02'), rep('2026-10-02'), rep('2026-10-04', 'draft'), rep('2026-10-05', 'rejected')];
		const c = buildChecklist(reports, '2026-10', '2026-11-16')!;
		expect(c.bulanBerjalan).toBe(false);
		expect(c.hariTarget).toBe(31);
		expect(c.hariBerlapor).toBe(2);
		expect(c.hariKosong).toHaveLength(29);
		expect(c.hariKosong).toContain('2026-10-04');
		expect(c.laporanDraf).toBe(1);
		expect(c.laporanDitolak).toBe(1);
		expect(c.laporanDihitung).toBe(3);
		expect(c.kepatuhanPct).toBe(6);
	});

	it('bulan berjalan: target sampai KEMARIN; hari ini belum wajib', () => {
		const c = buildChecklist([rep('2026-11-01'), rep('2026-11-02')], '2026-11', '2026-11-03')!;
		expect(c.bulanBerjalan).toBe(true);
		expect(c.hariTarget).toBe(2);
		expect(c.hariKosong).toEqual([]);
		expect(c.kepatuhanPct).toBe(100);
	});

	it('hari pertama bulan berjalan & bulan depan: target 0, kepatuhan null (bukan 0%)', () => {
		expect(buildChecklist([], '2026-11', '2026-11-01')!.kepatuhanPct).toBeNull();
		expect(buildChecklist([], '2026-12', '2026-11-16')!.hariTarget).toBe(0);
	});

	it('tahan input kosong/rusak', () => {
		expect(buildChecklist(null as any, '2026-10', '2026-11-16')!.laporanDihitung).toBe(0);
		expect(buildChecklist([], 'salah')).toBeNull();
	});
});

describe('closeWarnings', () => {
	it('mendaftar kekurangan tapi tidak pernah memblokir (hanya teks)', () => {
		const c = buildChecklist([rep('2026-10-01')], '2026-10', '2026-11-16');
		const w = closeWarnings(c, { kendala_utama: '', rencana_bulan_depan: '  ' });
		expect(w.join(' ')).toContain('belum ada laporan harian');
		expect(w).toContain('Kendala utama belum diisi.');
		expect(w).toContain('Rencana bulan depan belum diisi.');
	});
	it('lengkap → kosong', () => {
		const days = Array.from({ length: 31 }, (_, i) => rep(`2026-10-${String(i + 1).padStart(2, '0')}`));
		expect(closeWarnings(buildChecklist(days, '2026-10', '2026-11-16'), { kendala_utama: 'x', rencana_bulan_depan: 'y' })).toEqual([]);
	});
});

describe('validateNarasiInput', () => {
	const ok = { projectId: 7, period: '2026-10', kendala_utama: ' Hujan ', rencana_bulan_depan: 'Lanjut coating', photo_ids: ['abcdef-1', 'abcdef-1', '../x', 'abcdef-2'] };
	it('menormalkan teks, menyaring id foto (unik, aman) dan default action=save', () => {
		const r = validateNarasiInput(ok);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.kendala_utama).toBe('Hujan');
			expect(r.value.catatan_manajemen).toBe('');
			expect(r.value.photo_ids).toEqual(['abcdef-1', 'abcdef-2']);
			expect(r.value.action).toBe('save');
		}
	});
	it('menolak input tidak valid dengan pesan jelas', () => {
		expect(validateNarasiInput({ ...ok, projectId: 'x' })).toMatchObject({ ok: false });
		expect(validateNarasiInput({ ...ok, period: '2026-13' })).toMatchObject({ ok: false });
		expect(validateNarasiInput({ ...ok, action: 'hapus' })).toMatchObject({ ok: false });
		expect(validateNarasiInput({ ...ok, kendala_utama: 'a'.repeat(4001) })).toMatchObject({ ok: false });
		expect(validateNarasiInput({ ...ok, kendala_utama: 123 })).toMatchObject({ ok: false });
		expect(validateNarasiInput({ ...ok, photo_ids: 'bukan-array' })).toMatchObject({ ok: false });
		expect(validateNarasiInput(null)).toMatchObject({ ok: false });
	});
	it('foto dibatasi', () => {
		const ids = Array.from({ length: 40 }, (_, i) => `foto-id-${i}-xxx`);
		const r = validateNarasiInput({ ...ok, photo_ids: ids });
		expect(r.ok && r.value.photo_ids.length).toBe(MAX_PHOTOS);
	});
});

describe('kandidat foto', () => {
	it('mengumpulkan dari beberapa bentuk; mengabaikan laporan draf', () => {
		const p = collectPhotos({ date: '2026-10-01', progress_photos: ['aaaaaaaa-1', { id: 'bbbbbbbb-2', label: 'X' }], area_kerja_photos: 'cccccccc-3,aaaaaaaa-1', progress: [{ activity: 'Cat', foto_bukti: ['dddddddd-4'] }] });
		expect(p.map((x) => x.id)).toEqual(['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3', 'dddddddd-4']);
		const all = photoCandidatesOf([rep('2026-10-02', 'draft', { progress_photos: ['draftfoto-1'] }), rep('2026-10-01', 'submitted', { progress_photos: ['okfoto-123'] })]);
		expect(all.map((x) => x.id)).toEqual(['okfoto-123']);
	});
});
