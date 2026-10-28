import { describe, it, expect } from 'vitest';
import * as gate from './sj-atur-mode-gate.mjs';
import * as saklar from './sj-saklar-gerbang-penjualan.mjs';
import * as sec from './sj-cek-secret-gerbang.mjs';
import { parseHanya, bentukPatch as patchSj04, bentukChecklistRekonsiliasi } from './sj04-bereskan-sj-lama-tertahan.mjs';
import { statusSecret, susunLaporan } from './sj01-cek-kesiapan-gerbang.mjs';

const HARI_INI = '2026-10-08';
const base = { gate: 'G_SJ_BARANG_BERMASALAH', mode: 'soft', enforceFrom: null, lead: null, izin: null, apply: false, tanpaTenggang: false };

describe('sj-atur-mode-gate', () => {
  it('hanya 2 gate SJ yang boleh diubah', () => {
    expect(gate.validasiArgumen({ ...base, gate: 'G_SJ_STOK' }, HARI_INI).ok).toBe(false);
    expect(gate.validasiArgumen(base, HARI_INI).ok).toBe(true);
    expect(gate.validasiArgumen({ ...base, gate: 'G_SJ_ALAMAT' }, HARI_INI).ok).toBe(true);
  });
  it('mode di luar shadow/soft/hard ditolak', () => {
    expect(gate.validasiArgumen({ ...base, mode: 'off' }, HARI_INI).ok).toBe(false);
  });
  it('--apply wajib --lead dan --izin', () => {
    expect(gate.validasiArgumen({ ...base, apply: true }, HARI_INI).ok).toBe(false);
    expect(gate.validasiArgumen({ ...base, apply: true, lead: 'Lead' }, HARI_INI).ok).toBe(false);
    expect(gate.validasiArgumen({ ...base, apply: true, lead: 'Lead', izin: 'WA 8 Okt' }, HARI_INI).ok).toBe(true);
  });
  it('Aturan #3: hard tanpa masa tenggang ditolak kecuali --tanpa-tenggang', () => {
    const hard = { ...base, mode: 'hard' };
    expect(gate.validasiArgumen(hard, HARI_INI).ok).toBe(false);
    expect(gate.validasiArgumen({ ...hard, tanpaTenggang: true }, HARI_INI).ok).toBe(true);
    expect(gate.validasiArgumen({ ...hard, enforceFrom: '2026-10-22' }, HARI_INI).ok).toBe(true);
  });
  it('enforce_from: format, harus masa depan, hanya untuk hard', () => {
    const hard = { ...base, mode: 'hard' };
    expect(gate.validasiArgumen({ ...hard, enforceFrom: '22/10/2026' }, HARI_INI).ok).toBe(false);
    expect(gate.validasiArgumen({ ...hard, enforceFrom: '2026-10-08' }, HARI_INI).ok).toBe(false);
    expect(gate.validasiArgumen({ ...base, enforceFrom: '2026-10-22' }, HARI_INI).ok).toBe(false);
  });
  it('payload: catatan audit memuat Lead & izin; enforce_from dikosongkan bila bukan hard', () => {
    const p = gate.bentukPatch({ ...base, lead: 'Lead A', izin: 'WA 8 Okt' }, HARI_INI);
    expect(p).toMatchObject({ mode: 'soft', enforce_from: null });
    expect(p.note).toMatch(/Lead A/);
    expect(p.note).toMatch(/WA 8 Okt/);
    expect(gate.bentukPatch({ ...base, mode: 'hard', enforceFrom: '2026-10-22', lead: 'L', izin: 'i' }, HARI_INI).enforce_from).toBe('2026-10-22');
  });
  it('parseArgv membaca flag', () => {
    expect(gate.parseArgv(['--gate', 'G_SJ_ALAMAT', '--mode', 'soft', '--apply', '--lead', 'X', '--izin', 'Y'])).toMatchObject({ gate: 'G_SJ_ALAMAT', mode: 'soft', apply: true, lead: 'X', izin: 'Y' });
  });
});

describe('sj-saklar-gerbang-penjualan', () => {
  it('validasi --set dan --apply', () => {
    expect(saklar.validasiArgumen({ set: 'nyala' }).ok).toBe(false);
    expect(saklar.validasiArgumen({ set: 'aktif', apply: true }).ok).toBe(false);
    expect(saklar.validasiArgumen({ set: 'aktif', apply: true, lead: 'L', izin: 'i' }).ok).toBe(true);
    expect(saklar.validasiArgumen({ set: 'mati' }).ok).toBe(true);
  });
  it('nilai tersimpan string true/false & baris baru bertipe boolean', () => {
    expect(saklar.nilaiTersimpan('aktif')).toBe('true');
    expect(saklar.nilaiTersimpan('mati')).toBe('false');
    expect(saklar.barisBaru()).toMatchObject({ module: 'logistik', setting_key: 'gerbang_penjualan_aktif', setting_type: 'boolean' });
  });
});

describe('sj-cek-secret-gerbang', () => {
  const S32 = 'a'.repeat(32);
  it('ambilNilai: kutip, komentar, export, CRLF; baris terakhir menang', () => {
    expect(sec.ambilNilai('A=1\r\nGERBANG_PROXY_SECRET="abc def"\r\n')).toBe('abc def');
    expect(sec.ambilNilai("GERBANG_PROXY_SECRET='xyz' # komentar")).toBe('xyz');
    expect(sec.ambilNilai('export GERBANG_PROXY_SECRET=abc  # k\n')).toBe('abc');
    expect(sec.ambilNilai('GERBANG_PROXY_SECRET=satu\nGERBANG_PROXY_SECRET=dua')).toBe('dua');
    expect(sec.ambilNilai('# GERBANG_PROXY_SECRET=x')).toBe(null);
    expect(sec.ambilNilai('')).toBe(null);
  });
  it('bandingkan: sama & cukup panjang → ok; beda / kosong / pendek → masalah, nilai tidak bocor', () => {
    expect(sec.bandingkan(S32, S32).ok).toBe(true);
    const beda = sec.bandingkan(S32, 'b'.repeat(32));
    expect(beda.ok).toBe(false);
    expect(beda.masalah.join(' ')).toMatch(/BEDA/);
    expect(sec.bandingkan(null, S32).masalah.join(' ')).toMatch(/KOSONG/);
    expect(sec.bandingkan('pendek', 'pendek').masalah.join(' ')).toMatch(/TERLALU-PENDEK/);
    expect(JSON.stringify(sec.bandingkan(S32, S32))).not.toContain(S32);
  });
});

describe('sj04 & sj01 (helper murni)', () => {
  it('parseHanya', () => {
    expect(parseHanya('744, 745,abc,744,-3')).toEqual([744, 745]);
    expect(parseHanya('')).toEqual([]);
  });
  it('SJ-04 tidak mengisi security_verified_*; checklist = tidak_diperiksa', () => {
    const p = patchSj04({ security_checklist: 'catatan lama' }, 'shipped', '2026-10-08T00:00:00Z');
    expect(p.status).toBe('shipped');
    expect(p).not.toHaveProperty('security_verified_at');
    expect(p.security_checklist).toMatchObject({ hasil: 'tidak_diperiksa', sumber: 'rekonsiliasi', catatan: 'catatan lama' });
    expect(bentukChecklistRekonsiliasi({ security_checklist: null }).catatan).toBe(null);
  });
  it('SJ-01 statusSecret & laporan wajib', () => {
    expect(statusSecret('')).toBe('KOSONG');
    expect(statusSecret('x'.repeat(10))).toBe('terlalu-pendek');
    expect(statusSecret('x'.repeat(40))).toBe('ada');
    const l = susunLaporan({ secret: 'KOSONG', saklar: 1, karyawan: [], antrean: [{ track_stage: null }], dicetakBelumDimuat: 2, scanSejak: {} });
    expect(l.ok).toBe(false);
    expect(l.temuan.filter((t) => t.level === 'WAJIB').length).toBeGreaterThanOrEqual(3);
    const ok = susunLaporan({ secret: 'ada', saklar: true, karyawan: [{ kiosk_menu_access: ['gerbang_sj', 'muat_sj'] }], antrean: [], dicetakBelumDimuat: 0, scanSejak: { lolosGerbangNyata: 1 } });
    expect(ok.ok).toBe(true);
  });
});
