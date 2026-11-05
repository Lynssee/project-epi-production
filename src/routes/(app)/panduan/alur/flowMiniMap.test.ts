import { describe, it, expect } from 'vitest';
import { layoutMiniMap } from './flowMiniMap';
import { buildCycle } from './gateCardModel';

const flow: any = {
	id: 'd', title: 'D', description: '', lanes: [{ key: 'l', label: 'L' }],
	nodes: [
		{ id: 'mulai', type: 'start', lane: 'l', col: 0, row: 1, label: 'Mulai' },
		{ id: 'input', type: 'task', lane: 'l', col: 1, row: 1, label: 'Input SO', gates: [{ key: 'G', modul: 'm', documentType: 'd' }] },
		{ id: 'setuju', type: 'decision', lane: 'l', col: 2, row: 1, label: 'Disetujui?' },
		{ id: 'kirim', type: 'task', lane: 'l', col: 3, row: 0, label: 'Kirim' },
		{ id: 'tahan', type: 'task', lane: 'l', col: 3, row: 2, label: 'Tahan dulu' },
		{ id: 'akhir', type: 'end', lane: 'l', col: 4, row: 1, label: 'Selesai' }
	],
	edges: [
		{ from: 'mulai', to: 'input' }, { from: 'input', to: 'setuju' },
		{ from: 'setuju', to: 'kirim', label: 'Ya' }, { from: 'setuju', to: 'tahan', label: 'Tunda' },
		{ from: 'setuju', to: 'input', label: 'Revisi' },
		{ from: 'kirim', to: 'akhir' }, { from: 'tahan', to: 'akhir' },
		{ from: 'input', to: 'hantu' }, { from: 'input', to: 'input' }
	]
};
const info: any = { mode: 'hard', nama: 'G', message: null, hint: null, owner_role: null, bypass: null, checklist: [] };

describe('layoutMiniMap (vertikal, muat layar HP)', () => {
	const m = layoutMiniMap(flow, buildCycle(flow, { G: info }));
	const n = (id: string) => m.nodes.find((x) => x.id === id)!;

	it('kolom editor → ke bawah, baris editor → ke samping; bentuk per tipe; nomor sama dengan kartu', () => {
		expect(n('input').cy).toBeGreaterThan(n('mulai').cy);
		expect(n('setuju').cy).toBeGreaterThan(n('input').cy);
		expect(n('kirim').cy).toBe(n('tahan').cy);
		expect(n('kirim').cx).toBeLessThan(n('input').cx); // baris 0 di kiri baris 1
		expect(n('tahan').cx).toBeGreaterThan(n('input').cx);
		expect(n('setuju').shape).toBe('diamond');
		expect(n('mulai').shape).toBe('pill');
		expect([n('input').no, n('setuju').no, n('kirim').no, n('mulai').no]).toEqual([1, 2, 3, null]);
		expect(n('input')).toMatchObject({ gates: 1, strongest: 'hard', tappable: true });
		expect(n('akhir').tappable).toBe(false);
	});

	it('lebar peta muat layar HP untuk alur ≤ 3 lajur paralel', () => {
		expect(m.width).toBeLessThan(640);
		expect(Math.max(...m.nodes.map((x) => x.x + x.w))).toBeLessThanOrEqual(m.width);
	});

	it('panah: maju elbow ke bawah, mundur (revisi) lewat sisi kanan terluar; ujung hilang & self-loop dibuang', () => {
		expect(m.edges).toHaveLength(7);
		const back = m.edges.find((e) => e.label === 'Revisi')!;
		expect(back.back).toBe(true);
		const right = Math.max(...m.nodes.map((x) => x.x + x.w));
		expect(back.points[1][0]).toBeGreaterThan(right);
		expect(m.edges.filter((e) => e.back)).toHaveLength(1);
		const fwd = m.edges.find((e) => e.label === 'Tunda')!;
		expect(fwd.points[0][1]).toBe(n('setuju').y + n('setuju').h);
		expect(fwd.points.at(-1)![1]).toBe(n('tahan').y);
	});

	it('tanpa langkah / data rusak tidak crash', () => {
		expect(layoutMiniMap(null).empty).toBe(true);
		expect(layoutMiniMap({ nodes: [], edges: [] } as any).empty).toBe(true);
		const solo = layoutMiniMap({ nodes: [{ id: 'a', type: 'task', lane: 'l', col: 0, label: 'A' }], edges: [{ from: 'a', to: 'a' }, null] } as any);
		expect(solo.nodes).toHaveLength(1);
		expect(solo.edges).toEqual([]);
	});
});
