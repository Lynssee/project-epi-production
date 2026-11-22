// src/lib/server/equipmentHubAuth.ts
// SERVER-ONLY. Izin melihat nominal Rp di Hub Equipment — dipisah dari equipmentHub.ts agar modul I/O itu ringan diuji.
import type { RequestEvent } from '@sveltejs/kit';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import type { HubSettings } from '$lib/server/equipmentHubCore';

/** Nominal tampil hanya bila setelan aktif DAN pemanggil punya salah satu izin. Gagal baca izin → false (nominal tetap tersembunyi). */
export async function canSeeHubCost(event: RequestEvent, user: any, settings: HubSettings): Promise<boolean> {
	if (!settings.showCost || settings.costPermissions.length === 0) return false;
	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	try {
		const { permissions } = await getUserPermissions(idToken, user.localId, { email: user.email });
		return hasAnyPermission(permissions, settings.costPermissions);
	} catch (e) {
		console.error('[equipmentHub] gagal baca permission (nominal disembunyikan):', e instanceof Error ? e.message : e);
		return false;
	}
}
