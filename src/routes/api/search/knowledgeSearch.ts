// src/routes/api/search/knowledgeSearch.ts
// Fase 3 Pertajam Global Search (Dashboard Lapangan): lapisan pencarian
// pengetahuan & identitas perusahaan (Visi, Misi, Motto, Nilai Inti, Panduan,
// FAQ, SOP, Peta Alur Bisnis, Pengumuman) + pembacaan konfigurasi dinamis
// `app_settings` (module = 'global_search') dengan in-memory cache + single-flight.

import { directusServerJson } from '$lib/server/directus';
import { tokenize, normalizeText, buildBlob } from '$lib/utils/searchMatch';

export interface KnowledgeItem {
	id: string;
	source: string;
	entity: string;
	title: string;
	subtitle: string;
	answer_snippet?: string;
	url: string;
	blob: string;
}

export interface SearchConfigLite {
	cacheTtlMinutes: number;
	synonyms: Record<string, string[]>;
	typoAliases: Record<string, string>;
	pinnedLinks: Array<{
		id: string;
		keywords: string[];
		title: string;
		subtitle?: string;
		href: string;
		badge?: string;
		answer_summary?: string;
		active?: boolean;
	}>;
	disabledSources: Set<string>;
	sourceWeights: Map<string, number>;
}

const DEFAULT_SYNONYMS: Record<string, string[]> = {
	visi: ['misi', 'motto', 'budaya', 'nilai inti', 'perusahaan', 'direktur'],
	misi: ['visi', 'motto', 'budaya', 'nilai inti', 'perusahaan'],
	motto: ['visi', 'misi', 'budaya', 'semboyan'],
	budaya: ['visi', 'misi', 'motto', 'nilai inti', 'propaganda', 'perusahaan'],
	propaganda: ['budaya', 'tbm', 'visi', 'misi'],
	perusahaan: ['visi', 'misi', 'budaya', 'sop', 'pt eltama'],
	sop: ['prosedur', 'panduan', 'buku saku', 'aturan'],
	faq: ['bantuan', 'panduan', 'tanya jawab', 'kendala']
};

const DEFAULT_TYPOS: Record<string, string> = {
	rport: 'report',
	propganda: 'propaganda',
	jobdes: 'jobdesc',
	budya: 'budaya',
	vsi: 'visi',
	msisi: 'misi'
};

let cfgCache: { at: number; ttlMs: number; value: SearchConfigLite } | null = null;
let cfgInflight: Promise<SearchConfigLite> | null = null;
let knowledgeCache: { at: number; ttlMs: number; items: KnowledgeItem[] } | null = null;
let knowledgeInflight: Promise<KnowledgeItem[]> | null = null;

function safeStr(v: unknown): string {
	return v == null ? '' : String(v).trim();
}

export async function loadFieldSearchConfig(): Promise<SearchConfigLite> {
	const now = Date.now();
	if (cfgCache && now - cfgCache.at < cfgCache.ttlMs) return cfgCache.value;
	if (cfgInflight) return cfgInflight;

	cfgInflight = (async () => {
		try {
			const res = await directusServerJson(
				'/items/app_settings?filter[module][_eq]=global_search&fields=setting_key,setting_value&limit=-1'
			);
			const raw: Record<string, any> = {};
			for (const r of res?.data || []) {
				if (!r?.setting_key) continue;
				try {
					raw[r.setting_key] = JSON.parse(r.setting_value);
				} catch {
					raw[r.setting_key] = r.setting_value;
				}
			}
			const cacheTtlMinutes = Math.max(1, Math.min(120, Number(raw.general?.cache_ttl_minutes) || 10));
			const disabledSources = new Set<string>();
			const sourceWeights = new Map<string, number>();
			if (Array.isArray(raw.sources)) {
				for (const s of raw.sources) {
					if (!s?.id) continue;
					if (s.active === false) disabledSources.add(String(s.id));
					if (Number.isFinite(Number(s.weight))) sourceWeights.set(String(s.id), Number(s.weight));
				}
			}
			const val: SearchConfigLite = {
				cacheTtlMinutes,
				synonyms: { ...DEFAULT_SYNONYMS, ...(raw.synonyms && typeof raw.synonyms === 'object' ? raw.synonyms : {}) },
				typoAliases: { ...DEFAULT_TYPOS, ...(raw.typo_aliases && typeof raw.typo_aliases === 'object' ? raw.typo_aliases : {}) },
				pinnedLinks: Array.isArray(raw.pinned_links) ? raw.pinned_links : [],
				disabledSources,
				sourceWeights
			};
			cfgCache = { at: Date.now(), ttlMs: cacheTtlMinutes * 60 * 1000, value: val };
			return val;
		} catch (e: any) {
			console.warn('[project-epi/knowledgeSearch] gagal baca app_settings:', e?.message || e);
			const fallback: SearchConfigLite = {
				cacheTtlMinutes: 10,
				synonyms: DEFAULT_SYNONYMS,
				typoAliases: DEFAULT_TYPOS,
				pinnedLinks: [],
				disabledSources: new Set(),
				sourceWeights: new Map()
			};
			cfgCache = { at: Date.now(), ttlMs: 60_000, value: fallback };
			return fallback;
		} finally {
			cfgInflight = null;
		}
	})();

	return cfgInflight;
}

export function normalizeFieldQuery(rawQuery: string, typos: Record<string, string>): string {
	const norm = normalizeText(rawQuery);
	if (!norm) return '';
	return norm
		.split(/\s+/)
		.map((t) => typos[t] || t)
		.join(' ');
}

export function normalizeFieldIdentity(row: any): KnowledgeItem[] {
	if (!row || typeof row !== 'object') return [];
	const items: KnowledgeItem[] = [];
	const companyName = safeStr(row.nama_badan_hukum) || 'PT. Eltama Prima Indo';
	const visi = safeStr(row.visi);
	const misiList = Array.isArray(row.misi) ? row.misi.map(safeStr).filter(Boolean) : [];
	const motto = safeStr(row.motto);

	if (visi) {
		items.push({
			id: `identity_visi_${row.id || 1}`,
			source: 'company_identity',
			entity: 'Budaya & Identitas Perusahaan',
			title: `Visi ${companyName}`,
			subtitle: visi,
			answer_snippet: visi,
			url: '/ess/budaya',
			blob: buildBlob(['visi perusahaan tujuan', companyName, visi, safeStr(row.tagline)])
		});
	}
	if (misiList.length) {
		items.push({
			id: `identity_misi_${row.id || 1}`,
			source: 'company_identity',
			entity: 'Budaya & Identitas Perusahaan',
			title: `Misi ${companyName} (${misiList.length} Butir)`,
			subtitle: misiList[0],
			answer_snippet: misiList.map((m, i) => `${i + 1}. ${m}`).join(' '),
			url: '/ess/budaya',
			blob: buildBlob(['misi perusahaan langkah tujuan', companyName, ...misiList])
		});
	}
	if (motto) {
		items.push({
			id: `identity_motto_${row.id || 1}`,
			source: 'company_identity',
			entity: 'Budaya & Identitas Perusahaan',
			title: `Motto: "${motto}"`,
			subtitle: safeStr(row.tagline) || companyName,
			answer_snippet: motto,
			url: '/ess/budaya',
			blob: buildBlob(['motto semboyan budaya perusahaan', motto, safeStr(row.manifesto_budaya)])
		});
	}
	return items;
}

export function normalizeFieldCoreValues(rows: any[] = []): KnowledgeItem[] {
	return rows
		.filter((r) => r && (r.aktif === 1 || r.aktif === true || r.aktif === undefined))
		.map((r) => ({
			id: `core_value_${r.id}`,
			source: 'company_core_values',
			entity: 'Budaya & Identitas Perusahaan',
			title: `Nilai Inti${r.kode ? ` (${r.kode})` : ''}: ${safeStr(r.judul)}`,
			subtitle: safeStr(r.arti_singkat),
			answer_snippet: safeStr(r.arti_singkat),
			url: '/ess/budaya',
			blob: buildBlob(['nilai inti core values budaya', r.kode, r.judul, r.arti_singkat])
		}));
}

export function normalizeFieldSops(rows: any[] = []): KnowledgeItem[] {
	return rows
		.filter((r) => r && ['published', 'active'].includes(String(r.status || '').toLowerCase()))
		.map((r) => ({
			id: `sop_${r.id}`,
			source: 'sop_documents',
			entity: 'SOP Resmi',
			title: `${r.sop_code ? `${r.sop_code} — ` : ''}${safeStr(r.title)}`,
			subtitle: [safeStr(r.department), safeStr(r.keterangan || r.ai_summary).slice(0, 110)]
				.filter(Boolean)
				.join(' · '),
			answer_snippet: safeStr(r.ai_summary || r.keterangan),
			url: `/ess/pelatihan/sop?id=${r.id}`,
			blob: buildBlob([
				'sop prosedur pedoman',
				r.sop_code,
				r.title,
				r.department,
				r.keterangan,
				r.ai_summary,
				...(Array.isArray(r.tags) ? r.tags : [])
			])
		}));
}

async function safeFetch(path: string): Promise<any[]> {
	try {
		const res = await directusServerJson(path);
		return res?.data ?? [];
	} catch (err: any) {
		console.warn(`[project-epi/knowledgeSearch] skip ${path}:`, err?.message || err);
		return [];
	}
}

export async function loadFieldKnowledgeIndex(ttlMinutes = 10): Promise<KnowledgeItem[]> {
	const now = Date.now();
	if (knowledgeCache && now - knowledgeCache.at < knowledgeCache.ttlMs) return knowledgeCache.items;
	if (knowledgeInflight) return knowledgeInflight;

	knowledgeInflight = (async () => {
		const [identityRaw, coreValuesRaw, panduanModsRaw, panduanFaqRaw, sopRaw, flowsRaw, pengumumanRaw] =
			await Promise.all([
				safeFetch('/items/company_identity?fields=id,nama_badan_hukum,tagline,visi,misi,motto,manifesto_budaya&limit=1'),
				safeFetch('/items/company_core_values?fields=id,kode,judul,arti_singkat,aktif&sort=urutan&limit=-1'),
				safeFetch('/items/panduan_modules?fields=id,slug,nama,kategori_slug,deskripsi,href,target_app,status&limit=-1'),
				safeFetch('/items/panduan_faq?fields=id,tanya,jawab,target_app&limit=-1'),
				safeFetch('/items/sop_documents?fields=id,title,sop_code,department,status,keterangan,ai_summary,tags&limit=-1'),
				safeFetch('/items/process_guidance_flows?fields=id,flow_key,title,description,target_app,status&limit=-1'),
				safeFetch('/items/hr_pengumuman?fields=id,judul,isi,kategori,aktif&sort=-tanggal_mulai&limit=100')
			]);

		const identityRow = Array.isArray(identityRaw) ? identityRaw[0] : identityRaw;
		const items: KnowledgeItem[] = [
			...normalizeFieldIdentity(identityRow),
			...normalizeFieldCoreValues(Array.isArray(coreValuesRaw) ? coreValuesRaw : []),
			...(Array.isArray(panduanModsRaw) ? panduanModsRaw : [])
				.filter((r) => r && r.status === 'published' && (!r.target_app || r.target_app === 'project-epi' || r.target_app === 'both'))
				.map((r) => ({
					id: `panduan_mod_${r.id}`,
					source: 'panduan_modules',
					entity: 'Panduan & Bantuan',
					title: safeStr(r.nama),
					subtitle: safeStr(r.deskripsi).slice(0, 140),
					url: safeStr(r.href) || '/panduan',
					blob: buildBlob(['panduan modul bantuan', r.nama, r.slug, r.deskripsi])
				})),
			...(Array.isArray(panduanFaqRaw) ? panduanFaqRaw : [])
				.filter((r) => r && (!r.target_app || r.target_app === 'project-epi' || r.target_app === 'both'))
				.map((r) => ({
					id: `panduan_faq_${r.id}`,
					source: 'panduan_faq',
					entity: 'Panduan & Bantuan',
					title: safeStr(r.tanya),
					subtitle: safeStr(r.jawab).slice(0, 140),
					answer_snippet: safeStr(r.jawab),
					url: '/bantuan',
					blob: buildBlob(['faq tanya jawab bantuan kendala', r.tanya, r.jawab])
				})),
			...normalizeFieldSops(Array.isArray(sopRaw) ? sopRaw : []),
			...(Array.isArray(flowsRaw) ? flowsRaw : [])
				.filter((r) => r && r.status === 'published' && (!r.target_app || r.target_app === 'project-epi' || r.target_app === 'both'))
				.map((r) => ({
					id: `flow_${r.id}`,
					source: 'process_guidance_flows',
					entity: 'Peta Alur Bisnis',
					title: safeStr(r.title) || safeStr(r.flow_key),
					subtitle: safeStr(r.description).slice(0, 140),
					url: `/panduan/alur?flow=${encodeURIComponent(r.flow_key || '')}`,
					blob: buildBlob(['alur kerja proses bisnis flowchart', r.flow_key, r.title, r.description])
				})),
			...(Array.isArray(pengumumanRaw) ? pengumumanRaw : [])
				.filter((r) => r && (r.aktif === 1 || r.aktif === true || r.aktif === undefined))
				.map((r) => ({
					id: `pengumuman_${r.id}`,
					source: 'hr_pengumuman',
					entity: 'Pengumuman Perusahaan',
					title: safeStr(r.judul),
					subtitle: safeStr(r.isi).slice(0, 140),
					url: '/ess/pengumuman',
					blob: buildBlob(['pengumuman edaran hrd', r.kategori, r.judul, r.isi])
				}))
		];

		knowledgeCache = { at: Date.now(), ttlMs: ttlMinutes * 60 * 1000, items };
		return items;
	})();

	try {
		return await knowledgeInflight;
	} finally {
		knowledgeInflight = null;
	}
}

export function searchFieldKnowledgeInMemory(items: KnowledgeItem[], rawQuery: string, cfg: SearchConfigLite) {
	const cleaned = normalizeFieldQuery(rawQuery, cfg.typoAliases);
	const tokens = tokenize(cleaned);
	if (!tokens.length) return [];

	const tokenGroups = tokens.map((t) => {
		const s = new Set([t]);
		const syns = cfg.synonyms[t];
		if (Array.isArray(syns)) {
			for (const syn of syns.slice(0, 6)) {
				for (const st of tokenize(syn)) s.add(st);
			}
		}
		return Array.from(s);
	});

	const grouped = new Map<string, any[]>();
	for (const item of items) {
		if (cfg.disabledSources.has(item.source)) continue;
		const titleNorm = normalizeText(item.title);
		const subNorm = normalizeText(item.subtitle);

		let matchScore = 0;
		if (titleNorm === cleaned) matchScore = 100;
		else if (titleNorm.startsWith(cleaned)) matchScore = 88;
		else if (titleNorm.includes(cleaned)) matchScore = 76;
		else if (subNorm.includes(cleaned)) matchScore = 66;
		else {
			let matched = 0;
			for (const group of tokenGroups) {
				if (group.some((v) => item.blob.includes(v))) matched++;
			}
			if (matched === tokenGroups.length) matchScore = 58;
			else if (tokenGroups.length >= 2 && matched / tokenGroups.length >= 0.5) matchScore = 34;
		}
		if (matchScore === 0) continue;

		const weight = cfg.sourceWeights.get(item.source) ?? 80;
		const score = Math.round(matchScore * (0.6 + (weight / 100) * 0.4));
		if (!grouped.has(item.entity)) grouped.set(item.entity, []);
		grouped.get(item.entity)!.push({
			entity: item.entity,
			source: item.source,
			id: item.id,
			title: item.title,
			subtitle: item.subtitle,
			answer_snippet: item.answer_snippet || '',
			url: item.url,
			score
		});
	}

	const pinned = cfg.pinnedLinks
		.filter((p) => {
			if (p?.active === false) return false;
			return (p.keywords || []).some((kw) => {
				const k = String(kw || '').trim().toLowerCase();
				return k && (cleaned === k || cleaned.includes(k) || k.includes(cleaned));
			});
		})
		.map((p) => ({
			entity: 'Jawaban & Tautan Tersemat',
			source: 'pinned_link',
			id: p.id,
			title: p.title,
			subtitle: p.answer_summary || p.subtitle || '',
			answer_snippet: p.answer_summary || '',
			url: p.href,
			score: 120
		}));

	const groups = Array.from(grouped.entries()).map(([entity, results]) => ({
		entity,
		results: results.sort((a, b) => b.score - a.score).slice(0, 6)
	}));
	groups.sort((a, b) => (b.results[0]?.score || 0) - (a.results[0]?.score || 0));

	return pinned.length ? [{ entity: 'Jawaban & Tautan Tersemat', results: pinned }, ...groups] : groups;
}

export async function runFieldKnowledgeSearch(rawQuery: string) {
	const cfg = await loadFieldSearchConfig();
	const items = await loadFieldKnowledgeIndex(cfg.cacheTtlMinutes);
	return searchFieldKnowledgeInMemory(items, rawQuery, cfg);
}
