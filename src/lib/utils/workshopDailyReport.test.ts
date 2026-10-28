// @ts-nocheck
// SALINAN tes erp-epi workshopDailyReport.test.js — paritas aturan WSK-10 di HP.
import { describe, it, expect } from 'vitest';
import {
  personKey, countUniqueHadir, computePoManpower, normalizeDailyReportInput, applyPoManpower, planMerge, mergeText, normalizeTanggalGandaMode
} from './workshopDailyReport';

const H = (nama, status = 'hadir', extra = {}) => ({ nama, status_hadir: status, ...extra });

describe('countUniqueHadir (jumlah_tenaga = orang unik)', () => {
  it('kasus tiket: 4 leader + 9 manpower hadir = 13 walau dipakai di 8 baris PO', () => {
    const leaders = ['L1', 'L2', 'L3', 'L4'].map((n) => H(n));
    const mp = Array.from({ length: 9 }, (_, i) => H('M' + i, 'hadir', { manpower_id: 100 + i }));
    expect(countUniqueHadir(mp, leaders)).toBe(13);
  });
  it('setengah hari dihitung 1 orang; izin/sakit/absen tidak; orang sama dua kali (manpower_id) 1', () => {
    expect(countUniqueHadir([H('A', 'setengah_hari'), H('B', 'izin'), H('C', 'sakit'), H('D', 'absen'), H('E', 'ijin')], [])).toBe(1);
    expect(countUniqueHadir([H('A', 'hadir', { manpower_id: 5 }), H('A (dobel)', 'hadir', { manpower_id: 5 })], [])).toBe(1);
  });
  it('nama sama beda huruf/spasi = orang sama; tipe leader vs manpower beda', () => {
    expect(countUniqueHadir([H('budi  santoso'), H('BUDI SANTOSO')], [])).toBe(1);
    expect(countUniqueHadir([H('Budi')], [H('Budi')])).toBe(2);
  });
  it('null-safe', () => { expect(countUniqueHadir(undefined, null)).toBe(0); });
});

describe('computePoManpower / applyPoManpower (porsi alokasi)', () => {
  const abs = [
    H('A', 'hadir', { po_split: [{ po_id: 1, persentase: 100 / 3 }, { po_id: 2, persentase: 100 / 3 }, { po_id: 3, persentase: 100 / 3 }] }),
    H('B', 'hadir', { po_split: [{ po_id: 1, persentase: 100 }] }),
    H('C', 'izin', { po_split: [{ po_id: 1, persentase: 100 }] }),
    H('D', 'hadir')
  ];
  it('Σ porsi desimal; yang tidak hadir & tanpa pembagian tidak dihitung', () => {
    const m = computePoManpower(abs, []);
    expect(m.get(1)).toBeCloseTo(1.3333, 3);
    expect(m.get(2)).toBeCloseTo(0.3333, 3);
    expect(m.get(3)).toBeCloseTo(0.3333, 3);
  });
  it('baris PO tanpa pembagian mempertahankan jumlah_manpower kiriman klien', () => {
    const r = applyPoManpower([{ po_id: 1, jumlah_manpower: 9 }, { po_id: 7, jumlah_manpower: 4 }], abs, []);
    expect(r[0].jumlah_manpower).toBeCloseTo(1.3333, 3);
    expect(r[1].jumlah_manpower).toBe(4);
  });
});

describe('normalizeDailyReportInput', () => {
  const ok = { header: { tanggal: '2026-10-18', cuaca: 'cerah', hacker: 'x', jumlah_tenaga: 999 }, absensi: [H('A', 'hadir', { foto_masuk: 'f' })], absensi_leader: [H('L', 'hadir')], material: [{ nama_material: 'Pasir', qty: 3, ngawur: 1 }], po_details: [{ po_id: 5, volume_aktual: 10, aneh: 1 }] };
  it('hanya kolom skema live yang lolos; jumlah_tenaga kiriman klien DIBUANG (server menghitung)', () => {
    const r = normalizeDailyReportInput(ok);
    expect(r.ok).toBe(true);
    expect(r.value.header).toEqual({ tanggal: '2026-10-18', cuaca: 'cerah' });
    expect(r.value.material[0]).toEqual({ nama_material: 'Pasir', qty: 3 });
    expect(r.value.poDetails[0]).toEqual({ po_id: 5, volume_aktual: 10 });
  });
  it('galat jelas: tanggal salah, status tak dikenal, orang ganda, split ≠ 100%, daftar bukan array, po tanpa po_id', () => {
    expect(normalizeDailyReportInput({ header: { tanggal: '18/10/2026' } }).errors[0]).toContain('Tanggal');
    expect(normalizeDailyReportInput({ header: { tanggal: '2026-10-18' }, absensi: [H('A', 'ngantuk')] }).errors[0]).toContain('tidak dikenal');
    expect(normalizeDailyReportInput({ header: { tanggal: '2026-10-18' }, absensi: [H('A'), H('a')] }).errors[0]).toContain('dua kali');
    expect(normalizeDailyReportInput({ header: { tanggal: '2026-10-18' }, absensi: [H('A', 'hadir', { po_split: [{ po_id: 1, persentase: 60 }] })] }).errors[0]).toContain('100%');
    expect(normalizeDailyReportInput({ header: { tanggal: '2026-10-18' }, material: 'x' }).errors[0]).toContain('daftar');
    expect(normalizeDailyReportInput({ header: { tanggal: '2026-10-18' }, po_details: [{ volume_aktual: 1 }] }).errors.join()).toContain('po_id');
    expect(normalizeDailyReportInput(null).ok).toBe(false);
  });
  it('batas jumlah baris', () => {
    const many = Array.from({ length: 130 }, (_, i) => H('P' + i));
    expect(normalizeDailyReportInput({ header: { tanggal: '2026-10-18' }, absensi: many }).errors[0]).toContain('Maksimal');
  });
  it('baris material tanpa nama dibuang; split valid dinormalisasi', () => {
    const r = normalizeDailyReportInput({ header: { tanggal: '2026-10-18' }, material: [{ nama_material: '  ' }, { nama_material: 'Cat' }], absensi: [H('A', 'hadir', { po_split: [{ po_id: '4', persentase: '50' }, { po_id: 5, persentase: 50 }] })] });
    expect(r.value.material).toHaveLength(1);
    expect(r.value.absensi[0].po_split).toEqual([{ po_id: 4, persentase: 50 }, { po_id: 5, persentase: 50 }]);
  });
});

describe('planMerge (gabung ke laporan yang sudah ada)', () => {
  const existing = {
    absensi: [{ nama: 'Budi', tipe: 'manpower', manpower_id: 7 }, { nama: 'Leo', tipe: 'leader' }],
    material: [{ kategori: 'Cat', nama_material: 'Epoxy', no_po: 'P1', qty: 2, satuan: 'kg' }],
    poDetails: [{ po_id: 5, subtask_id: 1, subtask_name: 'Blasting', volume_aktual: 10, progress_hari_ini: 5 }]
  };
  it('orang/material/progres identik dilewati; yang baru ditambahkan', () => {
    const p = planMerge(existing, {
      absensi: [H('Budi', 'hadir', { manpower_id: 7 }), H('Sari')],
      absensiLeader: [H('LEO'), H('Rudi')],
      material: [{ kategori: 'Cat', nama_material: 'epoxy', no_po: 'p1', qty: 2, satuan: 'KG' }, { kategori: 'Cat', nama_material: 'Thinner', qty: 1 }],
      poDetails: [{ po_id: 5, subtask_id: 1, subtask_name: 'Blasting', volume_aktual: 10, progress_hari_ini: 5 }, { po_id: 5, subtask_id: 2, subtask_name: 'Painting', volume_aktual: 3 }]
    });
    expect(p.absensi.map((r) => r.nama)).toEqual(['Sari']);
    expect(p.absensiLeader.map((r) => r.nama)).toEqual(['Rudi']);
    expect(p.material.map((m) => m.nama_material)).toEqual(['Thinner']);
    expect(p.poDetails.map((d) => d.subtask_name)).toEqual(['Painting']);
    expect(p.skipped).toEqual({ absensi: ['Budi', 'LEO'], material: 1, poDetails: 1 });
  });
  it('laporan lama kosong → semua masuk', () => {
    const p = planMerge({}, { absensi: [H('A')], absensiLeader: [], material: [{ nama_material: 'X' }], poDetails: [{ po_id: 1 }] });
    expect(p.absensi).toHaveLength(1);
    expect(p.skipped.material + p.skipped.poDetails + p.skipped.absensi.length).toBe(0);
  });
});

describe('util kecil', () => {
  it('mergeText menambah tanpa menghapus & tanpa menggandakan', () => {
    expect(mergeText('pagi', 'sore')).toBe('pagi | sore');
    expect(mergeText('pagi | sore', 'sore')).toBe('pagi | sore');
    expect(mergeText('', 'x')).toBe('x');
    expect(mergeText('a', '')).toBe('a');
  });
  it('mode tanggal ganda: tolak (aman) bila tak dikenal', () => {
    expect(normalizeTanggalGandaMode('gabung')).toBe('gabung');
    expect(normalizeTanggalGandaMode(undefined)).toBe('tolak');
    expect(normalizeTanggalGandaMode('apa')).toBe('tolak');
  });
  it('personKey stabil', () => {
    expect(personKey({ manpower_id: { id: 3 } }, 'manpower')).toBe('m:3');
    expect(personKey({ nama: ' a  b ' }, 'leader')).toBe('n:leader:A B');
  });
});
