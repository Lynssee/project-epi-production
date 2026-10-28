// src/routes/api/automation/terima-site-otomatis/+server.ts
// RSM-11 §4.1 — batas hari penerimaan di site: bila leader tidak mengonfirmasi dalam N hari setelah SJ lolos gerbang
// (setelan inventory.terima_site.batas_hari), barang dianggap DITERIMA otomatis (IN-RECEIPT + biaya diakui, source
// 'auto_batas'). Hanya aktif bila inventory.terima_site.mode ≠ 'saat_sj_dibuat' (mode lama sudah mengakui saat dibuat).
// Dipanggil terjadwal (n8n/cron) dengan shared secret ?s=<AUTOMATION_SERVER_SECRET>. ?dry=1 = hanya hitung.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { getInventorySettingServer } from '$lib/server/inventorySettings';
import { receiveProjectDelivery, sjMelewatiBatas } from '$lib/server/receiveProjectDelivery';

const MAKS_SJ_PER_JALAN = 50;

export const GET: RequestHandler = async ({ url }) => {
	const expected = env.AUTOMATION_SERVER_SECRET;
	if (!expected) throw error(503, 'AUTOMATION_SERVER_SECRET belum dikonfigurasi di server.');
	if ((url.searchParams.get('s') || '') !== expected) throw error(401, 'Invalid automation server secret');
	const dry = url.searchParams.get('dry') === '1';

	const mode = await getInventorySettingServer<string>('inventory.terima_site.mode', 'saat_sj_dibuat');
	if (mode === 'saat_sj_dibuat') return json({ success: true, mode, dilewati: 'mode saat_sj_dibuat — tidak ada penerimaan tertunda' });
	const batasHari = Math.max(1, Number(await getInventorySettingServer<number>('inventory.terima_site.batas_hari', 3)) || 3);

	// 1) biaya tertunda → SJ id (query terpisah per koleksi, Aturan #2)
	const tertunda = (await directusServerJson<{ data: Array<{ surat_jalan_id: number | { id: number } | null }> }>(
		`/items/project_expenses?filter[is_received][_eq]=false&filter[surat_jalan_id][_nnull]=true&fields=surat_jalan_id&limit=500`
	))?.data || [];
	const sjIds = [...new Set(tertunda.map((e) => (typeof e.surat_jalan_id === 'object' ? e.surat_jalan_id?.id : e.surat_jalan_id)).filter((x): x is number => !!x))];
	if (!sjIds.length) return json({ success: true, mode, batasHari, kandidat: 0, diproses: [] });

	// 2) hanya SJ yang sudah keluar gerbang (shipped) — SJ yang masih tertahan/di gudang belum "diterima" apa pun
	const sjs = (await directusServerJson<{ data: Array<{ id: number; nomor_sj: string; status: string; security_verified_at: string | null; date_created: string | null; gr_enabled: boolean | null }> }>(
		`/items/surat_jalan?filter[id][_in]=${sjIds.join(',')}&filter[status][_eq]=shipped&fields=id,nomor_sj,status,security_verified_at,date_created,gr_enabled&limit=-1`
	))?.data || [];
	const lewat = sjMelewatiBatas(sjs, batasHari).slice(0, MAKS_SJ_PER_JALAN);

	const hasil: Array<Record<string, unknown>> = [];
	for (const s of lewat) {
		if (dry) { hasil.push({ sjId: s.id, nomor_sj: s.nomor_sj, dry: true }); continue; }
		try {
			const r = await receiveProjectDelivery(s.id, { by: null, source: 'auto_batas' });
			hasil.push({ nomor_sj: s.nomor_sj, ...r });
		} catch (e) {
			console.error(`[terima-site-otomatis] SJ ${s.id} gagal:`, e instanceof Error ? e.message : e);
			hasil.push({ sjId: s.id, nomor_sj: s.nomor_sj, error: e instanceof Error ? e.message : String(e) });
		}
	}
	return json({ success: true, mode, batasHari, kandidat: sjs.length, melewatiBatas: lewat.length, dry, diproses: hasil });
};
