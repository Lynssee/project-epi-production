import { describe, it, expect } from 'vitest';
import { loadPrep, savePrep, prepItemKey, prepProgress, isPrepGate } from './gatePrep';

const mem = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const info = (mode: string, checklist: any[]): any => ({ mode, nama: 'G', message: null, hint: null, owner_role: null, bypass: null, checklist });
const cl = [{ label: 'A', wajib: true, tips: null }, { label: 'B', wajib: true, tips: null }, { label: 'C', wajib: false, tips: null }];

describe('gatePrep', () => {
	it('simpan & muat per alur; kosong → kunci dihapus; data rusak → set kosong', () => {
		const st = mem();
		savePrep('f1', new Set([prepItemKey('G', 'A')]), st);
		expect([...loadPrep('f1', st)]).toEqual(['G::A']);
		expect(loadPrep('f2', st).size).toBe(0);
		savePrep('f1', new Set(), st);
		expect(st.m.size).toBe(0);
		st.setItem('epi_gate_prep_v1_f3', '{bukan json');
		expect(loadPrep('f3', st).size).toBe(0);
		st.setItem('epi_gate_prep_v1_f4', JSON.stringify([1, 'ok', null]));
		expect([...loadPrep('f4', st)]).toEqual(['ok']);
	});
	it('storage tak tersedia / melempar → tidak crash', () => {
		const bad: any = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
		expect(loadPrep('f', bad).size).toBe(0);
		expect(() => savePrep('f', new Set(['a']), bad)).not.toThrow();
		expect(loadPrep('f', null).size).toBe(0);
	});
	it('progres: siap bila SEMUA butir wajib tercentang (opsional tak menghalangi)', () => {
		const i = info('hard', cl);
		expect(prepProgress('G', i, new Set())).toEqual({ total: 3, done: 0, wajibTotal: 2, wajibDone: 0, ready: false });
		expect(prepProgress('G', i, new Set(['G::A'])).ready).toBe(false);
		expect(prepProgress('G', i, new Set(['G::A', 'G::B']))).toMatchObject({ done: 2, wajibDone: 2, ready: true });
		expect(prepProgress('G', i, new Set(['G::A', 'H::B'])).wajibDone).toBe(1); // kunci gate lain tidak dihitung
	});
	it('tanpa butir wajib → siap bila semua tercentang; tanpa checklist → tidak pernah siap', () => {
		const opt = info('soft', [{ label: 'X', wajib: false, tips: null }]);
		expect(prepProgress('G', opt, new Set()).ready).toBe(false);
		expect(prepProgress('G', opt, new Set(['G::X'])).ready).toBe(true);
		expect(prepProgress('G', info('hard', []), new Set()).ready).toBe(false);
		expect(prepProgress('G', null, new Set()).total).toBe(0);
	});
	it('simulasi hanya untuk gate yang mengikat (Wajib / Perlu alasan) dan punya checklist', () => {
		expect(isPrepGate(info('hard', cl))).toBe(true);
		expect(isPrepGate(info('soft', cl))).toBe(true);
		expect(isPrepGate(info('warn', cl))).toBe(false);
		expect(isPrepGate(info('shadow', cl))).toBe(false);
		expect(isPrepGate(info('hard', []))).toBe(false);
		expect(isPrepGate(null)).toBe(false);
	});
});
