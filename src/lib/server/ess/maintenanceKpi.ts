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
import { hitungMttr, loadMttrSettings, type MttrResult } from './maintenanceMttr';
import { ringkasPmP2h, type PmP2hSaya } from './maintenanceSaya';

export interface MyWorkOrder {
	id: string;
	wo_number: string;
	statusName: string;
	statusSelesai: boolean;
	keluhan: string | null;
	tanggal_rusak: string | null;
	tanggal_done: string | null;
	created_at: string | null;
	/** Target selesai (WO tanpa target = null). */
	target_finish_date: string | null;
	/** WO belum selesai yang sudah melewati target_finish_date (hari ini WIB). */
	terlambat: boolean;
	/** Sedang menunggu pemeriksaan/persetujuan (status Inspection/Approval). */
	menungguQc: boolean;
}

export interface MaintenanceKpiSummary extends MttrResult {
	linked: boolean; // false = karyawan ini tidak punya personnel record tertaut
	personnelName: string | null;
	periode: string | null;
	total: number;
	selesai: number;
	pct: number | null; // null kalau total=0 (bukan 0%, memang tidak ada WO)
	/** WO berstatus selesai tapi tanggal_done kosong -> penyebab MTTR belum bisa dihitung; dipakai sebagai pengingat kelengkapan data. */
	selesaiTanpaTanggal: number;
	openList: MyWorkOrder[]; // WO belum selesai, untuk ditindaklanjuti
	/** Kepatuhan PM & P2H pribadi pada periode aktif; null = gagal dibaca (bukan 0). */
	pmP2h: PmP2hSaya | null;
}

const WO_STATUS_SELESAI = new Set(['done', 'closed (migrated)']);
const WO_STATUS_BATAL = new Set(['cancelled']);
const MENUNGGU_QC = new Set(['inspection', 'approval']);

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
		return { linked: false, personnelName: null, periode: null, total: 0, selesai: 0, pct: null, selesaiTanpaTanggal: 0, mttrJam: null, mttrSample: 0, mttrCoveragePct: null, mttrReady: false, mttrMinSample: 5, mttrMinCoveragePct: 60, openList: [], pmP2h: null };
	}

	const period = await getOpenPeriod();
	const [statusMap] = await Promise.all([getWoStatusMap()]);

	const filter: Record<string, unknown> = {
		_or: [{ pic_mekanik_1_id: { _eq: personnel.id } }, { pic_mekanik_2_id: { _eq: personnel.id } }]
	};
	if (period) {
		// Jangkar tanggal = COALESCE(created_at, tanggal_rusak): WO temuan P2H/PM punya created_at NULL dan sebelumnya hilang dari daftar ini.
		(filter as any)._and = [
			{ _or: filter._or },
			{
				_or: [
					{ created_at: { _between: [period.tanggal_mulai, `${period.tanggal_selesai}T23:59:59`] } },
					{ _and: [{ created_at: { _null: true } }, { tanggal_rusak: { _between: [period.tanggal_mulai, period.tanggal_selesai] } }] }
				]
			}
		];
		delete filter._or;
	}

	const qs = new URLSearchParams({
		filter: JSON.stringify(filter),
		fields: 'id,wo_number,order_status,keluhan,tanggal_rusak,tanggal_done,created_at,target_finish_date',
		sort: '-tanggal_rusak,-created_at',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/work_order?${qs.toString()}`);
	const rows = res?.data || [];
	const todayWib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

	const withStatus: MyWorkOrder[] = rows.map((r) => {
		const statusName = statusMap.get(r.order_status) || '(status tak dikenal)';
		const selesaiWo = WO_STATUS_SELESAI.has(statusName.toLowerCase());
		const target = r.target_finish_date ? String(r.target_finish_date).slice(0, 10) : null;
		return {
			id: r.id,
			wo_number: r.wo_number || `WO-${String(r.id).slice(0, 8)}`, // WO lama tanpa nomor tetap bisa dikenali
			statusName,
			statusSelesai: selesaiWo,
			keluhan: r.keluhan,
			tanggal_rusak: r.tanggal_rusak,
			tanggal_done: r.tanggal_done,
			created_at: r.created_at,
			target_finish_date: target,
			terlambat: !selesaiWo && !!target && target < todayWib,
			menungguQc: !selesaiWo && MENUNGGU_QC.has(statusName.toLowerCase())
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
		selesaiTanpaTanggal: selesai.filter((w) => !w.tanggal_done).length,
		...hitungMttr(selesai, await loadMttrSettings()),
		openList: dinilai.filter((w) => !w.statusSelesai),
		pmP2h: await ringkasPmP2h(personnel, period)
	};
}
