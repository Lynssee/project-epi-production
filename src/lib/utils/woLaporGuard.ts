// src/lib/utils/woLaporGuard.ts
// Fase 5 (Laporan Bulanan Maintenance & Pertajam KPI): bantu mekanik mencatat JAM KERJA pada laporan harian WO, karena MTTR di
// Laporan Bulanan/KPI hanya bisa dihitung dari mekanik_activity.durasi_kerja_menit (cakupan data saat ini ±8%).
// Penutupan WO (status Done/tanggal_done) SENGAJA bukan tugas halaman ini — tetap di admin lewat gate QC & verifikasi biaya.

/** 'HH:MM' dari jam lokal perangkat (dipakai tombol 1-tap Mulai/Selesai kerja). */
export function nowHm(d: Date = new Date()): string {
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Progres 100% tanpa jam kerja → minta konfirmasi sekali (bukan memblokir; mekanik lapangan tidak boleh terkunci — Aturan #6).
 * @returns true bila submit perlu ditahan dulu untuk menampilkan peringatan.
 */
export function needsDurationConfirm(p: { progress: number; durasiKerjaMenit: number | null; alreadyConfirmed: boolean }): boolean {
	return p.progress >= 100 && (p.durasiKerjaMenit == null || p.durasiKerjaMenit <= 0) && !p.alreadyConfirmed;
}

/** Teks durasi ramah: 95 → '1 jam 35 menit'. */
export function formatDurasi(menit: number): string {
	const m = Math.max(0, Math.round(menit));
	return m >= 60 ? `${Math.floor(m / 60)} jam ${m % 60} menit` : `${m} menit`;
}
