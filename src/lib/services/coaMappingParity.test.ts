// Rekonsiliasi CoA `sewa_alat` (implementation_plan Pertajam Rental Order v2, Fase 0 §7.5 R4).
// `sewa_alat` sempat terbelah 2 akun berlawanan makna di 3 salinan manual (erp-epi
// RAB_COA_MAPPING, projectAktualisasiApi.ts, finance.ts). Nilai resminya 5130-013
// (Biaya Penyusutan Peralatan Proyek, HPP proyek) — BUKAN 6141-005 (Biaya Sewa non-proyek,
// yang lama dipakai finance.ts). Cermin dari coaMappingParity.test.js di erp-epi-1
// (tidak bisa import lintas repo) — keduanya HARUS diperbarui bersamaan bila kode berubah.
//
//   node --test src/lib/services/coaMappingParity.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { RAB_COA_MAPPING } from './rabCoaMapping.ts';
import { COA_MAP, resolveCoaForFieldItem } from './financeCoaMap.ts';

const SEWA_ALAT_COA_RESMI = '5130-013';
const SEWA_VENDOR_COA_RESMI = '5130-015'; // Fase 0 R3 / Fase 4 — sewa DARI vendor, beda dari sewa_alat

test('projectAktualisasiApi RAB_COA_MAPPING.sewa_alat menunjuk akun resmi', () => {
	assert.equal(RAB_COA_MAPPING.sewa_alat.debit, SEWA_ALAT_COA_RESMI);
});

test('finance.ts COA_MAP.sewa_alat menunjuk akun resmi', () => {
	assert.equal(COA_MAP.sewa_alat, SEWA_ALAT_COA_RESMI);
});

test('finance.ts resolveCoaForFieldItem(kategoriBelanja=sewa_alat) menunjuk akun resmi', () => {
	assert.equal(resolveCoaForFieldItem({}, 'sewa_alat'), SEWA_ALAT_COA_RESMI);
});

test('RAB_COA_MAPPING.sewa_vendor & COA_MAP.sewa_vendor menunjuk akun resmi, beda dari sewa_alat', () => {
	assert.equal(RAB_COA_MAPPING.sewa_vendor.debit, SEWA_VENDOR_COA_RESMI);
	assert.equal(COA_MAP.sewa_vendor, SEWA_VENDOR_COA_RESMI);
	assert.equal(resolveCoaForFieldItem({}, 'sewa_vendor'), SEWA_VENDOR_COA_RESMI);
	assert.notEqual(SEWA_VENDOR_COA_RESMI, SEWA_ALAT_COA_RESMI);
});

test('resolveCoaForFieldItem menyelesaikan berbagai kategori belanja dan fallback dengan tepat', () => {
	// Account code bawaan item diutamakan
	assert.equal(resolveCoaForFieldItem({ account_code: '1234-567' }, 'sewa_alat'), '1234-567');
	// Kategori belanja khusus
	assert.equal(resolveCoaForFieldItem({}, 'gaji_manpower'), '6131-001');
	assert.equal(resolveCoaForFieldItem({}, 'material_supplier'), '5110-001');
	assert.equal(resolveCoaForFieldItem({}, 'bbm_transport'), '6141-013');
	// Kategori item dari COA_MAP
	assert.equal(resolveCoaForFieldItem({ kategori_item: 'operasional' }), '5100013');
	assert.equal(resolveCoaForFieldItem({ kategori_item: 'consumable' }), '6161-001');
	assert.equal(resolveCoaForFieldItem({ kategori_item: 'safety' }), '6161-003');
	// Fallback ke lain_lain
	assert.equal(resolveCoaForFieldItem({}), '6141-022');
	assert.equal(resolveCoaForFieldItem({ kategori_item: 'unknown' }), '6141-022');
});

