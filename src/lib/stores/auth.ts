import { writable, get } from 'svelte/store';
import type { User } from 'firebase/auth';

interface AuthState {
	user: User | null;
	loading: boolean;
	checked: boolean;
	// Role info from Firestore
	role: string | null;
	roleId: string | null;
	// Semua role yang dimiliki user (dari Firestore users/{uid}.roleIds).
	// Digunakan oleh hasPermission() untuk union permission dari semua role.
	roleIds: string[];
	// Karyawan data from Directus (for project filtering)
	karyawanName: string | null;
	karyawanId: number | null;      // ID FK ke karyawan collection
	karyawanDivisi: string | null;  // karyawan.divisi (teks bebas) — dipakai Command Center utk resolve department
	karyawanPosisi: string | null;  // karyawan.posisi MENTAH (nama jabatan) — dipakai scoping workshop
	directusToken: string | null;   // Per-user Directus access token
	// Sistem Manpower Leader — akun ini terpetakan ke baris `manpower` yang mana.
	// null berarti akun kantor biasa (bukan orang lapangan).
	manpowerId: number | null;
	manpowerNama: string | null;
	// Proyek tempat dia memegang kursi Manpower Leader / Wakil. Dipakai scoping:
	// role saja tidak cukup, karena role tidak mengikat orang ke proyek tertentu.
	manpowerLeaderProjectIds: number[];
}

export const authStore = writable<AuthState>({
	user: null,
	loading: true,
	checked: false,
	role: null,
	roleId: null,
	roleIds: [],
	karyawanName: null,
	karyawanId: null,
	karyawanDivisi: null,
	karyawanPosisi: null,
	directusToken: null,
	manpowerId: null,
	manpowerNama: null,
	manpowerLeaderProjectIds: []
});

/**
 * Role-role yang memiliki akses penuh ke semua proyek (tidak difilter).
 * Semua role selain ini akan difilter berdasarkan nama leader proyek.
 */
const FULL_VIEW_ROLES = ['super_admin', 'admin_project', 'finance', 'hrd', 'director', 'manager'];

export function getUserDisplay(user: User | null): string {
	if (!user) return 'LEADER';
	return user.displayName || user.email?.split('@')[0]?.toUpperCase() || 'LEADER';
}

export function getUserInitials(user: User | null): string {
	return getUserDisplay(user).substring(0, 2).toUpperCase();
}

/**
 * Check if user is a leader role (should see filtered projects).
 * Tetap ada untuk backward-compatibility.
 */
export function isLeaderRole(roleId: string | null): boolean {
	return roleId === 'leader';
}

/**
 * Check if user is a super admin (sees everything)
 */
export function isSuperAdminRole(roleId: string | null): boolean {
	return roleId === 'super_admin';
}

/**
 * Check if user can approve/reject pengajuan anggaran.
 * Finance role dan super_admin memiliki akses approval.
 */
export function isFinanceRole(roleId: string | null): boolean {
	return roleId === 'finance' || roleId === 'super_admin';
}

/**
 * Menentukan apakah user harus melihat proyek berdasarkan nama leader-nya saja.
 * Berlaku untuk: role 'leader', 'staff', dan role apapun yang tidak ada di FULL_VIEW_ROLES.
 * Jika karyawanName tidak tersedia, tidak ada filter yang diterapkan (fallback ke semua proyek).
 */
export function shouldFilterProjectsByLeader(roleId: string | null): boolean {
	if (!roleId) return true; // role tidak diketahui: default filter per leader (least privilege)

	// Klaim v1.0 #7 fix (Rencana RBAC v2, Bagian 3): sebelumnya dicocokkan lewat
	// substring (`.includes('admin')` dll), yang bisa salah kena pada role ID
	// manapun yang KEBETULAN memuat potongan kata itu — dan fungsi ini juga
	// dipakai untuk memutuskan apakah pengguna login ke Directus dengan token
	// pribadinya (+layout.svelte:95), jadi salah klasifikasi bisa membuat orang
	// kehilangan token Directus, bukan cuma salah lihat daftar proyek. Diganti
	// ke pencocokan token utuh (dipisah per underscore), bukan potongan bebas.
	const tokens = roleId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	const hasToken = (...words: string[]) => words.some((w) => tokens.includes(w));

	if (hasToken('admin', 'manager', 'director', 'finance', 'hrd')) {
		return false; // Do not filter, can view all
	}

	return !FULL_VIEW_ROLES.includes(roleId);
}
