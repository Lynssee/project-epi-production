// src/lib/server/gerbangSj/penjualan.ts
// SJ-09 opsi C — gerbang untuk SJ penjualan (type = so_delivery) TANPA mengubah status.
// SJ penjualan lahir `delivered` (salesApi.processSODelivery) dan dibaca 5 modul sebagai "terkirim", jadi
// satpam hanya mencatat lolos_gerbang (scan_log + track_stage) — status tidak pernah di-PATCH.
// Penulisan jejak lolos (loloskanPenjualan) ada di actions.ts — aturan satu pintu GSP-01 §4.5.
// Default MATI (app_settings logistik.gerbang_penjualan_aktif). Aksi Tahan belum ada (fase berikutnya).

import { directusServerJson } from '../directus';
import { normalizeChecklist } from './checklist';
import { getGerbangSettings } from './settings';

const unwrap = (v: any) => (v && typeof v === 'object' ? v.id : v);
export const FIELDS_PENJUALAN = 'id,nomor_sj,status,type,category,track_stage,track_stage_at,driver,vehicle_id,delivery_address,date_created,so_customer_id,project_id,security_verified_at,security_checklist';

/** Murni: alamat "Diambil Sendiri oleh Customer" = barang tidak lewat gerbang dengan armada kita. */
export const isDiambilSendiri = (addr: unknown) => /diambil\s+sendiri/i.test(String(addr ?? ''));

/** Murni: awal hari ini (WIB) sebagai ISO — antrean penjualan hanya SJ hari ini. */
export function awalHariWib(now = new Date()): string {
	const tgl = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
	return `${tgl}T00:00:00+07:00`;
}

/** Murni: SJ penjualan yang masih harus lewat gerbang. */
export function perluGerbang(sj: any, kategoriWajib: Set<string>): boolean {
	return sj?.type === 'so_delivery'
		&& sj?.status === 'delivered'
		&& !sj?.track_stage
		&& !sj?.security_verified_at
		&& kategoriWajib.has(String(unwrap(sj?.category)))
		&& !isDiambilSendiri(sj?.delivery_address);
}

async function list<T = any>(path: string, label: string): Promise<T[]> {
	try {
		return (await directusServerJson<{ data: T[] }>(path))?.data || [];
	} catch (e) {
		console.error(`[gerbangSj/penjualan] gagal baca ${label}:`, e instanceof Error ? e.message : e);
		return [];
	}
}

/** id stock_activity_types yang kategorinya wajib satpam (config.kode = stock_activity_types.code). Fetch dipisah (Aturan #2). */
export async function kategoriWajibSatpam(): Promise<Set<string>> {
	const cfg = await list(`/items/surat_jalan_category_config?filter[requires_security_check][_eq]=true&fields=id,kode&limit=-1`, 'surat_jalan_category_config');
	const kode = cfg.map((c: any) => c.kode).filter(Boolean);
	if (!kode.length) return new Set();
	const sat = await list(`/items/stock_activity_types?filter[code][_in]=${kode.map(encodeURIComponent).join(',')}&fields=id,code&limit=-1`, 'stock_activity_types');
	return new Set(sat.map((s: any) => String(s.id)));
}

export type AntrianPenjualanRow = {
	id: number; nomor_sj: string; customer: string | null; tujuan: string | null; driver: string | null; plat: string | null;
	dibuat: string; menunggu_menit: number | null;
	ditahan: boolean; alasan_tahan: string | null;
};

export async function getAntrianPenjualan(): Promise<{ aktif: boolean; count: number; antrian: AntrianPenjualanRow[] }> {
	const settings = await getGerbangSettings();
	if (!settings.penjualanAktif) return { aktif: false, count: 0, antrian: [] };
	const wajib = await kategoriWajibSatpam();
	if (!wajib.size) return { aktif: true, count: 0, antrian: [] };

	const sjs = (await list(
		`/items/surat_jalan?filter[type][_eq]=so_delivery&filter[status][_eq]=delivered&filter[track_stage][_null]=true` +
		`&filter[security_verified_at][_null]=true&filter[date_created][_gte]=${encodeURIComponent(awalHariWib())}` +
		`&fields=${FIELDS_PENJUALAN}&sort=date_created&limit=200`, 'surat_jalan penjualan'
	)).filter((s) => perluGerbang(s, wajib));
	if (!sjs.length) return { aktif: true, count: 0, antrian: [] };

	const cIds = [...new Set(sjs.map((s) => unwrap(s.so_customer_id)).filter(Boolean))];
	const vIds = [...new Set(sjs.map((s) => unwrap(s.vehicle_id)).filter(Boolean))];
	const [cust, veh] = await Promise.all([
		cIds.length ? list(`/items/so_customer?filter[id][_in]=${cIds.join(',')}&fields=id,customer_name&limit=-1`, 'so_customer') : [],
		vIds.length ? list(`/items/fleet_kendaraan?filter[id][_in]=${vIds.join(',')}&fields=id,nomor_polisi&limit=-1`, 'fleet_kendaraan') : []
	]);
	const cu = new Map(cust.map((c: any) => [String(c.id), c.customer_name]));
	const pl = new Map(veh.map((v: any) => [String(v.id), v.nomor_polisi]));
	const antrian = sjs.map((s) => {
		const cl = normalizeChecklist(s.security_checklist);
		const ditahan = cl?.hasil === 'ditahan';
		return {
		id: s.id, nomor_sj: s.nomor_sj,
		customer: cu.get(String(unwrap(s.so_customer_id))) || null,
		tujuan: s.delivery_address || null, driver: s.driver || null,
		plat: pl.get(String(unwrap(s.vehicle_id))) || null,
		dibuat: s.date_created,
		menunggu_menit: s.date_created ? Math.max(0, Math.round((Date.now() - new Date(s.date_created).getTime()) / 60000)) : null,
		ditahan, alasan_tahan: ditahan ? ((cl?.alasan as string) ?? null) : null
		};
	});
	return { aktif: true, count: antrian.length, antrian };
}
