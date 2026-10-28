// Fase 6, Rencana Pertajam Rental Order v2 §9.2 L3 — countdown "alat sewa harus kembali dalam
// N hari" di homepage & halaman "Alat Sewa di Site Saya". Uji fungsi PURE saja (tidak fetch).
//
//   node --test src/lib/services/sewaAlatLapanganApi.hitungHariTersisa.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { hitungHariTersisa } from './sewaAlatLapanganApi.ts';

test('end_date besok -> 1 hari tersisa', () => {
	const besok = new Date();
	besok.setDate(besok.getDate() + 1);
	assert.equal(hitungHariTersisa(besok.toISOString().slice(0, 10)), 1);
});

test('end_date hari ini -> 0 hari tersisa', () => {
	const hariIni = new Date().toISOString().slice(0, 10);
	assert.equal(hitungHariTersisa(hariIni), 0);
});

test('end_date kemarin -> negatif (sudah lewat tenggat)', () => {
	const kemarin = new Date();
	kemarin.setDate(kemarin.getDate() - 3);
	assert.equal(hitungHariTersisa(kemarin.toISOString().slice(0, 10)), -3);
});

test('end_date null/kosong/tidak valid -> null, tidak error', () => {
	assert.equal(hitungHariTersisa(null), null);
	assert.equal(hitungHariTersisa(''), null);
	assert.equal(hitungHariTersisa('bukan-tanggal'), null);
});
