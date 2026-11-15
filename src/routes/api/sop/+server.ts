// src/routes/api/sop/+server.ts
// SERVER-ONLY. Endpoint pembaca katalog SOP untuk dashboard lapangan (project-epi).
// Hemat kuota: in-memory cache 5 menit, pemisahan query Directus antar relasi.

import { json, type RequestHandler } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedSops: any[] | null = null;
let lastCacheTime = 0;

const LIST_FIELDS = 'id,title,sop_code,department,approval_status,status,version,version_seq,effective_date,review_due_date,sosialisasi_end_date,target_departments,target_roles,flow_id,kebijakan_id,requires_training';
const DETAIL_FIELDS = `${LIST_FIELDS},content,ai_summary,keterangan,kategori_sop,sub_kategori,external_flowchart_url,external_doc_url`;

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const url = event.url;
	const idParam = url.searchParams.get('id');
	const searchParam = url.searchParams.get('search');
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

		let filtered = sops;
		if (searchParam) {
			const q = searchParam.toLowerCase().trim();
			filtered = filtered.filter(
				(s) =>
					(s.title || '').toLowerCase().includes(q) ||
					(s.sop_code || '').toLowerCase().includes(q) ||
					(s.department || '').toLowerCase().includes(q)
			);
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
