import { describe, it, expect } from 'vitest';
import { normalizeStages, activeWajibKeys, resolveProjectStage, pickStageFlows, type StageFlow } from './projectStageResolver';
import { DEFAULT_PROJECT_STAGES } from '$lib/data/processProjectStageDefaults';

const tl = (subs: any[]) => ({ categories: [{ id: 'c1', subtasks: subs }] });
const sub = (wajib_key: string | null, days: string[]) => ({ wajib_key, daily_plan: Object.fromEntries(days.map((d) => [d, 1])) });

describe('normalizeStages', () => {
	it('kosong/rusak → bawaan (salinan, aman diubah)', () => {
		for (const v of [null, undefined, [], 'x', [{ key: 'X', label: 'x' }]]) expect(normalizeStages(v).map((s) => s.key)).toEqual(DEFAULT_PROJECT_STAGES.map((s) => s.key));
		const a = normalizeStages(null);
		a[0].match.project_status.push('zzz');
		expect(DEFAULT_PROJECT_STAGES[0].match.project_status).toEqual(['waiting']);
	});
	it('membuang kunci tak valid/dobel/tanpa label; mengurutkan; match dinormalkan', () => {
		const r = normalizeStages([
			{ key: 'b_dua', label: 'Dua', urutan: 2, match: { project_status: [' Hold '], wajib_key: ['BAST'] } },
			{ key: 'a_satu', label: 'Satu', urutan: 1 },
			{ key: 'a_satu', label: 'Dobel' },
			{ key: 'Bad', label: 'x' },
			{ key: 'tanpa_label', label: ' ' }
		]);
		expect(r.map((s) => s.key)).toEqual(['a_satu', 'b_dua']);
		expect(r[1].match).toEqual({ project_status: ['hold'], wajib_key: ['bast'] });
	});
});

describe('activeWajibKeys', () => {
	const plan = tl([sub('mobilisasi', ['2026-11-02', '2026-11-03']), sub('demobilisasi', ['2026-12-20']), sub(null, ['2026-11-02', '2026-12-01'])]);
	it('hanya subtask wajib yang rentang rencananya mencakup hari ini', () => {
		expect(activeWajibKeys(plan, '2026-11-03')).toEqual(['mobilisasi']);
		expect(activeWajibKeys(plan, '2026-11-04')).toEqual([]);
		expect(activeWajibKeys(plan, '2026-12-20')).toEqual(['demobilisasi']);
	});
	it('menerima string JSON; rusak/kosong/volume 0 → kosong', () => {
		expect(activeWajibKeys(JSON.stringify(plan), '2026-11-02')).toEqual(['mobilisasi']);
		expect(activeWajibKeys('{rusak', '2026-11-02')).toEqual([]);
		expect(activeWajibKeys(null, '2026-11-02')).toEqual([]);
		expect(activeWajibKeys({ categories: [{ subtasks: [{ wajib_key: 'bast', daily_plan: { '2026-11-02': 0 } }] }] }, '2026-11-02')).toEqual([]);
	});
});

describe('resolveProjectStage', () => {
	const stages = DEFAULT_PROJECT_STAGES;
	it('subtask wajib berjalan didahulukan atas status proyek', () => {
		const r = resolveProjectStage(stages, { status: 'on progress', timelinePlanning: tl([sub('mobilisasi', ['2026-11-02'])]) }, '2026-11-02');
		expect(r).toMatchObject({ stage: { key: 'mobilisasi' }, via: 'subtask' });
	});
	it('tanpa subtask aktif → status proyek (huruf besar/spasi diabaikan)', () => {
		expect(resolveProjectStage(stages, { status: ' On Progress ' }, '2026-11-02')).toMatchObject({ stage: { key: 'eksekusi' }, via: 'status' });
		expect(resolveProjectStage(stages, { status: 'waiting' }, '2026-11-02')?.stage.key).toBe('persiapan');
	});
	it('beberapa cocok → tahap lebih akhir menang (demob + bast hari yang sama → closing)', () => {
		const r = resolveProjectStage(stages, { timelinePlanning: tl([sub('demobilisasi', ['2026-12-20']), sub('bast', ['2026-12-20'])]) }, '2026-12-20');
		expect(r?.stage.key).toBe('closing');
	});
	it('tahap nonaktif dilewati; tak ada sinyal cocok → null (tidak menebak)', () => {
		const off = stages.map((s) => (s.key === 'eksekusi' ? { ...s, aktif: false } : s));
		expect(resolveProjectStage(off, { status: 'on progress' }, '2026-11-02')).toBeNull();
		expect(resolveProjectStage(stages, { status: 'hold' }, '2026-11-02')).toBeNull();
		expect(resolveProjectStage(stages, {}, '2026-11-02')).toBeNull();
	});
});

describe('pickStageFlows', () => {
	const F = (id: string, title: string, extra: Partial<StageFlow> = {}): StageFlow => ({ id, title, tahap_proyek: ['mobilisasi'], ...extra });
	const flows = [
		F('turunan_a', 'A Turunan', { kategori_sop: 'turunan' }),
		F('induk_b', 'B Induk', { kategori_sop: 'induk' }),
		F('milik_saya', 'Z Milik Saya', { kategori_sop: 'turunan' }),
		F('sosialisasi', 'Y Sosialisasi', { kategori_sop: 'turunan', approval_status: 'butuh_sosialisasi' }),
		F('lain_tahap', 'Lain Tahap', { tahap_proyek: ['closing'] })
	];
	it('urutan: milik saya → sosialisasi → Induk sebelum Turunan → judul; tahap lain tidak ikut', () => {
		const r = pickStageFlows(flows, 'mobilisasi', { myFlowIds: new Set(['milik_saya']), max: 10, today: '2026-11-02' });
		expect(r.map((f) => f.id)).toEqual(['milik_saya', 'sosialisasi', 'induk_b', 'turunan_a']);
	});
	it('dibatasi max; tahap tanpa alur → kosong; sosialisasi_end_date ≥ hari ini dihitung', () => {
		expect(pickStageFlows(flows, 'mobilisasi', { max: 2 })).toHaveLength(2);
		expect(pickStageFlows(flows, 'persiapan')).toEqual([]);
		const r = pickStageFlows([F('x', 'X', { sosialisasi_end_date: '2026-11-30' }), F('y', 'A Y')], 'mobilisasi', { today: '2026-11-02' });
		expect(r[0].id).toBe('x');
	});
});
