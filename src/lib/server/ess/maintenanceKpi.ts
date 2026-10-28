// src/lib/server/ess/maintenanceKpi.ts
// Pertajam KPI v2 Fase 5B — "My WO Scorecard" untuk mekanik/teknisi maintenance.
//
// Cakupan SENGAJA dipersempit dari rencana dokumen v2 (WO selesai, response time, P2H
// compliance) menjadi WO completion saja:
//   - "Response time" (MTTR) TIDAK dibuat — work_order.tanggal_done 93% null di produksi
//     (Fase 0 audit, erp-epi-1 _kpi-audit-fase0.js), rata-rata jam akan didominasi data hilang.
//   - "PM Due Reminder" TIDAK dibuat — koleksi maint_preventive 0 baris, tidak ada jadwal PM
//     apa pun untuk diingatkan.
//   - "Equipment under my care" ditunda sesuai anjuran dokumen sendiri (§Fase 5B.3).
//
// Identitas mekanik: personnel.karyawan_id → personnel.id → work_order.pic_mekanik_1_id /
// pic_mekanik_2_id. Hanya 25/39 baris personnel yang tertaut karyawan (Fase 0 audit lama,
// gap yang sama dengan sisi admin) — karyawan tanpa personnel record melihat status kosong,
// bukan error.

import { directusServerJson } from '$lib/server/directus';

export interface MyWorkOrder {
	id: string;
	wo_number: string;
	statusName: string;
	statusSelesai: boolean;
	keluhan: string | null;
	tanggal_rusak: string | null;
	tanggal_done: string | null;
	created_at: string | null;
}

export interface MaintenanceKpiSummary {
	linked: boolean; // false = karyawan ini tidak punya personnel record tertaut
	personnelName: string | null;
	periode: string | null;
	total: number;
	selesai: number;
	pct: number | null; // null kalau total=0 (bukan 0%, memang tidak ada WO)
	openList: MyWorkOrder[]; // WO belum selesai, untuk ditindaklanjuti
}

const WO_STATUS_SELESAI = new Set(['done', 'closed (migrated)']);
const WO_STATUS_BATAL = new Set(['cancelled']);

let woStatusMapCache: Map<string, string> | null = null;
async function getWoStatusMap(): Promise<Map<string, string>> {
	if (woStatusMapCache) return woStatusMapCache;
	const qs = new URLSearchParams({
		'filter[group][_eq]': 'wo_status',
		fields: 'id,name',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: { id: string; name: string }[] }>(`/items/category?${qs.toString()}`);
	woStatusMapCache = new Map((res?.data || []).map((r) => [r.id, r.name]));
	return woStatusMapCache;
}

async function resolvePersonnelId(karyawanId: number): Promise<{ id: string; name: string } | null> {
	const qs = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: 'id,name',
		limit: '1'
	});
	const res = await directusServerJson<{ data: { id: string; name: string }[] }>(`/items/personnel?${qs.toString()}`);
	return res?.data?.[0] || null;
}

async function getOpenPeriod(): Promise<{ id: string; kode: string; tanggal_mulai: string; tanggal_selesai: string } | null> {
	const qs = new URLSearchParams({
		fields: 'id,kode,status,tanggal_mulai,tanggal_selesai',
		sort: '-tanggal_mulai',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/kpi_period?${qs.toString()}`);
	const rows = res?.data || [];
	return rows.find((r) => r.status === 'open') || rows[0] || null;
}

export async function getMyMaintenanceKpi(karyawanId: number): Promise<MaintenanceKpiSummary> {
	const personnel = await resolvePersonnelId(karyawanId);
	if (!personnel) {
		return { linked: false, personnelName: null, periode: null, total: 0, selesai: 0, pct: null, openList: [] };
	}

	const period = await getOpenPeriod();
	const [statusMap] = await Promise.all([getWoStatusMap()]);

	const filter: Record<string, unknown> = {
		_or: [{ pic_mekanik_1_id: { _eq: personnel.id } }, { pic_mekanik_2_id: { _eq: personnel.id } }]
	};
	if (period) {
		(filter as any)._and = [
			{ _or: filter._or },
			{ created_at: { _between: [period.tanggal_mulai, `${period.tanggal_selesai}T23:59:59`] } }
		];
		delete filter._or;
	}

	const qs = new URLSearchParams({
		filter: JSON.stringify(filter),
		fields: 'id,wo_number,order_status,keluhan,tanggal_rusak,tanggal_done,created_at',
		sort: '-created_at',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/work_order?${qs.toString()}`);
	const rows = res?.data || [];

	const withStatus: MyWorkOrder[] = rows.map((r) => {
		const statusName = statusMap.get(r.order_status) || '(status tak dikenal)';
		return {
			id: r.id,
			wo_number: r.wo_number,
			statusName,
			statusSelesai: WO_STATUS_SELESAI.has(statusName.toLowerCase()),
			keluhan: r.keluhan,
			tanggal_rusak: r.tanggal_rusak,
			tanggal_done: r.tanggal_done,
			created_at: r.created_at
		};
	});

	const dinilai = withStatus.filter((w) => !WO_STATUS_BATAL.has(w.statusName.toLowerCase()));
	const selesai = dinilai.filter((w) => w.statusSelesai);
	const pct = dinilai.length > 0 ? Math.round((selesai.length / dinilai.length) * 10000) / 100 : null;

	return {
		linked: true,
		personnelName: personnel.name,
		periode: period?.kode || null,
		total: dinilai.length,
		selesai: selesai.length,
		pct,
		openList: dinilai.filter((w) => !w.statusSelesai)
	};
}
