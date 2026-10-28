// src/lib/server/gates/plFieldOverride.ts
// SERVER-ONLY. Path A — Audit & Hardening Gate v2 (30 Agu 2026), F0.3.
// Resolusi hak "tembus gate Packing List lapangan": super admin ATAU GM (jabatan_id=4),
// sejajar dengan resolveOverrideAllowed di erp-epi-1/src/routes/api/packing-list/validate/+server.js.
// GM_JABATAN_ID dibiarkan hardcoded di sini demi paritas dengan sisi admin — pelepasan
// hardcode (helper resolveGateOverrideAuthority dari app_config) adalah pekerjaan F2.

import type { RequestEvent } from '@sveltejs/kit';
import { verifyFirebaseToken } from '$lib/server/firebaseAuth';
import { getUserPermissions } from '$lib/server/rbacServer';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';

// F2.6 (Audit & Hardening Gate v2, 30 Agu 2026): jabatan yang boleh menembus gate
// dibaca dari system_settings key `gate.override.jabatan_ids` (JSON array angka,
// default [4]). Sejajar dengan erp-epi-1/src/lib/server/gateOverrideLog.js.
const DEFAULT_GM_JABATAN_IDS = ['4'];
let _jabatanCache: { at: number; ids: string[] } = { at: 0, ids: DEFAULT_GM_JABATAN_IDS };
const JABATAN_TTL_MS = 5 * 60 * 1000;

async function getGateOverrideJabatanIds(): Promise<string[]> {
	if (Date.now() - _jabatanCache.at < JABATAN_TTL_MS) return _jabatanCache.ids;
	let ids = DEFAULT_GM_JABATAN_IDS;
	try {
		const r: any = await directusServerJson(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent('gate.override.jabatan_ids')}&fields=setting_value&limit=1`
		);
		const raw = r?.data?.[0]?.setting_value;
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (Array.isArray(parsed) && parsed.length) ids = parsed.map((n: any) => String(n));
	} catch {
		/* pakai default */
	}
	_jabatanCache = { at: Date.now(), ids };
	return ids;
}

function bearer(event: RequestEvent): string | null {
	const h = event.request.headers.get('authorization') || '';
	return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** true = user boleh menembus gate PL lapangan (super admin / GM). Gagal-lunak → false. */
export async function resolveFieldOverrideAllowed(event: RequestEvent): Promise<boolean> {
	try {
		const idToken = bearer(event);
		const user = await verifyFirebaseToken(idToken);
		if (!user) return false;

		const [{ roleId, permissions = [] }, karyawan, jabatanIds] = await Promise.all([
			getUserPermissions(idToken as string, user.localId).catch(() => ({ roleId: null, permissions: [] as string[] })),
			getKaryawanByFirebaseUid(user.localId).catch(() => null),
			getGateOverrideJabatanIds()
		]);
		if (roleId === 'super_admin' || permissions.includes('*')) return true;

		const jId =
			typeof (karyawan as any)?.jabatan_id === 'object'
				? (karyawan as any).jabatan_id?.id
				: (karyawan as any)?.jabatan_id;
		return jId != null && jabatanIds.map(String).includes(String(jId));
	} catch {
		return false;
	}
}

/**
 * Catat penembusan gate PL lapangan ke app_notifications (tipe sama dengan endpoint
 * admin `packing_list_gate_override`) supaya muncul di Panel Kepatuhan Packing List
 * erp-epi-1. Best-effort (F2.2 "wajib berhasil" adalah pekerjaan fase berikutnya).
 */
export async function recordFieldGateOverride(params: {
	firebaseUid: string;
	failedGates: string[];
	context: string;
	sourceId?: string | number | null;
	reason?: string | null;
}): Promise<void> {
	try {
		const karyawan = await getKaryawanByFirebaseUid(params.firebaseUid).catch(() => null);
		const who = (karyawan as any)?.nama_karyawan || params.firebaseUid;
		const msg =
			`OVERRIDE gate Packing List (lapangan) oleh ${who} — konteks: ${params.context}. ` +
			`Gate dilewati: ${params.failedGates.join(', ') || '-'}.` +
			(params.reason ? ` Alasan: ${params.reason}` : '');
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'packing_list_gate_override',
				title: 'Gate Packing List ditembus (lapangan, super admin/GM)',
				message: msg,
				priority: 'high',
				department: 'PROJECT',
				action_required: false,
				action_url: '/inventory/keluar-masuk?tab=surat_jalan',
				source_collection: 'project_budgets',
				source_id: params.sourceId != null ? String(params.sourceId) : params.context,
				read: false,
				created_at: new Date().toISOString()
			})
		});
	} catch (e: any) {
		console.error('[plFieldOverride] gagal mencatat override (diabaikan):', e?.message);
	}
}
