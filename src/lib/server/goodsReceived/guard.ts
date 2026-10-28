// src/lib/server/goodsReceived/guard.ts
// Guard bersama untuk endpoint /api/goods-received/*: verifikasi Firebase token,
// resolve ke karyawan, lalu resolve daftar project_id yang jadi tanggung jawab
// karyawan tsb sebagai leader (dipakai untuk scoping Surat Jalan yang boleh dilihat/dikonfirmasi).

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { resolveKaryawanByEmail, type ServerKaryawan } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';

export async function authenticateProjectLeader(
	event: RequestEvent
): Promise<{ karyawan: ServerKaryawan; projectIds: number[] }> {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');
	}

	const filter = {
		_and: [
			{ status: { _nin: ['closed', 'cancel', 'cancelled'] } },
			{
				_or: [
					{ leader_id: { _eq: karyawan.id } },
					{ leader: { _icontains: karyawan.nama_karyawan } }
				]
			}
		]
	};
	const query = new URLSearchParams({
		filter: JSON.stringify(filter),
		fields: 'id',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/projects?${query.toString()}`);
	const projectIds = (result?.data || []).map((p) => p.id);

	return { karyawan, projectIds };
}

export type GRActorRole = 'project_leader' | 'admin' | 'staff_backup';

export interface GRActor {
	karyawan: ServerKaryawan;
	/** null = tidak dibatasi per-proyek (Admin). Selalu array untuk role lain. */
	projectIds: number[] | null;
	role: GRActorRole;
}

/**
 * Guard yang diperluas (Gap #6, dual-input) untuk endpoint konfirmasi/list GR:
 * selain Project Leader (pemilik utama proyek), izinkan juga:
 *  - Admin (permission 'admin_panel' / '*') sebagai backup — bisa mengonfirmasi
 *    proyek manapun, karena Project Leader biasa memegang 3-5 proyek dan tidak
 *    selalu di site.
 *  - Staff backup yang DITUNJUK MANUAL oleh Admin per proyek lewat
 *    projects.gr_backup_karyawan_ids — bisa mengonfirmasi hanya untuk proyek
 *    tempat mereka ditunjuk.
 *
 * CATATAN (koreksi setelah audit ulang): draf awal mencoba mencocokkan lewat
 * koleksi `manpower_assignment`, tapi `manpower` (buruh lapangan harian/borongan)
 * adalah koleksi TERPISAH dari `karyawan` (pegawai berlogin Firebase) — tidak
 * ada relasi ID di antara keduanya, dan populasi manpower umumnya tidak punya
 * akun untuk login ke app ini. Jalur backup karena itu diganti ke penunjukan
 * eksplisit oleh Admin (karyawan yang memang punya akun), bukan tabel manpower.
 *
 * Urutan cek: leader -> admin -> staff backup yang ditunjuk. Melempar 403 bila
 * tidak cocok dengan peran manapun.
 */
export async function authenticateGRActor(event: RequestEvent): Promise<GRActor> {
	const header = event.request.headers.get('authorization') || '';
	const idToken = header.startsWith('Bearer ') ? header.slice(7) : null;

	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');
	}

	const { karyawan: _k, projectIds: leaderProjectIds } = await authenticateProjectLeader(event);

	if (idToken) {
		const { permissions } = await getUserPermissions(idToken, user.localId);
		if (hasAnyPermission(permissions, ['admin_panel', '*'])) {
			return { karyawan, projectIds: null, role: 'admin' };
		}
	}
	if (leaderProjectIds.length > 0) {
		return { karyawan, projectIds: leaderProjectIds, role: 'project_leader' };
	}

	const backupQuery = new URLSearchParams({
		filter: JSON.stringify({ status: { _nin: ['closed', 'cancel', 'cancelled'] } }),
		fields: 'id,gr_backup_karyawan_ids',
		limit: '-1'
	});
	const backupResult = await directusServerJson<{ data: Array<{ id: number; gr_backup_karyawan_ids: number[] | null }> }>(
		`/items/projects?${backupQuery.toString()}`
	).catch(() => null);
	const backupProjectIds = (backupResult?.data || [])
		.filter((p) => Array.isArray(p.gr_backup_karyawan_ids) && p.gr_backup_karyawan_ids.includes(karyawan.id))
		.map((p) => p.id);

	if (backupProjectIds.length > 0) {
		return { karyawan, projectIds: backupProjectIds, role: 'staff_backup' };
	}

	throw error(403, 'Anda bukan Project Leader, Admin, atau staff backup yang ditunjuk untuk proyek manapun.');
}

/** true bila projectIds null (Admin, tak dibatasi) atau id ada di dalamnya. */
export function isProjectAllowed(projectIds: number[] | null, projectId: number): boolean {
	return projectIds === null || projectIds.includes(projectId);
}
