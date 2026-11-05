import { describe, it, expect } from 'vitest';
import { computeUnconfirmed, sopTargetsDivisi, isFlowConfirmed, isSopConfirmed } from './sopReadRequirement';

const flow = (o: any = {}) => ({ id: 1, flow_key: 'f1', approval_status: 'butuh_sosialisasi', version: 1, ...o });
const sop = (o: any = {}) => ({ id: 7, approval_status: 'butuh_sosialisasi', version_seq: 11, department: 'Produksi', target_departments: [], ...o });

describe('sopTargetsDivisi', () => {
	it('target_departments diprioritaskan; huruf besar/kecil tidak berpengaruh', () => {
		expect(sopTargetsDivisi(sop({ target_departments: ['PRODUKSI'], department: 'Finance' }) as any, 'produksi')).toBe(true);
		expect(sopTargetsDivisi(sop({ target_departments: ['Finance'] }) as any, 'Produksi')).toBe(false);
	});
	it('tanpa target → ikut department SOP; tanpa keduanya → semua orang', () => {
		expect(sopTargetsDivisi(sop() as any, 'Produksi')).toBe(true);
		expect(sopTargetsDivisi(sop() as any, 'Finance')).toBe(false);
		expect(sopTargetsDivisi(sop({ department: null }) as any, 'Finance')).toBe(true);
	});
	it('karyawan tanpa divisi tidak kena SOP yang ditarget', () => {
		expect(sopTargetsDivisi(sop() as any, null)).toBe(false);
		expect(sopTargetsDivisi(sop({ department: null }) as any, null)).toBe(true);
	});
	it('target_departments bukan array tidak melempar', () => {
		expect(() => sopTargetsDivisi(sop({ target_departments: 'x' }) as any, 'Produksi')).not.toThrow();
	});
});

describe('versi', () => {
	it('flow: konfirmasi tanpa flow_version = v1', () => {
		expect(isFlowConfirmed(flow({ version: 1 }) as any, [{ flow_key: 'f1' }])).toBe(true);
		expect(isFlowConfirmed(flow({ version: 2 }) as any, [{ flow_key: 'f1' }])).toBe(false);
		expect(isFlowConfirmed(flow({ version: 2 }) as any, [{ flow_key: 'f1', flow_version: 3 }])).toBe(true);
	});
	it('SOP: tanpa sop_version_seq = belum sah; versi lebih baru sah', () => {
		expect(isSopConfirmed(sop() as any, [{ sop_id: 7 }])).toBe(false);
		expect(isSopConfirmed(sop() as any, [{ sop_id: 7, sop_version_seq: 10 }])).toBe(false);
		expect(isSopConfirmed(sop() as any, [{ sop_id: 7, sop_version_seq: 11 }])).toBe(true);
	});
	it('konfirmasi alur lain tidak menutup alur ini', () => {
		expect(isFlowConfirmed(flow() as any, [{ flow_key: 'lain' }])).toBe(false);
	});
});

describe('computeUnconfirmed', () => {
	it('hanya butuh_sosialisasi; published/draft diabaikan', () => {
		const out = computeUnconfirmed({
			flows: [flow(), flow({ flow_key: 'f2', approval_status: 'published' }), flow({ flow_key: 'f3', approval_status: 'draft' })] as any,
			sops: [sop(), sop({ id: 8, approval_status: 'published' })] as any,
			confirms: [],
			divisi: 'Produksi'
		});
		expect(out.map((i) => `${i.type}:${i.flow_key ?? i.sop_id}`)).toEqual(['flow:f1', 'sop:7']);
	});

	it('item membawa versi sekarang dan tipe', () => {
		const [a, b] = computeUnconfirmed({ flows: [flow({ version: 5 })] as any, sops: [sop()] as any, confirms: [], divisi: 'Produksi' });
		expect(a).toMatchObject({ type: 'flow', version: 5, sop_id: null });
		expect(b).toMatchObject({ type: 'sop', version: 11, flow_key: null, sop_id: 7 });
	});

	it('input kosong/rusak tidak melempar', () => {
		expect(computeUnconfirmed({ flows: null as any, sops: undefined as any, confirms: null as any })).toEqual([]);
		expect(computeUnconfirmed({ flows: [null, {}] as any, sops: [null] as any, confirms: [] })).toEqual([]);
	});
});
