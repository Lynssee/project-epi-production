// src/lib/server/equipmentVerifyAuth.ts
// SERVER-ONLY. Pemeriksaan permission penembus kunci pengemudi — dipisah dari equipmentVerify.ts agar modul I/O itu
// tetap ringan diuji (tanpa menarik rbacServer).
import type { RequestEvent } from '@sveltejs/kit';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import type { VerifySettings } from '$lib/server/equipmentVerifyCore';

/** Gagal baca permission => false (override tertutup, dicatat) — fail-safe untuk jalur hard. */
export async function hasOverridePermission(event: RequestEvent, user: any, settings: VerifySettings): Promise<boolean> {
	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	try {
		const { permissions } = await getUserPermissions(idToken, user.localId, { email: user.email });
		return hasAnyPermission(permissions, settings.overridePermissions);
	} catch (e) {
		console.error('[equipmentVerify] gagal baca permission (override ditutup):', e instanceof Error ? e.message : e);
		return false;
	}
}
