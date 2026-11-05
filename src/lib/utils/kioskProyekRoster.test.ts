import { describe, it, expect } from 'vitest';
import { labelStatusKru, inisial, filterKru, tokenDariHash } from './kioskProyekRoster';

describe('labelStatusKru', () => {
	it('null/undefined/status kosong → Belum absen (tidak crash)', () => {
		expect(labelStatusKru(null)).toEqual({ teks: 'Belum absen', tone: 'belum' });
		expect(labelStatusKru(undefined).tone).toBe('belum');
		expect(labelStatusKru({ status: null }).tone).toBe('belum');
	});
	it('hadir menampilkan jam WIB; sudah pulang → tone pulang', () => {
		// 00:42 UTC = 07:42 WIB
		expect(labelStatusKru({ status: 'hadir', jam_masuk: '2026-10-27T00:42:00Z' })).toEqual({ teks: 'Hadir 07:42', tone: 'hadir' });
		const r = labelStatusKru({ status: 'hadir', jam_masuk: '2026-10-27T00:42:00Z', jam_pulang: '2026-10-27T10:05:00Z' });
		expect(r.tone).toBe('pulang');
		expect(r.teks).toContain('Pulang 17:05');
	});
	it('hadir tanpa jam (data lama) tetap tampil', () => {
		expect(labelStatusKru({ status: 'hadir' })).toEqual({ teks: 'Hadir', tone: 'hadir' });
		expect(labelStatusKru({ status: 'hadir', jam_masuk: 'bukan-tanggal' }).teks).toBe('Hadir');
	});
	it('izin, sakit, alpha, status asing', () => {
		expect(labelStatusKru({ status: 'izin' }).tone).toBe('izin');
		expect(labelStatusKru({ status: 'sakit' }).teks).toBe('Sakit');
		expect(labelStatusKru({ status: 'alpha' }).tone).toBe('lain');
		expect(labelStatusKru({ status: 'xyz' }).teks).toBe('xyz');
	});
});

describe('inisial, filterKru, tokenDariHash', () => {
	it('inisial', () => {
		expect(inisial('Budi Santoso Putra')).toBe('BP');
		expect(inisial('agus')).toBe('A');
		expect(inisial('')).toBe('?');
		expect(inisial(null)).toBe('?');
	});
	it('filterKru tak peduli huruf & menerima null', () => {
		const kru = [{ nama: 'Agus', posisi: 'Painter' }, { nama: 'Budi', posisi: 'Foreman' }, { nama: null, posisi: null }];
		expect(filterKru(kru, 'PAINT')).toHaveLength(1);
		expect(filterKru(kru, '')).toHaveLength(3);
		expect(filterKru(null, 'x')).toEqual([]);
	});
	it('tokenDariHash hanya dari fragmen yang benar', () => {
		expect(tokenDariHash('#t=abc.def-_1')).toBe('abc.def-_1');
		expect(tokenDariHash('#x=1&t=abc.def')).toBe('abc.def');
		expect(tokenDariHash('')).toBeNull();
		expect(tokenDariHash('#t=<script>')).toBeNull();
	});
});
