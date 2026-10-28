// src/routes/api/site-checkin/my-work-orders/+server.ts
// "4-Gate Site Visit System" Fase 3c (8 Sep 2026) — GET: daftar work order kandidat untuk
// dropdown check-in tipe 'maintenance'. Union dari:
//   1) work_order.pic_mekanik_1_id/pic_mekanik_2_id = personnel milik karyawan ini (prioritas)
//   2) WO belum selesai lainnya (order_status bukan Done/Cancelled/Closed), dibatasi 100 atau
//      disaring ?q= (nomor WO / nama unit) untuk WO di luar 100 teratas.
// Pola sama my-projects/my-prospects — identitas SELALU dari token Firebase.
//
// Paket 09 Site Visit Release §2.4 (Aturan #2) — SEBELUMNYA query relasi bersarang
// (order_status.name, equipment_id.name) rentan 403 saat relasi berubah, dan daftar tampil
// kosong tanpa penjelasan. Sekarang: category (status tertutup) & equipment diambil TERPISAH.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export interface WorkOrderOption {
	id: string;
	wo_number: string | null;
	equipment_name: string | null;
	peran: 'assigned' | 'lainnya';
}

const CLOSED_STATUS_NAMES = ['Done', 'Cancelled', 'Closed (Migrated)'];
const MAX_LAINNYA = 100;

let closedStatusIdsCache: { at: number; ids: string[] } = { at: 0, ids: [] };
const CACHE_TTL_MS = 30 * 60 * 1000;

async function resolveClosedStatusIds(): Promise<string[]> {
	const now = Date.now();
	if (closedStatusIdsCache.ids.length > 0 && now - closedStatusIdsCache.at < CACHE_TTL_MS) {
		return closedStatusIdsCache.ids;
	}
	const query = new URLSearchParams({
		'filter[group][_eq]': 'wo_status',
		'filter[name][_in]': CLOSED_STATUS_NAMES.join(','),
		fields: 'id',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: { id: string }[] }>(`/items/category?${query.toString()}`);
	const ids = (res?.data || []).map((c) => c.id);
	closedStatusIdsCache = { at: now, ids };
	return ids;
}

async function fetchEquipmentNames(equipmentIds: string[]): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	const uniqueIds = [...new Set(equipmentIds.filter(Boolean))];
	if (uniqueIds.length === 0) return map;
	const query = new URLSearchParams({
		filter: JSON.stringify({ id: { _in: uniqueIds } }),
		fields: 'id,name',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: { id: string; name: string }[] }>(`/items/equipment?${query.toString()}`).catch(() => null);
	for (const e of res?.data || []) map.set(e.id, e.name);
	return map;
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const q = (event.url.searchParams.get('q') || '').trim();
	const results = new Map<string, WorkOrderOption>();

	let closedIds: string[];
	try {
		closedIds = await resolveClosedStatusIds();
	} catch (e) {
		console.error('[SiteCheckin] Gagal resolusi status WO tertutup:', e);
		throw error(502, 'Gagal memuat daftar status Work Order. Coba lagi beberapa saat.');
	}

	// Resolusi personnel.id dari karyawan.id (jembatan resmi, sama dgn visitMaintenanceBridge.ts)
	let personnelId: string | null = null;
	try {
		const pQuery = new URLSearchParams({ 'filter[karyawan_id][_eq]': String(karyawan.id), fields: 'id', limit: '1' });
		const pRes = await directusServerJson<{ data: { id: string }[] }>(`/items/personnel?${pQuery.toString()}`);
		personnelId = pRes?.data?.[0]?.id || null;
	} catch (e) {
		console.warn('[SiteCheckin] Error resolving personnel:', e);
	}

	const rowsAssigned: any[] = [];
	if (personnelId) {
		try {
			const query = new URLSearchParams({
				filter: JSON.stringify({
					_and: [
						{ order_status: { _nin: closedIds } },
						{ _or: [{ pic_mekanik_1_id: { _eq: personnelId } }, { pic_mekanik_2_id: { _eq: personnelId } }] }
					]
				}),
				fields: 'id,wo_number,equipment_id',
				sort: '-created_at',
				limit: '-1'
			});
			const res = await directusServerJson<{ data: any[] }>(`/items/work_order?${query.toString()}`);
			rowsAssigned.push(...(res?.data || []));
		} catch (e) {
			console.warn('[SiteCheckin] Error fetching assigned work orders:', e);
		}
	}

	const rowsLainnya: any[] = [];
	try {
		const lainnyaFilter: any = {
			_and: [
				{ order_status: { _nin: closedIds } },
				...(q.length >= 2 ? [{ _or: [{ wo_number: { _icontains: q } }, { equipment_id: { name: { _icontains: q } } }] }] : [])
			]
		};
		const allQuery = new URLSearchParams({
			filter: JSON.stringify(lainnyaFilter),
			fields: 'id,wo_number,equipment_id',
			sort: '-created_at',
			limit: String(q.length >= 2 ? 50 : MAX_LAINNYA)
		});
		const allRes = await directusServerJson<{ data: any[] }>(`/items/work_order?${allQuery.toString()}`);
		rowsLainnya.push(...(allRes?.data || []));
	} catch (e) {
		console.error('[SiteCheckin] Error fetching open work orders:', e);
		if (rowsAssigned.length === 0) {
			// Bucket "assigned" juga kosong -> daftar akan benar-benar kosong tanpa penjelasan.
			throw error(502, 'Gagal memuat daftar Work Order. Coba lagi beberapa saat atau hubungi admin Maintenance.');
		}
	}

	const equipmentIds = [...rowsAssigned, ...rowsLainnya].map((w) => (typeof w.equipment_id === 'object' ? w.equipment_id?.id : w.equipment_id));
	const equipmentMap = await fetchEquipmentNames(equipmentIds);

	for (const w of rowsAssigned) {
		const eqId = typeof w.equipment_id === 'object' ? w.equipment_id?.id : w.equipment_id;
		results.set(w.id, { id: w.id, wo_number: w.wo_number || null, equipment_name: equipmentMap.get(eqId) || null, peran: 'assigned' });
	}
	const assignedCount = results.size;
	for (const w of rowsLainnya) {
		if (results.has(w.id)) continue;
		const eqId = typeof w.equipment_id === 'object' ? w.equipment_id?.id : w.equipment_id;
		results.set(w.id, { id: w.id, wo_number: w.wo_number || null, equipment_name: equipmentMap.get(eqId) || null, peran: 'lainnya' });
	}

	const allWorkOrders = [...results.values()].sort((a, b) => (a.peran === b.peran ? 0 : a.peran === 'assigned' ? -1 : 1));
	return json({ workOrders: allWorkOrders, assignedCount });
};
