// src/lib/server/pengajuanAnggaranGuard.ts
// SERVER-ONLY. Tambal sempit koleksi pengajuan_anggaran (celah otorisasi proxy
// Directus, temuan 14 Sep 2026 -- lihat fieldProjectScope.ts untuk latar lengkap).
// Baris ini berisi nominal + rekening bank penerima (bank_name/bank_account_number/
// bank_account_name/penerima_dana_nama) -- paling sensitif dari koleksi yang diaudit.
//
// Halaman lapangan (anggaran/+page.svelte) SUDAH menerapkan pembatasan "cuma proyek
// yang saya pegang" lewat getProjectsForCurrentUser() -- guard ini menegakkan
// pembatasan YANG SAMA di server (reuse fieldProjectScope, identik dengan payroll),
// PLUS satu tambahan: pengajuan non-proyek (operasional/kas kecil, project_id NULL)
// tetap boleh dilihat pemiliknya sendiri lewat kolom created_by_email (diisi saat
// submit, dibandingkan ke email hasil verifikasi token Firebase -- bukan input
// klien). Tanpa tambahan ini, staf yang mengajukan kas kecil (bukan leader proyek
// mana pun) akan kehilangan akses ke pengajuannya sendiri -- regresi fungsional,
// bukan cuma penyempitan cakupan.
//
// created_by_email kosong di sebagian baris lama (field ditambahkan belakangan) --
// baris begitu, kalau bukan milik proyek yang dipegang, ikut tersembunyi (fail
// closed). Itu bisa berarti staf lama tidak bisa lihat pengajuan lamanya sendiri
// lewat link langsung; diterima sebagai trade-off, jauh lebih aman daripada
// fail-open.

import { resolveFieldProjectScope, withScopeFilter, projectIdInCondition, type FieldProjectScope } from './fieldProjectScope';

export type PengajuanAnggaranScope = FieldProjectScope;

export async function resolvePengajuanAnggaranScope(
	idToken: string,
	uid: string,
	email: string | null | undefined
): Promise<PengajuanAnggaranScope> {
	return resolveFieldProjectScope(idToken, uid, email);
}

/** Filter list: proyek yang dipegang ATAU pengajuan yang dia ajukan sendiri. */
export function withPengajuanAnggaranListFilter(
	search: string,
	scope: Extract<PengajuanAnggaranScope, { unrestricted: false }>,
	email: string | null | undefined
): string {
	const conditions: Record<string, any>[] = [];
	if (scope.projectIds.length > 0) conditions.push(projectIdInCondition(scope.projectIds));
	if (email) conditions.push({ created_by_email: { _eq: email } });
	// Tidak punya pegangan proyek maupun email -> kondisi mustahil (id negatif),
	// supaya hasilnya kosong alih-alih filter Directus invalid/diabaikan.
	const condition = conditions.length > 0 ? { _or: conditions } : { id: { _eq: -1 } };
	return withScopeFilter(search, condition);
}

/** Apakah satu baris pengajuan_anggaran (hasil GET single item) boleh dilihat pemanggil ini? */
export function isPengajuanAnggaranRowAllowed(
	row: any,
	scope: Extract<PengajuanAnggaranScope, { unrestricted: false }>,
	email: string | null | undefined
): boolean {
	if (!row) return false;
	const pid = row.project_id;
	const pidNum = pid && typeof pid === 'object' ? pid.id : pid;
	if (pidNum != null && scope.projectIds.includes(Number(pidNum))) return true;
	if (email && row.created_by_email && String(row.created_by_email).toLowerCase() === email.toLowerCase()) return true;
	return false;
}
