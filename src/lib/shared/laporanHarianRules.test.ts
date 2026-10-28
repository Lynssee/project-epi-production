// Unit test murni untuk evaluateLaporanHarianRules — tanpa framework tambahan, pakai test
// runner bawaan Node (`node --test`), konsisten dengan gateModeResolver.test.ts.
//
//   node --test src/lib/shared/laporanHarianRules.test.ts
//
// Salinan dari erp-epi-1/src/lib/shared/laporanHarianRules.test.js (vitest) — assersi
// sama, cuma dipindah ke node:test. Lihat juga laporanHarianRules.contract.test.ts untuk
// pembuktian gate_key kedua repo identik.

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLaporanHarianRules, LAPORAN_HARIAN_GATE_KEYS } from './laporanHarianRules.ts';

function baseSnapshot(overrides: Record<string, any> = {}) {
	return {
		date: '2026-09-16', // Rabu
		activity_status: 'on progress',
		karyawan_id: 42,
		weather: 'Cerah',
		manpower_count: 5,
		general_notes: 'Catatan umum hari ini cukup panjang',
		issues_general: 'Tidak ada kendala berarti',
		tomorrow_plan_summary: 'Lanjut pengecoran',
		schedule: [{ activity: 'Pengecoran', start_time: '08:00', end_time: '12:00', status: 'done' }],
		tomorrow_plan: [{ activity: 'Pengecoran lantai 2', notes: 'siap material' }],
		progress: [{ subtask_id: 'sub-1', activity: 'Pengecoran', progress_value: 40, notes: 'progress sesuai jadwal hari ini', foto_bukti: ['file-progress-1'] }],
		progress_photos: ['file1'],
		material_used: [{ type: 'Semen', amount: 10, unit: 'sak' }],
		manpower: [{ role: 'Tukang', count: 3, workers: [{ id: 1, nama: 'A' }] }],
		attendance_photos: ['file2'],
		toolbox_photos: ['file3'],
		area_kerja_photos: ['file4'],
		issue_photos: ['file5'],
		hse_daily: { apd_compliance: 'lengkap' },
		...overrides
	};
}

test('semua gate WAJIB passed untuk snapshot lengkap', () => {
	const { gates, score } = evaluateLaporanHarianRules(baseSnapshot());
	const failed = gates.filter((g) => g.status === 'failed');
	assert.deepEqual(failed, []);
	assert.equal(score, 100);
});

test('gate yang dihasilkan sesuai LAPORAN_HARIAN_GATE_KEYS', () => {
	const { gates } = evaluateLaporanHarianRules(baseSnapshot());
	const keys = new Set(gates.map((g) => g.gate_key));
	assert.deepEqual(keys, new Set(LAPORAN_HARIAN_GATE_KEYS));
});

test('Tingkat A — gagal kalau schedule kosong (bukan Hold)', () => {
	const { gates } = evaluateLaporanHarianRules(baseSnapshot({ schedule: [] }));
	assert.equal(gates.find((g) => g.gate_key === 'G_LH_JADWAL')?.status, 'failed');
});

test('weekend gate not_applicable di hari kerja biasa, wajib di hari Jumat', () => {
	const rabu = evaluateLaporanHarianRules(baseSnapshot({ date: '2026-09-16' }));
	assert.equal(rabu.gates.find((g) => g.gate_key === 'G_WEEKEND_RECAP')?.status, 'not_applicable');

	const jumat = evaluateLaporanHarianRules(baseSnapshot({ date: '2026-09-18', weekend_location_recap: '', weekend_photos: [] }));
	assert.equal(jumat.gates.find((g) => g.gate_key === 'G_WEEKEND_RECAP')?.status, 'failed');
	assert.equal(jumat.gates.find((g) => g.gate_key === 'G_WEEKEND_FOTO')?.status, 'failed');
});

test('Tingkat B — gagal kalau narasi umum kosong (menutup C3)', () => {
	const { gates } = evaluateLaporanHarianRules(baseSnapshot({ general_notes: '', issues_general: '', tomorrow_plan_summary: '' }));
	assert.equal(gates.find((g) => g.gate_key === 'G_LH_CATATAN_UMUM')?.status, 'failed');
	assert.equal(gates.find((g) => g.gate_key === 'G_LH_KENDALA_UMUM')?.status, 'failed');
	assert.equal(gates.find((g) => g.gate_key === 'G_LH_RENCANA_BESOK_RINGKASAN')?.status, 'failed');
});

test('G_LH_PROGRESS_CATATAN wajib untuk SEMUA baris, bukan hanya yang berubah', () => {
	const { gates } = evaluateLaporanHarianRules(baseSnapshot({
		progress: [
			{ subtask_id: 'sub-1', progress_value: 40, notes: 'catatan panjang cukup' },
			{ subtask_id: 'sub-2', progress_value: 20, notes: '' }
		]
	}));
	const g = gates.find((g) => g.gate_key === 'G_LH_PROGRESS_CATATAN');
	assert.equal(g?.status, 'failed');
	assert.match(g?.message || '', /1 baris/);
});

test('G_LH_PROGRESS_FOTO_PER_ITEM (WAJIB) gagal kalau ada baris tanpa foto_bukti, not_applicable kalau progress kosong', () => {
	const kosong = evaluateLaporanHarianRules(baseSnapshot({ progress: [] }));
	assert.equal(kosong.gates.find((g) => g.gate_key === 'G_LH_PROGRESS_FOTO_PER_ITEM')?.status, 'not_applicable');

	const { gates } = evaluateLaporanHarianRules(baseSnapshot({
		progress: [
			{ subtask_id: 'sub-1', notes: 'catatan panjang cukup', foto_bukti: ['file-1'] },
			{ subtask_id: 'sub-2', activity: 'Pengecatan', progress_value: 20, notes: 'catatan panjang cukup juga', foto_bukti: [] }
		]
	}));
	const g = gates.find((g) => g.gate_key === 'G_LH_PROGRESS_FOTO_PER_ITEM');
	assert.equal(g?.status, 'failed');
	assert.equal(g?.severity, 'WAJIB');
	assert.match(g?.message || '', /1 baris/);
});

test('status Hold: tab jadwal/progress/material jadi not_applicable, tenaga & foto absensi tetap wajib', () => {
	const { gates } = evaluateLaporanHarianRules(baseSnapshot({
		activity_status: 'hold',
		schedule: [], tomorrow_plan: [], progress: [], material_used: [],
		weather: '', manpower_count: null, general_notes: '', issues_general: '', tomorrow_plan_summary: '',
		hold_reason: '', attendance_photos: []
	}));
	for (const key of ['G_LH_JADWAL', 'G_LH_RENCANA_BESOK', 'G_LH_PROGRESS', 'G_LH_FOTO_PROGRESS', 'G_LH_MATERIAL_TERPAKAI', 'G_LH_CUACA', 'G_LH_JML_TENAGA', 'G_LH_CATATAN_UMUM', 'G_LH_KENDALA_UMUM', 'G_LH_RENCANA_BESOK_RINGKASAN']) {
		assert.equal(gates.find((g) => g.gate_key === key)?.status, 'not_applicable', `${key} harus not_applicable saat Hold`);
	}
	assert.equal(gates.find((g) => g.gate_key === 'G_LH_HOLD_ALASAN')?.status, 'failed');
	assert.equal(gates.find((g) => g.gate_key === 'G_LH_HOLD_FOTO_STANDBY')?.status, 'failed');
});

test('status Hold dengan alasan cukup panjang + foto standby lolos G_LH_HOLD_*', () => {
	const { gates } = evaluateLaporanHarianRules(baseSnapshot({
		activity_status: 'hold', hold_reason: 'Menunggu izin dari pemilik lahan sebelah', attendance_photos: ['file-standby']
	}));
	assert.equal(gates.find((g) => g.gate_key === 'G_LH_HOLD_ALASAN')?.status, 'passed');
	assert.equal(gates.find((g) => g.gate_key === 'G_LH_HOLD_FOTO_STANDBY')?.status, 'passed');
});

test('Fase 1 foto: G_LH_FOTO_TOOLBOX gagal (WARN) kalau kosong, G_LH_FOTO_AREA_KERJA not_applicable saat Hold', () => {
	const { gates } = evaluateLaporanHarianRules(baseSnapshot({ toolbox_photos: [] }));
	const toolbox = gates.find((g) => g.gate_key === 'G_LH_FOTO_TOOLBOX');
	assert.equal(toolbox?.status, 'failed');
	assert.equal(toolbox?.severity, 'WAJIB');

	const hold = evaluateLaporanHarianRules(baseSnapshot({
		activity_status: 'hold', schedule: [], tomorrow_plan: [], progress: [], material_used: [],
		hold_reason: 'Menunggu izin dari pemilik lahan sebelah', area_kerja_photos: []
	}));
	assert.equal(hold.gates.find((g) => g.gate_key === 'G_LH_FOTO_AREA_KERJA')?.status, 'not_applicable');
});

test('G_LH_FOTO_KENDALA not_applicable kalau kendala kosong, failed (WARN) kalau kendala terisi tanpa foto', () => {
	const kosong = evaluateLaporanHarianRules(baseSnapshot({ issues_general: '', issue_photos: [] }));
	assert.equal(kosong.gates.find((g) => g.gate_key === 'G_LH_FOTO_KENDALA')?.status, 'not_applicable');

	const tanpaFoto = evaluateLaporanHarianRules(baseSnapshot({ issue_photos: [] }));
	const g = tanpaFoto.gates.find((g) => g.gate_key === 'G_LH_FOTO_KENDALA');
	assert.equal(g?.status, 'failed');
	assert.equal(g?.severity, 'WAJIB');
});

test('G_LH_ANTI_SALIN not_applicable tanpa previousReport, failed (WARN) kalau narasi identik', () => {
	const noPrev = evaluateLaporanHarianRules(baseSnapshot());
	assert.equal(noPrev.gates.find((g) => g.gate_key === 'G_LH_ANTI_SALIN')?.status, 'not_applicable');

	const prev = { general_notes: 'Catatan umum hari ini cukup panjang', issues_general: 'beda', tomorrow_plan_summary: 'beda juga' };
	const withPrev = evaluateLaporanHarianRules(baseSnapshot(), { previousReport: prev });
	const g = withPrev.gates.find((g) => g.gate_key === 'G_LH_ANTI_SALIN');
	assert.equal(g?.status, 'failed');
	assert.equal(g?.severity, 'WARN');
});
