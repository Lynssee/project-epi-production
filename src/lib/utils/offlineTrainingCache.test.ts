import { describe, it, expect } from 'vitest';
import { hasOfflineReadableContent, isCacheFresh, MAX_CACHE_AGE_DAYS } from './offlineTrainingCache';

const detail = (modules: any[]) => ({ program: { id: 1 }, enrollment: null, modules, finalQuizId: null, bisaSelfEnroll: false }) as any;

describe('offlineTrainingCache (murni)', () => {
	it('hanya kursus dengan modul Teks berisi yang layak di-cache', () => {
		expect(hasOfflineReadableContent(detail([{ modul: { tipe_konten: 'Teks', konten_teks: '## Materi\nisi' } }]))).toBe(true);
		expect(hasOfflineReadableContent(detail([{ modul: { tipe_konten: 'Video', konten_teks: null } }]))).toBe(false);
		expect(hasOfflineReadableContent(detail([{ modul: { tipe_konten: 'Teks', konten_teks: '   ' } }]))).toBe(false);
		expect(hasOfflineReadableContent(detail([]))).toBe(false);
		expect(hasOfflineReadableContent(null)).toBe(false);
	});

	it('tipe_konten kosong dianggap Teks (default modul)', () => {
		expect(hasOfflineReadableContent(detail([{ modul: { tipe_konten: null, konten_teks: 'x' } }]))).toBe(true);
	});

	it('salinan basi (> batas hari) atau tanggal rusak tidak ditampilkan', () => {
		const now = Date.UTC(2026, 10, 12);
		expect(isCacheFresh(new Date(now - 5 * 86400000).toISOString(), now)).toBe(true);
		expect(isCacheFresh(new Date(now - (MAX_CACHE_AGE_DAYS + 1) * 86400000).toISOString(), now)).toBe(false);
		expect(isCacheFresh('bukan-tanggal', now)).toBe(false);
	});
});

import { selectPrefetchTargets, prefetchKursus, MAX_PREFETCH_PER_RUN } from './offlineTrainingCache';

describe('selectPrefetchTargets', () => {
	const k = (programId: number, extra: any = {}) => ({ programId, wajib: false, terdaftar: true, status: 'Ongoing', progress: 0, ...extra });
	it('hanya yang diikuti & belum lulus; yang segar dilewati', () => {
		const out = selectPrefetchTargets([k(1), k(2, { terdaftar: false }), k(3, { status: 'Lulus' }), k(4)], new Set([4]));
		expect(out).toEqual([1]);
	});
	it('wajib lebih dulu, lalu progres tertinggi', () => {
		const out = selectPrefetchTargets([k(1, { progress: 90 }), k(2, { wajib: true, progress: 10 }), k(3, { progress: 50 })], new Set());
		expect(out).toEqual([2, 1, 3]);
	});
	it('dibatasi max', () => {
		const many = Array.from({ length: 20 }, (_, i) => k(i + 1));
		expect(selectPrefetchTargets(many, new Set())).toHaveLength(MAX_PREFETCH_PER_RUN);
		expect(selectPrefetchTargets(many, new Set(), 2)).toHaveLength(2);
	});
	it('input null/kosong aman', () => {
		expect(selectPrefetchTargets(undefined, new Set())).toEqual([]);
		expect(selectPrefetchTargets([null as any], new Set())).toEqual([]);
	});
});

describe('prefetchKursus', () => {
	it('kursus tanpa materi teks dilewati; error fetch dihitung gagal & tidak menghentikan yang lain', async () => {
		const progress: number[] = [];
		const r = await prefetchKursus(
			[1, 2],
			async (id) => {
				if (id === 1) throw new Error('timeout');
				return { program: { id }, modules: [{ modul: { tipe_konten: 'Video' } }] } as any;
			},
			(s) => progress.push(s)
		);
		expect(r).toEqual({ tersimpan: 0, dilewati: 1, gagal: 1 });
		expect(progress).toEqual([1, 2]);
	});
});
