// src/lib/server/fieldProjectScope.ts
// SERVER-ONLY. Resolver bersama untuk tambal sempit (celah otorisasi proxy Directus,
// temuan 14 Sep 2026): banyak koleksi (manpower_payroll, pengajuan_anggaran, dst)
// diteruskan proxy /api/directus dengan token admin server tanpa penegakan otorisasi --
// pembatasan "cuma proyek yang saya pegang" sebelumnya HANYA filter JavaScript di
// browser (projectScope.ts), jadi siapa pun yang login sah bisa memanggil endpoint
// ini langsung (lewat console) dan membaca data lintas proyek yang bukan miliknya.
// Fungsi di sini menegakkan pembatasan proyek yang SAMA di server, dipakai bersama
// oleh tiap guard per-koleksi (lihat proxy [...path]/+server.ts) -- mengikuti pola
// hseGuard.ts (tambal per-koleksi eksplisit di titik proxy generik, BUKAN mesin RBAC
// Directus baru; lihat catatan di hseGuard.ts).
//
// TIDAK menulis ulang resolusi karyawan/kepemimpinan proyek dari nol -- reuse
// projectLeaderGuard.ts (resolveKaryawanByEmail + resolveLedProjectIds, SUDAH
// mencakup fallback nama leader legacy _icontains) dan manpowerLeaderGuard.ts
// (resolveManpowerByEmail), infrastruktur guard yang sudah ada & dipakai endpoint
// PL/ML Dashboard lain. Revisi 14 Sep 2026 sore: draf pertama file ini menulis ulang
// lookup ini dari nol dan sengaja TIDAK menyertakan fallback nama (supaya fail-closed
// alih-alih salah meniru logika fuzzy) -- ternyata fallback itu sudah ada, teruji, dan
// dipakai endpoint lain; reuse langsung lebih aman daripada dua implementasi yang bisa
// diam-diam berbeda perilaku.

import { getUserPermissions } from './rbacServer';
import { resolveKaryawanByEmail, resolveLedProjectIds } from './projectLeaderGuard';
import { resolveManpowerByEmail } from './manpowerLeaderGuard';
import { directusServerJson } from './directus';

/** Role dengan akses penuh lintas proyek -- cermin token match di
 *  $lib/stores/auth.ts:shouldFilterProjectsByLeader(). JAGA TETAP SINKRON: kalau
 *  daftar token di sana berubah, ubah juga di sini. */
const FULL_VIEW_TOKENS = new Set(['admin', 'manager', 'director', 'finance', 'hrd']);

function isFullViewRole(roleId: string | null): boolean {
	if (!roleId) return false;
	if (roleId === 'super_admin') return true;
	const tokens = roleId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	return tokens.some((t) => FULL_VIEW_TOKENS.has(t));
}

export type FieldProjectScope = { unrestricted: true } | { unrestricted: false; projectIds: number[] };

/** Semua proyek tempat manpower ini memegang kursi Leader/Wakil lapangan. */
async function resolveLedManpowerProjectIds(manpowerId: number): Promise<number[]> {
	const qs = new URLSearchParams({
		filter: JSON.stringify({
			_or: [{ manpower_leader_id: { _eq: manpowerId } }, { manpower_leader_wakil_id: { _eq: manpowerId } }]
		}),
		fields: 'id',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/projects?${qs.toString()}`).catch(
		() => null
	);
	return (res?.data || []).map((p) => p.id);
}

/**
 * Proyek mana yang boleh dilihat pemanggil ini. `unrestricted: true` = lolos tanpa
 * filter tambahan (role admin/manager/director/finance/hrd/super_admin). Selain itu:
 * hanya proyek tempat dia memegang kursi Project Leader (leader_id, fallback nama --
 * lihat resolveLedProjectIds) atau Manpower Leader/Wakil. Dipakai lintas koleksi
 * (payroll, pengajuan anggaran, dst) -- resolve identitas & kursi proyek TIDAK
 * berbeda per koleksi, yang berbeda hanya kondisi tambahan (mis. "punya saya
 * sendiri") di guard masing-masing.
 */
export async function resolveFieldProjectScope(
	idToken: string,
	uid: string,
	email: string | null | undefined
): Promise<FieldProjectScope> {
	const { roleId } = await getUserPermissions(idToken, uid);
	if (isFullViewRole(roleId)) return { unrestricted: true };

	const projectIds = new Set<number>();

	try {
		const karyawan = await resolveKaryawanByEmail(email);
		if (karyawan) {
			for (const id of await resolveLedProjectIds(karyawan)) projectIds.add(id);
		}

		const manpower = await resolveManpowerByEmail(email);
		if (manpower) {
			for (const id of await resolveLedManpowerProjectIds(manpower.id)) projectIds.add(id);
		}
	} catch (e) {
		// Gagal resolve -> default TERTUTUP (fail closed): daftar proyek tetap
		// apa adanya yang sudah terkumpul (bisa kosong), bukan fail open.
		console.warn('[fieldProjectScope] Gagal resolve cakupan proyek, fail-closed:', (e as Error)?.message);
	}

	return { unrestricted: false, projectIds: [...projectIds] };
}

/** Gabungkan satu kondisi filter Directus ke query string GET yang sudah ada (via `_and`). */
export function withScopeFilter(search: string, condition: Record<string, any>): string {
	const params = new URLSearchParams(search);
	const existingFilterRaw = params.get('filter');
	let existingFilter: any = null;
	if (existingFilterRaw) {
		try {
			existingFilter = JSON.parse(existingFilterRaw);
		} catch {
			existingFilter = null;
		}
	}
	const merged = existingFilter ? { _and: [existingFilter, condition] } : condition;
	params.set('filter', JSON.stringify(merged));
	return `?${params.toString()}`;
}

/** Kondisi `filter[project_id][_in]` siap pakai bersama withScopeFilter(). */
export function projectIdInCondition(projectIds: number[]): Record<string, any> {
	return { project_id: { _in: projectIds } };
}
