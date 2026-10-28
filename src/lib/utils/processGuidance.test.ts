// src/lib/utils/processGuidance.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLaneSections, laneOfNode } from './processGuidance';
import { PROCESS_FLOWS, getProcessFlow } from '../data/processGuidance';

const flow = PROCESS_FLOWS[0];

describe('data panduan alur (lapangan)', () => {
	it('edge hanya merujuk node yang ada; lane node terdaftar; sel (lane,col,row) unik', () => {
		const ids = new Set(flow.nodes.map((n) => n.id));
		const lanes = new Set(flow.lanes.map((l) => l.key));
		for (const e of flow.edges) {
			expect(ids.has(e.from), `edge from ${e.from}`).toBe(true);
			expect(ids.has(e.to), `edge to ${e.to}`).toBe(true);
		}
		for (const n of flow.nodes) expect(lanes.has(n.lane), `lane ${n.lane}`).toBe(true);
		const cells = flow.nodes.map((n) => `${n.lane}:${n.col}:${n.row ?? 0}`);
		expect(new Set(cells).size).toBe(cells.length);
	});

	it('setiap pintasan menuju route (app) yang ada di project-epi', () => {
		for (const n of flow.nodes) {
			for (const a of n.actions ?? []) {
				const p = resolve(process.cwd(), 'src/routes/(app)', a.href.replace(/^\//, ''), '+page.svelte');
				expect(existsSync(p), `${n.id} → ${a.href}`).toBe(true);
			}
		}
	});

	it('cabang PO Jasa/Cat/Rental ada dan tombol bantuan kontekstual menunjuk id node yang valid', () => {
		const out = flow.edges.filter((e) => e.from === 'so').map((e) => e.label);
		expect(out).toEqual(expect.arrayContaining(['PO Cat', 'PO Jasa', 'PO Rental']));
		for (const id of ['survey', 'so']) expect(flow.nodes.some((n) => n.id === id)).toBe(true);
	});

	// Cermin erp-epi: id node & edge harus sama. Dilewati bila repo erp-epi tidak ada di sebelah (mis. CI).
	const erpCfg = resolve(process.cwd(), '..', 'erp-epi', 'src/lib/config/processGuidanceConfig.js');
	it.skipIf(!existsSync(erpCfg))('id node & edge sama dengan konfigurasi dashboard admin (erp-epi)', () => {
		const src = readFileSync(erpCfg, 'utf8');
		const erpNodeIds = [...src.matchAll(/id: '([a-z_]+)', type:/g)].map((m) => m[1]).sort();
		expect(flow.nodes.map((n) => n.id).sort()).toEqual(erpNodeIds);
		const erpEdges = [...src.matchAll(/\{ from: '([a-z_]+)', to: '([a-z_]+)'/g)].map((m) => `${m[1]}->${m[2]}`).sort();
		expect(flow.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(erpEdges);
	});
});

describe('buildLaneSections', () => {
	it('mengelompokkan per lane, membuang lane kosong, mengurut kolom lalu baris', () => {
		const s = buildLaneSections(flow);
		expect(s.map((x) => x.key)).toEqual(['sales', 'inventory', 'produksi', 'proyek']);
		const sales = s[0].nodes.map((n) => n.id);
		expect(sales.indexOf('start')).toBeLessThan(sales.indexOf('survey'));
		expect(sales.indexOf('minta_produk')).toBeLessThan(sales.indexOf('spk_proyek'));
		expect(sales.indexOf('spk_proyek')).toBeLessThan(sales.indexOf('kontrak_sewa'));
		const kosong = buildLaneSections({ ...flow, lanes: [...flow.lanes, { key: 'x', label: 'X' }] });
		expect(kosong).toHaveLength(4);
	});

	it('next: kondisi percabangan & loop balik ditandai backward', () => {
		const pen = buildLaneSections(flow)[0].nodes.find((n) => n.id === 'penawaran')!;
		const ditolak = pen.next.find((x) => x.condition === 'ditolak')!;
		expect(ditolak.toId).toBe('survey');
		expect(ditolak.backward).toBe(true);
		expect(pen.next.find((x) => x.condition === 'diterima')!.backward).toBe(false);
	});

	it('aman untuk null/edge ke node tak dikenal', () => {
		expect(buildLaneSections(null)).toEqual([]);
		expect(buildLaneSections(undefined)).toEqual([]);
		const s = buildLaneSections({ ...flow, edges: [...flow.edges, { from: 'start', to: 'hantu' }] });
		expect(s[0].nodes.find((n) => n.id === 'start')!.next.map((x) => x.toId)).toEqual(['survey']);
	});

	it('laneOfNode & getProcessFlow', () => {
		expect(laneOfNode(flow, 'spk_produksi')).toBe('produksi');
		expect(laneOfNode(flow, 'tidak-ada')).toBeNull();
		expect(laneOfNode(null, 'x')).toBeNull();
		expect(getProcessFlow('sales_to_inventory')).not.toBeNull();
		expect(getProcessFlow('nope')).toBeNull();
	});
});
