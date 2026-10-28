import { describe, it, expect, vi } from 'vitest';
import { gateReportElements, GATE_ERROR_FLAG, LH_TANGGAL_UNIK, makeFindExisting, nextDayKey } from './reportsBatchGate';

const q = (score = 90, flags: string[] = []) => ({ quality_score: score, quality_flags: flags, quality_evaluated_at: '2026-10-20T00:00:00Z' });
const allow = () => ({ decision: 'allow', qualityFields: q(), blockingGates: [] });
const reject = () => ({ decision: 'reject', qualityFields: q(40, ['G_X']), blockingGates: [{ gate_key: 'G_X', label: 'X', message: 'm', tab: 'meta' }] });
const audit = vi.fn(async () => {});

describe('gateReportElements (R2-07, lapangan)', () => {
	it('array 3 laporan, 1 ditolak -> 2 diterima & berskor', async () => {
		const els = [{ project_id: 1, date: '2026-10-01' }, { project_id: 1, date: '2026-10-02' }, { project_id: 1, date: '2026-10-03' }];
		const r = await gateReportElements(els, { audit, evaluate: async (_e, i) => (i === 1 ? reject() : allow()) });
		expect(r.accepted.map((a) => a.index)).toEqual([0, 2]);
		expect(r.accepted[0].element.quality_score).toBe(90);
		expect(r.rejected[0]).toMatchObject({ index: 1, gates: [{ gate_key: 'G_X' }] });
	});

	it('evaluasi error -> diterima bertanda GATE_ERROR', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const r = await gateReportElements([{ project_id: 1, date: '2026-10-01' }], { audit, evaluate: async () => { throw new Error('boom'); } });
		expect(r.accepted[0].element).toMatchObject({ quality_score: null, quality_flags: [GATE_ERROR_FLAG] });
		spy.mockRestore();
	});

	it('override tidak tersedia di proxy lapangan', async () => {
		const ov = { decision: 'override', qualityFields: q(), blockingGates: [{ gate_key: 'G_X' }] };
		const r = await gateReportElements([{}], { audit, evaluate: async () => ov });
		expect(r.rejected[0].overrideNotAvailableHere).toBe(true);
	});

	it('G_LH_TANGGAL_UNIK soft -> tanda; hard -> ditolak; multi-shift dikecualikan; shadow hanya audit', async () => {
		const base = { audit: vi.fn(async () => {}), evaluate: async () => allow(), isCreate: true, findExisting: async () => [3575] };
		const el = () => ({ project_id: 1051, date: '2026-10-16T00:00:00' });
		expect((await gateReportElements([el()], { ...base, dupMode: async () => 'soft' })).accepted[0].element.quality_flags).toContain(LH_TANGGAL_UNIK);
		expect((await gateReportElements([el()], { ...base, dupMode: async () => 'hard' })).rejected[0].gates[0].message).toContain('#3575');
		expect((await gateReportElements([el()], { ...base, dupMode: async () => 'hard', multiShiftProjects: async () => new Set(['1051']) })).accepted).toHaveLength(1);
		const sh = await gateReportElements([el()], { ...base, dupMode: async () => 'shadow' });
		expect(sh.accepted[0].element.quality_flags).not.toContain(LH_TANGGAL_UNIK);
		expect(base.audit).toHaveBeenCalledWith(expect.objectContaining({ gate: LH_TANGGAL_UNIK, decision: 'shadow' }));
	});

	it('PATCH mempertahankan tanda tanggal unik dari record lama', async () => {
		const r = await gateReportElements([{ status: 'approved' }], { audit, evaluate: async () => allow(), previousFlags: [LH_TANGGAL_UNIK] });
		expect(r.accepted[0].element.quality_flags).toContain(LH_TANGGAL_UNIK);
	});
});

describe('makeFindExisting / nextDayKey', () => {
	it('rentang [hari, hari+1) dan non-rejected', async () => {
		const fetchJson = vi.fn(async (_p: string) => ({ data: [{ id: 7 }] }));
		expect(await makeFindExisting(fetchJson)(1051, '2026-10-16')).toEqual([7]);
		const url = fetchJson.mock.calls[0][0] as string;
		expect(url).toContain('filter[date][_lt]=2026-10-17');
		expect(url).toContain('filter[status][_neq]=rejected');
	});
	it('nextDayKey lintas bulan & tak valid', () => {
		expect(nextDayKey('2026-10-31')).toBe('2026-11-01');
		expect(nextDayKey('xx')).toBeNull();
	});
});
