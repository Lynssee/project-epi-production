// src/routes/api/equipment/hub/[id]/+server.ts
// Hub Equipment 360° — satu endpoint, data dimuat on-demand per bagian: ?section=summary|repair|p2h|purchase|usage.
// [id] = equipment.id (uuid; kode equipment mengandung "/" sehingga tidak dipakai di URL). Hanya BACA.
// Bagian selain summary hanya dimuat saat tab dibuka (hemat kuota HP & server). Tab yang dimatikan di fleet_settings
// 'eq_hub_tab_aktif' ditolak (404). Nominal Rp disensor server-side kecuali setelan + izin mengizinkan.

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { findVehicleByEquipment } from '$lib/server/equipmentVerify';
import {
	HUB_SECTIONS,
	loadEquipmentRow,
	loadHubSettings,
	loadP2h,
	loadPelatihan,
	loadPurchase,
	loadRepair,
	loadSummary,
	loadUsage,
	resolveHubGateMode,
	type HubSection
} from '$lib/server/equipmentHub';
import { canSeeHubCost } from '$lib/server/equipmentHubAuth';

const TAB_OF_SECTION: Partial<Record<HubSection, string>> = { repair: 'perbaikan', p2h: 'p2h', purchase: 'pembelian', usage: 'pemakaian' };

export async function GET(event: RequestEvent) {
	const { user } = await authenticateEss(event);
	const id = String(event.params.id || '').trim();
	if (!id) throw error(400, 'ID equipment wajib diisi.');
	const section = (event.url.searchParams.get('section') || 'summary') as HubSection;
	if (!HUB_SECTIONS.includes(section)) throw error(400, 'Bagian tidak dikenal.');

	let eq;
	try {
		eq = await loadEquipmentRow(id);
	} catch (e) {
		console.error('[api/equipment/hub] gagal baca equipment:', e instanceof Error ? e.message : e);
		throw error(502, 'Gagal membaca data equipment. Coba lagi.');
	}
	if (!eq) throw error(404, 'Equipment tidak ditemukan.');

	const settings = await loadHubSettings();
	const tab = TAB_OF_SECTION[section];
	if (tab && !settings.tabs.includes(tab as any)) throw error(404, 'Bagian ini dinonaktifkan oleh administrator.');

	try {
		switch (section) {
			case 'summary':
				return json(await loadSummary(eq, settings, await resolveHubGateMode()));
			case 'pelatihan':
				return json(await loadPelatihan(eq));
			case 'repair':
				return json(await loadRepair(id));
			case 'p2h':
				return json(await loadP2h(id));
			case 'purchase':
				return json(await loadPurchase(eq, await canSeeHubCost(event, user, settings)));
			case 'usage': {
				const vehicle = await findVehicleByEquipment(id, undefined, eq.code).catch(() => null);
				return json(await loadUsage(eq, vehicle));
			}
		}
	} catch (e) {
		console.error(`[api/equipment/hub] gagal memuat bagian ${section}:`, e instanceof Error ? e.message : e);
		throw error(502, 'Gagal memuat data. Coba lagi.');
	}
}
