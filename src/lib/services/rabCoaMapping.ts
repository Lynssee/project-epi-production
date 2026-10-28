// Mapping COA sama persis dengan RAB_COA_MAPPING di erp-epi-1 (suratJalanApi.js) — TIDAK bisa
// di-import lintas repo, jadi disalin manual (keputusan user 16 Sep 2026: kategori dinamis,
// COA tetap 3 salinan manual seperti sekarang — lihat catatan di projectAktualisasiApi.ts).
// Diletakkan di file tersendiri TANPA import lain supaya bisa diuji langsung dengan
// `node --test` tanpa menyeret runtime SvelteKit/Firebase (lihat coaMappingParity.test.ts).
export const RAB_COA_MAPPING: Record<string, { debit: string; credit: string; debitName: string; creditName: string }> = {
  supplier: { debit: '5100001', credit: '1131-001', debitName: 'Harga Pokok Proyek', creditName: 'Persediaan Bahan Baku - Produksi' },
  consumable: { debit: '6161-001', credit: '1131-002', debitName: 'Biaya Pembelian Barang Sekali Pakai', creditName: 'Persediaan Consumable Produksi' },
  jasa: { debit: '5100011', credit: '2120000', debitName: 'Upah Kerja Proyek', creditName: 'Utang Biaya' },
  operasional: { debit: '5100013', credit: '1111-002', debitName: 'Biaya Operasional Proyek', creditName: 'Kas Kecil Project' },
  sewa_alat: { debit: '5130-013', credit: '2120000', debitName: 'Biaya Penyusutan Peralatan Proyek', creditName: 'Utang Biaya' },
  // Fase 0 R3 / Fase 4, Rencana Pertajam Rental Order v2 — sewa alat DARI VENDOR (rental_in),
  // BEDA dari sewa_alat (alat milik sendiri). Selaras erp-epi rabCoaMapping.js.
  sewa_vendor: { debit: '5130-015', credit: '2120000', debitName: 'Biaya Sewa Alat & Mesin Proyek', creditName: 'Utang Biaya' },
  lain_lain: { debit: '8120000', credit: '1131-001', debitName: 'Biaya lainnya', creditName: 'Persediaan Bahan Baku - Produksi' },
  man_power: { debit: '5100011', credit: '2120000', debitName: 'Upah Kerja Proyek', creditName: 'Utang Biaya' },
  safety: { debit: '6161-001', credit: '1131-002', debitName: 'Biaya Pembelian Barang Sekali Pakai', creditName: 'Persediaan Consumable Produksi' }
};
