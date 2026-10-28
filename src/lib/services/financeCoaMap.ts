// Mapping COA sama persis dengan RAB_COA_MAPPING di erp-epi-1 (suratJalanApi.js) & rabCoaMapping.ts
// — TIDAK bisa di-import lintas repo/modul asal, jadi disalin manual (keputusan user 16 Sep 2026:
// kategori dinamis, COA tetap 3 salinan manual). Diletakkan di file tersendiri TANPA import lain
// supaya bisa diuji langsung dengan `node --test` tanpa menyeret runtime SvelteKit/Firebase yang
// dipakai finance.ts (lihat coaMappingParity.test.ts).
export const COA_MAP: Record<string, string> = {
	operasional: '5100013',
	supplier: '5110-001',
	jasa: '5100013',
	sewa_alat: '5130-013', // Biaya Penyusutan Peralatan Proyek (selaras rabCoaMapping.ts & erp-epi RAB_COA_MAPPING)
	sewa_vendor: '5130-015', // Biaya Sewa Alat & Mesin Proyek (sewa DARI vendor, beda dari sewa_alat) — Fase 0 R3
	consumable: '6161-001',
	safety: '6161-003',
	lain_lain: '6141-022'
};

export function resolveCoaForFieldItem(item: any, kategoriBelanja?: string | null): string {
	if (item.account_code) return item.account_code;
	if (kategoriBelanja === 'gaji_manpower') return '6131-001';
	if (kategoriBelanja === 'material_supplier') return '5110-001';
	if (kategoriBelanja === 'bbm_transport') return '6141-013';
	if (kategoriBelanja === 'sewa_alat') return '5130-013';
	if (kategoriBelanja === 'sewa_vendor') return '5130-015';
	if (item.kategori_item && COA_MAP[item.kategori_item]) return COA_MAP[item.kategori_item];
	return '6141-022';
}
