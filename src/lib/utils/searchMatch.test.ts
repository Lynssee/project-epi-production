import { describe, it, expect } from 'vitest';
import {
	normalizeText,
	tokenize,
	levenshteinDistance,
	scoreNavEntry,
	expandTokensWithSynonyms,
	type NavSearchEntry
} from './searchMatch';

describe('searchMatch for project-epi', () => {
	it('normalizes degrees, punctuation, and extra whitespace', () => {
		expect(normalizeText('Equipment 360°')).toBe('equipment 360');
		expect(normalizeText('Ceklist / P2H (Harian)')).toBe('ceklist p2h harian');
	});

	it('calculates levenshtein distance for typo tolerance', () => {
		expect(levenshteinDistance('inentory', 'inventory')).toBe(1);
		expect(levenshteinDistance('ceklis', 'ceklist')).toBe(1);
		expect(levenshteinDistance('lapran', 'laporan')).toBe(1);
	});

	it('matches title exact or startsWith with highest score', () => {
		const entry: NavSearchEntry = {
			title: 'Absensi Masuk / Pulang',
			parent: 'Portal Karyawan',
			href: '/ess/absen',
			keywords: 'clock in clock out kehadiran'
		};
		const tokens = tokenize('Absensi');
		const expanded = expandTokensWithSynonyms(tokens);
		const score = scoreNavEntry(entry, 'Absensi', tokens, expanded);
		expect(score).toBeGreaterThanOrEqual(85);
	});

	it('finds menu with typo tolerance (e.g. "lapran harian" -> Laporan Harian)', () => {
		const entry: NavSearchEntry = {
			title: 'Laporan Harian Proyek',
			parent: 'Project Lapangan',
			href: '/laporan',
			keywords: 'daily report progress cuaca'
		};
		const tokens = tokenize('lapran harian');
		const expanded = expandTokensWithSynonyms(tokens);
		const score = scoreNavEntry(entry, 'lapran harian', tokens, expanded);
		expect(score).toBeGreaterThan(0);
	});

	it('finds menu using operational synonyms (e.g. "gudang" -> Stok Lapangan)', () => {
		const entry: NavSearchEntry = {
			title: 'Stok Lapangan & Sparepart',
			parent: 'Barang & Logistik',
			href: '/stock-lapangan',
			keywords: 'persediaan saldo barang site'
		};
		const tokens = tokenize('gudang');
		const expanded = expandTokensWithSynonyms(tokens);
		const score = scoreNavEntry(entry, 'gudang', tokens, expanded);
		expect(score).toBeGreaterThan(0);
	});

	it('finds equipment checklist using synonyms (e.g. "alat")', () => {
		const entry: NavSearchEntry = {
			title: 'Preventive Maintenance & P2H',
			parent: 'Maintenance',
			href: '/preventive',
			keywords: 'alat berat mesin kompresor p2h'
		};
		const tokens = tokenize('alat');
		const expanded = expandTokensWithSynonyms(tokens);
		const score = scoreNavEntry(entry, 'alat', tokens, expanded);
		expect(score).toBeGreaterThan(0);
	});
});
