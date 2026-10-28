// src/lib/server/sjGerbangAntrian.ts
// SJH-10 — satu sumber "antrian SJ di gerbang", dipakai kiosk (gerbang-sj/antrian, auth badge) dan
// aplikasi satpam (api/satpam/sj-antrian, auth Firebase). Query dipisah per relasi (Aturan #2) dan
// dijalankan di server, sehingga tidak ada lagi query klien ke surat_jalan_items (pernah 403, GATE-01).

import { directusServerJson } from '$lib/server/directus';

export type AntrianRow = {
	id: number;
	nomor_sj: string;
	status: string;
	driver: string | null;
	plat: string | null;
	tujuan: string | null;
	items: { nama_barang: string; qty: number | null; unit: string | null }[];
	wait_min: number | null;
	overdue: boolean;
	/** alasan SJ belum siap di gerbang, null bila siap */
	belum_siap: string | null;
};

/** Bagian murni: alasan SJ belum siap di gerbang (null = siap). */
export function alasanBelumSiap(sj: { print_count?: unknown }): string | null {
	return Number(sj?.print_count) >= 1 ? null : 'Belum dicetak';
}

export async function getGerbangAntrian(): Promise<{ siap: AntrianRow[]; belumSiap: AntrianRow[] }> {
	// SJ yang perlu diperiksa satpam: status needs_security_check ATAU tahap tracking menunggu_gerbang.
	const res = await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan?filter[_or][0][status][_eq]=needs_security_check` +
		`&filter[_or][1][track_stage][_eq]=menunggu_gerbang` +
		`&fields=id,nomor_sj,status,track_stage,track_stage_at,driver,vehicle_id,delivery_address,` +
		`date_created,security_verified_at,print_count,so_customer_id.customer_name` +
		`&sort=track_stage_at,date_created&limit=100`
	).catch((e) => {
		console.error('[sjGerbangAntrian] gagal baca surat_jalan:', e instanceof Error ? e.message : e);
		return { data: [] as any[] };
	});
	const sjs = (res?.data || []).filter((s) => !s.security_verified_at);
	if (sjs.length === 0) return { siap: [], belumSiap: [] };

	const ids = sjs.map((s) => s.id);
	const vehicleIds = [...new Set(sjs.map((s) => (typeof s.vehicle_id === 'object' ? s.vehicle_id?.id : s.vehicle_id)).filter(Boolean))];
	const [vehicles, items] = await Promise.all([
		vehicleIds.length
			? directusServerJson<{ data: any[] }>(`/items/fleet_kendaraan?filter[id][_in]=${vehicleIds.join(',')}&fields=id,nomor_polisi&limit=-1`)
				.then((r) => r?.data || []).catch(() => [])
			: Promise.resolve([]),
		directusServerJson<{ data: any[] }>(
			`/items/surat_jalan_items?filter[surat_jalan_id][_in]=${ids.join(',')}&fields=id,surat_jalan_id,nama_barang,qty_delivered,qty_required,unit&limit=-1`
		).then((r) => r?.data || []).catch(() => [])
	]);
	const platById = new Map(vehicles.map((v: any) => [String(v.id), v.nomor_polisi as string]));
	const itemsBySj = new Map<string, AntrianRow['items']>();
	for (const it of items) {
		const k = String(typeof it.surat_jalan_id === 'object' ? it.surat_jalan_id?.id : it.surat_jalan_id);
		if (!itemsBySj.has(k)) itemsBySj.set(k, []);
		itemsBySj.get(k)!.push({ nama_barang: it.nama_barang || 'Barang tanpa nama', qty: it.qty_delivered ?? it.qty_required ?? null, unit: it.unit || null });
	}

	const now = Date.now();
	const rows: AntrianRow[] = sjs.map((sj) => {
		const since = sj.track_stage_at || sj.date_created;
		const waitMin = since ? Math.max(0, Math.round((now - new Date(since).getTime()) / 60000)) : null;
		const vid = typeof sj.vehicle_id === 'object' ? sj.vehicle_id?.id : sj.vehicle_id;
		return {
			id: sj.id,
			nomor_sj: sj.nomor_sj,
			status: sj.status,
			driver: sj.driver || null,
			plat: vid ? platById.get(String(vid)) || null : null,
			tujuan: sj.delivery_address || sj.so_customer_id?.customer_name || null,
			items: itemsBySj.get(String(sj.id)) || [],
			wait_min: waitMin,
			overdue: waitMin != null && waitMin > 30,
			belum_siap: alasanBelumSiap(sj)
		};
	});
	return { siap: rows.filter((r) => !r.belum_siap), belumSiap: rows.filter((r) => r.belum_siap) };
}
