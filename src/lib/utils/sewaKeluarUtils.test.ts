// Real Profit R1 — Log Sewa Keluar. Uji fungsi PURE saja (tidak fetch).
//
//   node --test src/lib/utils/sewaKeluarUtils.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNum, validateTimesheet, sisaJamPaket } from './sewaKeluarUtils.ts';

const CTX = { lastHourMeter: 1200, hariIni: '2026-10-05' };

test('parseNum: kosong/null → null (bukan 0), koma desimal diterima, bukan angka → null', () => {
	assert.equal(parseNum(''), null);
	assert.equal(parseNum(null), null);
	assert.equal(parseNum('12,5'), 12.5);
	assert.equal(parseNum(0), 0);
	assert.equal(parseNum('abc'), null);
});

test('entri valid minimal (hanya tanggal) lolos', () => {
	assert.deepEqual(validateTimesheet({ tanggal: '2026-10-05' }, CTX), []);
});

test('entri lengkap valid lolos', () => {
	assert.deepEqual(
		validateTimesheet({ tanggal: '2026-10-04', jam_mulai: '08:00', jam_selesai: '16:30', hour_meter_reading: 1208.5, overtime_hours: 1.5, bbm_liter: 40, bbm_rp: 600000 }, CTX),
		[]
	);
});

test('tanggal wajib & tidak boleh di masa depan', () => {
	assert.match(validateTimesheet({ tanggal: '' }, CTX)[0], /Tanggal wajib/);
	assert.match(validateTimesheet({ tanggal: '2026-10-06' }, CTX)[0], /masa depan/);
});

test('jam selesai harus setelah jam mulai; format jam tak valid ditolak', () => {
	assert.match(validateTimesheet({ tanggal: '2026-10-05', jam_mulai: '16:00', jam_selesai: '08:00' }, CTX).join(' '), /setelah jam mulai/);
	assert.match(validateTimesheet({ tanggal: '2026-10-05', jam_mulai: '8.00' }, CTX).join(' '), /jam mulai tidak valid/);
});

test('hour meter tidak boleh mundur dari catatan sebelumnya; sama dengan boleh', () => {
	assert.match(validateTimesheet({ tanggal: '2026-10-05', hour_meter_reading: 1100 }, CTX).join(' '), /lebih kecil dari catatan sebelumnya \(1200\)/);
	assert.deepEqual(validateTimesheet({ tanggal: '2026-10-05', hour_meter_reading: 1200 }, CTX), []);
	assert.deepEqual(validateTimesheet({ tanggal: '2026-10-05', hour_meter_reading: 5 }, { ...CTX, lastHourMeter: null }), []);
	assert.match(validateTimesheet({ tanggal: '2026-10-05', hour_meter_reading: -1 }, CTX).join(' '), /negatif/);
});

test('lembur 0–24; BBM: liter wajar, Rp tidak negatif, Rp butuh liter', () => {
	assert.match(validateTimesheet({ tanggal: '2026-10-05', overtime_hours: 30 }, CTX).join(' '), /lembur/);
	assert.match(validateTimesheet({ tanggal: '2026-10-05', bbm_liter: 5000 }, CTX).join(' '), /tidak wajar/);
	assert.match(validateTimesheet({ tanggal: '2026-10-05', bbm_rp: -1 }, CTX).join(' '), /negatif/);
	assert.match(validateTimesheet({ tanggal: '2026-10-05', bbm_rp: 100000 }, CTX).join(' '), /liter solar/);
	assert.deepEqual(validateTimesheet({ tanggal: '2026-10-05', bbm_liter: 20 }, CTX), []); // liter saja boleh
});

test('sisaJamPaket: terpakai = pembacaan − baseline; status aman/mendekati/habis', () => {
	assert.deepEqual(sisaJamPaket(1000, 200, 1050), { terpakai: 50, sisa: 150, pct: 25, status: 'aman' });
	assert.equal(sisaJamPaket(1000, 200, 1170)!.status, 'mendekati'); // sisa 30 ≤ 20%
	assert.equal(sisaJamPaket(1000, 200, 1200)!.status, 'habis');
	assert.equal(sisaJamPaket(1000, 200, 1250)!.sisa, -50);
});

test('sisaJamPaket: batas kosong → null; belum ada pembacaan → terpakai 0; baseline kosong → 0', () => {
	assert.equal(sisaJamPaket(1000, null, 1100), null);
	assert.equal(sisaJamPaket(1000, 0, 1100), null);
	assert.equal(sisaJamPaket(1000, 200, null)!.terpakai, 0);
	assert.equal(sisaJamPaket(null, 200, 50)!.terpakai, 50);
});
