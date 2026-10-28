// src/lib/server/pengajuanAtasNama.ts
// SERVER-ONLY. Otorisasi "Ajukan Atas Nama" dari dashboard lapangan (PA & PR).
//
// Siapa yang boleh (keputusan Lead): HANYA Leader Proyek / Wakil Leader proyek yang bersangkutan, dan
// Supervisor (izin `ajukan_atas_nama`, diberikan lewat Role Management). Pemohon harus anggota AKTIF
// proyek yang sama (manpower_assignment) dan punya tautan karyawan (manpower.karyawan_id) — karena
// pemohon harus bisa dinotifikasi, menandatangani, dan jadi requester approval. Tidak boleh diri sendiri.

import { directusServerJson } from '$lib/server/directus';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { resolveKaryawanForUser } from '$lib/server/ess/karyawan';

export const IZIN_ATAS_NAMA = 'ajukan_atas_nama';
const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);
const same = (a: any, b: any) => a != null && b != null && String(idOf(a)) === String(idOf(b));

export interface AnggotaPemohon {
	karyawanId: number;
	nama: string;
	divisi: string | null;
	punyaHp: boolean;
}

/** Aturan murni (diuji): apakah pengisi boleh, dan apakah pemohon sah. */
export function evaluateScopeAtasNama(p: {
	isLeaderProyek: boolean;
	isSupervisor: boolean;
	pengisiKaryawanId: number | string;
	pemohonKaryawanId?: number | string | null;
	anggotaKaryawanIds: Array<number | string>;
}): { ok: true } | { ok: false; httpStatus: number; message: string } {
	if (!p.isLeaderProyek && !p.isSupervisor) {
		return { ok: false, httpStatus: 403, message: 'Pengajuan atas nama hanya untuk Leader/Wakil Leader proyek ini atau Supervisor.' };
	}
	if (p.pemohonKaryawanId != null) {
		if (same(p.pemohonKaryawanId, p.pengisiKaryawanId)) {
			return { ok: false, httpStatus: 400, message: 'Pemohon sama dengan Anda — matikan mode atas nama untuk pengajuan sendiri.' };
		}
		if (!p.anggotaKaryawanIds.some((id) => same(id, p.pemohonKaryawanId))) {
			return { ok: false, httpStatus: 403, message: 'Pemohon bukan anggota aktif proyek ini (atau belum tertaut ke data karyawan).' };
		}
	}
	return { ok: true };
}

/** Anggota aktif proyek yang bisa jadi pemohon (punya karyawan_id). Query dipisah per relasi. */
async function loadAnggotaPemohon(projectId: number): Promise<Array<AnggotaPemohon & { noHp: string | null }>> {
	const asg: any = await directusServerJson(`/items/manpower_assignment?filter[project_id][_eq]=${projectId}&filter[status][_eq]=aktif&fields=manpower_id&limit=-1`).catch(() => null);
	const manpowerIds = [...new Set((asg?.data || []).map((r: any) => idOf(r.manpower_id)).filter(Boolean))];
	if (!manpowerIds.length) return [];
	const mp: any = await directusServerJson(`/items/manpower?filter[id][_in]=${manpowerIds.join(',')}&fields=id,karyawan_id&limit=-1`).catch(() => null);
	const karyawanIds = [...new Set((mp?.data || []).map((r: any) => idOf(r.karyawan_id)).filter(Boolean))];
	if (!karyawanIds.length) return [];
	const ky: any = await directusServerJson(`/items/karyawan?filter[id][_in]=${karyawanIds.join(',')}&fields=id,nama_karyawan,divisi,no_hp&limit=-1`).catch(() => null);
	return (ky?.data || []).map((k: any) => ({ karyawanId: k.id, nama: k.nama_karyawan, divisi: k.divisi || null, punyaHp: !!k.no_hp, noHp: k.no_hp || null }));
}

/**
 * @returns pengisi (karyawan), proyek, daftar anggota, dan verdict. `pemohonKaryawanId` opsional:
 * tanpa itu hanya mengecek hak pengisi (dipakai untuk menampilkan panel & daftar pemohon).
 */
export async function authorizeAtasNama(p: {
	idToken: string;
	uid: string;
	email: string;
	projectId: number;
	pemohonKaryawanId?: number | null;
}) {
	const pengisi = await resolveKaryawanForUser({ uid: p.uid, email: p.email });
	if (!pengisi) {
		return { ok: false as const, httpStatus: 403, message: 'Akun Anda belum terhubung ke data karyawan.', pengisi: null, pemohon: null, anggota: [] as AnggotaPemohon[] };
	}
	if (!Number.isFinite(p.projectId) || p.projectId <= 0) {
		return { ok: false as const, httpStatus: 400, message: 'Pilih proyek terlebih dahulu — pengajuan atas nama selalu terkait proyek.', pengisi, pemohon: null, anggota: [] as AnggotaPemohon[] };
	}

	const [proj, pengisiMp, perms, anggota] = await Promise.all([
		directusServerJson<any>(`/items/projects/${p.projectId}?fields=id,name,manpower_leader_id,manpower_leader_wakil_id`).catch(() => null),
		directusServerJson<any>(`/items/manpower?filter[karyawan_id][_eq]=${pengisi.id}&fields=id&limit=-1`).catch(() => null),
		getUserPermissions(p.idToken, p.uid).catch(() => ({ permissions: [] as string[] })),
		loadAnggotaPemohon(p.projectId)
	]);
	if (!proj?.data?.id) {
		return { ok: false as const, httpStatus: 404, message: 'Proyek tidak ditemukan.', pengisi, pemohon: null, anggota: [] as AnggotaPemohon[] };
	}
	const myManpowerIds = (pengisiMp?.data || []).map((r: any) => r.id);
	const isLeaderProyek = myManpowerIds.some((id: any) => same(id, proj.data.manpower_leader_id) || same(id, proj.data.manpower_leader_wakil_id));
	const isSupervisor = hasAnyPermission(perms.permissions || [], IZIN_ATAS_NAMA);

	const calon = anggota.filter((a) => !same(a.karyawanId, pengisi.id));
	const verdict = evaluateScopeAtasNama({
		isLeaderProyek,
		isSupervisor,
		pengisiKaryawanId: pengisi.id,
		pemohonKaryawanId: p.pemohonKaryawanId ?? null,
		anggotaKaryawanIds: anggota.map((a) => a.karyawanId)
	});
	const pemohon = p.pemohonKaryawanId != null ? anggota.find((a) => same(a.karyawanId, p.pemohonKaryawanId)) || null : null;
	return {
		...(verdict.ok ? { ok: true as const } : verdict),
		pengisi,
		pemohon,
		anggota: calon.map(({ noHp: _n, ...a }) => a)
	};
}
