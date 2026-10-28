// src/lib/services/kategoriGuess.test.ts
// Fase 4 (Pos Keuangan, Kategori Operasional & Audit Expense Proyek v2 TAJAM, 28 Sep 2026)
// §5 F4.2 — audit Fase 0 menemukan aturan `safety` & `consumable` menunjuk kode yang TIDAK
// ADA di budget_category_config live (kode sah: `hse_apd`; `consumable` baru dibuat sbg
// baris tersendiri di F4), jadi kedua aturan itu tidak pernah cocok sejak awal.
import { describe, it, expect } from 'vitest';
import { guessKategoriBelanja } from './kategoriGuess';

const ALLOWED = [
	'bbm_transport', 'gaji_manpower', 'sewa_alat', 'material_supplier', 'subkon_jasa',
	'hse_apd', 'consumable', 'hr_ga_atk'
];

describe('guessKategoriBelanja — fallback RULES (bug lama)', () => {
	it('teks safety/APD -> hse_apd (dulu kode "safety" tak pernah ada di budget_category_config)', () => {
		expect(guessKategoriBelanja('beli helm dan sarung tangan safety', ALLOWED)).toBe('hse_apd');
	});

	it('teks consumable -> consumable (baru sah sbg kode kategori di Fase 4)', () => {
		expect(guessKategoriBelanja('beli majun dan lakban', ALLOWED)).toBe('consumable');
	});

	it('kode "safety" lama TIDAK BOLEH muncul lagi sbg hasil tebakan', () => {
		const result = guessKategoriBelanja('helm safety k3', ALLOWED);
		expect(result).not.toBe('safety');
	});

	it('teks kosong/pendek -> null', () => {
		expect(guessKategoriBelanja('', ALLOWED)).toBeNull();
		expect(guessKategoriBelanja('ab', ALLOWED)).toBeNull();
	});

	it('kode hasil tebakan difilter oleh allowedKodes', () => {
		// 'hse_apd' cocok tapi tidak ada di daftar allowed -> null (bukan dipaksakan)
		expect(guessKategoriBelanja('beli helm safety', ['bbm_transport'])).toBeNull();
	});
});

describe('guessKategoriBelanja — dynamic rules dari clue_keywords live (F4.2)', () => {
	const categories = [
		{ kode: 'ops_akomodasi', clue_keywords: ['mess', 'kos', 'token listrik', 'pdam'] },
		{ kode: 'ops_konsumsi', clue_keywords: ['uang makan', 'galon', 'lembur'] },
		{ kode: 'consumable', clue_keywords: ['consumable', 'majun', 'lakban'] }
	];
	const allowedWithSubs = [...ALLOWED, 'ops_akomodasi', 'ops_konsumsi'];

	it('clue_keywords live mengenali kategori baru yang tidak ada di RULES hardcode', () => {
		expect(guessKategoriBelanja('bayar sewa kos pekerja bulan ini', allowedWithSubs, categories)).toBe('ops_akomodasi');
		expect(guessKategoriBelanja('uang makan harian tim lapangan', allowedWithSubs, categories)).toBe('ops_konsumsi');
	});

	it('kategori tanpa clue_keywords di parameter categories tetap jatuh ke RULES fallback', () => {
		// 'hse_apd' tidak ada di array `categories` test ini -> harus tetap match via RULES
		expect(guessKategoriBelanja('beli helm safety', allowedWithSubs, categories)).toBe('hse_apd');
	});

	it('categories kosong (parameter opsional tak dikirim) -> perilaku identik dgn sebelum F4.2', () => {
		expect(guessKategoriBelanja('beli majun', ALLOWED)).toBe('consumable');
	});

	it('kata kunci multi-kata (mis. "uang makan") tetap match sbg frasa utuh', () => {
		expect(guessKategoriBelanja('klaim uang makan lembur', allowedWithSubs, categories)).toBe('ops_konsumsi');
	});
});
