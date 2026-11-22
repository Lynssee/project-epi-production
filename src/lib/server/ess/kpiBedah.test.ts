import { describe, it, expect } from 'vitest';
import { bedahIndikator, buatTip } from './kpiBedah';
import { draftSanggahan } from '$lib/utils/ess/kpiSanggahan';

const targets = [
	{ name: 'Ketepatan Waktu Posting Jurnal', weight: 20, target: 90, achievement: 76.49, metricType: 'percentage', arah: 'tinggi', terukur: true },
	{ name: 'Pelatihan Wajib Selesai', weight: 10, target: 100, achievement: 0, metricType: 'percentage', terukur: true },
	{ name: 'Output Teknis', weight: 30, target: 100, achievement: 0, terukur: false },
	{ name: 'Kehadiran', weight: 20, target: 95, achievement: 100, metricType: 'percentage', terukur: true }
];
const outliers = Array.from({ length: 14 }, (_, n) => ({ ref: `JE-${n}`, detail: 'Transaksi 2026-07-01 → diposting 2026-07-20', nilai: 19 - n, satuan: 'hari' }));
const sumber = [
	{ indikator: 'Ketepatan Waktu Posting Jurnal', data_source: 'finance_journal_posting_lag_dept', otomatis: true, terukur: true, skor: 85, catatan: 'SELURUH departemen: 501/655', atribusi: 'departemen', outliers, outliers_total: 154 },
	{ indikator: 'Pelatihan Wajib Selesai', data_source: 'training_enrollment', otomatis: true, terukur: true, skor: 0, catatan: '0/1 pelatihan wajib selesai', atribusi: 'individu', outliers: [{ ref: 'K3 Dasar', detail: 'Status terakhir: Ongoing', nilai: null, satuan: '' }], outliers_total: 1 },
	{ indikator: 'Output Teknis', data_source: null, otomatis: false, terukur: false, skor: 0 },
	{ indikator: 'Kehadiran', data_source: 'absensi', otomatis: true, terukur: true, skor: 100, catatan: 'ok' }
];

describe('bedahIndikator', () => {
	const r = bedahIndikator({ targets, sumber_perhitungan: sumber });

	it('membawa atribusi, catatan, dan log audit (maks 10) per indikator', () => {
		expect(r).toHaveLength(4);
		expect(r[0]).toMatchObject({ atribusi: 'departemen', catatan: 'SELURUH departemen: 501/655', outliers_total: 154, skor: 85, pilar: 'teknis' });
		expect(r[0].outliers).toHaveLength(10);
		expect(r[1].atribusi).toBe('individu');
	});

	it('indikator belum terukur tidak mendapat skor 0 & diberi penjelasan', () => {
		expect(r[2]).toMatchObject({ terukur: false, skor: null, nilai: null });
		expect(r[2].tip).toContain('Belum terukur');
	});

	it('tip: kolektif → koordinasi tim; individu ber-outlier → sebut item; skor 100 → tanpa tip', () => {
		expect(r[0].tip).toContain('kolektif departemen');
		expect(r[0].tip).toContain('154');
		expect(r[1].tip).toContain('K3 Dasar');
		expect(r[3].tip).toBeNull();
	});

	it('scorecard lama tanpa field baru & data JSON-string/null tetap aman', () => {
		const lama = bedahIndikator({ targets: JSON.stringify([targets[3]]), sumber_perhitungan: JSON.stringify([{ indikator: 'Kehadiran', data_source: 'absensi', terukur: true, skor: 80 }]) });
		expect(lama[0]).toMatchObject({ atribusi: null, outliers: [], outliers_total: null, catatan: '' });
		expect(bedahIndikator({})).toEqual([]);
		expect(bedahIndikator({ targets: 'bukan json' })).toEqual([]);
	});
});

describe('buatTip — selisih ke target', () => {
	it('arah tinggi & rendah', () => {
		const dasar = { terukur: true, skor: 60, atribusi: 'individu' as const, outliers: [], outliers_total: null, unit: '%' };
		expect(buatTip({ ...dasar, arah: 'tinggi', nilai: 70, target: 90 })).toContain('selisih 20');
		expect(buatTip({ ...dasar, arah: 'rendah', nilai: 5, target: 2, unit: 'kali' })).toContain('selisih 3 kali');
	});
});

describe('draftSanggahan', () => {
	it('menyebut indikator + hanya dokumen valid yang dipilih (tanpa duplikat)', () => {
		const ind = { nama: 'Ketepatan Waktu Posting Jurnal', outliers: [{ ref: 'JE-1', detail: '', nilai: 5, satuan: 'hari' }, { ref: 'JE-2', detail: '', nilai: 4, satuan: 'hari' }] };
		const t = draftSanggahan(ind, ['JE-1', 'JE-1', 'JE-9']);
		expect(t).toBe('[Indikator: Ketepatan Waktu Posting Jurnal] Dokumen yang dipermasalahkan: JE-1. Alasan: ');
		expect(draftSanggahan(ind, [])).toBe('[Indikator: Ketepatan Waktu Posting Jurnal] Alasan: ');
	});
});
