// src/lib/server/siteCheckin.ts
// Fase 1 Check-in Berbasis Event / Kunjungan Proyek (v3). Logika bisnis server-side.
// Prinsip mutlak (lihat implementation plan v3 §3): site_checkin = bukti, absensi_harian
// tetap kebenaran payroll. Identitas karyawan SELALU dari token Firebase (authenticateEss),
// tidak pernah dari body klien. Semua perhitungan jarak di server.

import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { haversineMeters, withinRadius, computeAntiFakeGpsScore } from '$lib/server/ess/geo';
import { todayJakarta } from '$lib/server/ess/time';
import { bridgeToVisitLeader } from '$lib/server/visitLeaderBridge';
import { bridgeToVisitMarketing, type BantStatus } from '$lib/server/visitMarketingBridge';
import { bridgeToVisitMaintenance, resolvePersonnelId } from '$lib/server/visitMaintenanceBridge';
import { notifyProjectSiteCheckin, notifyProjectSiteCheckout } from '$lib/server/projectNotify';
import { notifySalesServer } from '$lib/server/salesNotifyRelay';

/** Paket 09 §0 — dipetakan ke HTTP 422 di +server.ts. */
export class TipeMaintenanceNonaktifError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TipeMaintenanceNonaktifError';
	}
}

export const TIER_VALUES = ['Jabodetabek', 'Luar Jabodetabek, pulau jawa', 'Luar pulau jawa'] as const;
export type TierAbsensi = (typeof TIER_VALUES)[number];

export interface SiteCheckinSettings {
	id: number;
	foto_checkin_wajib: boolean;
	foto_checkout_wajib: boolean;
	auto_checkout_on_report: boolean;
	auto_close_midnight: boolean;
	max_durasi_jam: number;
	min_durasi_menit: number;
	geofence_fallback_mode: boolean;
	radius_default_m: number;
	ambang_km_jawa: number;
	ambang_km_luar_jawa: number;
	tulis_balik_absensi_aktif: boolean;
	tulis_balik_butuh_verifikasi: boolean;
	tulis_visit_leader_aktif: boolean;
	// Paket 04 Site Visit Release §3.1 — gate akurasi GPS vs sinkron payroll.
	akurasi_maks_m: number | null;
	akurasi_mode: 'shadow' | 'soft' | 'hard' | null;
	akurasi_enforce_from: string | null;
	// §3.7 — whitelist status proyek untuk tab "Kunjungan" (csv), bukan hardcode.
	status_proyek_kunjungan: string | null;
	// Paket 05 Site Visit Release §3.1 (SVR-20) — jarak minimum hari sebelum notifikasi
	// visit_anomali yang SAMA (karyawan+lokasi) boleh dikirim ulang.
	anomali_cooldown_hari: number | null;
	// §3.2 (SVR-21) — ambang durasi khusus picker klaim finansial (reimburse/BBM), terpisah
	// dari min_durasi_menit (payroll) karena tujuannya beda.
	min_durasi_menit_finansial: number | null;
	// Paket 08b Site Visit Release §4.2 — radius geofence customer (marketing), terpisah dari
	// radius_default_m (proyek) karena konteksnya beda.
	radius_customer_m: number | null;
	// Paket 09 Site Visit Release §0 — tab Maintenance disembunyikan & check-in maintenance
	// ditolak server sampai flag ini diaktifkan (alur belum pernah dipakai di produksi).
	tipe_maintenance_aktif: boolean;
	// Paket 10 Site Visit Release §2.2 — jam pengingat lupa checkout (csv, WIB), default 17:30,21:00.
	pengingat_checkout_jam: string | null;
}

export interface SiteCheckinRecord {
	id: string;
	karyawan_id: string;
	tipe_checkin: string;
	referensi_id: number | null;
	referensi_uuid: string | null;
	nama_lokasi: string | null;
	tier_absensi: TierAbsensi | null;
	area_sumber: 'master_proyek' | 'usulan_jarak' | 'manual_hrd' | null;
	area_status: 'diterapkan' | 'usulan' | 'ditolak' | null;
	check_in_at: string;
	lat_in: number;
	lng_in: number;
	akurasi_in_m: number | null;
	anti_fake_gps_score: number | null;
	foto_in_id: string | null;
	jarak_in_m: number | null;
	jarak_dari_kantor_m: number | null;
	in_geofence: boolean | null;
	check_out_at: string | null;
	lat_out: number | null;
	lng_out: number | null;
	akurasi_out_m: number | null;
	foto_out_id: string | null;
	checkout_method: string | null;
	durasi_menit: number | null;
	absensi_harian_id: string | null;
	absensi_sinkron: boolean;
	absensi_anomali: string | null;
	catatan: string | null;
	catatan_sistem: string | null;
	status: 'active' | 'completed' | 'cancelled';
	// Paket 02 §3.9 — dedup replay checkout offline (pola sama client_txn_id check-in, SV-12).
	checkout_client_txn_id?: string | null;
	[key: string]: any;
}

interface ProjectGeo {
	id: number;
	name: string;
	tier_absensi: TierAbsensi | null;
	geo_lat: number | null;
	geo_lng: number | null;
	geo_radius_m: number | null;
}

// "4-Gate Site Visit System" Fase 3 (8 Sep 2026): tipe_checkin selain 'proyek'/
// 'peminjaman_kendaraan' (sudah ada sejak Fase 4 sebelumnya).
export type TipeKeperluan = 'proyek' | 'marketing' | 'maintenance';

interface ProspectGeo {
	id: number;
	name: string | null;
	company: string | null;
	customer_id: number | null;
}

async function getProspect(prospectId: number): Promise<ProspectGeo | null> {
	const query = new URLSearchParams({ fields: 'id,name,company,customer_id' });
	try {
		const result = await directusServerJson<{ data: ProspectGeo }>(`/items/prospects/${prospectId}?${query.toString()}`);
		return result?.data || null;
	} catch {
		return null;
	}
}

interface WorkOrderRef {
	id: string;
	wo_number: string | null;
	equipment_id: string | null;
	equipment_name: string | null;
}

/** work_order + nama equipment (untuk nama_lokasi) — location TIDAK punya lat/lng di skema
 *  live (dicek saat riset Fase 3c), jadi geofence maintenance SELALU null, sama pola marketing
 *  tanpa customer_id. */
// Paket 09 §2.4 (Aturan #2) — equipment diambil di query TERPISAH, bukan `equipment_id.name`
// bersarang: relasi berubah/gagal resolve di WO ini tidak boleh membuat SELURUH fetch WO 403.
async function getWorkOrder(workOrderId: string): Promise<WorkOrderRef | null> {
	const query = new URLSearchParams({ fields: 'id,wo_number,equipment_id' });
	try {
		const result = await directusServerJson<{ data: any }>(`/items/work_order/${workOrderId}?${query.toString()}`);
		const wo = result?.data;
		if (!wo) return null;
		const equipmentId = typeof wo.equipment_id === 'object' ? wo.equipment_id?.id : wo.equipment_id;
		let equipmentName: string | null = null;
		if (equipmentId) {
			const eqRes = await directusServerJson<{ data: { name: string } | null }>(`/items/equipment/${equipmentId}?fields=id,name`).catch(() => null);
			equipmentName = eqRes?.data?.name || null;
		}
		return {
			id: wo.id,
			wo_number: wo.wo_number || null,
			equipment_id: equipmentId,
			equipment_name: equipmentName
		};
	} catch (e) {
		console.error('[SiteCheckin] Gagal memuat work_order:', e);
		return null;
	}
}

/** master_customer.latitude/longitude (BUKAN geo_lat/geo_lng — nama field sebenarnya di
 *  skema live berbeda dari draft rencana awal). Dipakai geofence check-in marketing bila
 *  prospek sudah tertaut ke customer existing. Null bila customer tak punya koordinat. */
async function getCustomerGeo(customerId: number): Promise<{ lat: number; lng: number; radiusM: number | null } | null> {
	const query = new URLSearchParams({ fields: 'id,latitude,longitude' });
	try {
		const result = await directusServerJson<{ data: { latitude: number | null; longitude: number | null } }>(
			`/items/master_customer/${customerId}?${query.toString()}`
		);
		const c = result?.data;
		if (!c || c.latitude == null || c.longitude == null) return null;
		return { lat: c.latitude, lng: c.longitude, radiusM: null };
	} catch {
		return null;
	}
}

/** Paket 08b — nama tampilan customer untuk kunjungan marketing langsung ke master_customer
 *  (jalur A, TANPA prospek). Query terpisah, bukan nested. */
async function getMasterCustomerBasic(customerId: number): Promise<{ id: number; customer_name: string } | null> {
	try {
		const result = await directusServerJson<{ data: { id: number; nama_sj_fp: string } }>(
			`/items/master_customer/${customerId}?fields=id,nama_sj_fp`
		);
		return result?.data ? { id: result.data.id, customer_name: result.data.nama_sj_fp } : null;
	} catch {
		return null;
	}
}

/** Ambil singleton konfigurasi Site Check-in (kill-switch, radius default, dll). */
export async function getSiteCheckinSettings(): Promise<SiteCheckinSettings> {
	const result = await directusServerJson<{ data: SiteCheckinSettings }>('/items/site_checkin_settings');
	return result.data;
}

async function getProject(projectId: number): Promise<ProjectGeo | null> {
	const query = new URLSearchParams({
		fields: 'id,name,tier_absensi,geo_lat,geo_lng,geo_radius_m'
	});
	try {
		const result = await directusServerJson<{ data: ProjectGeo }>(`/items/projects/${projectId}?${query.toString()}`);
		return result?.data || null;
	} catch {
		return null;
	}
}

/**
 * Titik referensi "kantor pusat" untuk usulan jarak (S-2). Dicocokkan lewat nama, bukan
 * "baris aktif pertama" — lokasi_absensi bisa berisi banyak titik non-kantor (gudang/workshop)
 * di masa depan (lihat rencana field lokasi_absensi.tier_absensi).
 */
export async function getKantorPusat(): Promise<{ lat: number; lng: number } | null> {
	const query = new URLSearchParams({
		'filter[aktif][_eq]': 'true',
		'filter[nama][_icontains]': 'kantor pusat',
		fields: 'lat,lng',
		sort: 'id',
		limit: '1'
	});
	const result = await directusServerJson<{ data: { lat: number; lng: number }[] }>(`/items/lokasi_absensi?${query.toString()}`);
	return result?.data?.[0] || null;
}

/**
 * Tentukan tier_absensi untuk sebuah proyek. SELALU mengembalikan salah satu dari 3 string
 * sah di TIER_VALUES, atau null — tidak pernah 'Jawa' (S-2). Urutan sumber:
 *   1) projects.tier_absensi (master data, sumber='master_proyek', langsung 'diterapkan')
 *   2) usulan berbasis jarak dari kantor pusat (sumber='usulan_jarak', status='usulan' — wajib ACC HRD)
 *   3) null (belum bisa ditentukan)
 */
export async function resolveTierAbsensi(
	projectId: number
): Promise<{ tier: TierAbsensi | null; sumber: 'master_proyek' | 'usulan_jarak' | null; status: 'diterapkan' | 'usulan' | null; jarakDariKantorM: number | null }> {
	const project = await getProject(projectId);
	if (!project) return { tier: null, sumber: null, status: null, jarakDariKantorM: null };

	if (project.tier_absensi && (TIER_VALUES as readonly string[]).includes(project.tier_absensi)) {
		return { tier: project.tier_absensi, sumber: 'master_proyek', status: 'diterapkan', jarakDariKantorM: null };
	}

	if (project.geo_lat != null && project.geo_lng != null) {
		const kantor = await getKantorPusat();
		if (kantor) {
			const jarakM = haversineMeters(project.geo_lat, project.geo_lng, kantor.lat, kantor.lng);
			if (jarakM != null) {
				const settings = await getSiteCheckinSettings();
				const jarakKm = jarakM / 1000;
				let usulan: TierAbsensi;
				if (jarakKm <= settings.ambang_km_jawa) usulan = 'Jabodetabek';
				else if (jarakKm <= settings.ambang_km_luar_jawa) usulan = 'Luar Jabodetabek, pulau jawa';
				else usulan = 'Luar pulau jawa';
				return { tier: usulan, sumber: 'usulan_jarak', status: 'usulan', jarakDariKantorM: jarakM };
			}
		}
	}

	return { tier: null, sumber: null, status: null, jarakDariKantorM: null };
}

const KOORDINAT_SALAH_TOLERANSI_M = 100; // "hampir identik" = selisih jarak_in_m antar kunjungan <= ini
const KOORDINAT_SALAH_MIN_KUNJUNGAN = 3;
const KOORDINAT_SALAH_COOLDOWN_HARI = 14; // jangan spam notif untuk proyek yang sama tiap kunjungan

/**
 * SV-11 (correction plan site-visit-payroll): koordinat proyek yang salah (mis. hasil input GA/PM
 * meleset beberapa km) membuat SETIAP kunjungan ke proyek itu ditandai "di luar geofence" dengan
 * jarak_in_m yang nyaris sama persis — pola konstan itu tanda koordinat proyek yang salah, BUKAN
 * GPS karyawan yang tidak akurat (yang biasanya jarak_in_m acak). Deteksi dari 3 kunjungan terakhir
 * ke proyek yang sama; fail-soft mutlak, tidak pernah menggagalkan check-in.
 */
async function cekKoordinatProyekKemungkinanSalah(projectId: number, projectName: string): Promise<void> {
	const query = new URLSearchParams({
		'filter[tipe_checkin][_eq]': 'proyek',
		'filter[referensi_id][_eq]': String(projectId),
		'filter[in_geofence][_eq]': 'false',
		// Paket 04 §3.4 (SVR-18) — GPS kasar TIDAK BOLEH dipakai menilai koordinat proyek.
		// Jarak "hampir sama" dari HP yang akurasinya ±2000m bisa kebetulan, bukan sinyal
		// koordinat proyek yang salah.
		'filter[akurasi_in_m][_lte]': '100',
		sort: '-check_in_at',
		limit: String(KOORDINAT_SALAH_MIN_KUNJUNGAN),
		fields: 'id,jarak_in_m,karyawan_id'
	});
	const res = await directusServerJson<{ data: { id: string; jarak_in_m: number | null; karyawan_id: string }[] }>(
		`/items/site_checkin?${query.toString()}`
	);
	const rows = res?.data || [];
	if (rows.length < KOORDINAT_SALAH_MIN_KUNJUNGAN) return;

	// Paket 04 §3.4 (SVR-18) — minimal 2 karyawan BERBEDA di antara kunjungan ini. Satu HP
	// yang bermasalah (mis. GPS drift konsisten karena kondisi perangkat) bisa menghasilkan
	// jarak_in_m yang mirip berkali-kali TANPA berarti koordinat proyeknya yang salah.
	const karyawanUnik = new Set(rows.map((r) => r.karyawan_id));
	if (karyawanUnik.size < 2) return;

	const jarakList = rows.map((r) => r.jarak_in_m).filter((j): j is number => j != null);
	if (jarakList.length < KOORDINAT_SALAH_MIN_KUNJUNGAN) return;
	const selisih = Math.max(...jarakList) - Math.min(...jarakList);
	if (selisih > KOORDINAT_SALAH_TOLERANSI_M) return; // jarak bervariasi -> kemungkinan GPS acak, bukan koordinat salah

	// Hindari notifikasi berulang untuk proyek yang sama dalam masa cooldown.
	// Paket 04 §3.4 (Aturan #1): app_notifications TIDAK punya date_created — memakainya
	// selalu 403, dedup ini TIDAK PERNAH benar-benar jalan (silent-fail lewat .catch di
	// pemanggil). Field yang benar adalah created_at.
	const cooldownDate = new Date(Date.now() - KOORDINAT_SALAH_COOLDOWN_HARI * 24 * 3600 * 1000).toISOString();
	const existingQuery = new URLSearchParams({
		'filter[type][_eq]': 'koordinat_proyek_salah',
		'filter[source_collection][_eq]': 'projects',
		'filter[source_id][_eq]': String(projectId),
		'filter[created_at][_gte]': cooldownDate,
		limit: '1',
		fields: 'id'
	});
	const existingRes = await directusServerJson<{ data: { id: number }[] }>(`/items/app_notifications?${existingQuery.toString()}`);
	if ((existingRes?.data || []).length > 0) return;

	await directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'koordinat_proyek_salah',
			title: 'Koordinat Proyek Kemungkinan Salah',
			message: `${KOORDINAT_SALAH_MIN_KUNJUNGAN} kunjungan terakhir ke "${projectName}" selalu di luar geofence dengan jarak hampir sama (~${Math.round(jarakList[0])} m) — kemungkinan koordinat proyek meleset, bukan GPS karyawan.`,
			priority: 'medium',
			source_collection: 'projects',
			source_id: String(projectId),
			action_url: `/hrd?tab=wizard-lokasi-proyek`,
			action_type: 'view_wizard_lokasi_proyek'
		})
	});
}

/** Reuse geofence dari ess/geo.ts — jarak & validitas terhadap koordinat proyek. */
export function computeProjectGeofence(
	lat: number,
	lng: number,
	project: { geo_lat: number | null; geo_lng: number | null; geo_radius_m: number | null },
	radiusDefaultM: number
): { jarakM: number | null; inGeofence: boolean | null } {
	if (project.geo_lat == null || project.geo_lng == null) return { jarakM: null, inGeofence: null };
	const { valid, jarak } = withinRadius(lat, lng, project.geo_lat, project.geo_lng, project.geo_radius_m || radiusDefaultM);
	return { jarakM: jarak, inGeofence: valid };
}

export async function findActiveCheckin(karyawanId: string): Promise<SiteCheckinRecord | null> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': karyawanId,
		'filter[status][_eq]': 'active',
		sort: '-check_in_at',
		limit: '1'
	});
	const result = await directusServerJson<{ data: SiteCheckinRecord[] }>(`/items/site_checkin?${query.toString()}`);
	return result?.data?.[0] || null;
}

/**
 * Paket 02 §3.9.2 (worst case I) — resolusi checkin_id dari client_txn_id, untuk checkout
 * yang diantrekan SEBELUM check-in pasangannya sendiri tersinkron (mis. checkout ditekan
 * offline segera setelah check-in offline, urutan flush menjamin check-in dikirim duluan —
 * tapi baris server-nya baru ADA setelah itu benar-benar berhasil). Dibatasi karyawan_id
 * yang sama (klaim milik orang lain tidak mungkin lewat jalur ini).
 */
export async function findCheckinByClientTxnId(karyawanId: string, clientTxnId: string): Promise<SiteCheckinRecord | null> {
	const query = new URLSearchParams({
		'filter[client_txn_id][_eq]': clientTxnId,
		'filter[karyawan_id][_eq]': karyawanId,
		fields: '*',
		limit: '1'
	});
	const result = await directusServerJson<{ data: SiteCheckinRecord[] }>(`/items/site_checkin?${query.toString()}`);
	return result?.data?.[0] || null;
}

async function findAbsensiHarianPadaTanggal(karyawanId: string, tanggal: string): Promise<{ id: string; lokasi: string | null; tanggal: string } | null> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': karyawanId,
		'filter[tanggal][_eq]': tanggal,
		fields: 'id,lokasi,tanggal',
		limit: '1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/absensi_harian?${query.toString()}`);
	return result?.data?.[0] || null;
}

/** true bila periode (bulan berjalan absensi) terkunci — cek absensi_lock (tanggal=YYYY-MM-01). */
async function isPeriodLocked(tanggal: string): Promise<boolean> {
	const [year, month] = tanggal.split('-');
	const lockTanggal = `${year}-${month}-01`;
	try {
		const query = new URLSearchParams({ 'filter[tanggal][_eq]': lockTanggal, fields: 'is_locked', limit: '1' });
		const result = await directusServerJson<{ data: { is_locked: boolean }[] }>(`/items/absensi_lock?${query.toString()}`);
		if (result?.data?.[0]?.is_locked) return true;
	} catch {
		/* koleksi absensi_lock opsional di sebagian env — jangan gagalkan kalau tak ada */
	}
	try {
		const periode = tanggal.slice(0, 7);
		const query = new URLSearchParams({ 'filter[periode][_eq]': periode, fields: 'locked', limit: '1' });
		const result = await directusServerJson<{ data: { locked: boolean }[] }>(`/items/payroll_period_lock?${query.toString()}`);
		if (result?.data?.[0]?.locked) return true;
	} catch {
		/* idem */
	}
	return false;
}

const TIER_KONFLIK_LOKASI = new Set(['Dinas Luar Kota', 'WFH']);

// SV-07 — aturan tulis: tier TERTINGGI per hari menang, tidak pernah menurunkan otomatis.
// "Kantor Pusat - ..." (nilai default absensi kantor) dianggap rank 0, di bawah 3 tier resmi.
const TIER_RANK: Record<string, number> = {
	Jabodetabek: 1,
	'Luar Jabodetabek, pulau jawa': 2,
	'Luar pulau jawa': 3
};
function rankLokasi(lokasi: string | null): number {
	if (!lokasi) return 0;
	return TIER_RANK[lokasi] ?? 0; // "Kantor Pusat - ...", "-", dll -> 0 (selalu boleh ditimpa)
}

// Paket 04 §3.1/§3.3 — Aturan #3 (anti-lockdown retroaktif): mode `hard`/`soft` baru hanya
// berlaku mulai `akurasi_enforce_from`. Sebelum tanggal itu (atau bila belum diset / mode
// bukan hard/soft), selalu diperlakukan sebagai `shadow` (hanya dicatat, tidak menahan apa pun).
export function modeAkurasiEfektif(mode: string | null, enforceFrom: string | null): 'shadow' | 'soft' | 'hard' {
	if (mode !== 'hard' && mode !== 'soft') return 'shadow';
	if (!enforceFrom) return 'shadow';
	return todayJakarta() < enforceFrom.slice(0, 10) ? 'shadow' : mode;
}

/** Ditolak saat createCheckin (mode `hard` sudah berlaku) — dipetakan ke HTTP 422 di +server.ts. */
export class AkurasiGpsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AkurasiGpsError';
	}
}

/**
 * Jembatan payroll (S-10a/b, aturan tulis-balik §3). NOL efek bila
 * settings.tulis_balik_absensi_aktif === false (default Fase 1) — hanya merekam status di
 * site_checkin.absensi_sinkron/absensi_anomali, tidak pernah menyentuh payrollSync.js.
 *
 * SV-02: `tanggalCheckin` WAJIB tanggal WIB dari check_in_at kunjungan, BUKAN tanggal saat
 * fungsi ini dipanggil (checkout/cron bisa jatuh di hari berikutnya) — kalau tidak, lokasi
 * tidak pernah tertulis untuk hari kunjungan yang sebenarnya (lihat correction plan SV-02).
 */
export async function syncAbsensiLokasi(
	checkin: Pick<SiteCheckinRecord, 'karyawan_id' | 'tier_absensi' | 'area_status'> & { akurasi_in_m?: number | null },
	tanggalCheckin: string,
	opts?: { paksa?: boolean } // paksa: true -> ACC manual HRD (resync), lewati gate akurasi (keputusan manusia)
): Promise<{ synced: boolean; absensiHarianId: string | null; anomali: string | null }> {
	const settings = await getSiteCheckinSettings();
	if (!settings.tulis_balik_absensi_aktif) {
		return { synced: false, absensiHarianId: null, anomali: null };
	}
	// Paket 04 §3.3 — akurasi GPS rendah tidak otomatis masuk tunjangan (mode soft/hard setelah
	// enforce_from). Dicek SEBELUM tier_absensi supaya anomali ini tidak tertutup 'tier_tidak_diketahui'.
	const modeAkurasi = modeAkurasiEfektif(settings.akurasi_mode, settings.akurasi_enforce_from);
	const akurasiBuruk = checkin.akurasi_in_m != null && checkin.akurasi_in_m > (settings.akurasi_maks_m || 500);
	if (akurasiBuruk && modeAkurasi !== 'shadow' && !opts?.paksa) {
		return { synced: false, absensiHarianId: null, anomali: 'akurasi_gps_rendah' };
	}
	if (!checkin.tier_absensi || !(TIER_VALUES as readonly string[]).includes(checkin.tier_absensi)) {
		// SV-08: tier BELUM DIKETAHUI (proyek belum diatur admin) — beda dari bentrok
		// Dinas Luar Kota/WFH di bawah. HRD harus lihat ini sebagai "atur tier proyek",
		// bukan "ada konflik data".
		return { synced: false, absensiHarianId: null, anomali: 'tier_tidak_diketahui' };
	}
	if (settings.tulis_balik_butuh_verifikasi && checkin.area_status !== 'diterapkan') {
		return { synced: false, absensiHarianId: null, anomali: null }; // menunggu ACC HRD, bukan anomali
	}

	const existing = await findAbsensiHarianPadaTanggal(checkin.karyawan_id, tanggalCheckin);
	if (!existing) {
		return { synced: false, absensiHarianId: null, anomali: 'tanpa_absen_bk' };
	}
	if (await isPeriodLocked(existing.tanggal)) {
		return { synced: false, absensiHarianId: existing.id, anomali: 'periode_terkunci' };
	}
	if (existing.lokasi && TIER_KONFLIK_LOKASI.has(existing.lokasi)) {
		return { synced: false, absensiHarianId: existing.id, anomali: 'tier_konflik' };
	}
	// SV-07: jangan pernah MENURUNKAN tier yang sudah tertulis lebih tinggi hari itu
	// (mis. dua kunjungan sehari, Luar Jawa lalu Jabodetabek — yang terakhir tidak boleh menang).
	if (rankLokasi(existing.lokasi) > rankLokasi(checkin.tier_absensi)) {
		return { synced: false, absensiHarianId: existing.id, anomali: 'tier_lebih_rendah' };
	}

	await directusServerJson(`/items/absensi_harian/${existing.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ lokasi: checkin.tier_absensi })
	});
	return { synced: true, absensiHarianId: existing.id, anomali: null };
}

export interface CreateCheckinInput {
	karyawanId: string;
	// number untuk proyek/marketing (projects.id/prospects.id), string (UUID) untuk
	// maintenance (work_order.id — referensi_id integer TIDAK BISA menampung UUID, lihat
	// site_checkin.referensi_uuid). Paket 08b: null diperbolehkan HANYA untuk marketing
	// check-in langsung ke master_customer TANPA prospek (lihat masterCustomerId).
	referensiId: number | string | null;
	// Paket 08b Site Visit Release — check-in marketing langsung ke customer existing (jalur
	// A, /sales/baru) tanpa melalui prospek. Diabaikan untuk tipe selain 'marketing'.
	masterCustomerId?: number | null;
	lat: number;
	lng: number;
	akurasi: number | null;
	// Paket 08b: nullable — kunjungan sales jalur A (/sales/baru) historisnya tidak mengambil
	// foto saat mulai (hanya saat submit/checkout, foto_id di visit_sales). Endpoint
	// /api/site-checkin (proyek/maintenance) tetap mewajibkan foto di level +server.ts sendiri.
	foto: File | null;
	catatan?: string;
	bookingId?: string | null; // Fase 4, §11.2.2 — check-in dari peminjaman kendaraan (site_visit)
	// Penajaman SDM v2 Fase 5 (Pengerasan Verifikasi):
	deviceFingerprint?: string | null; // dari +server.ts, hash User-Agent+Accept-Language
	networkType?: 'wifi' | 'cellular' | 'offline' | null; // dari klien, opsional
	// "4-Gate Site Visit System" Fase 3 — default 'proyek' (referensiId -> projects.id) bila
	// tak diisi, konsisten dengan perilaku lama. 'marketing' -> referensiId adalah prospects.id.
	tipeKeperluan?: TipeKeperluan;
	// SV-12: waktu check-in sebenarnya di HP (ISO) — diisi saat replay dari antrean offline.
	clientCreatedAt?: string | null;
	// SV-12 (disetujui Lead 26 Sep 2026, skema): UUID dibuat klien saat masuk antrean offline —
	// dikirim ulang tiap replay. Dedup exact-match terhadap site_checkin.client_txn_id (unique).
	clientTxnId?: string | null;
}

/** SHA-256 hex dari isi file — dipakai deteksi foto daur-ulang (Fase 5). */
async function hashFile(file: File): Promise<string> {
	const buf = await file.arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Fase 5 — sinyal tambahan buat anti_fake_gps_score (BUKAN field baru, memperluas bobot field
 * lama sesuai rencana): jumlah device_fingerprint BERBEDA yang dipakai karyawan ini HARI INI
 * (>1 = indikasi berbagi HP), dan apakah foto check-in ini identik dengan salah satu dari 10
 * check-in terakhirnya (indikasi foto daur-ulang, bukan foto baru saat itu juga).
 */
async function getFase5AntiFraudSignals(
	karyawanId: string,
	deviceFingerprint: string | null,
	fotoHash: string
): Promise<{ deviceCountToday: number; isFotoReused: boolean }> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': karyawanId,
		sort: '-check_in_at',
		limit: '10',
		fields: 'device_fingerprint,foto_hash,check_in_at'
	});
	const result = await directusServerJson<{ data: { device_fingerprint: string | null; foto_hash: string | null; check_in_at: string }[] }>(
		`/items/site_checkin?${query.toString()}`
	);
	const rows = result?.data || [];
	const today = todayJakarta();

	const devicesToday = new Set<string>();
	if (deviceFingerprint) devicesToday.add(deviceFingerprint);
	let isFotoReused = false;
	for (const r of rows) {
		if (r.foto_hash && r.foto_hash === fotoHash) isFotoReused = true;
		// Paket 05 §3.3 (SVR-30): check_in_at disimpan UTC — slice(0,10) mentah salah menilai hari
		// untuk kunjungan 00:00-06:59 WIB (jatuh ke hari SEBELUMNYA di UTC), membuat anti-fraud
		// deviceCountToday tidak pernah menangkap berbagi HP untuk kunjungan dini hari.
		if (r.device_fingerprint && r.check_in_at && todayJakarta(new Date(r.check_in_at)) === today) {
			devicesToday.add(r.device_fingerprint);
		}
	}
	return { deviceCountToday: devicesToday.size, isFotoReused };
}

// SV-12: jendela toleransi untuk dedup FALLBACK (klien lama yang belum kirim client_txn_id —
// mis. antrean offline yang sudah tersimpan di browser sebelum update ini dipasang). Klien baru
// selalu punya client_txn_id, jadi jalur ini diharapkan makin jarang terpakai seiring waktu.
const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const OFFLINE_MAX_DELAY_MS = 24 * 3600 * 1000;

export async function createCheckin(
	input: CreateCheckinInput
	// Paket 09 §2.2 — peringatan?: opsional, TIDAK disimpan di DB, murni untuk ditampilkan ke
	// mekanik saat itu juga (gagal-lunak tapi TERLIHAT, bukan diam-diam kehilangan laporan).
): Promise<SiteCheckinRecord & { peringatan?: string }> {
	const tipeKeperluan: TipeKeperluan = input.tipeKeperluan || 'proyek';

	// Paket 09 §0 — tipe maintenance ditolak server selama flag tipe_maintenance_aktif OFF
	// (default), terlepas dari apakah klien mencoba mengirimnya (tombol disembunyikan di UI,
	// tapi server tidak boleh percaya begitu saja pada UI).
	if (tipeKeperluan === 'maintenance') {
		const settingsAwal = await getSiteCheckinSettings();
		if (!settingsAwal.tipe_maintenance_aktif) {
			throw new TipeMaintenanceNonaktifError('Laporan kunjungan maintenance belum dibuka. Hubungi admin Maintenance.');
		}
	}

	// SV-12: check_in_at = waktu SEBENARNYA di HP (client_created_at), bukan waktu request sampai
	// ke server — tanpa ini, check-in offline pagi yang baru tersinkron malam tercatat jam sinkron.
	// Selisih >24 jam dianggap tak wajar (data offline basi) -> pakai waktu server, tandai di catatan.
	let checkInAtIso = new Date().toISOString();
	let offlineTerlambat = false;
	if (input.clientCreatedAt) {
		const clientMs = new Date(input.clientCreatedAt).getTime();
		if (Number.isFinite(clientMs) && Math.abs(Date.now() - clientMs) <= OFFLINE_MAX_DELAY_MS) {
			checkInAtIso = new Date(clientMs).toISOString();
		} else {
			offlineTerlambat = true;
		}
	}

	// SV-12: dedup replay antrean offline (mis. request pertama sukses tapi respons tidak sampai
	// ke klien karena jaringan putus, lalu klien mengirim ulang request yang SAMA).
	if (input.clientTxnId) {
		// Jalur utama: exact-match terhadap kolom unik client_txn_id — replay PASTI mengembalikan
		// baris yang sama persis, tidak bergantung jendela waktu/toleransi apa pun.
		const exactQuery = new URLSearchParams({ 'filter[client_txn_id][_eq]': input.clientTxnId, fields: '*', limit: '1' });
		const exactRes = await directusServerJson<{ data: SiteCheckinRecord[] }>(`/items/site_checkin?${exactQuery.toString()}`).catch(() => null);
		const exactExisting = exactRes?.data?.[0];
		if (exactExisting) return exactExisting;
	} else if (input.clientCreatedAt && tipeKeperluan !== 'maintenance') {
		// Fallback: klien lama tanpa client_txn_id (antrean offline tersimpan sebelum update ini).
		const dari = new Date(new Date(checkInAtIso).getTime() - DEDUP_WINDOW_MS).toISOString();
		const sampai = new Date(new Date(checkInAtIso).getTime() + DEDUP_WINDOW_MS).toISOString();
		const dupQuery = new URLSearchParams({
			'filter[karyawan_id][_eq]': input.karyawanId,
			'filter[tipe_checkin][_eq]': tipeKeperluan,
			'filter[referensi_id][_eq]': String(input.referensiId),
			'filter[check_in_at][_gte]': dari,
			'filter[check_in_at][_lte]': sampai,
			fields: '*',
			limit: '1'
		});
		const dupRes = await directusServerJson<{ data: SiteCheckinRecord[] }>(`/items/site_checkin?${dupQuery.toString()}`).catch(() => null);
		const existing = dupRes?.data?.[0];
		if (existing) return existing; // idempoten: replay mengembalikan baris yang sudah ada
	}

	// Paket 04 §3.3 — mode `hard` (setelah enforce_from): tolak check-in dengan akurasi GPS
	// buruk sebelum data dibuat sama sekali. Tidak retroaktif (Aturan #3): hanya berlaku ketika
	// modeAkurasiEfektif() sudah lewat enforce_from.
	const settingsAwal = await getSiteCheckinSettings();
	const modeAkurasiAwal = modeAkurasiEfektif(settingsAwal.akurasi_mode, settingsAwal.akurasi_enforce_from);
	if (
		modeAkurasiAwal === 'hard' &&
		input.akurasi != null &&
		input.akurasi > (settingsAwal.akurasi_maks_m || 500)
	) {
		throw new AkurasiGpsError(
			'Lokasi HP Anda kurang tepat untuk check-in sekarang. Nyalakan "Lokasi akurat" di Setelan HP, lalu coba lagi.'
		);
	}

	// "4-Gate Site Visit System" Fase 3: marketing check-in referensiId -> prospects.id, BUKAN
	// projects.id. Geofence & tier absensi tidak berlaku sama seperti proyek — lihat cabang di bawah.
	let namaLokasi: string;
	let jarakM: number | null = null;
	let inGeofence: boolean | null = null;
	let tierResolved: { tier: TierAbsensi | null; sumber: 'master_proyek' | 'usulan_jarak' | null; status: 'diterapkan' | 'usulan' | null; jarakDariKantorM: number | null } = {
		tier: null,
		sumber: null,
		status: null,
		jarakDariKantorM: null
	};

	// Fase 3c: workOrderRef hanya terisi untuk tipe 'maintenance' — dipakai lagi di bawah
	// untuk payload (referensi_uuid, BUKAN referensi_id — lihat catatan interface).
	let workOrderRef: WorkOrderRef | null = null;
	// Paket 09 §2.2 (SVR-27 worst case) — gagal-lunak TAPI TERLIHAT: mekanik tanpa tautan
	// personnel diberi tahu SEJAK check-in, bukan diam-diam kehilangan laporannya nanti.
	let peringatanPersonnel: string | null = null;

	if (tipeKeperluan === 'marketing') {
		// Paket 08b Site Visit Release — dua jalur: (a) referensiId = prospects.id (tab Prospek,
		// perilaku lama); (b) referensiId null + masterCustomerId = kunjungan LANGSUNG ke
		// customer existing tanpa prospek (jalur A, /sales/baru). Radius dari settings
		// (radius_customer_m) — bukan hardcode 300.
		let customerIdUntukGeo: number | null = null;
		if (input.referensiId != null) {
			const prospect = await getProspect(Number(input.referensiId));
			if (!prospect) throw new Error('Prospek tidak ditemukan');
			namaLokasi = prospect.company || prospect.name || `Prospek #${prospect.id}`;
			customerIdUntukGeo = prospect.customer_id || input.masterCustomerId || null;
		} else if (input.masterCustomerId != null) {
			const customer = await getMasterCustomerBasic(input.masterCustomerId);
			if (!customer) throw new Error('Customer tidak ditemukan');
			namaLokasi = customer.customer_name || `Customer #${input.masterCustomerId}`;
			customerIdUntukGeo = input.masterCustomerId;
		} else {
			throw new Error('Prospek atau customer tujuan tidak ditemukan');
		}
		if (customerIdUntukGeo != null) {
			const customerGeo = await getCustomerGeo(customerIdUntukGeo);
			if (customerGeo) {
				const { valid, jarak } = withinRadius(
					input.lat,
					input.lng,
					customerGeo.lat,
					customerGeo.lng,
					customerGeo.radiusM || settingsAwal.radius_customer_m || 300
				);
				jarakM = jarak;
				inGeofence = valid;
			}
		}
		// tier_absensi/area_sumber/area_status SENGAJA null — kunjungan marketing tidak
		// menggantikan lokasi absensi payroll (syncAbsensiLokasi akan skip dengan anomali
		// 'tier_konflik', bukan menulis lokasi kerja yang salah).
	} else if (tipeKeperluan === 'maintenance') {
		workOrderRef = await getWorkOrder(String(input.referensiId));
		if (!workOrderRef) throw new Error('Work Order tidak ditemukan');
		namaLokasi = [workOrderRef.wo_number, workOrderRef.equipment_name].filter(Boolean).join(' — ') || `WO #${workOrderRef.id}`;
		// Geofence null (location tanpa lat/lng di skema live) & tier_absensi null — sama
		// alasan seperti marketing: kunjungan maintenance tidak menggantikan lokasi absensi.
		const personnelId = await resolvePersonnelId(input.karyawanId).catch(() => null);
		if (!personnelId) {
			peringatanPersonnel =
				'Akun Anda belum terhubung ke data mekanik. Laporan servis tidak akan masuk ke modul Maintenance. Hubungi admin Maintenance.';
		}
	} else {
		const project = await getProject(Number(input.referensiId));
		if (!project) throw new Error('Proyek tidak ditemukan');
		namaLokasi = project.name;
		const geo = computeProjectGeofence(input.lat, input.lng, project, settingsAwal.radius_default_m);
		jarakM = geo.jarakM;
		inGeofence = geo.inGeofence;
		tierResolved = await resolveTierAbsensi(Number(input.referensiId));
	}

	// Paket 07 Site Visit Release §3.1 (SVR-14) — booking HANYA dipasang bila benar-benar milik
	// karyawan ini, tipe 'site_visit', dan statusnya masuk akal. Booking tidak valid TIDAK PERNAH
	// menggagalkan check-in — cukup diabaikan (dicatat di catatan_sistem untuk audit).
	let bookingIdEfektif: string | null = null;
	let catatanBooking: string | null = null;
	if (input.bookingId) {
		const bkRes = await directusServerJson<{
			data: { id: string; karyawan_id: string; tipe_keperluan: string; status: string; project_id: number | null } | null;
		}>(`/items/fleet_bookings/${input.bookingId}?fields=id,karyawan_id,tipe_keperluan,status,project_id`).catch(() => null);
		const bk = bkRes?.data;
		if (!bk) {
			catatanBooking = 'booking_diabaikan: tidak ditemukan';
		} else if (String(bk.karyawan_id) !== String(input.karyawanId)) {
			catatanBooking = 'booking_diabaikan: bukan milik karyawan ini';
		} else if (bk.tipe_keperluan !== 'site_visit') {
			catatanBooking = 'booking_diabaikan: bukan peminjaman site visit';
		} else if (bk.status !== 'disetujui' && bk.status !== 'aktif') {
			catatanBooking = `booking_diabaikan: status booking '${bk.status}'`;
		} else {
			bookingIdEfektif = input.bookingId;
			// Booking punya proyek tertaut tapi leader check-in ke proyek LAIN — tetap diizinkan
			// (leader bisa mampir proyek lain dalam 1 perjalanan), hanya dicatat untuk audit GA.
			if (bk.project_id != null && tipeKeperluan === 'proyek' && Number(bk.project_id) !== Number(input.referensiId)) {
				catatanBooking = 'proyek_beda_dari_booking';
			}
		}
	}

	// Multi-site 1 hari: tutup check-in aktif lain sebelum membuka yang baru (auto_next_checkin).
	// Paket 02 §3.10 (SVR-06): replay offline BISA datang lebih tua dari check-in aktif saat ini
	// (mis. check-in pagi tersinkron malam setelah check-in siang sudah aktif) — dalam kasus itu
	// TIDAK boleh menutup yang aktif "sekarang" (durasi jadi salah/hilang), baris LAMA yang harus
	// langsung ditutup tepat saat yang aktif dimulai.
	const activeExisting = await findActiveCheckin(input.karyawanId);
	let tutupBaruSetelahDibuat: string | null = null;
	if (activeExisting) {
		const tBaru = new Date(checkInAtIso).getTime();
		const tAktif = new Date(activeExisting.check_in_at).getTime();
		if (tBaru >= tAktif) {
			// Normal: tutup yang aktif TEPAT saat kunjungan baru dimulai, bukan waktu request sampai.
			await closeCheckin({
				checkinId: activeExisting.id,
				karyawanId: input.karyawanId,
				method: 'auto_next_checkin',
				lat: input.lat,
				lng: input.lng,
				akurasi: null,
				foto: null,
				checkOutAtOverride: checkInAtIso
			});
		} else {
			// Replay lebih tua: jangan sentuh yang aktif (mungkin lebih baru) — baris baru ditutup
			// setelah dibuat, pada saat yang aktif dimulai (lihat setelah POST di bawah).
			tutupBaruSetelahDibuat = activeExisting.check_in_at;
		}
	}

	const kantor = await getKantorPusat();
	const jarakDariKantorM = kantor ? haversineMeters(input.lat, input.lng, kantor.lat, kantor.lng) : null;

	// Fase 5 — dihitung SEBELUM upload supaya hash foto tersedia untuk skor & tidak menahan upload
	// bila gagal (fail-soft: sinyal Fase 5 tidak pernah menggagalkan check-in).
	// Paket 08b — foto NULLABLE: kunjungan sales jalur A (/sales/baru) historisnya TIDAK
	// mengambil foto saat mulai (hanya saat submit/checkout) — foto di sini opsional sama
	// seperti closeCheckin, bukan wajib untuk semua tipeKeperluan.
	const fotoHash = input.foto ? await hashFile(input.foto).catch(() => null) : null;
	let deviceCountToday = input.deviceFingerprint ? 1 : 0;
	let isFotoReused = false;
	if (fotoHash) {
		try {
			const signals = await getFase5AntiFraudSignals(input.karyawanId, input.deviceFingerprint || null, fotoHash);
			deviceCountToday = signals.deviceCountToday;
			isFotoReused = signals.isFotoReused;
		} catch {
			/* gagal-lunak — skor tetap dihitung tanpa sinyal Fase 5 */
		}
	}

	const antiFakeGpsScore = computeAntiFakeGpsScore({
		accuracy: input.akurasi,
		current: { lat: input.lat, lng: input.lng, atMs: Date.now() },
		deviceCountToday,
		isFotoReused
	});

	let fotoId: string | null = null;
	if (input.foto) {
		const uploadForm = new FormData();
		uploadForm.append('file', input.foto, `site-checkin-${input.karyawanId}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw new Error('Gagal mengunggah foto ke server.');
		const uploaded = await uploadRes.json();
		fotoId = uploaded?.data?.id;
		if (!fotoId) throw new Error('Gagal mengunggah foto ke server.');
	}

	const payload = {
		karyawan_id: input.karyawanId,
		// Paket 07 Site Visit Release §3.1 (SVR-14): tipe_checkin SELALU tipe keperluan asli —
		// dulu dipaksa 'peminjaman_kendaraan' saat ada bookingId, membuat pilihan Marketing/
		// Maintenance tersembunyi dan (worst case #2) laporan kunjungan bisa salah masuk ke ID
		// prospek yang disangka ID proyek. Keterkaitan kendaraan cukup lewat booking_id di bawah.
		tipe_checkin: tipeKeperluan,
		// referensi_id (integer) TIDAK BISA menampung UUID work_order.id — maintenance pakai
		// referensi_uuid, kolom lama referensi_id dikosongkan untuk tipe ini.
		referensi_id: tipeKeperluan === 'maintenance' ? null : input.referensiId,
		referensi_uuid: tipeKeperluan === 'maintenance' ? String(input.referensiId) : null,
		booking_id: bookingIdEfektif,
		nama_lokasi: namaLokasi,
		tier_absensi: tierResolved.tier,
		area_sumber: tierResolved.sumber,
		area_status: tierResolved.status,
		check_in_at: checkInAtIso,
		lat_in: input.lat,
		lng_in: input.lng,
		akurasi_in_m: input.akurasi,
		anti_fake_gps_score: antiFakeGpsScore,
		foto_in_id: fotoId,
		jarak_in_m: jarakM,
		jarak_dari_kantor_m: jarakDariKantorM ?? tierResolved.jarakDariKantorM,
		in_geofence: inGeofence,
		catatan: input.catatan || null,
		status: 'active',
		device_fingerprint: input.deviceFingerprint || null,
		foto_hash: fotoHash,
		network_type: input.networkType || null,
		client_txn_id: input.clientTxnId || null,
		...(offlineTerlambat || catatanBooking
			? {
					catatan_sistem: [
						offlineTerlambat ? `offline_terlambat: client_created_at (${input.clientCreatedAt}) melebihi 24 jam, pakai waktu server` : null,
						catatanBooking
					]
						.filter(Boolean)
						.join(' | ')
				}
			: {})
	};

	let result: { data: SiteCheckinRecord };
	try {
		result = await directusServerJson<{ data: SiteCheckinRecord }>('/items/site_checkin', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	} catch (e) {
		// SV-12: request kembar (race) lolos pre-check exact-match di atas lalu sama-sama mencoba
		// INSERT — constraint unik client_txn_id menolak yang kedua. Alih-alih gagal, ambil baris
		// yang berhasil dibuat request pertama (tetap idempoten dari sudut pandang klien).
		if (input.clientTxnId) {
			const raceQuery = new URLSearchParams({ 'filter[client_txn_id][_eq]': input.clientTxnId, fields: '*', limit: '1' });
			const raceRes = await directusServerJson<{ data: SiteCheckinRecord[] }>(`/items/site_checkin?${raceQuery.toString()}`).catch(() => null);
			const raceExisting = raceRes?.data?.[0];
			if (raceExisting) return raceExisting;
		}
		throw e;
	}

	// Paket 02 §3.10: baris ini LEBIH TUA dari check-in yang sedang aktif (replay offline
	// terlambat) — tutup langsung tepat saat yang aktif mulai, supaya tidak ada 2 baris
	// 'active' bertumpuk dan durasi baris lama tidak nyasar ke "sekarang". Fail-soft: gagal
	// menutup TIDAK membatalkan check-in yang baru saja berhasil dibuat (baris tetap ada,
	// akan ditutup cron auto-close paling lambat).
	if (tutupBaruSetelahDibuat) {
		try {
			await closeCheckin({
				checkinId: result.data.id,
				karyawanId: input.karyawanId,
				method: 'auto_next_checkin',
				lat: input.lat,
				lng: input.lng,
				akurasi: null,
				foto: null,
				checkOutAtOverride: tutupBaruSetelahDibuat,
				catatanSistemTag: 'replay_offline_urutan'
			});
		} catch (e) {
			console.error('Gagal menutup baris replay_offline_urutan:', e);
		}
	}

	// Fase 6 — event real-time, fail-soft mutlak (tidak pernah await-block/menggagalkan check-in).
	notifyProjectSiteCheckin(result.data.id, input.karyawanId, result.data.nama_lokasi).catch(() => {});

	// SV-11 — fail-soft mutlak, sama pola. Hanya relevan untuk tipe 'proyek' (marketing/maintenance
	// tidak punya geofence proyek).
	if (tipeKeperluan === 'proyek' && inGeofence === false) {
		cekKoordinatProyekKemungkinanSalah(Number(input.referensiId), namaLokasi).catch((e) => {
			console.error('Gagal cek koordinat proyek kemungkinan salah (SV-11):', e);
		});
	}

	// Fase 4 (§11.2.2c) — tulis balik dua arah, fail-soft (jangan gagalkan check-in bila ini error).
	// Fase 2 (Pertajam Site Visit) — untuk kunjungan TANPA kendaraan (butuh_kendaraan=false) tidak ada
	// P2H "sebelum" yang menaikkan status ke 'aktif'; check-in di lokasi yang menggantikannya.
	if (bookingIdEfektif) {
		(async () => {
			try {
				const bRes = await directusServerJson<{ data: { status: string; butuh_kendaraan: boolean | null; referensi_site_visit_id: string | null } }>(
					`/items/fleet_bookings/${bookingIdEfektif}?fields=status,butuh_kendaraan,referensi_site_visit_id`
				);
				const b = bRes?.data;
				const patch: Record<string, any> = {};
				// Paket 07 §3.1 (SVR-14): booking multi-kunjungan — isi referensi_site_visit_id
				// HANYA bila masih kosong (check-in PERTAMA dalam booking ini = kunjungan utama).
				// Sebelumnya ditimpa setiap check-in baru, menghilangkan riwayat kunjungan awal
				// dari sisi fleet. Daftar LENGKAP kunjungan tetap terbaca dari site_checkin.booking_id.
				if (!b?.referensi_site_visit_id) {
					patch.referensi_site_visit_id = result.data.id;
				}
				if (b && b.butuh_kendaraan === false && b.status === 'disetujui') {
					patch.status = 'aktif';
				}
				if (Object.keys(patch).length > 0) {
					await directusServerJson(`/items/fleet_bookings/${bookingIdEfektif}`, {
						method: 'PATCH',
						body: JSON.stringify(patch)
					});
				}
			} catch (e) {
				console.error('Gagal menulis balik / mengaktifkan fleet_bookings dari check-in:', e);
			}
		})();
	}

	return peringatanPersonnel ? { ...result.data, peringatan: peringatanPersonnel } : result.data;
}

export interface CloseCheckinInput {
	checkinId: string;
	karyawanId: string;
	karyawanNama?: string;
	method: 'manual' | 'auto_report' | 'auto_midnight' | 'auto_next_checkin';
	lat: number | null;
	lng: number | null;
	akurasi: number | null;
	foto: File | null;
	reportId?: number | null; // Fase 4 — diisi saat auto-checkout dipicu submit laporan harian
	// SV-03/SV-10: waktu check-out yang DIPAKSAKAN pemanggil (auto-close), bukan "sekarang".
	// Cron auto-close bisa telat jalan berjam-jam — tanpa ini, check_out_at tertulis ke waktu
	// cron jalan (bisa besok), bukan waktu kunjungan sebenarnya berakhir.
	checkOutAtOverride?: string | null;
	// Fase 3 (Q7-a) — form kunjungan di check-out, dijembatani ke project_visit_leader.
	kegiatan?: string | null;
	temuan?: string | null;
	tindakLanjut?: string | null;
	rencanaBesok?: string | null;
	// "4-Gate Site Visit System" Fase 3 (8 Sep 2026) — form checkout tipe 'marketing',
	// dijembatani ke follow_ups (visitMarketingBridge.ts). Hanya dipakai bila
	// existing.tipe_checkin === 'marketing'.
	picDitemui?: string | null;
	jabatanPic?: string | null;
	noWaPic?: string | null;
	hasilMeeting?: string | null;
	statusBant?: BantStatus | null;
	nextAction?: string | null;
	followUpDate?: string | null;
	// "4-Gate Site Visit System" Fase 3c (8 Sep 2026) — form checkout tipe 'maintenance',
	// dijembatani ke mekanik_activity (visitMaintenanceBridge.ts).
	serviceLog?: string | null;
	sparepartDipakai?: string | null;
	statusUnit?: string | null;
	hourMeter?: number | null;
	// Paket 02 §3.9 — idempotensi checkout offline (pola sama client_txn_id check-in, SV-12).
	// clientTxnId: UUID dibuat klien saat checkout masuk antrean; replay dengan nilai SAMA pada
	// baris yang sudah tertutup dianggap sukses (already_closed), bukan error.
	clientTxnId?: string | null;
	// clientCreatedAt: waktu checkout SEBENARNYA di HP (untrusted — beda dari checkOutAtOverride
	// yang dipakai pemanggil server TERPERCAYA seperti cron/auto_next_checkin). Divalidasi:
	// check_in_at <= t <= now dan now - t <= 24 jam; di luar itu pakai jam server (§3.9.4).
	clientCreatedAt?: string | null;
	// Tag audit opsional ditulis ke catatan_sistem (mis. 'replay_offline_urutan' dari §3.10).
	catatanSistemTag?: string | null;
}

export async function closeCheckin(input: CloseCheckinInput): Promise<SiteCheckinRecord & { already_closed?: boolean; peringatan?: string }> {
	const query = new URLSearchParams({ fields: '*' });
	const existingResult = await directusServerJson<{ data: SiteCheckinRecord }>(`/items/site_checkin/${input.checkinId}?${query.toString()}`);
	const existing = existingResult?.data;
	if (!existing) throw new Error('Check-in tidak ditemukan');
	if (existing.karyawan_id !== input.karyawanId) throw new Error('Check-in ini bukan milik Anda');

	if (existing.status !== 'active') {
		// Paket 02 §3.9.3: replay (klien mengirim ulang request checkout yang SEBELUMNYA sukses
		// tapi responsnya hilang di jalan) tidak boleh error "Check-in sudah ditutup" — dua kondisi
		// dianggap replay yang sah:
		//   1. client_txn_id yang dikirim SAMA dengan yang tersimpan saat penutupan pertama.
		//   2. Penutupan sebelumnya OTOMATIS (bukan manual) — retry klien pada baris yang sudah
		//      ditutup sistem (auto_next_checkin/auto_midnight/auto_report) juga aman = sukses,
		//      karena klien tidak pernah bisa "menutup lebih dulu" daripada sistem di jalur ini.
		const metodeOtomatis = !!existing.checkout_method && existing.checkout_method !== 'manual';
		const txnCocok = !!input.clientTxnId && existing.checkout_client_txn_id === input.clientTxnId;
		if (txnCocok || metodeOtomatis) {
			return { ...existing, already_closed: true };
		}
		throw new Error('Check-in sudah ditutup');
	}

	let fotoOutId: string | null = null;
	if (input.foto) {
		const uploadForm = new FormData();
		uploadForm.append('file', input.foto, `site-checkout-${input.karyawanId}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (uploadRes.ok) {
			const uploaded = await uploadRes.json();
			fotoOutId = uploaded?.data?.id || null;
		}
	}

	const checkInAt = new Date(existing.check_in_at);
	let checkOutAt: Date;
	let catatanUntrustedTime: string | null = null;
	if (input.checkOutAtOverride) {
		// Sumber TERPERCAYA (cron/auto_next_checkin) — dipakai apa adanya, tanpa validasi.
		checkOutAt = new Date(input.checkOutAtOverride);
	} else if (input.clientCreatedAt) {
		// Sumber UNTRUSTED (jam HP saat checkout offline) — divalidasi sebelum dipercaya.
		const t = new Date(input.clientCreatedAt).getTime();
		const now = Date.now();
		if (Number.isFinite(t) && t >= checkInAt.getTime() && t <= now && now - t <= OFFLINE_MAX_DELAY_MS) {
			checkOutAt = new Date(t);
		} else {
			checkOutAt = new Date();
			catatanUntrustedTime = 'offline_terlambat_checkout';
		}
	} else {
		checkOutAt = new Date();
	}

	// SV-03/SV-10: potong paksa ke max_durasi_jam bila terlampaui — dijaga di sini (bukan hanya
	// di endpoint auto-close) supaya closeCheckin AMAN dipanggil dari mana saja (manual, auto_report,
	// auto_next_checkin) tanpa risiko durasi raksasa (lupa checkout berhari-hari).
	const settings = await getSiteCheckinSettings();
	const maxDurasiMs = (settings.max_durasi_jam || 16) * 3600 * 1000;
	let durasiDipotong = false;
	if (checkOutAt.getTime() - checkInAt.getTime() > maxDurasiMs) {
		checkOutAt = new Date(checkInAt.getTime() + maxDurasiMs);
		durasiDipotong = true;
	}

	const durasiMenit = Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000));

	const catatanSistemGabungan = [
		catatanUntrustedTime,
		durasiDipotong ? 'ditutup otomatis — durasi dipotong' : null,
		input.catatanSistemTag || null
	]
		.filter(Boolean)
		.join(' | ');

	const payload: Record<string, any> = {
		check_out_at: checkOutAt.toISOString(),
		lat_out: input.lat,
		lng_out: input.lng,
		akurasi_out_m: input.akurasi,
		foto_out_id: fotoOutId,
		checkout_method: input.method,
		durasi_menit: durasiMenit,
		status: 'completed',
		report_id: input.reportId ?? null,
		checkout_client_txn_id: input.clientTxnId || null,
		...(catatanSistemGabungan ? { catatan_sistem: catatanSistemGabungan } : {})
	};

	// SV-10: durasi di bawah minimum -> JANGAN sinkron otomatis ke payroll. Mode soft: tetap
	// tercatat dengan anomali, HRD bisa ACC manual lewat panel Verifikasi Area (Fase 2/SV-06)
	// bila memang kunjungan itu sah (mis. hanya antar dokumen cepat).
	if (durasiMenit < (settings.min_durasi_menit || 0)) {
		payload.absensi_sinkron = false;
		payload.absensi_anomali = 'durasi_terlalu_singkat';
	} else {
		// Jembatan payroll — fail-safe: kegagalan sync TIDAK PERNAH menggagalkan check-out.
		// SV-02: tanggal WAJIB dari check_in_at (WIB), bukan saat check-out/cron berjalan.
		try {
			const tanggalCheckin = todayJakarta(checkInAt);
			const sync = await syncAbsensiLokasi(
				{
					karyawan_id: existing.karyawan_id,
					tier_absensi: existing.tier_absensi,
					area_status: existing.area_status,
					akurasi_in_m: existing.akurasi_in_m
				},
				tanggalCheckin
			);
			payload.absensi_sinkron = sync.synced;
			payload.absensi_harian_id = sync.absensiHarianId;
			payload.absensi_anomali = sync.anomali;
		} catch (e) {
			payload.absensi_sinkron = false;
			payload.catatan_sistem = `${payload.catatan_sistem ? payload.catatan_sistem + ' | ' : ''}Gagal sinkron absensi: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	// Jembatan project_visit_leader (Q7-a, S-4) — kill-switch terpisah, fail-safe yang sama:
	// kegagalan di sini TIDAK PERNAH menggagalkan check-out. Dijaga tipe_checkin bukan
	// 'marketing'/'maintenance' (Fase 3) — referensi_id keduanya bukan projects.id.
	// SV-14: 'auto_report' (checkout otomatis saat submit laporan harian) SEBELUMNYA tidak pernah
	// masuk sini (hanya 'manual') — laporan kunjungan leader kosong untuk semua checkout via jalur
	// ini. Sekarang diikutkan, dengan sumber='auto_report' supaya admin tahu ini bukan isian manual.
	if (
		existing.tipe_checkin !== 'marketing' &&
		existing.tipe_checkin !== 'maintenance' &&
		existing.referensi_id != null &&
		(input.method === 'manual' || input.method === 'auto_report') &&
		(input.kegiatan || input.temuan || input.tindakLanjut || input.rencanaBesok)
	) {
		try {
			const bridge = await bridgeToVisitLeader({
				siteCheckinId: input.checkinId,
				karyawanId: existing.karyawan_id,
				karyawanNama: input.karyawanNama || `Karyawan #${existing.karyawan_id}`,
				projectId: existing.referensi_id,
				lokasi: existing.nama_lokasi,
				tanggal: todayJakarta(checkInAt), // SV-02: tanggal kunjungan, bukan tanggal check-out
				kegiatan: input.kegiatan,
				temuan: input.temuan,
				tindakLanjut: input.tindakLanjut,
				rencanaBesok: input.rencanaBesok,
				sumber: input.method === 'auto_report' ? 'auto_report' : 'site_checkin'
			});
			if (bridge.created) payload.visit_leader_id = bridge.visitLeaderId;
		} catch (e) {
			payload.catatan_sistem = `${payload.catatan_sistem || ''} | Gagal tulis project_visit_leader: ${e instanceof Error ? e.message : String(e)}`.trim();
		}
	}

	// Jembatan follow_ups (Fase 3 "4-Gate Site Visit System", 8 Sep 2026) — kunjungan
	// marketing, kill-switch terpisah (tulis_visit_marketing_aktif). Fail-safe: kegagalan
	// TIDAK PERNAH menggagalkan check-out. existing.referensi_id di sini adalah prospects.id.
	//
	// Paket 08d §6.2 — gate `referensi_id != null` DIHAPUS: kunjungan ke master_customer
	// langsung (tanpa prospek tertaut) sebelumnya TIDAK PERNAH memicu bridge ini sama sekali
	// (SVR tanpa nomor, ditemukan saat 08c). masterCustomerId diambil dari visit_sales tertaut
	// (query terpisah, Aturan #2) — bridgeToVisitMarketing sendiri yang mencari prospek terkait
	// atau menulis fallback nama customer di notes bila tak ada.
	if (existing.tipe_checkin === 'marketing' && input.method === 'manual') {
		try {
			let masterCustomerId: number | null = null;
			const visitSalesId: number | null = existing.visit_sales_id ?? null;
			if (visitSalesId) {
				const vs = await directusServerJson<{ data: { master_customer_id: number | null } }>(
					`/items/visit_sales/${visitSalesId}?fields=master_customer_id`
				).catch(() => null);
				masterCustomerId = vs?.data?.master_customer_id ?? null;
			}
			const bridge = await bridgeToVisitMarketing({
				prospectId: existing.referensi_id,
				masterCustomerId,
				salesName: input.karyawanNama || null,
				siteCheckinId: existing.id,
				visitSalesId,
				picDitemui: input.picDitemui,
				jabatanPic: input.jabatanPic,
				noWaPic: input.noWaPic,
				hasilMeeting: input.hasilMeeting,
				statusBant: input.statusBant,
				nextAction: input.nextAction,
				followUpDate: input.followUpDate
			});
			if (!bridge.created) {
				payload.catatan_sistem = `${payload.catatan_sistem || ''} | follow_ups tidak ditulis (kill-switch nonaktif atau prospect/customer kosong)`.trim();
			}
		} catch (e) {
			payload.catatan_sistem = `${payload.catatan_sistem || ''} | Gagal tulis follow_ups: ${e instanceof Error ? e.message : String(e)}`.trim();
		}
	}

	// Paket 08e Site Visit Release §7 — sales LUPA menekan "Kirim" di /sales/[id]: cron
	// auto-close (method otomatis) menutup site_checkin yang menggantung, tapi visit_sales
	// tertautnya tetap 'in_progress' selamanya tanpa ini — tidak ada penutupan, tidak ada
	// pengingat (worst case #3 dok). Hanya untuk checkout OTOMATIS (manual = sales sendiri
	// yang menutup via /sales/[id], sudah menulis hasil_kunjungan lewat endpoint submit).
	if (
		existing.tipe_checkin === 'marketing' &&
		(input.method === 'auto_midnight' || input.method === 'auto_next_checkin') &&
		existing.visit_sales_id
	) {
		try {
			const vsRes = await directusServerJson<{ data: { id: number; status: string | null; tujuan: string | null } }>(
				`/items/visit_sales/${existing.visit_sales_id}?fields=id,status,tujuan`
			).catch(() => null);
			const vs = vsRes?.data;
			// Guard status 'in_progress': sales sudah sempat submit (race dengan cron) atau baris
			// ini sudah pernah ditandai sebelumnya — jangan timpa/notifikasi dobel (idempoten).
			if (vs && vs.status === 'in_progress') {
				await directusServerJson(`/items/visit_sales/${vs.id}`, {
					method: 'PATCH',
					body: JSON.stringify({ status: 'belum_dilaporkan' })
				});
				await notifySalesServer(
					'VISIT_NOT_REPORTED',
					`Kunjungan ke ${vs.tujuan || 'customer'} belum dilaporkan. Isi hasilnya sekarang.`,
					{ karyawanId: input.karyawanId, sourceCollection: 'visit_sales', sourceId: vs.id, actionUrl: `/sales/${vs.id}` }
				);
			}
		} catch (e) {
			payload.catatan_sistem = `${payload.catatan_sistem || ''} | Gagal tandai visit_sales belum_dilaporkan: ${e instanceof Error ? e.message : String(e)}`.trim();
		}
	}

	// Jembatan mekanik_activity (Fase 3c "4-Gate Site Visit System", 8 Sep 2026) — kunjungan
	// maintenance, kill-switch terpisah (tulis_visit_maintenance_aktif). Fail-safe: kegagalan
	// TIDAK PERNAH menggagalkan check-out. existing.referensi_uuid di sini adalah work_order.id.
	//
	// Paket 09 §2.3 (SVR-28) — KEPUTUSAN: checkout OTOMATIS (auto_next_checkin/auto_midnight/
	// auto_report) juga menulis mekanik_activity, bukan cuma 'manual' seperti sebelumnya (yang
	// membuat log servis/sparepart/hour meter HILANG total tiap kali mekanik lupa checkout).
	// Baris minimal ditulis dengan kegiatan_repair placeholder + approval_status='pending', supaya
	// supervisor melihat baris "perlu dilengkapi" alih-alih tidak melihat apa pun.
	let peringatanMaintenance: string | null = null;
	if (existing.tipe_checkin === 'maintenance' && existing.referensi_uuid) {
		try {
			const wo = await getWorkOrder(existing.referensi_uuid);
			if (!wo?.equipment_id) {
				payload.catatan_sistem = `${payload.catatan_sistem || ''} | mekanik_activity tidak ditulis: work_order tanpa equipment_id`.trim();
			} else {
				const isOtomatis = input.method !== 'manual';
				const bridge = await bridgeToVisitMaintenance({
					workOrderId: existing.referensi_uuid,
					equipmentId: wo.equipment_id,
					karyawanId: existing.karyawan_id,
					serviceLog: isOtomatis ? 'Kunjungan site — laporan belum diisi (ditutup otomatis)' : input.serviceLog,
					sparepartDipakai: isOtomatis ? null : input.sparepartDipakai,
					statusUnit: isOtomatis ? null : input.statusUnit,
					hourMeter: isOtomatis ? null : input.hourMeter,
					checkInAt: existing.check_in_at,
					durasiMenit
				});
				if (!bridge.created) {
					payload.catatan_sistem = `${payload.catatan_sistem || ''} | mekanik_activity tidak ditulis (${bridge.reason || 'kill-switch nonaktif'})`.trim();
					if (bridge.reason === 'personnel tidak ditemukan untuk karyawan ini') {
						peringatanMaintenance =
							'Akun Anda belum terhubung ke data mekanik. Laporan servis tidak akan masuk ke modul Maintenance. Hubungi admin Maintenance.';
					}
				} else if (isOtomatis) {
					// Fail-soft: notifikasi "lengkapi laporan" tidak boleh menggagalkan checkout.
					directusServerJson('/items/app_notifications', {
						method: 'POST',
						body: JSON.stringify({
							type: 'mekanik_activity_belum_lengkap',
							title: 'Lengkapi Laporan Servis',
							message: `Kunjungan WO ${wo.wo_number || existing.referensi_uuid} ditutup otomatis (${input.method}) — laporan servis belum diisi. Lengkapi di modul Maintenance.`,
							priority: 'medium',
							karyawan_id: Number(existing.karyawan_id) || null,
							source_collection: 'mekanik_activity',
							source_id: bridge.activityId ? String(bridge.activityId) : null,
							action_type: 'lengkapi_mekanik_activity'
						})
					}).catch((e) => console.error('Gagal kirim notifikasi lengkapi laporan servis:', e));
				}
			}
		} catch (e) {
			payload.catatan_sistem = `${payload.catatan_sistem || ''} | Gagal tulis mekanik_activity: ${e instanceof Error ? e.message : String(e)}`.trim();
		}
	}

	let result: { data: SiteCheckinRecord };
	try {
		result = await directusServerJson<{ data: SiteCheckinRecord }>(`/items/site_checkin/${input.checkinId}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});
	} catch (e) {
		// Paket 02 §3.9: dua replay bersamaan lolos pre-check `status === 'active'` lalu sama-sama
		// mencoba PATCH — constraint unik checkout_client_txn_id menolak yang kedua. Alih-alih
		// gagal, ambil baris yang berhasil dipatch request pertama (tetap idempoten).
		if (input.clientTxnId) {
			const raceRes = await directusServerJson<{ data: SiteCheckinRecord }>(`/items/site_checkin/${input.checkinId}?fields=*`).catch(() => null);
			const raceExisting = raceRes?.data;
			if (raceExisting?.checkout_client_txn_id === input.clientTxnId) {
				return { ...raceExisting, already_closed: true };
			}
		}
		throw e;
	}

	// Fase 6 — event real-time, fail-soft mutlak (tidak pernah await-block/menggagalkan check-out).
	notifyProjectSiteCheckout(result.data.id, input.karyawanId, existing.nama_lokasi).catch(() => {});

	// "4-Gate Site Visit System" Fase 5, Workflow 3 (8 Sep 2026) — Flagged Visit
	// Auto-Escalation. Ditulis LANGSUNG di sini (bukan lewat n8n webhook terpisah seperti
	// draft rencana awal — lebih sederhana & tidak ada titik kegagalan tambahan jaringan
	// antar-app). Tulis app_notifications ke `department` (BUKAN atasan_id per karyawan —
	// essNotify.js di erp-epi mendokumentasikan atasan_id sengaja dihindari untuk rute
	// notifikasi; department + dashboard Anomali di HRD sudah cukup untuk auto-flag).
	// Fail-soft mutlak, sama pola notifyProjectSiteCheckout.
	(async () => {
		try {
			// Paket 05 §3.2 (SVR-21) — ambang SAMA dengan yang dipakai payroll (settings.min_durasi_menit),
			// bukan 30 menit hardcode terpisah. Sebelumnya kunjungan 16-29 menit DIBAYAR (payroll pakai
			// min_durasi_menit=15) tapi tetap dilaporkan "durasi rendah" ke HRD — membingungkan.
			const durasiRendah = Number.isFinite(result.data.durasi_menit) && result.data.durasi_menit < (settings.min_durasi_menit || 15);
			// SV-05: in_geofence round-trip dari Directus/SQLite bisa balik sebagai 0 (bukan false)
			// walau kita kirim boolean asli — `=== false` gagal menangkap 0, notifikasi anomali tidak pernah terkirim.
			const luarGeofence = result.data.in_geofence === false || (result.data.in_geofence as unknown) === 0;
			const gpsRendah = Number.isFinite(parseFloat(String(result.data.anti_fake_gps_score))) && parseFloat(String(result.data.anti_fake_gps_score)) < 0.5;
			if (!durasiRendah && !luarGeofence && !gpsRendah) return;

			const alasan = [
				durasiRendah ? `durasi ${result.data.durasi_menit} menit (di bawah minimum)` : null,
				luarGeofence ? 'di luar geofence' : null,
				gpsRendah ? `skor anti-fake-GPS rendah (${result.data.anti_fake_gps_score})` : null
			].filter(Boolean).join(', ');

			// Paket 05 §3.1 (SVR-20) — dedup: kasus berulang (karyawan+lokasi sama) hanya 1 notifikasi
			// per anomali_cooldown_hari, bukan sekali per kunjungan (8 notifikasi identik dalam 11 hari
			// sebelumnya membuat HRD berhenti membaca notifikasi site visit sama sekali).
			const cooldownHari = settings.anomali_cooldown_hari ?? 7;
			const sejak = new Date(Date.now() - cooldownHari * 24 * 3600 * 1000).toISOString();
			const dedupQuery = new URLSearchParams({
				'filter[type][_eq]': 'visit_anomali',
				'filter[karyawan_id][_eq]': String(Number(input.karyawanId) || 0),
				'filter[message][_icontains]': existing.nama_lokasi || '',
				'filter[created_at][_gte]': sejak, // BUKAN date_created (tidak ada di app_notifications)
				fields: 'id',
				limit: '1'
			});
			const dedupRes = await directusServerJson<{ data: { id: number }[] }>(
				`/items/app_notifications?${dedupQuery.toString()}`
			).catch((e) => {
				console.error('Gagal cek dedup notifikasi visit_anomali:', e);
				return null;
			});
			if ((dedupRes?.data || []).length > 0) {
				// Kunjungan tetap ditandai anomali di site_checkin sendiri (HRD tetap melihatnya di
				// tab Anomali) — hanya NOTIFIKASI berulang yang ditekan.
				return;
			}

			await directusServerJson('/items/app_notifications', {
				method: 'POST',
				body: JSON.stringify({
					type: 'visit_anomali',
					title: 'Kunjungan Site Ditandai Anomali',
					message: `Kunjungan "${existing.nama_lokasi || result.data.id}" (${existing.tipe_checkin || 'proyek'}) ditandai: ${alasan}. Buka tab Anomali untuk ACC/koreksi.`,
					priority: 'medium',
					karyawan_id: Number(input.karyawanId) || null,
					source_collection: 'site_checkin',
					source_id: String(result.data.id),
					action_url: `/hrd?tab=kehadiran-site`,
					action_type: 'view_anomali'
				})
			});
		} catch (e) {
			console.error('Gagal menulis app_notifications (flagged visit escalation):', e);
		}
	})();

	// Fase 2 (Pertajam Site Visit) — kunjungan TANPA kendaraan ditutup di sini (tidak ada P2H "setelah").
	// Fail-soft: kegagalan tidak pernah menggagalkan check-out.
	if (existing.booking_id) {
		(async () => {
			try {
				const bRes = await directusServerJson<{ data: { status: string; butuh_kendaraan: boolean | null } }>(
					`/items/fleet_bookings/${existing.booking_id}?fields=status,butuh_kendaraan`
				);
				const b = bRes?.data;
				// 'disetujui' = aktivasi saat check-in gagal (tulis-balik) — tetap boleh ditutup di check-out.
				if (b && b.butuh_kendaraan === false && ['aktif', 'disetujui'].includes(b.status)) {
					await directusServerJson(`/items/fleet_bookings/${existing.booking_id}`, {
						method: 'PATCH',
						body: JSON.stringify({ status: 'selesai', tanggal_selesai_aktual: new Date().toISOString() })
					});
				}
			} catch (e) {
				console.error('Gagal menutup fleet_bookings (kunjungan tanpa kendaraan) dari check-out:', e);
			}
		})();
	}

	return peringatanMaintenance ? { ...result.data, peringatan: peringatanMaintenance } : result.data;
}

export async function getActiveCheckin(karyawanId: string): Promise<SiteCheckinRecord | null> {
	return findActiveCheckin(karyawanId);
}
