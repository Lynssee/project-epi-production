// src/lib/server/searchService.ts
// SERVER-ONLY. Jalur A (live fan-out) untuk Global Deep Search, Tier-1
// Dashboard Lapangan.
//
// Aturan bisnis (lihat Rencana_Implementasi_Deep_Search_v2.pdf §1):
// - Koleksi payroll TIDAK PERNAH masuk daftar di bawah — gate-nya adalah
//   "tidak pernah didaftarkan", bukan filter runtime.
// - 403/error per-koleksi diperlakukan sebagai kosong (senyap).
// - "panduan" bukan koleksi Directus — konten statis, dicari in-memory.

import { directusServerJson } from './directus';
import { modulDokumentasi } from '$lib/data/panduan';
import { tokenize, matchQuery } from '../utils/searchMatch';

export interface SearchSource {
	id: string;
	entity: string;
	collection: string;
	permission: string | string[];
	searchFields: string[];
	fields: string[];
	titleField: string;
	subtitleFields: string[];
}

export const SEARCH_SOURCES: SearchSource[] = [
	{
		id: 'projects',
		entity: 'Proyek',
		collection: 'projects',
		permission: ['view_all_projects', 'view_own_projects'],
		searchFields: ['name', 'nomor_po', 'lokasi'],
		fields: ['id', 'name', 'status', 'lokasi', 'nomor_po', 'leader', 'leader_id'],
		titleField: 'name',
		subtitleFields: ['nomor_po', 'lokasi']
	},
	{
		id: 'work_order',
		entity: 'Work Order',
		collection: 'work_order',
		permission: 'input_maintenance',
		searchFields: ['wo_number', 'keluhan'],
		fields: ['id', 'wo_number', 'status', 'keluhan'],
		titleField: 'wo_number',
		subtitleFields: ['status']
	},
	{
		id: 'equipment',
		entity: 'Equipment',
		collection: 'equipment',
		permission: 'input_maintenance',
		searchFields: ['name', 'code'],
		fields: ['id', 'name', 'code'],
		titleField: 'name',
		subtitleFields: ['code']
	},
	{
		id: 'maint_tickets',
		entity: 'Tiket Maintenance',
		collection: 'maint_tickets',
		permission: 'input_maintenance',
		searchFields: ['nomor_tiket', 'masalah'],
		fields: ['id', 'nomor_tiket', 'masalah', 'status'],
		titleField: 'nomor_tiket',
		subtitleFields: ['masalah']
	},
	{
		id: 'identitas_barang',
		entity: 'Sparepart / Stock',
		collection: 'identitas_barang',
		permission: ['view_stock_lapangan', 'input_stock_lapangan'],
		searchFields: ['nama_barang_lengkap'],
		fields: ['id', 'nama_barang_lengkap', 'satuan', 'stok_tersedia'],
		titleField: 'nama_barang_lengkap',
		subtitleFields: ['satuan']
	},
	{
		id: 'surat_jalan',
		entity: 'Surat Jalan',
		collection: 'surat_jalan',
		permission: ['view_stock_lapangan', 'input_stock_lapangan', 'access_ess'],
		searchFields: ['nomor_sj', 'penerima'],
		fields: ['id', 'nomor_sj', 'status', 'penerima'],
		titleField: 'nomor_sj',
		subtitleFields: ['status', 'penerima']
	},
	{
		id: 'pengajuan_anggaran',
		entity: 'Pengajuan Anggaran',
		collection: 'pengajuan_anggaran',
		permission: ['request_budget', 'approve_budget', 'access_ess'],
		searchFields: ['nomor_pengajuan', 'kategori_belanja'],
		fields: ['id', 'nomor_pengajuan', 'status', 'kategori_belanja', 'total_amount'],
		titleField: 'nomor_pengajuan',
		subtitleFields: ['status', 'kategori_belanja']
	},
	{
		id: 'karyawan',
		entity: 'Karyawan / Manpower',
		collection: 'karyawan',
		permission: ['view_manpower', 'access_ess'],
		searchFields: ['nama_karyawan', 'nik', 'jabatan'],
		fields: ['id', 'nama_karyawan', 'nik', 'jabatan'],
		titleField: 'nama_karyawan',
		subtitleFields: ['nik', 'jabatan']
	}
];

// mode 'and': setiap token harus cocok di suatu field (AND antar-token, OR antar-field).
// mode 'or': token manapun cocok di field manapun (fallback saat AND nol hasil).
function buildTokenFilter(searchFields: string[], tokens: string[], mode: 'and' | 'or') {
	const perTokenOr = tokens.map((t) => ({ _or: searchFields.map((f) => ({ [f]: { _icontains: t } })) }));
	return mode === 'and' ? { _and: perTokenOr } : { _or: perTokenOr };
}

function scoreMatch(title: string, q: string) {
	const needle = q.toLowerCase();
	const t = title.toLowerCase();
	if (t === needle) return 100;
	if (t.startsWith(needle)) return 80;
	if (t.includes(needle)) return 60;
	return 40;
}

/** Resolve leader identity (karyawan) dari email, dipakai untuk scope "view_own_projects". */
async function resolveLeaderFilterValue(email: string): Promise<{ id: number; nama_karyawan: string } | null> {
	try {
		const qs = new URLSearchParams({
			filter: JSON.stringify({ email_company: { _eq: email.toLowerCase() } }),
			fields: 'id,nama_karyawan',
			limit: '1'
		});
		const result = await directusServerJson(`/items/karyawan?${qs.toString()}`);
		return result?.data?.[0] || null;
	} catch {
		return null;
	}
}

async function searchOneSource(
	source: SearchSource,
	q: string,
	tokens: string[],
	mode: 'and' | 'or',
	ctx: { leaderScope: { id: number; nama_karyawan: string } | null }
) {
	try {
		let filter: any = buildTokenFilter(source.searchFields, tokens, mode);

		// Batasi "projects" ke milik leader sendiri bila user hanya punya
		// view_own_projects (bukan view_all_projects) — selaras gate di
		// src/lib/services/projects.ts getProjects(leaderParam, ...).
		if (source.id === 'projects' && ctx.leaderScope) {
			const leaderFilter = {
				_or: [
					{ leader_id: { _eq: ctx.leaderScope.id } },
					{ co_leader_id: { _eq: ctx.leaderScope.id } },
					{ leader: { _icontains: ctx.leaderScope.nama_karyawan } },
					{ co_leader: { _icontains: ctx.leaderScope.nama_karyawan } }
				]
			};
			filter = { _and: [filter, leaderFilter] };
		}

		const qs = new URLSearchParams({
			filter: JSON.stringify(filter),
			fields: source.fields.join(','),
			limit: '8'
		});
		const result = await directusServerJson(`/items/${source.collection}?${qs.toString()}`);
		return (result?.data || []).map((item: any) => ({
			entity: source.entity,
			source: source.id,
			id: item.id,
			title: item[source.titleField] || '(tanpa judul)',
			subtitle: source.subtitleFields.map((f) => item[f]).filter(Boolean).join(' · '),
			score: scoreMatch(String(item[source.titleField] || ''), q)
		}));
	} catch (err: any) {
		// 403/error per-koleksi diperlakukan sebagai kosong (senyap).
		console.warn(`[searchService] gagal mencari koleksi "${source.collection}":`, err?.message || err);
		return [];
	}
}

// Jalur B — Tier-2 via search_index (disinkron n8n W2, lihat rencana §5-6).
// module_key dicocokkan langsung ke permission (FeatureKey) user Lapangan.
const TIER2_ENTITY_LABELS: Record<string, string> = {
	reports: 'Laporan Harian',
	manpower_assignment: 'SPK Manpower'
};

function tier2TokenFilter(tokens: string[], mode: 'and' | 'or') {
	const perTokenOr = tokens.map((t) => ({
		_or: [
			{ title: { _icontains: t } },
			{ subtitle: { _icontains: t } },
			{ body_text: { _icontains: t } },
			{ keywords: { _icontains: t } }
		]
	}));
	return mode === 'and' ? { _and: perTokenOr } : { _or: perTokenOr };
}

async function searchTier2Index(q: string, tokens: string[], mode: 'and' | 'or', permissions: string[]) {
	const isSuperAdmin = permissions.includes('*');
	try {
		const andFilter: any[] = [tier2TokenFilter(tokens, mode)];
		if (!isSuperAdmin) {
			andFilter.push({ module_key: { _in: permissions.length ? permissions : ['__none__'] } });
		}
		const qs = new URLSearchParams({
			filter: JSON.stringify({ _and: andFilter }),
			fields: 'id,source_collection,source_id,title,subtitle,module_key,url',
			limit: '20'
		});
		const result = await directusServerJson(`/items/search_index?${qs.toString()}`);
		return (result?.data || []).map((item: any) => ({
			entity: TIER2_ENTITY_LABELS[item.source_collection] || item.source_collection,
			source: item.source_collection,
			id: item.source_id,
			title: item.title || '(tanpa judul)',
			subtitle: item.subtitle || '',
			score: scoreMatch(item.title || '', q)
		}));
	} catch (err: any) {
		// 403/error diperlakukan sebagai kosong (senyap) — sama seperti Jalur A.
		console.warn('[searchService] gagal mencari search_index (Jalur B):', err?.message || err);
		return [];
	}
}

function searchPanduan(q: string) {
	return modulDokumentasi
		.filter((m) => matchQuery(q, [m.nama, m.deskripsi]))
		.slice(0, 8)
		.map((m) => ({
			entity: 'Panduan',
			source: 'panduan',
			id: m.id,
			title: m.nama,
			subtitle: m.deskripsi,
			score: scoreMatch(m.nama, q),
			url: m.href
		}));
}

export async function runSearch({
	q,
	permissions,
	roleId,
	userEmail
}: {
	q: string;
	permissions: string[];
	roleId: string | null;
	userEmail: string | null;
}) {
	const isSuperAdmin = permissions.includes('*');
	const allowedSources = SEARCH_SOURCES.filter((s) => {
		if (isSuperAdmin) return true;
		const required = Array.isArray(s.permission) ? s.permission : [s.permission];
		return required.some((p) => permissions.includes(p));
	});

	// "view_own_projects" tanpa "view_all_projects" → scope proyek ke leader sendiri.
	let leaderScope: { id: number; nama_karyawan: string } | null = null;
	const needsLeaderScope =
		!isSuperAdmin &&
		permissions.includes('view_own_projects') &&
		!permissions.includes('view_all_projects');
	if (needsLeaderScope && userEmail) {
		leaderScope = await resolveLeaderFilterValue(userEmail);
	}

	const tokens = tokenize(q);
	if (!tokens.length) return [];

	async function runOnce(mode: 'and' | 'or') {
		const settled = await Promise.allSettled([
			...allowedSources.map((s) => searchOneSource(s, q, tokens, mode, { leaderScope })),
			searchTier2Index(q, tokens, mode, permissions)
		]);
		return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
	}

	function group(flat: any[]) {
		const grouped = new Map<string, any[]>();
		for (const item of flat) {
			if (!grouped.has(item.entity)) grouped.set(item.entity, []);
			grouped.get(item.entity)!.push(item);
		}
		for (const list of grouped.values()) list.sort((a, b) => b.score - a.score);
		return Array.from(grouped.entries()).map(([entity, results]) => ({ entity, results }));
	}

	let flat = await runOnce('and');
	// Panduan: konten publik statis, selalu tercari (tidak butuh permission Directus).
	flat.push(...searchPanduan(q));

	if (flat.length || tokens.length < 2) return group(flat);

	// AND antar-token nol hasil dan query multi-kata — coba OR sebagai
	// "Hasil terkait" (Rencana_Implementasi_Pertajam_Search_v3.pdf Q2).
	const flatOr = await runOnce('or');
	flatOr.push(...searchPanduan(q));
	return group(flatOr).map((g) => ({ ...g, fallback: true }));
}
