import { describe, it, expect } from 'vitest';
import { buildRatingPayloads, isDraftComplete, isDraftPartial, ratedTodaySet, lastRatedMap, matchWorkshop } from './bulkRating';

const d = (id: number, k = 0, s = 0, t = 0) => ({ manpowerId: id, nama: `P${id}`, jabatan: 'Painter', kualitas: k, safety: s, ketepatan: t });

describe('kelengkapan draft', () => {
	it('lengkap hanya bila ketiga bintang 1..5', () => {
		expect(isDraftComplete(d(1, 4, 5, 3))).toBe(true);
		expect(isDraftComplete(d(1, 4, 0, 3))).toBe(false);
		expect(isDraftComplete(d(1, 6, 5, 3))).toBe(false);
		expect(isDraftComplete(d(1, 2.5, 5, 3))).toBe(false);
	});
	it('partial = disentuh tapi belum lengkap; kosong total bukan partial', () => {
		expect(isDraftPartial(d(1, 4, 0, 0))).toBe(true);
		expect(isDraftPartial(d(1))).toBe(false);
		expect(isDraftPartial(d(1, 4, 4, 4))).toBe(false);
	});
});

describe('buildRatingPayloads', () => {
	it('hanya baris lengkap yang dikirim; baris kosong/partial dilewati', () => {
		const p = buildRatingPayloads({ drafts: [d(1, 4, 4, 4), d(2, 5, 0, 0), d(3)], projectId: 7, dinilaiOleh: 'Budi', tanggal: '2026-11-02' });
		expect(p).toHaveLength(1);
		expect(p[0]).toEqual({ manpower_id: 1, project_id: 7, workshop_id: null, tanggal: '2026-11-02', kualitas: 4, safety: 4, ketepatan: 4, catatan: '', dinilai_oleh: 'Budi' });
	});
	it('mode workshop: project_id null + kolom workshop_id (tanpa awalan teks di catatan)', () => {
		const [p] = buildRatingPayloads({ drafts: [d(1, 3, 3, 3)], projectId: null, workshopId: 2, catatan: ' rapi ', dinilaiOleh: 'X', tanggal: '2026-11-02' });
		expect(p.project_id).toBeNull();
		expect(p.workshop_id).toBe(2);
		expect(p.catatan).toBe('rapi');
	});
	it('mode proyek mengabaikan workshopId (satu konteks per penilaian)', () => {
		const [p] = buildRatingPayloads({ drafts: [d(1, 3, 3, 3)], projectId: 7, workshopId: 2, dinilaiOleh: 'X' });
		expect(p.workshop_id).toBeNull();
	});
	it('pekerja yang sudah dinilai hari ini dilewati', () => {
		const p = buildRatingPayloads({ drafts: [d(1, 4, 4, 4), d(2, 4, 4, 4)], projectId: 7, dinilaiOleh: 'B', skipManpowerIds: new Set([2]) });
		expect(p.map((x) => x.manpower_id)).toEqual([1]);
	});
	it('input kosong/undefined tidak melempar', () => {
		expect(buildRatingPayloads({ drafts: undefined as any, projectId: 1, dinilaiOleh: '' })).toEqual([]);
	});
});

describe('riwayat rating', () => {
	const past = [
		{ manpower_id: 1, tanggal: '2026-11-02', project_id: 7 },
		{ manpower_id: { id: 2 }, tanggal: '2026-11-02T08:00:00', project_id: null, workshop_id: 1 },
		{ manpower_id: 4, tanggal: '2026-11-02', project_id: null, workshop_id: 2 },
		{ manpower_id: 3, tanggal: '2026-10-30', project_id: 7 },
		{ manpower_id: 1, tanggal: '2026-10-01', project_id: 9 }
	];
	it('ratedToday memisahkan konteks proyek vs workshop', () => {
		expect([...ratedTodaySet(past, 7, '2026-11-02')]).toEqual([1]);
		expect([...ratedTodaySet(past, null, '2026-11-02', 1)]).toEqual([2]); // workshop 1 saja
		expect([...ratedTodaySet(past, null, '2026-11-02', 2)]).toEqual([4]);
		expect(ratedTodaySet(past, 9, '2026-11-02').size).toBe(0);
	});
	it('lastRated mengambil tanggal terbaru lintas konteks', () => {
		const m = lastRatedMap(past);
		expect(m.get(1)).toBe('2026-11-02');
		expect(m.get(3)).toBe('2026-10-30');
	});
});

describe('matchWorkshop', () => {
	const ws = [{ id: 1, code: 'WS-CKT', name: 'Workshop Ciketing' }, { id: 2, code: 'MB-BLR', name: 'MB Balaraja' }];
	it('cocokkan kunci setelan cakupan ke baris workshops', () => {
		expect(matchWorkshop('ciketing', ws)?.id).toBe(1);
		expect(matchWorkshop('Balaraja', ws)?.id).toBe(2);
		expect(matchWorkshop('xyz', ws)).toBeNull();
		expect(matchWorkshop('', ws)).toBeNull();
	});
});
