// src/routes/(app)/panduan/alur/flowMiniMap.ts
// Tata letak MURNI "Peta Alur Mini" untuk layar HP: simpul/panah ASLI alur (start · task · decision · end) digambar VERTIKAL
// (kolom editor → arah ke bawah, baris editor → sejajar ke samping) agar muat lebar HP. Data seluruhnya dari `flow` yang sudah ada di
// memori → 0 request tambahan dan tetap jalan offline. Dites.
import type { ProcessFlow } from '$lib/data/processGuidance';
import type { CycleStep } from './gateCardModel';

export interface MiniNode {
	id: string;
	type: string;
	shape: 'pill' | 'rect' | 'diamond';
	/** Nomor langkah (sama dengan nomor di kartu Siklus); null untuk Mulai/Selesai. */
	no: number | null;
	label: string;
	full: string;
	x: number;
	y: number;
	w: number;
	h: number;
	cx: number;
	cy: number;
	gates: number;
	strongest: string | null;
	/** Hanya langkah (tugas/keputusan) yang bisa diketuk. */
	tappable: boolean;
}
export interface MiniEdge {
	from: string;
	to: string;
	label: string;
	back: boolean;
	points: [number, number][];
	lx: number;
	ly: number;
}
export interface MiniMap {
	width: number;
	height: number;
	nodes: MiniNode[];
	edges: MiniEdge[];
	empty: boolean;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
const order = (a: { col?: number; row?: number }, b: { col?: number; row?: number }) => (a.col ?? 0) - (b.col ?? 0) || (a.row ?? 0) - (b.row ?? 0);

export function layoutMiniMap(flow: ProcessFlow | null | undefined, steps: CycleStep[] = []): MiniMap {
	const nodes = [...(flow?.nodes ?? [])].filter((n) => n && n.id).sort(order);
	if (!nodes.length) return { width: 0, height: 0, nodes: [], edges: [], empty: true };
	const NW = 144;
	const XGAP = 160;
	const YGAP = 82;
	const PAD = 14;
	const stepOf = new Map(steps.map((s) => [s.id, s]));
	const colRank = new Map([...new Set(nodes.map((n) => n.col ?? 0))].sort((a, b) => a - b).map((c, i) => [c, i]));
	const rowRank = new Map([...new Set(nodes.map((n) => n.row ?? 0))].sort((a, b) => a - b).map((r, i) => [r, i]));

	const laid: MiniNode[] = nodes.map((n) => {
		const t = n.type === 'decision' || n.type === 'start' || n.type === 'end' ? n.type : 'task';
		const pill = t === 'start' || t === 'end';
		const w = pill ? 108 : NW;
		const h = t === 'decision' ? 62 : t === 'task' ? 44 : 30;
		const cx = PAD + (rowRank.get(n.row ?? 0) ?? 0) * XGAP + NW / 2;
		const cy = PAD + 34 + (colRank.get(n.col ?? 0) ?? 0) * YGAP;
		const s = stepOf.get(n.id);
		return {
			id: n.id,
			type: t,
			shape: t === 'decision' ? 'diamond' : pill ? 'pill' : 'rect',
			no: s?.no ?? null,
			label: clip(n.label ?? n.id, t === 'decision' ? 20 : 24),
			full: n.label ?? n.id,
			x: cx - w / 2,
			y: cy - h / 2,
			w,
			h,
			cx,
			cy,
			gates: s?.gates.length ?? (n.gates ?? []).filter((g) => g?.key).length,
			strongest: s?.strongest ?? null,
			tappable: !pill
		};
	});
	const pos = new Map(laid.map((n) => [n.id, n]));
	const globalRight = Math.max(...laid.map((n) => n.x + n.w));
	let loops = 0;
	const edges: MiniEdge[] = [];
	const seen = new Set<string>();
	for (const e of flow?.edges ?? []) {
		const a = pos.get(e?.from);
		const b = pos.get(e?.to);
		if (!a || !b || a === b || seen.has(`${a.id}>${b.id}`)) continue;
		seen.add(`${a.id}>${b.id}`);
		const label = clip((e.label ?? '').trim(), 14);
		let points: [number, number][];
		let lx: number;
		let ly: number;
		const back = b.cy < a.cy || (b.cy === a.cy && b.cx < a.cx);
		if (back) {
			// Perbaikan (rework): lewat sisi kanan terluar agar tak menembus kotak lain.
			const xr = globalRight + 12 + loops++ * 10;
			points = [[a.x + a.w, a.cy], [xr, a.cy], [xr, b.cy], [b.x + b.w, b.cy]];
			lx = xr - 4;
			ly = (a.cy + b.cy) / 2;
		} else if (b.cy === a.cy) {
			points = [[a.x + a.w, a.cy], [b.x, b.cy]];
			lx = (a.x + a.w + b.x) / 2;
			ly = a.cy - 6;
		} else {
			const p1: [number, number] = [a.cx, a.y + a.h];
			const p2: [number, number] = [b.cx, b.y];
			const my = (p1[1] + p2[1]) / 2;
			points = a.cx === b.cx ? [p1, p2] : [p1, [p1[0], my], [p2[0], my], p2];
			// Label di dekat TUJUAN agar cabang paralel dari satu keputusan tidak saling menimpa.
			lx = a.cx === b.cx ? p1[0] + 5 : p2[0] + 5;
			ly = a.cx === b.cx ? (p1[1] + p2[1]) / 2 + 4 : p2[1] - 6;
		}
		edges.push({ from: a.id, to: b.id, label, back, points, lx, ly });
	}
	const width = globalRight + 24 + loops * 10 + (loops ? 24 : 0);
	const height = Math.max(...laid.map((n) => n.y + n.h)) + PAD + 8;
	return { width, height, nodes: laid, edges, empty: false };
}
