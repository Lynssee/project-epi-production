// src/lib/server/visitMaintenanceBridge.ts
// Fase 3c "4-Gate Site Visit System" (8 Sep 2026) — check-out site_checkin tipe
// 'maintenance' menulis 1 baris `mekanik_activity`, mirror bridgeToVisitLeader/
// bridgeToVisitMarketing. Kill-switch TERPISAH (tulis_visit_maintenance_aktif).
// Kegagalan di sini TIDAK PERNAH boleh menggagalkan check-out.
//
// KEPUTUSAN SADAR (riset schema 8 Sep 2026, sebelum implementasi):
// - mekanik_activity.status_repair_id adalah status PROGRES WO (Open/On Progress/Waiting
//   For Parts/Done/dst, dikelola supervisor+QC lewat modul Maintenance sendiri) — BUKAN
//   kondisi fisik unit (Running/Standby/Breakdown) seperti diasumsikan draft rencana awal.
//   Baris baru dari checkout SELALU dibuat berstatus 'On Progress' (id dicari by name+group,
//   BUKAN hardcode UUID — environment lain bisa beda id). Checkout site-visit TIDAK PERNAH
//   menandai WO 'Done' — itu keputusan supervisor/QC lewat alur approval mekanik_activity
//   yang sudah ada (approval_status pending/approved/rejected).
// - "Status Unit" (Running/Standby/Breakdown) dari form checkout DITULIS SEBAGAI TEKS ke
//   `remarks`, TIDAK mengubah equipment.status_operational atau work_order.order_status —
//   sama alasan seperti keputusan tidak mengubah prospects.stage di visitMarketingBridge.ts:
//   auto-mutasi status aset dari satu checkout lapangan berisiko menabrak alur maintenance
//   yang sudah punya mekanisme sendiri (QC, biaya berjenjang, dst).
// - pic_id (wajib, FK personnel) diresolusi dari karyawan_id lewat personnel.karyawan_id
//   (jembatan resmi, lihat catatan field-nya di Directus). Gagal resolusi -> gagal-lunak,
//   baris TIDAK ditulis, dicatat di catatan_sistem oleh caller (siteCheckin.ts).

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

async function getTulisVisitMaintenanceAktif(): Promise<boolean> {
	const result = await directusServerJson<{ data: { tulis_visit_maintenance_aktif: boolean } }>('/items/site_checkin_settings');
	return !!result?.data?.tulis_visit_maintenance_aktif;
}

// Paket 09 §2.2 — diekspor supaya createCheckin bisa cek lebih awal (saat check-in, bukan
// hanya saat checkout) dan menampilkan peringatan gagal-lunak-tapi-TERLIHAT ke mekanik.
export async function resolvePersonnelId(karyawanId: string): Promise<string | null> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': karyawanId,
		fields: 'id',
		limit: '1'
	});
	const res = await directusServerJson<{ data: { id: string }[] }>(`/items/personnel?${query.toString()}`).catch(() => null);
	return res?.data?.[0]?.id || null;
}

let onProgressCategoryIdCache: { at: number; id: string | null } = { at: 0, id: null };
const CATEGORY_CACHE_TTL_MS = 30 * 60 * 1000;

/** category.id untuk group='wo_status', name='On Progress' — dicari, bukan hardcode UUID. */
async function resolveOnProgressCategoryId(): Promise<string | null> {
	const now = Date.now();
	if (onProgressCategoryIdCache.id && now - onProgressCategoryIdCache.at < CATEGORY_CACHE_TTL_MS) {
		return onProgressCategoryIdCache.id;
	}
	const query = new URLSearchParams({
		'filter[group][_eq]': 'wo_status',
		'filter[name][_eq]': 'On Progress',
		fields: 'id',
		limit: '1'
	});
	const res = await directusServerJson<{ data: { id: string }[] }>(`/items/category?${query.toString()}`).catch(() => null);
	const id = res?.data?.[0]?.id || null;
	onProgressCategoryIdCache = { at: now, id };
	return id;
}

export interface VisitMaintenanceBridgeInput {
	workOrderId: string;
	equipmentId: string;
	karyawanId: string;
	serviceLog?: string | null;
	sparepartDipakai?: string | null;
	statusUnit?: string | null; // 'running' | 'standby' | 'breakdown' — ditulis ke remarks saja
	hourMeter?: number | null;
	// Paket 09 Site Visit Release §2.1 (SVR-27) — waktu KUNJUNGAN (check_in_at), bukan waktu
	// bridge ini dipanggil (checkout/cron bisa jalan jauh setelah kunjungan sebenarnya berakhir,
	// mis. shift malam yang baru ditutup otomatis besok pagi).
	checkInAt?: string | null;
	durasiMenit?: number | null;
}

export async function bridgeToVisitMaintenance(
	input: VisitMaintenanceBridgeInput
): Promise<{ created: boolean; activityId: string | null; reason?: string }> {
	const aktif = await getTulisVisitMaintenanceAktif();
	if (!aktif) return { created: false, activityId: null, reason: 'kill-switch nonaktif' };
	if (!input.workOrderId || !input.equipmentId) return { created: false, activityId: null, reason: 'work_order_id/equipment_id kosong' };

	const [picId, statusRepairId] = await Promise.all([resolvePersonnelId(input.karyawanId), resolveOnProgressCategoryId()]);
	if (!picId) return { created: false, activityId: null, reason: 'personnel tidak ditemukan untuk karyawan ini' };
	if (!statusRepairId) return { created: false, activityId: null, reason: 'kategori status "On Progress" (wo_status) tidak ditemukan' };

	const statusUnitLabel: Record<string, string> = {
		running: 'Running',
		standby: 'Standby',
		breakdown: 'Breakdown'
	};
	const remarksParts = [
		input.statusUnit ? `Status Unit (laporan lapangan): ${statusUnitLabel[input.statusUnit] || input.statusUnit}` : null
	].filter(Boolean);

	// Paket 09 §2.1 (SVR-27): tanggal WIB dari waktu KUNJUNGAN, bukan "sekarang" — sebelumnya
	// pekerjaan 00:00-06:59 WIB (shift malam/pagi buta) tercatat tanggal SEBELUMNYA (UTC slice).
	const tanggalInput = input.checkInAt ? todayJakarta(new Date(input.checkInAt)) : todayJakarta();

	const payload = {
		tanggal_input: tanggalInput,
		pic_id: picId,
		work_order_id: input.workOrderId,
		status_repair_id: statusRepairId,
		equipment_id: input.equipmentId,
		kegiatan_repair: input.serviceLog || 'Kunjungan site (checkout otomatis)',
		hoursmeter: input.hourMeter ?? null,
		sparepart_ringkas: input.sparepartDipakai || null,
		remarks: remarksParts.join(' | ') || null,
		durasi_kerja_menit: input.durasiMenit ?? null,
		approval_status: 'pending'
	};

	const result = await directusServerJson<{ data: { id: string } }>('/items/mekanik_activity', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return { created: true, activityId: result?.data?.id ?? null };
}
