// src/lib/services/projectScope.ts
// Satu tempat untuk menjawab "proyek mana yang boleh dilihat pengguna ini".
// Dokumen: erp-epi-1/docs/rencana-manpower-leader.md
//
// Sebelumnya tiap layar mengulang pola ini sendiri:
//
//   const needsLeaderFilter = shouldFilterProjectsByLeader(roleId);
//   const leaderParam = needsLeaderFilter ? (karyawanId ?? karyawanName) : null;
//   await getProjects(leaderParam, ...);
//
// Pola itu punya dua lubang:
//
//   1. Pengguna TANPA data karyawan menghasilkan leaderParam = null, dan null di
//      getProjects() berarti "tanpa filter" — jadi orang yang seharusnya dibatasi
//      malah melihat SELURUH proyek. Manpower Leader murni persis di kategori ini:
//      pekerja harian/borongan tidak punya baris `karyawan`.
//   2. Manpower Leader terikat ke proyek lewat kursi projects.manpower_leader_id,
//      bukan lewat projects.leader — jadi filter nama Project Leader tidak pernah
//      cocok dan daftarnya kosong.
//
// Helper di bawah menutup keduanya: kursi lapangan ikut diperhitungkan, dan bila
// pengguna memang harus dibatasi tapi tidak punya pegangan apa pun, hasilnya
// KOSONG (least privilege) — bukan semua proyek.

import { get } from 'svelte/store';
import { authStore, shouldFilterProjectsByLeader } from '$lib/stores/auth';
import { getProjectSetting } from './projectSettings';
import { getProjects } from './projects';
import { secureDirectusJson } from './secureDirectus';

export interface ProjectScope {
	/** true = boleh lihat semua proyek (admin/manager/finance/hrd/direktur/super admin). */
	unrestricted: boolean;
	/** Pegangan Project Leader: karyawanId (disukai) atau nama (legacy). */
	leaderParam: number | string | null;
	/** Proyek tempat pengguna memegang kursi Manpower Leader/Wakil. */
	kursiProjectIds: number[];
	/** Nama leader (untuk proyek lama yang leader_id-nya kosong/menunjuk baris duplikat). */
	leaderName: string | null;
	/** Workshop yang dikoordinasi pengguna — dia berhak atas SELURUH proyek di sana. */
	workshops: string[];
	/** Proyek di mana pengguna pernah menjadi leader terdahulu (demisioner/transisi). */
	demisionerProjectIds: number[];
	/** true = tidak punya pegangan apa pun; daftar proyek harus kosong. */
	kosong: boolean;
}

/**
 * Workshop yang dikoordinasi pengguna ini, dibaca dari setelan
 * `project.scope.workshop_coordinators` (Directus, bisa diubah tanpa deploy).
 *
 * Koordinator workshop tidak terikat ke proyek lewat kursi Project Leader maupun
 * Manpower Leader — dia bertanggung jawab atas satu lokasi kerja. Tanpa cakupan ini
 * daftarnya kosong meski puluhan proyek berjalan di workshop-nya.
 */
export function getWorkshopScope(): string[] {
	const s = get(authStore);
	const rules = getProjectSetting('project.scope.workshop_coordinators');
	if (!rules || typeof rules !== 'object') return [];

	const milik = new Set(
		[s.karyawanPosisi, s.role, s.roleId, ...(s.roleIds || [])]
			.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
			.map((v) => v.trim().toUpperCase())
	);
	if (milik.size === 0) return [];

	const hasil: string[] = [];
	for (const [workshop, jabatan] of Object.entries(rules as Record<string, unknown>)) {
		const daftar = Array.isArray(jabatan) ? jabatan : [jabatan];
		const cocok = daftar.some(
			(j) => typeof j === 'string' && milik.has(j.trim().toUpperCase())
		);
		if (cocok) hasil.push(String(workshop).trim().toLowerCase());
	}
	return hasil;
}

/**
 * Cache in-memory untuk proyek demisioner per karyawan (hemat API usage).
 */
let demisionerCache: { karyawanId: number | null; projectIds: number[]; timestamp: number } | null = null;

export function getCachedDemisionerProjectIds(karyawanId: number | null): number[] {
	if (!karyawanId) return [];
	if (demisionerCache && demisionerCache.karyawanId === karyawanId) {
		return demisionerCache.projectIds;
	}
	return [];
}

/**
 * Tarik daftar ID proyek di mana pengguna pernah menjadi leader terdahulu (demisioner/transisi).
 * Membaca dari surat_tugas_project (status: 'selesai') dan delegation_log (leader_lama_id).
 */
export async function fetchDemisionerProjectIds(karyawanId: number | null): Promise<number[]> {
	if (!karyawanId) return [];
	const now = Date.now();
	if (demisionerCache && demisionerCache.karyawanId === karyawanId && now - demisionerCache.timestamp < 120000) {
		return demisionerCache.projectIds;
	}
	try {
		const [stRes, delRes] = await Promise.all([
			secureDirectusJson<{ data: any[] }>(
				`/items/surat_tugas_project?filter[leader_id][_eq]=${karyawanId}&filter[status][_eq]=selesai&fields=project_id&limit=50`
			).catch(() => ({ data: [] })),
			secureDirectusJson<{ data: any[] }>(
				`/items/delegation_log?filter[leader_lama_id][_eq]=${karyawanId}&fields=project_id&limit=50`
			).catch(() => ({ data: [] }))
		]);

		const ids = new Set<number>();
		for (const row of stRes?.data || []) {
			const pid = typeof row.project_id === 'object' ? row.project_id?.id : row.project_id;
			if (pid) ids.add(Number(pid));
		}
		for (const row of delRes?.data || []) {
			const pid = typeof row.project_id === 'object' ? row.project_id?.id : row.project_id;
			if (pid) ids.add(Number(pid));
		}
		const result = [...ids];
		demisionerCache = { karyawanId, projectIds: result, timestamp: now };
		return result;
	} catch (e) {
		console.warn('Gagal memuat demisionerProjectIds:', e);
		return [];
	}
}

/**
 * Apakah pengguna yang sedang login adalah mantan leader (demisioner) untuk proyek ini?
 * True jika pengguna bukan leader aktif saat ini, namun ada di riwayat demisioner.
 */
export function isDemisionerLeader(project: any): boolean {
	const s = get(authStore);
	if (!project || !s.karyawanId) return false;

	if (project.leader_id != null && String(project.leader_id) === String(s.karyawanId)) return false;
	if (project.co_leader_id != null && String(project.co_leader_id) === String(s.karyawanId)) return false;
	if (s.karyawanName && (project.leader || '').trim().toUpperCase() === s.karyawanName.trim().toUpperCase()) return false;
	if (s.karyawanName && (project.co_leader || '').trim().toUpperCase() === s.karyawanName.trim().toUpperCase()) return false;

	const demisionerIds = getCachedDemisionerProjectIds(s.karyawanId);
	return demisionerIds.includes(Number(project.id));
}

/** Hitung cakupan proyek pengguna yang sedang login. */
export function getProjectScope(): ProjectScope {
	const s = get(authStore);

	if (!shouldFilterProjectsByLeader(s.roleId)) {
		return {
			unrestricted: true,
			leaderParam: null,
			kursiProjectIds: [],
			leaderName: null,
			workshops: [],
			demisionerProjectIds: [],
			kosong: false
		};
	}

	const leaderParam = s.karyawanId ?? s.karyawanName ?? null;
	const kursiProjectIds = s.manpowerLeaderProjectIds || [];
	// Hanya berguna sebagai cadangan saat filter utama memakai FK; kalau leaderParam
	// sudah berupa nama, kondisi nama-nya sudah terpasang di getProjects().
	const leaderName = typeof leaderParam === 'number' ? s.karyawanName : null;
	const workshops = getWorkshopScope();
	const demisionerProjectIds = getCachedDemisionerProjectIds(s.karyawanId);

	return {
		unrestricted: false,
		leaderParam,
		kursiProjectIds,
		leaderName,
		workshops,
		demisionerProjectIds,
		kosong:
			leaderParam == null &&
			kursiProjectIds.length === 0 &&
			workshops.length === 0 &&
			demisionerProjectIds.length === 0
	};
}

/**
 * Apakah pengguna memegang kursi Manpower Leader/Wakil di proyek ini?
 *
 * Dipakai gerbang halaman detail proyek. Tanpa ini, gerbang lama yang hanya
 * mencocokkan `leader_id`/`leader` akan menendang Manpower Leader keluar dari
 * proyek yang justru dia pimpin di lapangan.
 */
export function pegangKursiLapangan(projectId: number | string | null | undefined): boolean {
	if (projectId == null) return false;
	const s = get(authStore);
	return (s.manpowerLeaderProjectIds || []).some((id) => String(id) === String(projectId));
}

/**
 * Gerbang satu pintu untuk halaman detail proyek: apakah pengguna boleh membuka
 * proyek ini? Menggabungkan SEMUA jalur kepemilikan — kursi Manpower Leader,
 * kursi Project Leader (Lead PIC & Co-Leader via FK maupun nama), koordinator workshop, dan mantan leader (demisioner).
 */
export function bolehAksesProyek(project: any): boolean {
	const s = get(authStore);
	if (!shouldFilterProjectsByLeader(s.roleId)) return true;
	if (!project) return false;

	if (pegangKursiLapangan(project.id)) return true;

	// 1. Lead PIC (FK & Nama)
	if (
		s.karyawanId != null &&
		project.leader_id != null &&
		String(project.leader_id) === String(s.karyawanId)
	)
		return true;

	if (
		s.karyawanName &&
		(project.leader || '').toUpperCase().includes(s.karyawanName.toUpperCase())
	) {
		return true;
	}

	// 2. Co-Leader (FK & Nama)
	if (
		s.karyawanId != null &&
		project.co_leader_id != null &&
		String(project.co_leader_id) === String(s.karyawanId)
	)
		return true;

	if (
		s.karyawanName &&
		(project.co_leader || '').toUpperCase().includes(s.karyawanName.toUpperCase())
	) {
		return true;
	}

	const workshops = getWorkshopScope();
	if (workshops.length > 0 && project.workshop) {
		if (workshops.includes(String(project.workshop).trim().toLowerCase())) return true;
	}

	// Mantan leader (demisioner) tetap boleh membuka proyek dalam mode riwayat (Read-Only)
	if (s.karyawanId != null) {
		const demisionerIds = getCachedDemisionerProjectIds(s.karyawanId);
		if (demisionerIds.includes(Number(project.id))) return true;
	}

	return false;
}

export type PeranProjectUser = 'lead_pic' | 'co_leader' | 'manpower_leader' | 'workshop_coordinator' | 'demisioner' | 'anggota' | 'admin';

/**
 * Tentukan peran spesifik user yang sedang login di proyek ini (untuk badge & wewenang).
 */
export function getPeranProjectUser(project: any): PeranProjectUser {
	const s = get(authStore);
	if (!shouldFilterProjectsByLeader(s.roleId)) return 'admin';
	if (!project) return 'anggota';

	const kid = s.karyawanId ? String(s.karyawanId) : null;
	const kname = s.karyawanName ? s.karyawanName.trim().toUpperCase() : null;

	const lid = project.leader_id && typeof project.leader_id === 'object' ? String(project.leader_id.id) : (project.leader_id != null ? String(project.leader_id) : null);
	if (kid && lid && kid === lid) return 'lead_pic';
	if (kname && (project.leader || '').trim().toUpperCase().includes(kname)) return 'lead_pic';

	const clid = project.co_leader_id && typeof project.co_leader_id === 'object' ? String(project.co_leader_id.id) : (project.co_leader_id != null ? String(project.co_leader_id) : null);
	if (kid && clid && kid === clid) return 'co_leader';
	if (kname && (project.co_leader || '').trim().toUpperCase().includes(kname)) return 'co_leader';

	if (pegangKursiLapangan(project.id)) {
		return 'manpower_leader';
	}

	const workshops = getWorkshopScope();
	if (workshops.length > 0 && project.workshop && workshops.includes(String(project.workshop).trim().toLowerCase())) {
		return 'workshop_coordinator';
	}

	if (isDemisionerLeader(project)) return 'demisioner';

	return 'anggota';
}

export { invalidateProjectsCache } from './projects';

type GetProjectsOptions = {
	limit?: number;
	offset?: number;
	search?: string;
	sort?: string;
	filterStatus?: string;
	forceRefresh?: boolean;
};

/**
 * Pengganti langsung untuk pola `getProjects(leaderParam, ...)` di layar-layar
 * yang harus ter-scope per pengguna. Membaca authStore sendiri, jadi pemanggil
 * tidak perlu lagi mengurus roleId/karyawanId/token.
 */
export async function getProjectsForCurrentUser(
	excludeClosedAndCancelled: boolean = false,
	options: GetProjectsOptions = {}
): Promise<any[]> {
	const s = get(authStore);

	// Ambil riwayat demisioner jika user dibatasi per-leader
	let demisionerIds: number[] = [];
	if (shouldFilterProjectsByLeader(s.roleId) && s.karyawanId) {
		demisionerIds = await fetchDemisionerProjectIds(s.karyawanId);
	}

	const scope = getProjectScope();

	// Tidak punya pegangan apa pun — jangan jatuh ke "tanpa filter".
	if (scope.kosong && demisionerIds.length === 0) return [];

	const combinedOrIds = [...new Set([...scope.kursiProjectIds, ...demisionerIds])];

	return getProjects(
		scope.unrestricted ? null : scope.leaderParam,
		excludeClosedAndCancelled,
		s.directusToken,
		scope.unrestricted
			? options
			: {
					...options,
					orProjectIds: combinedOrIds,
					orLeaderName: scope.leaderName,
					orWorkshops: scope.workshops
				}
	);
}

/**
 * Prefetch projects in the background (e.g. on mouse hover / touch start).
 */
export function prefetchProjectsForCurrentUser(
	excludeClosedAndCancelled: boolean = false,
	options: GetProjectsOptions = {}
) {
	try {
		getProjectsForCurrentUser(excludeClosedAndCancelled, options).catch(() => {});
	} catch {}
}
