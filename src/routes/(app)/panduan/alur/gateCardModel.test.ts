import { describe, it, expect } from 'vitest';
import { buildCycle, summarizeCycle, modeMeta, branchSentence } from './gateCardModel';

const info = (mode: string, o: any = {}) => ({ mode, nama: `Gate ${mode}`, message: null, hint: null, owner_role: null, bypass: null, checklist: [], ...o });
const flow: any = {
	id: 'f', title: 'F', description: '',
	lanes: [{ key: 'lap', label: 'LAPANGAN' }, { key: 'adm', label: 'ADMIN' }],
	edges: [],
	nodes: [
		{ id: 'akhir', type: 'end', lane: 'adm', col: 9, label: 'Selesai' },
		{ id: 'b', type: 'task', lane: 'adm', col: 2, row: 0, label: 'Verifikasi', pic: 'Finance', actions: [], gates: [{ key: 'G_SOFT', modul: 'm', documentType: 'd' }, { key: 'G_HARD', modul: 'm', documentType: 'd' }] },
		{ id: 'mulai', type: 'start', lane: 'lap', col: 0, label: 'Mulai' },
		{ id: 'a', type: 'task', lane: 'lap', col: 1, row: 0, label: 'Foto BA', pic: 'Mandor', sla_hours: 4, actions: [{ label: 'Form Laporan', href: '/laporan' }, { label: 'x', href: '' }], gates: [] },
		{ id: 'c', type: 'decision', lane: 'adm', col: 2, row: 1, label: 'Setuju?', gates: [{ key: 'G_X', modul: 'm', documentType: 'd' }] }
	]
};

describe('buildCycle', () => {
	it('urut kolom→baris, tanpa Mulai/Selesai, bernomor; lane jadi label; pintasan kosong dibuang', () => {
		const s = buildCycle(flow, null);
		expect(s.map((x) => [x.no, x.id])).toEqual([[1, 'a'], [2, 'b'], [3, 'c']]);
		expect(s[0]).toMatchObject({ lane: 'LAPANGAN', pic: 'Mandor', sla_hours: 4, gates: [], strongest: null, hasGuidance: false });
		expect(s[0].fieldActions).toEqual([{ label: 'Form Laporan', href: '/laporan' }]);
	});
	it('gate dicocokkan dengan info; yang tak ada info tetap tampil (info:null); gate terketat dipilih', () => {
		const s = buildCycle(flow, { G_SOFT: info('soft', { hint: 'siapkan PO' }), G_HARD: info('hard') });
		const b = s.find((x) => x.id === 'b')!;
		expect(b.gates.map((g) => [g.key, g.info?.mode ?? null])).toEqual([['G_SOFT', 'soft'], ['G_HARD', 'hard']]);
		expect(b.strongest).toBe('hard');
		expect(b.hasGuidance).toBe(true);
		const c = s.find((x) => x.id === 'c')!;
		expect(c.gates[0].info).toBeNull();
		expect(c.strongest).toBeNull();
	});
	it('input rusak tidak crash', () => {
		expect(buildCycle(null, null)).toEqual([]);
		expect(buildCycle({ nodes: [null, { id: 'z', type: 'task', lane: 'x', gates: [null, {}] }] } as any, undefined)).toHaveLength(1);
	});
});

describe('summarizeCycle / modeMeta', () => {
	it('ringkasan jumlah langkah, langkah ber-gate, total gate, dan mode terketat', () => {
		const s = buildCycle(flow, { G_SOFT: info('soft'), G_HARD: info('warn'), G_X: info('shadow') });
		expect(summarizeCycle(s)).toEqual({ steps: 3, gated: 2, gates: 3, strongest: 'soft' });
		expect(summarizeCycle([])).toEqual({ steps: 0, gated: 0, gates: 0, strongest: null });
	});
	it('bahasa lapangan, bukan istilah teknis; mode tak dikenal aman', () => {
		expect(modeMeta('hard').label).toBe('Wajib lolos');
		expect(modeMeta('shadow').short).toBe('Dipantau');
		expect(modeMeta('ngawur').rank).toBe(-1);
		expect(modeMeta(null).short).toBe('—');
	});
});

describe('cabang keputusan (buildCycle.branches)', () => {
	const dflow: any = {
		id: 'd', title: 'D', description: '', lanes: [{ key: 'l', label: 'L' }],
		nodes: [
			{ id: 'mulai', type: 'start', lane: 'l', col: 0, label: 'Mulai' },
			{ id: 'input', type: 'task', lane: 'l', col: 1, label: 'Input SO' },
			{ id: 'setuju', type: 'decision', lane: 'l', col: 2, label: 'Disetujui?' },
			{ id: 'kirim', type: 'task', lane: 'l', col: 3, label: 'Kirim' },
			{ id: 'akhir', type: 'end', lane: 'l', col: 4, label: 'Selesai' }
		],
		edges: [
			{ from: 'mulai', to: 'input' },
			{ from: 'input', to: 'setuju' },
			{ from: 'setuju', to: 'kirim', label: ' Ya ' },
			{ from: 'setuju', to: 'input', label: 'Revisi' },
			{ from: 'setuju', to: 'hantu', label: 'x' }, // tujuan tak dikenal → dilewati
			{ from: 'kirim', to: 'akhir' }
		]
	};
	const s = buildCycle(dflow, null);
	it('keputusan ditandai; cabang membawa nomor tujuan, label bersih, dan penanda kembali', () => {
		const d = s.find((x) => x.id === 'setuju')!;
		expect(d.isDecision).toBe(true);
		expect(d.branches.map((b) => [b.condition, b.toNo, b.backward, b.end])).toEqual([['Ya', 3, false, false], ['Revisi', 1, true, false]]);
		expect(s.find((x) => x.id === 'input')!.isDecision).toBe(false);
	});
	it('tujuan Selesai → end:true tanpa nomor; panah dari Mulai tidak jadi langkah', () => {
		expect(s.find((x) => x.id === 'kirim')!.branches).toEqual([{ toId: 'akhir', toNo: null, toLabel: 'Selesai', condition: '', backward: false, end: true }]);
		expect(s.map((x) => x.id)).toEqual(['input', 'setuju', 'kirim']);
	});
	it('kalimat bahasa lapangan', () => {
		const [ya, revisi] = s.find((x) => x.id === 'setuju')!.branches;
		expect(branchSentence(ya)).toBe('Jika “Ya” → lanjut ke Langkah 3 (Kirim)');
		expect(branchSentence(revisi)).toBe('Jika “Revisi” → kembali ke Langkah 1 (Input SO)');
		expect(branchSentence(s.find((x) => x.id === 'kirim')!.branches[0])).toBe('Proses selesai');
		expect(branchSentence(s.find((x) => x.id === 'input')!.branches[0])).toBe('Lanjut ke Langkah 2 (Disetujui?)');
	});
	it('tanpa edges / edges rusak tidak crash', () => {
		expect(buildCycle({ ...dflow, edges: undefined }, null).every((x) => x.branches.length === 0)).toBe(true);
		expect(() => buildCycle({ ...dflow, edges: [null, { from: 'input' }] }, null)).not.toThrow();
	});
});
