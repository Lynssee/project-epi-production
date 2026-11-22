import { describe, it, expect } from 'vitest';
import { normalizeMisi, normalizePerilaku, normalizeNilai } from './budaya';

describe('budaya (server)', () => {
	it('normalizeMisi: array, JSON string, teks per-baris, null', () => {
		expect(normalizeMisi(['A', ' ', '2) B'])).toEqual(['A', 'B']);
		expect(normalizeMisi('["X","Y"]')).toEqual(['X', 'Y']);
		expect(normalizeMisi('- satu\n• dua')).toEqual(['satu', 'dua']);
		expect(normalizeMisi(null)).toEqual([]);
	});
	it('normalizePerilaku aman untuk input rusak', () => {
		expect(normalizePerilaku('{"do":["a"],"dont":[" "]}')).toEqual({ do: ['a'], dont: [] });
		expect(normalizePerilaku('rusak')).toEqual({ do: [], dont: [] });
		expect(normalizePerilaku(undefined)).toEqual({ do: [], dont: [] });
	});
	it('normalizeNilai: buang nonaktif/tanpa judul, urutkan, validasi warna', () => {
		const out = normalizeNilai([
			{ id: 2, judul: 'B', urutan: 20, warna: '#112233' },
			{ id: 1, judul: 'A', urutan: 10, warna: 'merah' },
			{ id: 3, judul: 'C', aktif: false },
			{ id: 4, judul: '' },
			null
		]);
		expect(out.map((n) => n.judul)).toEqual(['A', 'B']);
		expect(out[0].warna).toBeNull();
		expect(out[1].warna).toBe('#112233');
		expect(normalizeNilai(undefined)).toEqual([]);
	});
});
