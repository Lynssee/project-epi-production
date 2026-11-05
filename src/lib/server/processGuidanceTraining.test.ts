// src/lib/server/processGuidanceTraining.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
import { directusServerJson } from '$lib/server/directus';
import { loadMyTrainingStatus, parseIds, MAX_IDS } from './processGuidanceTraining';

const mock = directusServerJson as unknown as ReturnType<typeof vi.fn>;
const PROGRAMS = [
	{ id: 13, kode: 'KC-P1', judul: 'Sandblasting', status: 'published', self_enroll: 1 },
	{ id: 17, kode: 'KC-P5', judul: 'Produk Cat', status: 'draft', self_enroll: 0 },
	{ id: 18, kode: 'KC-P6', judul: 'K3', status: 'published', self_enroll: 0 }
];
function setup(enrollments: any[]) {
	mock.mockImplementation(async (url: string) => (url.startsWith('/items/training_program') ? { data: PROGRAMS } : { data: enrollments }));
}
beforeEach(() => vi.clearAllMocks());

describe('parseIds', () => {
	it('unik, bilangan bulat > 0, dibatasi MAX_IDS; sampah diabaikan', () => {
		expect(parseIds('13, 14,x,13,0,-2,1.5')).toEqual([13, 14]);
		expect(parseIds(null)).toEqual([]);
		expect(parseIds(Array.from({ length: 50 }, (_, i) => i + 1).join(','))).toHaveLength(MAX_IDS);
	});
});

describe('loadMyTrainingStatus', () => {
	it('dua query terpisah, difilter ke karyawan itu & id yang diminta; tanpa relasi bersarang', async () => {
		setup([]);
		await loadMyTrainingStatus(7, [13, 18]);
		const urls = mock.mock.calls.map((c) => c[0] as string);
		expect(urls).toHaveLength(2);
		expect(urls[0]).toContain('filter[id][_in]=13,18');
		expect(urls[1]).toContain('filter[karyawan_id][_eq]=7');
		expect(urls[1]).toContain('filter[program_id][_in]=13,18');
		expect(urls.every((u) => !/fields=[^&]*\./.test(u))).toBe(true);
	});

	it('status terbaik per program (Lulus > berjalan > belum), progres, urutan mengikuti ids; draf ditandai tidak terbit', async () => {
		setup([
			{ program_id: 13, status: 'Ongoing', progress_persen: 40 },
			{ program_id: { id: 13 }, status: 'Lulus', progress_persen: 100, tenggat: '2026-12-01' },
			{ program_id: 18, status: 'Batal' }
		]);
		const r = await loadMyTrainingStatus(7, [18, 13, 17]);
		expect(r.map((x) => x.id)).toEqual([18, 13, 17]);
		expect(r[1]).toMatchObject({ judul: 'Sandblasting', terbit: true, self_enroll: true, status_saya: 'lulus', progress: 100, tenggat: '2026-12-01' });
		expect(r[0]).toMatchObject({ status_saya: 'belum', progress: null });
		expect(r[2]).toMatchObject({ terbit: false, status_saya: 'belum' });
	});

	it('berjalan membawa progres; program yang tak ada di master dilewati', async () => {
		setup([{ program_id: 13, status: 'Enrolled', progress_persen: 25 }]);
		const r = await loadMyTrainingStatus(7, [13, 999]);
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ status_saya: 'berjalan', progress: 25 });
	});

	it('masukan tidak valid → kosong TANPA query; gagal baca → melempar', async () => {
		expect(await loadMyTrainingStatus(0, [13])).toEqual([]);
		expect(await loadMyTrainingStatus(7, [])).toEqual([]);
		expect(mock).not.toHaveBeenCalled();
		mock.mockRejectedValue(new Error('403'));
		await expect(loadMyTrainingStatus(7, [13])).rejects.toThrow('403');
	});
});
