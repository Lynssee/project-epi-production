// src/routes/api/search/knowledgeSearch.test.ts
import { describe, it, expect } from 'vitest';
import {
	normalizeFieldIdentity,
	normalizeFieldSops,
	searchFieldKnowledgeInMemory,
	type SearchConfigLite
} from './knowledgeSearch';

describe('Fase 3: knowledgeSearch (Dashboard Lapangan)', () => {
	const cfg: SearchConfigLite = {
		cacheTtlMinutes: 10,
		synonyms: { visi: ['misi', 'motto', 'budaya'], misi: ['visi', 'motto', 'budaya'] },
		typoAliases: { vsi: 'visi', msisi: 'misi' },
		pinnedLinks: [],
		disabledSources: new Set(),
		sourceWeights: new Map()
	};

	const items = [
		...normalizeFieldIdentity({
			id: 1,
			nama_badan_hukum: 'PT. Eltama Prima Indo',
			visi: 'Menjadi mitra jasa coating terpercaya.',
			misi: ['Mutu terbaik', 'Keselamatan utama'],
			motto: 'Presisi di Setiap Lapisan'
		}),
		...normalizeFieldSops([
			{ id: 2, sop_code: 'HRD015', title: 'SOP Pengajuan Cuti', department: 'HRD', status: 'published' },
			{ id: 3, sop_code: 'HRD999', title: 'SOP Draft', department: 'HRD', status: 'draft' }
		])
	];

	it('menemukan Visi, Misi & Motto saat query "visi misi" atau typo "vsi msisi"', () => {
		const res = searchFieldKnowledgeInMemory(items, 'visi misi', cfg);
		const titles = res.flatMap((g) => g.results.map((r) => r.title));
		expect(titles.some((t) => t.includes('Visi'))).toBe(true);
		expect(titles.some((t) => t.includes('Misi'))).toBe(true);

		const typoRes = searchFieldKnowledgeInMemory(items, 'vsi msisi', cfg);
		expect(typoRes.length).toBeGreaterThan(0);
	});

	it('tidak menampilkan SOP draft dan menghormati disabledSources', () => {
		const sopRes = searchFieldKnowledgeInMemory(items, 'SOP', cfg);
		const titles = sopRes.flatMap((g) => g.results.map((r) => r.title));
		expect(titles.some((t) => t.includes('HRD015'))).toBe(true);
		expect(titles.some((t) => t.includes('HRD999'))).toBe(false);

		const disabled: SearchConfigLite = { ...cfg, disabledSources: new Set(['sop_documents']) };
		expect(searchFieldKnowledgeInMemory(items, 'HRD015', disabled)).toHaveLength(0);
	});
});
