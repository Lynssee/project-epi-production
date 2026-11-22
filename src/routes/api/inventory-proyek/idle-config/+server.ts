// src/routes/api/inventory-proyek/idle-config/+server.ts
// SOP Inventory Fase 5: batas hari "barang menganggur" dari system_settings (inventory.idle.proyek_hari), diatur admin di
// /settings/inventory. Default 30. Gagal baca = pakai default (dilog), tidak menggagalkan halaman.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	await authenticateProjectLeader(event);
	let hari = 30;
	try {
		const r = await directusServerJson<{ data: { setting_value: any }[] }>(
			`/items/system_settings?limit=1&fields=setting_value&filter[setting_key][_eq]=inventory.idle.proyek_hari`
		);
		const raw = r?.data?.[0]?.setting_value;
		const n = Number(typeof raw === 'string' ? JSON.parse(raw) : raw);
		if (Number.isFinite(n) && n > 0) hari = Math.round(n);
	} catch (e: any) {
		console.error('[idle-config] gagal baca setelan, pakai 30:', e?.message || e);
	}
	return json({ hari });
};
