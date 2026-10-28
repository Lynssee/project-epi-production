// src/lib/server/hse/hseGuard.ts
// T7 (rencana JSA & Administrasi HSE v2.0): sebelum ini, seluruh request lapangan
// diteruskan proxy /api/directus dengan hak token admin — role Firestore
// (leader/staff/driver/dst) tidak pernah ditegakkan di lapisan data, hanya di
// UI. Field sensitif hse_incident (identitas korban, jenis cedera, bagian
// tubuh, hari hilang/LTI) bisa dibaca siapa pun yang punya sesi login valid.
//
// Guard ini menutup celah itu di titik proxy generik (bukan membangun RBAC
// Directus baru — lihat audit T7: token Directus dibagi satu untuk semua
// user, jadi permission Directus per-role tidak akan berpengaruh). Mengikuti
// pola pemeriksaan koleksi eksplisit yang sudah dipakai di file yang sama
// untuk PAYROLL_COLLECTIONS, bukan mesin permission generik baru.

import { getUserPermissions } from '$lib/server/rbacServer';

export const HSE_INCIDENT_SENSITIVE_FIELDS = ['korban_id', 'jenis_cedera', 'bagian_tubuh', 'hari_hilang_lti'];

/** Role dengan tanggung jawab pengawasan HSE — boleh melihat detail cedera korban.
 *  Pekerja lapangan biasa (staff/operator/sales/driver/satpam) hanya boleh melihat
 *  laporannya sendiri lewat fetchMyHseReports (yang memang tidak meminta field ini). */
const HSE_SUPERVISORY_ROLES = new Set(['super_admin', 'admin_project', 'leader', 'hrd', 'director', 'manager']);

export async function canViewHseSensitiveFields(idToken: string, uid: string): Promise<boolean> {
	try {
		const { roleId, permissions } = await getUserPermissions(idToken, uid);
		if (permissions.includes('*')) return true;
		return !!roleId && HSE_SUPERVISORY_ROLES.has(roleId);
	} catch {
		// Gagal resolve role -> default TERTUTUP (fail closed), bukan fail open.
		return false;
	}
}

function stripFieldsDeep(value: any): any {
	if (Array.isArray(value)) return value.map(stripFieldsDeep);
	if (value && typeof value === 'object') {
		const out: Record<string, any> = {};
		for (const [k, v] of Object.entries(value)) {
			if (HSE_INCIDENT_SENSITIVE_FIELDS.includes(k)) continue;
			out[k] = v;
		}
		return out;
	}
	return value;
}

/** Hapus field sensitif dari body JSON respons hse_incident (list atau single item). */
export function stripHseIncidentSensitiveFields(bodyText: string): string {
	try {
		const parsed = JSON.parse(bodyText);
		if (parsed && 'data' in parsed) {
			parsed.data = stripFieldsDeep(parsed.data);
			return JSON.stringify(parsed);
		}
		return bodyText;
	} catch {
		return bodyText;
	}
}
