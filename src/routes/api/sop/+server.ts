// src/routes/api/sop/+server.ts
// SERVER-ONLY. Endpoint pembaca katalog SOP untuk dashboard lapangan (project-epi).
// Hemat kuota: in-memory cache 5 menit, pemisahan query Directus antar relasi.

import { json, type RequestHandler } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedSops: any[] | null = null;
let lastCacheTime = 0;

const LIST_FIELDS = 'id,title,sop_code,department,approval_status,status,version,version_seq,effective_date,review_due_date,sosialisasi_end_date,target_departments,target_roles,flow_id,kebijakan_id,requires_training,kategori_sop,sub_kategori,tags';
const DETAIL_FIELDS = `${LIST_FIELDS},content,ai_summary,keterangan,external_flowchart_url,external_doc_url`;

// Fase 5 SOP Proyek — SOP Proyek & K3 yang TERBIT di process_guidance_flows (SSOT) ikut tampil di katalog, read-only.
// sop_documents tetap sumber SOP umum (dengan konfirmasi baca); alur ditandai source:'flow' dan dibuka di /panduan/alur
// (konfirmasi baca alur memakai /api/process-guidance/read-confirm yang sudah ada). Cache 5 menit, 1 query Directus.
const FLOW_FILTER =
	'filter[status][_eq]=published&filter[_or][0][sop_code][_starts_with]=SOP-PRJ&filter[_or][1][sop_code][_starts_with]=SOP-OPS-PRJ&filter[_or][2][sop_code][_starts_with]=SOP-HSE';
let cachedFlowSops: any[] | null = null;
let lastFlowCacheTime = 0;

async function loadFlowSops(): Promise<any[]> {
	const now = Date.now();
	if (cachedFlowSops && now - lastFlowCacheTime < CACHE_TTL_MS) return cachedFlowSops;
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/process_guidance_flows?${FLOW_FILTER}&fields=id,flow_key,title,sop_code,version,kategori_sop,sub_kategori&sort=sop_code&limit=-1`
		);
		cachedFlowSops = (Array.isArray(res?.data) ? res.data : []).map((f) => ({
			id: -Number(f.id), // negatif: tak bentrok dengan id sop_documents
			title: f.title,
			sop_code: f.sop_code,
			department: String(f.sop_code || '').startsWith('SOP-HSE') ? 'HSE' : 'Operasional Proyek',
			approval_status: 'published',
			status: 'published',
			version: String(f.version ?? ''),
			version_seq: Number(f.version || 1),
			kategori_sop: f.kategori_sop || null,
			sub_kategori: f.sub_kategori || null,
			tags: [],
			source: 'flow',
			flow_key: f.flow_key
		}));
		lastFlowCacheTime = now;
	} catch (e: any) {
		// Gagal baca alur tidak boleh mematikan katalog SOP umum — dicatat, katalog tetap tampil tanpa alur.
		console.error('[/api/sop project-epi] gagal membaca alur terbit:', e?.message || e);
		return cachedFlowSops || [];
	}
	return cachedFlowSops;
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const url = event.url;
	const idParam = url.searchParams.get('id');
	const searchParam = url.searchParams.get('search');
	const tagParam = url.searchParams.get('tag');
	const kategoriParam = url.searchParams.get('kategori');
	const subKategoriParam = url.searchParams.get('sub_kategori');
	const includeContent = url.searchParams.get('include_content') === 'true';

	try {
		// 1. Ambil detail satu SOP
		if (idParam) {
			const sopRes = await directusServerJson<{ data: any }>(
				`/items/sop_documents/${encodeURIComponent(idParam)}?fields=${DETAIL_FIELDS}`
			);
			const sop = sopRes?.data;
			if (!sop) {
				return json({ success: false, error: 'SOP tidak ditemukan' }, { status: 404 });
			}

			let isConfirmed = false;
			if (karyawan?.id) {
				const confRes = await directusServerJson<{ data: any[] }>(
					`/items/sop_read_confirmations?filter[sop_id][_eq]=${sop.id}&filter[karyawan_id][_eq]=${karyawan.id}&limit=1&fields=id,sop_version_seq,confirmed_at`
				).catch(() => null);
				const conf = confRes?.data?.[0];
				if (conf && Number(conf.sop_version_seq || 0) >= Number(sop.version_seq || 1)) {
					isConfirmed = true;
				}
			}

			return json({ success: true, data: { ...sop, is_confirmed: isConfirmed } });
		}

		// 2. Ambil daftar SOP berstatus published atau butuh_sosialisasi
		const now = Date.now();
		let sops: any[] = [];
		if (cachedSops && now - lastCacheTime < CACHE_TTL_MS) {
			sops = cachedSops;
		} else {
			const res = await directusServerJson<{ data: any[] }>(
				`/items/sop_documents?filter[approval_status][_in]=published,butuh_sosialisasi&fields=${includeContent ? DETAIL_FIELDS : LIST_FIELDS}&sort=sop_code,title&limit=-1`
			);
			sops = Array.isArray(res?.data) ? res.data : [];
			cachedSops = sops;
			lastCacheTime = now;
		}

		// Gabungkan alur terbit (hindari ganda bila sop_documents sudah menautkan alur yang sama lewat flow_id / kode).
		const flowSops = await loadFlowSops();
		const haveCodes = new Set(sops.map((s) => String(s.sop_code || '').toUpperCase()).filter(Boolean));
		const haveFlowIds = new Set(sops.map((s) => Number(s.flow_id)).filter((n) => Number.isFinite(n) && n > 0));
		sops = [...sops, ...flowSops.filter((f) => !haveCodes.has(String(f.sop_code || '').toUpperCase()) && !haveFlowIds.has(-f.id))];

		let filtered = sops;
		if (kategoriParam) {
			const targetKat = kategoriParam.toLowerCase().trim();
			filtered = filtered.filter((s) => (s.kategori_sop || '').toLowerCase() === targetKat);
		}

		if (subKategoriParam) {
			const targetSub = subKategoriParam.toLowerCase().trim();
			filtered = filtered.filter((s) => (s.sub_kategori || '').toLowerCase() === targetSub);
		}

		if (tagParam) {
			const targetTag = tagParam.toLowerCase().trim();
			filtered = filtered.filter((s) => {
				if (!Array.isArray(s.tags)) return false;
				return s.tags.some((t: any) => String(t).toLowerCase() === targetTag);
			});
		}

		if (searchParam) {
			const q = searchParam.toLowerCase().trim();
			filtered = filtered.filter((s) => {
				const matchTitle = (s.title || '').toLowerCase().includes(q);
				const matchCode = (s.sop_code || '').toLowerCase().includes(q);
				const matchDept = (s.department || '').toLowerCase().includes(q);
				const matchSub = (s.sub_kategori || '').toLowerCase().includes(q);
				const matchTags = Array.isArray(s.tags) && s.tags.some((t: any) => String(t).toLowerCase().includes(q));
				return matchTitle || matchCode || matchDept || matchSub || matchTags;
			});
		}

		// Ambil status konfirmasi baca user aktif secara terpisah
		if (karyawan?.id) {
			const confRes = await directusServerJson<{ data: any[] }>(
				`/items/sop_read_confirmations?filter[karyawan_id][_eq]=${karyawan.id}&limit=-1&fields=sop_id,sop_version_seq,confirmed_at`
			).catch(() => null);
			const confList = Array.isArray(confRes?.data) ? confRes.data : [];
			const confMap = new Map<number, number>();
			for (const c of confList) {
				if (c.sop_id) confMap.set(c.sop_id, Number(c.sop_version_seq || 0));
			}

			filtered = filtered.map((s) => ({
				...s,
				is_confirmed: (confMap.get(s.id) ?? 0) >= Number(s.version_seq || 1)
			}));
		}

		return json({ success: true, count: filtered.length, data: filtered });
	} catch (err: any) {
		console.error('[/api/sop project-epi] Gagal mengambil SOP:', err?.message || err);
		return json({ success: false, error: err?.message || 'Gagal memuat SOP' }, { status: 500 });
	}
};
