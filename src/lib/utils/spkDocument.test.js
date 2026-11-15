import { describe, it, expect } from 'vitest';
import {
  SPK_DEFAULTS, mergeSpkSettings, spkDocDefaultsFlat, hitungBorongan, buildSpkDocument, stripHargaAssignment, esc, isi, fmtTanggal,
} from './spkDocument.js';

// Contoh riil dari PDF LO-PI097 (Irpan Nurdiawan - Mulia Sawit)
const ITEMS_IRPAN = [
  { deskripsi: 'Pekerjaan Epoxy Lantai 1000 micron', qty: 241, satuan: 'm2', harga_satuan: 33000 },
  { deskripsi: 'line marking', qty: 42, satuan: 'm2', harga_satuan: 5000 },
];
const A_BORONGAN = {
  rate_tipe: 'borongan', nilai_borongan: 8163000, nomor_spk: 'LO-PI097/EPI-SPK/MSAL/XI/2026',
  jabatan: 'Supervisor', jenis_pekerjaan: 'Epoxy Lantai', borongan_items: ITEMS_IRPAN,
  tanggal_mulai: '2026-11-01', tanggal_selesai: '2026-11-10', tanggal_spk: '2026-10-30',
};
const MP_IRPAN = { nama: 'IRPAN NURDIAWAN', NIK: '3201381110870003', no_telpon: '0857-7904-0430' };
const PR_MSAL = { name: 'PT. Mulia Sawit Agro Lestari', nomor_po: '5198022907' };

// Contoh riil dari PDF PI031 (Sugeng Wijaya - WKP)
const A_HARIAN = {
  rate_tipe: 'harian', rate_harian: 150000, rate_uang_makan: 30000, rate_standby: 40000,
  nomor_spk: 'SPK/EPI/112026/031', jabatan: 'Helper', jenis_pekerjaan: 'Painting',
  lokasi: 'Kec. Waru, Ka. Penajam Paser Utara, Kalimantan Timur', tanggal_mulai: '2026-10-07',
};
const PR_WKP = { name: 'PT. WARU KALTIM PLANTATIONS' };

describe('hitungBorongan — angka contoh PDF Irpan', () => {
  it('total 8.163.000, PPh 21 2,5% = 204.075, netto 7.958.925', () => {
    const h = hitungBorongan({ items: ITEMS_IRPAN, pph21Pct: 2.5 });
    expect(h.rows.map((r) => r.jumlah)).toEqual([7953000, 210000]);
    expect(h.total).toBe(8163000);
    expect(h.pph21).toBe(204075);
    expect(h.netto).toBe(7958925);
  });
  it('tanpa item → 1 baris paket dari nilai_borongan', () => {
    const h = hitungBorongan({ items: undefined, nilaiBorongan: 5000000, jenisPekerjaan: 'Epoxy', pph21Pct: 2.5 });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ satuan: 'paket', qty: 1, jumlah: 5000000 });
    expect(h.netto).toBe(5000000 - 125000);
  });
  it('tanpa item & tanpa nilai → kosong (tidak crash)', () => {
    const h = hitungBorongan({ items: null, nilaiBorongan: null, pph21Pct: 2.5 });
    expect(h.rows).toEqual([]);
    expect(h.total).toBe(0);
  });
  it('item rusak (qty 0 / tanpa deskripsi) diabaikan', () => {
    const h = hitungBorongan({ items: [{ deskripsi: '', qty: 3, harga_satuan: 10 }, { deskripsi: 'x', qty: 0, harga_satuan: 10 }], pph21Pct: 0 });
    expect(h.rows).toEqual([]);
  });
});

describe('buildSpkDocument — Surat Tugas Borongan', () => {
  const r = buildSpkDocument({ a: A_BORONGAN, mp: MP_IRPAN, pr: PR_MSAL, settings: SPK_DEFAULTS });
  it('varian borongan dengan angka sesuai PDF', () => {
    expect(r.varian).toBe('borongan');
    expect(r.html).toContain('8.163.000');
    expect(r.html).toContain('204.075');
    expect(r.html).toContain('7.958.925');
    expect(r.html).toContain('7.953.000');
  });
  it('memuat 6 pasal + tata tertib subcont + NIK/Tlp', () => {
    for (const p of ['PASAL I ', 'PASAL II ', 'PASAL III ', 'PASAL IV ', 'PASAL V ', 'PASAL VI ']) expect(r.html).toContain(p);
    expect(r.html).toContain('Tata Tertib Subcont');
    expect(r.html).toContain('3201381110870003');
    expect(r.html).toContain('0857-7904-0430');
    expect(r.html).toContain('PO 5198022907');
  });
  it('retensi dari setelan, satu klausul, dihitung setelah BAP', () => {
    expect(r.html).toContain('retensi sebesar 5% dari nilai kontrak dibayarkan 30 hari setelah BAP');
    expect(r.html).not.toContain('setelah satu bulan pekerjaan selesai');
  });
  it('butir 4 pembayaran punya subjek (tidak terpotong)', () => {
    expect(r.html).toContain('Termin pembayaran diberikan setelah ada pengajuan');
  });
  it('rujukan jam kerja menunjuk ayat yang benar (durasi=1, berakhir=2, jam=3)', () => {
    expect(r.html).toContain('Jangka waktu kontrak pengerjaan 10 hari');
    expect(r.html).toContain('pada Pasal IV ayat (3) tersebut');
  });
  it('tidak ada placeholder {…} tersisa', () => {
    expect(r.html).not.toMatch(/\{[a-z_]+\}/);
  });
  it('kontrakan mengikuti PDF (dibagi 2) dan sengketa tidak menyebut PN', () => {
    expect(r.html).toContain('Kontrakan dibagi 2');
    expect(r.html).not.toMatch(/Pengadilan Negeri/);
  });
  it('TTD manpower tampil bila ada', () => {
    const w = buildSpkDocument({ a: A_BORONGAN, mp: MP_IRPAN, pr: PR_MSAL, settings: SPK_DEFAULTS, ttdImg: '<img alt="ttd-x">' });
    expect(w.html).toContain('ttd-x');
  });
  it('PPh 0% → baris PPh disembunyikan', () => {
    const w = buildSpkDocument({ a: A_BORONGAN, mp: MP_IRPAN, pr: PR_MSAL, settings: { ...SPK_DEFAULTS, pph21_pct: 0 } });
    expect(w.html).not.toContain('PPH 21');
    expect(w.html).not.toContain('setelah PPH 21');
  });
  it('jumlah manpower minimal hanya muncul bila diisi', () => {
    expect(r.html).not.toContain('Jumlah manpower minimal');
    const w = buildSpkDocument({ a: { ...A_BORONGAN, jumlah_manpower_min: 3 }, mp: MP_IRPAN, pr: PR_MSAL, settings: SPK_DEFAULTS });
    expect(w.html).toContain('Jumlah manpower minimal 3 orang.');
    expect(w.html).toContain('Pasal IV ayat (4)');
  });
});

describe('buildSpkDocument — SPK Harian', () => {
  const r = buildSpkDocument({ a: A_HARIAN, mp: { nama: 'Sugeng Wijaya' }, pr: PR_WKP, settings: SPK_DEFAULTS });
  it('varian harian: upah, makan, standby sesuai PDF', () => {
    expect(r.varian).toBe('harian');
    expect(r.html).toContain('Rp 150.000');
    expect(r.html).toContain('Rp 30.000');
    expect(r.html).toContain('Rp 40.000');
    expect(r.html).toContain('Surat Perintah Kerja');
  });
  it('periode terbuka → "s/d Proyek selesai"', () => {
    expect(r.html).toContain('7 Oktober 2026');
    expect(r.html).toContain('Proyek selesai');
  });
  it('siklus bayar & 5 tata tertib', () => {
    expect(r.html).toContain('Pembayaran dilakukan 14 hari sekali di hari Jumat.');
    expect(r.html).toContain('smoking area');
    expect(r.html).toContain('Alat Pelindung Diri (APD) Standar');
  });
  it('4 blok TTD: Project Admin, Project Manager, Penerima, Direktur', () => {
    for (const role of ['Project Admin', 'Project Manager', 'Direktur']) expect(r.html).toContain(role);
    expect(r.html).toContain('Penerima tugas,');
  });
  it('tidak memuat tabel borongan / PPh 21 (format berpasal maupun ringkas)', () => {
    expect(r.html).not.toContain('PPH 21');
    expect(r.html).not.toContain('Harga Satuan');
  });
  it('format ringkas (harian_dengan_pasal=false) mengikuti PDF PI031: tanpa pasal & tanpa Pihak Pertama/Kedua', () => {
    const k = buildSpkDocument({ a: A_HARIAN, mp: { nama: 'Sugeng Wijaya' }, pr: PR_WKP, settings: { ...SPK_DEFAULTS, harian_dengan_pasal: false } });
    expect(k.html).not.toContain('PASAL');
    expect(k.html).not.toContain('PIHAK PERTAMA');
    expect(k.html).toContain('Syarat Pembayaran dan Tata Tertib');
  });
  it('uang makan/standby kosong → baris tidak dicetak', () => {
    const w = buildSpkDocument({ a: { ...A_HARIAN, rate_uang_makan: null, rate_standby: 0 }, mp: { nama: 'X' }, pr: PR_WKP });
    expect(w.html).not.toContain('Uang Makan');
    expect(w.html).not.toContain('Uang Standby');
  });
});

describe('keamanan & ketahanan', () => {
  it('esc menetralkan HTML pada data pengguna', () => {
    expect(esc('<img src=x onerror=alert(1)>')).not.toContain('<');
    const r = buildSpkDocument({ a: A_HARIAN, mp: { nama: '<script>x</script>' }, pr: { name: 'A & B' } });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('A &amp; B');
  });
  it('input kosong total tidak crash', () => {
    expect(() => buildSpkDocument({})).not.toThrow();
    expect(() => buildSpkDocument({ a: { rate_tipe: 'borongan' } })).not.toThrow();
  });
  it('isi() membiarkan placeholder tak dikenal', () => {
    expect(isi('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
  });
  it('fmtTanggal tidak bergeser zona waktu', () => {
    expect(fmtTanggal('2026-10-07')).toBe('7 Oktober 2026');
    expect(fmtTanggal(null)).toBe('-');
  });
});

const K = (k) => 'manpower.spk_doc.' + k;

describe('mergeSpkSettings (kunci manpower.spk_doc.*)', () => {
  it('tanpa setelan → default', () => {
    const { settings, peringatan } = mergeSpkSettings({});
    expect(settings.retensi_pct).toBe(5);
    expect(peringatan).toEqual([]);
    expect(mergeSpkSettings(undefined).settings.retensi_hari).toBe(30);
  });
  it('override angka & teks; kunci di luar namespace diabaikan', () => {
    const { settings } = mergeSpkSettings({
      [K('retensi_pct')]: 10,
      [K('jam_kerja')]: 'Senin–Jumat 08.00–16.00',
      'manpower.lain.retensi_pct': 99,
    });
    expect(settings.retensi_pct).toBe(10);
    expect(settings.jam_kerja).toBe('Senin–Jumat 08.00–16.00');
  });
  it('angka berupa string numerik diterima; rusak → default + peringatan', () => {
    expect(mergeSpkSettings({ [K('pph21_pct')]: '3' }).settings.pph21_pct).toBe(3);
    const { settings, peringatan } = mergeSpkSettings({ [K('retensi_hari')]: 'abc' });
    expect(settings.retensi_hari).toBe(30);
    expect(peringatan.join(' ')).toContain('retensi_hari');
  });
  it('null (default terdaftar) = pakai teks bawaan', () => {
    const { settings, peringatan } = mergeSpkSettings(spkDocDefaultsFlat());
    expect(settings.teks.tata_tertib_harian).toEqual(SPK_DEFAULTS.teks.tata_tertib_harian);
    expect(peringatan).toEqual([]);
  });
  it('nama penandatangan boleh dikosongkan (garis TTD kosong), jam_kerja kosong → default', () => {
    const { settings } = mergeSpkSettings({ [K('ttd_pm_nama')]: '', [K('jam_kerja')]: '' });
    expect(settings.ttd_pm_nama).toBe('');
    expect(settings.jam_kerja).toBe(SPK_DEFAULTS.jam_kerja);
  });
  it('daftar tata tertib valid (array/JSON string) menimpa; rusak → default + peringatan', () => {
    expect(mergeSpkSettings({ [K('tata_tertib_harian')]: ['Aturan baru'] }).settings.teks.tata_tertib_harian).toEqual(['Aturan baru']);
    expect(mergeSpkSettings({ [K('tata_tertib_harian')]: '["JSON string"]' }).settings.teks.tata_tertib_harian).toEqual(['JSON string']);
    const bad = mergeSpkSettings({ [K('tata_tertib_harian')]: '{rusak' });
    expect(bad.settings.teks.tata_tertib_harian).toEqual(SPK_DEFAULTS.teks.tata_tertib_harian);
    expect(bad.peringatan).toHaveLength(1);
  });
  it('klausul: kunci dikenal menimpa, tak dikenal diabaikan + peringatan', () => {
    const { settings, peringatan } = mergeSpkSettings({ [K('klausul')]: '{"pasal_VI":"Sengketa ke PN Cibinong.","ngawur":"x"}' });
    expect(settings.teks.pasal_VI).toBe('Sengketa ke PN Cibinong.');
    expect(peringatan.join(' ')).toContain('ngawur');
  });
  it('tidak mengubah SPK_DEFAULTS (tidak bocor antar panggilan)', () => {
    mergeSpkSettings({ [K('klausul')]: { pasal_VI: 'X' }, [K('retensi_pct')]: 99 });
    expect(SPK_DEFAULTS.teks.pasal_VI).toContain('musyawarah');
    expect(SPK_DEFAULTS.retensi_pct).toBe(5);
  });
  it('spkDocDefaultsFlat: semua kunci ber-namespace & nilai skalar = SPK_DEFAULTS', () => {
    const flat = spkDocDefaultsFlat();
    expect(Object.keys(flat).every((k) => k.startsWith('manpower.spk_doc.'))).toBe(true);
    expect(flat[K('retensi_pct')]).toBe(5);
    expect(flat[K('klausul')]).toBeNull();
  });
  it('setelan retensi tampil di dokumen', () => {
    const { settings } = mergeSpkSettings({ [K('retensi_pct')]: 7, [K('retensi_hari')]: 45 });
    const r = buildSpkDocument({ a: A_BORONGAN, mp: MP_IRPAN, pr: PR_MSAL, settings });
    expect(r.html).toContain('retensi sebesar 7% dari nilai kontrak dibayarkan 45 hari');
  });
});

describe('Versi tanpa harga (Syarat Manpower)', () => {
  const NOMINAL = /\bRp\b|\d{1,3}(\.\d{3})+/; // pola rupiah / angka ribuan ber-titik
  const A_BOR_BOCOR = { ...A_BORONGAN, rate_lembur: 25000, total_upah: 1234000, catatan: 'Bonus Rp 500.000 bila selesai cepat' };
  const bor = buildSpkDocument({ a: A_BOR_BOCOR, mp: MP_IRPAN, pr: PR_MSAL, settings: SPK_DEFAULTS, tanpaHarga: true });
  const har = buildSpkDocument({ a: { ...A_HARIAN, catatan: 'Uang kopi 20.000' }, mp: { nama: 'Sugeng Wijaya' }, pr: PR_WKP, settings: SPK_DEFAULTS, tanpaHarga: true });

  it('borongan: tidak ada nominal sama sekali di keluaran', () => {
    expect(bor.html).not.toMatch(NOMINAL);
    for (const x of ['8.163.000', '204.075', '7.958.925', '7.953.000', '33.000', '210.000', '500.000', '1.234.000', '25.000']) {
      expect(bor.html).not.toContain(x);
    }
    expect(bor.html).not.toContain('Harga Satuan');
    expect(bor.html).not.toContain('PPH 21');
    expect(bor.html).not.toContain('Jumlah (Rp)');
    expect(bor.hitung).toBeNull();
  });
  it('borongan: lingkup (qty+satuan) tetap tampil + watermark + pernyataan', () => {
    expect(bor.html).toContain('Lingkup Pekerjaan');
    expect(bor.html).toContain('Pekerjaan Epoxy Lantai 1000 micron');
    expect(bor.html).toContain('>241<');
    expect(bor.html).toContain('SYARAT & KETENTUAN — TANPA RINCIAN NILAI'.replace('&', '&amp;'));
    expect(bor.html).toContain('Dengan menandatangani dokumen ini');
    expect(bor.tanpaHarga).toBe(true);
  });
  it('borongan: pasal & tata tertib tetap utuh, retensi persen tetap ada', () => {
    for (const p of ['PASAL I ', 'PASAL IV ', 'PASAL VI ']) expect(bor.html).toContain(p);
    expect(bor.html).toContain('Tata Tertib Subcont');
    expect(bor.html).toContain('retensi sebesar 5% dari nilai kontrak');
    expect(bor.html).toContain('RUANG LINGKUP &amp; SYARAT PEMBAYARAN');
  });
  it('borongan tanpa borongan_items: 1 baris lingkup dari jenis pekerjaan', () => {
    const w = buildSpkDocument({ a: { ...A_BORONGAN, borongan_items: undefined }, mp: MP_IRPAN, pr: PR_MSAL, tanpaHarga: true });
    expect(w.html).toContain('Epoxy Lantai');
    expect(w.html).not.toMatch(NOMINAL);
  });
  it('harian: tanpa upah/makan/standby dan tanpa catatan bebas', () => {
    expect(har.html).not.toMatch(NOMINAL);
    for (const x of ['Upah Harian', 'Uang Makan', 'Uang Standby', '150.000', '30.000', '40.000', '20.000']) expect(har.html).not.toContain(x);
    expect(har.html).toContain('Pembayaran dilakukan 14 hari sekali di hari Jumat.'); // siklus ≠ nominal
    expect(har.html).toContain('Proyek selesai');
    expect(har.varian).toBe('harian');
  });
  it('varian tetap benar walau rate_tipe di-strip (borongan tetap Surat Tugas)', () => {
    expect(bor.varian).toBe('borongan');
    expect(bor.html).toContain('Surat Tugas');
  });
  it('mode lengkap tidak berubah (regresi): nominal & catatan tetap tampil', () => {
    const full = buildSpkDocument({ a: A_BOR_BOCOR, mp: MP_IRPAN, pr: PR_MSAL, settings: SPK_DEFAULTS });
    expect(full.html).toContain('8.163.000');
    expect(full.html).toContain('Bonus Rp 500.000');
    expect(full.html).not.toContain('TANPA RINCIAN NILAI');
  });
  it('TTD manpower tetap tampil di versi tanpa harga (pakta kru)', () => {
    const w = buildSpkDocument({ a: A_BORONGAN, mp: MP_IRPAN, pr: PR_MSAL, tanpaHarga: true, ttdImg: '<img alt="ttd-kru">' });
    expect(w.html).toContain('ttd-kru');
  });
  it('stripHargaAssignment: default-deny field uang, item tanpa harga, field non-uang utuh', () => {
    const s = stripHargaAssignment({
      id: 7, jabatan: 'Helper', nomor_spk: 'X', rate_tipe: 'harian', rate_harian: 1, rate_uang_makan: 2, rate_standby: 3,
      nilai_borongan: 4, total_upah: 5, borongan_total_paid: 6, borongan_outstanding: 7, catatan: 'Rp 9',
      borongan_items: [{ deskripsi: 'a', qty: 2, satuan: 'm2', harga_satuan: 99, harga: 98 }],
    });
    expect(Object.keys(s).sort()).toEqual(['borongan_items', 'id', 'jabatan', 'nomor_spk']);
    expect(s.borongan_items).toEqual([{ deskripsi: 'a', qty: 2, satuan: 'm2' }]);
    expect(JSON.stringify(s)).not.toMatch(/harga|99|98/);
  });
  it('stripHargaAssignment tidak memutasi input & aman untuk null', () => {
    const a = { rate_harian: 5, borongan_items: [{ deskripsi: 'a', qty: 1, harga_satuan: 2 }] };
    stripHargaAssignment(a);
    expect(a.rate_harian).toBe(5);
    expect(a.borongan_items[0].harga_satuan).toBe(2);
    expect(stripHargaAssignment(null)).toEqual({});
  });
});

describe('SPK Harian / perorangan berpasal (bawaan)', () => {
  const r = buildSpkDocument({ a: { ...A_HARIAN, tanggal_selesai: '2026-11-30' }, mp: { nama: 'Yora Hidayat', NIK: '3203080107910189', no_telpon: '85759580881' }, pr: { ...PR_WKP, nomor_po: '6201008521/2026/08/11' }, settings: { ...SPK_DEFAULTS, ttd_pm_nama: 'Anwar Hidayat' } });
  it('berformat berpasal secara bawaan: Pihak Pertama/Kedua + Pasal I–VI + lampiran tata tertib', () => {
    for (const p of ['PASAL I ', 'PASAL II ', 'PASAL III ', 'PASAL IV ', 'PASAL V ', 'PASAL VI ']) expect(r.html).toContain(p);
    expect(r.html).toContain('PIHAK PERTAMA');
    expect(r.html).toContain('PIHAK KEDUA');
    expect(r.html).toContain('Anwar Hidayat');
    expect(r.html).toContain('Ketentuan Kerja &amp; Tata Tertib');
    expect(r.html).toContain('3203080107910189');
  });
  it('Pasal I: tenaga harian + pekerjaan/proyek/PO dari data (bukan "Pemborong")', () => {
    expect(r.html).toContain('Tenaga Kerja Harian');
    expect(r.html).not.toContain('(Pemborong)');
    expect(r.html).toContain('PO 6201008521/2026/08/11');
  });
  it('Pasal III memuat upah harian/makan/standby dan siklus bayar; Pasal IV memuat periode', () => {
    expect(r.html).toContain('Rp 150.000');
    expect(r.html).toContain('Rp 30.000');
    expect(r.html).toContain('Rp 40.000');
    expect(r.html).toContain('Pembayaran dilakukan 14 hari sekali di hari Jumat.');
    expect(r.html).toContain('Periode kerja: 7 Oktober 2026 s/d 30 November 2026.');
  });
  it('periode terbuka tetap "s/d Proyek selesai"; rujukan jam kerja menunjuk ayat yang benar', () => {
    const o = buildSpkDocument({ a: A_HARIAN, mp: { nama: 'X' }, pr: PR_WKP });
    expect(o.html).toContain('s/d Proyek selesai');
    expect(o.html).toContain('Pasal IV ayat (3)'); // periode(1), kontrak berakhir(2), jam kerja(3)
  });
  it('kewajiban 4 butir + tata tertib 5 butir + 4 blok TTD tetap ada; tak ada placeholder tersisa', () => {
    expect(r.html).toContain('Melaksanakan pekerjaan sesuai instruksi Project Leader.');
    expect(r.html).toContain('smoking area');
    for (const role of ['Project Admin', 'Project Manager', 'Direktur']) expect(r.html).toContain(role);
    expect(r.html).not.toMatch(/\{[a-z_]+\}/);
  });
  it('versi tanpa harga: berpasal tanpa nominal sama sekali + watermark + pernyataan', () => {
    const k = buildSpkDocument({ a: { ...A_HARIAN, catatan: 'Uang kopi 20.000' }, mp: { nama: 'Yora' }, pr: PR_WKP, tanpaHarga: true });
    expect(k.html).toContain('PASAL III (SYARAT PEMBAYARAN)');
    expect(k.html).toContain('TANPA RINCIAN NILAI');
    expect(k.html).not.toMatch(/\bRp\b|\d{1,3}(\.\d{3})+/);
    for (const x of ['150.000', '30.000', '40.000', '20.000']) expect(k.html).not.toContain(x);
  });
  it('teks Pasal I & syarat bayar harian dapat ditimpa lewat setelan; kode versi berubah', () => {
    const { settings } = mergeSpkSettings({ 'manpower.spk_doc.klausul': { syarat_bayar_harian: ['Dibayar setiap minggu.'] } });
    const k = buildSpkDocument({ a: A_HARIAN, mp: { nama: 'X' }, pr: PR_WKP, settings });
    expect(k.html).toContain('Dibayar setiap minggu.');
    expect(k.kodeVersi).not.toBe(r.kodeVersi);
  });
  it('mergeSpkSettings: saklar harian_dengan_pasal dibaca (false/"false" → ringkas)', () => {
    expect(mergeSpkSettings({ 'manpower.spk_doc.harian_dengan_pasal': false }).settings.harian_dengan_pasal).toBe(false);
    expect(mergeSpkSettings({ 'manpower.spk_doc.harian_dengan_pasal': 'false' }).settings.harian_dengan_pasal).toBe(false);
    expect(mergeSpkSettings({}).settings.harian_dengan_pasal).toBe(true);
  });
});
