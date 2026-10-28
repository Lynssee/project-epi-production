// src/lib/shared/pettyCashKasir.ts
// PC3-07 — salinan TS dari erp-epi `src/lib/server/pettyCashKasir.js` (logika MURNI pemilihan kasir).
// JAGA IDENTIK: tes kontrak (pettyCashKasir.test.ts) memakai tabel harapan yang sama di kedua repo.

export type KasirVia = 'custodian' | 'backup' | 'pusat' | 'pusat_backup';
export type KasirCandidate = [number | string | null | undefined, KasirVia];

/**
 * Karyawan dianggap AKTIF selama statusnya bukan "Off". Sengaja BUKAN `status == 'On'`: di data live kolom
 * `status` juga berisi 'Kontrak ' / 'Tetap ' / 'Daily Worker' / 'Internship' — `== 'On'` akan salah
 * menganggap mereka nonaktif.
 */
export function isKaryawanAktif(k: { status?: string | null } | null | undefined): boolean {
	return String(k?.status ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Urutan kandidat: kustodian → cadangan → kustodian Pusat → cadangan Pusat.
 * Dilewati bila = pemohon (anti self-approval) atau tidak aktif.
 */
export function pickKasir(
	candidates: KasirCandidate[],
	requesterId: number | string | null | undefined,
	activeIds: Set<string>
): { kasirId: number | null; via: KasirVia | null } {
	const hit = (candidates || [])
		.filter(([id]) => id && String(id) !== String(requesterId ?? ''))
		.find(([id]) => activeIds.has(String(id)));
	return hit ? { kasirId: Number(hit[0]), via: hit[1] } : { kasirId: null, via: null };
}

/** Pesan 422 untuk dana yang pasti macet. */
export function noKasirMessage(fundName?: string | null): string {
	return `Dana ${fundName ? `"${fundName}" ` : ''}belum punya kasir aktif. Pilih dana lain (mis. Petty Cash Pusat) atau hubungi Finance.`;
}

/** Teks notifikasi tambahan saat kasir adalah pengganti. */
export function kasirViaNote(via: KasirVia | null, fundName?: string | null): string {
	if (via === 'backup') return ` (Anda kasir pengganti untuk dana ${fundName || 'ini'})`;
	if (via === 'pusat' || via === 'pusat_backup') return ` (Anda kasir Pusat pengganti untuk dana ${fundName || 'ini'})`;
	return '';
}
