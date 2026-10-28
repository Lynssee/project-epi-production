// src/lib/utils/isLeaderKaryawan.ts
// Deteksi berlapis Project Leader / karyawan mobile lapangan, sesuai Memo Internal HRD No.
// 018/MEMO/HRD/VIII/2026. Duplikasi KECIL & DISENGAJA dari isLeaderEmployee() di
// erp-epi-1/src/lib/utils/employeePolicy.js — dua app terpisah (repo & deploy sendiri-sendiri),
// tidak ada package bersama, jadi duplikasi kecil ini lebih aman daripada import lintas-repo.
// Kalau rumus deteksi Leader di erp-epi-1 berubah, pastikan disamakan di sini juga.
//
// SENGAJA TIDAK memakai divisi === 'PROJECT' sendirian sebagai sinyal — divisi PROJECT juga
// menaungi staf desk (mis. PROJECT FINANCE, ADMIN PROJECT) yang tetap wajib jam kerja normal.
// Fungsi MURNI (tanpa I/O).

export interface KaryawanLeaderCheck {
	pola_kerja?: string | null;
	posisi?: string | null;
	[key: string]: unknown;
}

export function isLeaderKaryawan(karyawan: KaryawanLeaderCheck | null | undefined): boolean {
	if (!karyawan) return false;
	if (karyawan.pola_kerja === 'mobile') return true;
	const pos = String(karyawan.posisi || '').toUpperCase();
	if (!pos) return false;
	return pos.includes('LEADER') || pos.includes('COORDINATOR') || pos.includes('KOORDINATOR');
}
