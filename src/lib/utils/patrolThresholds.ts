// src/lib/utils/patrolThresholds.ts
// Logika ambang murni (pure function, tanpa I/O) untuk Kontrol Patroli Fase 1-2 — diekstrak
// dari satpam/patroli/+page.svelte supaya bisa diuji unit test (node:test, lihat
// patrolThresholds.test.ts) tanpa perlu render Svelte component atau mock Directus.
// Komponen halaman memanggil fungsi-fungsi ini, bukan menghitung ulang logikanya sendiri —
// satu sumber kebenaran untuk logika ambang & UI.

/** 1.3 Velocity check — true bila scan berikutnya terlalu cepat dari scan sebelumnya. */
export function isVelocityViolation(lastScanAtMs: number | null, nowMs: number, minIntervalSeconds: number): boolean {
	if (lastScanAtMs == null) return false;
	const elapsedSec = (nowMs - lastScanAtMs) / 1000;
	return elapsedSec < minIntervalSeconds;
}

/** Sisa detik sebelum scan berikutnya diizinkan tanpa alasan (0 bila sudah boleh). */
export function velocitySecondsRemaining(lastScanAtMs: number | null, nowMs: number, minIntervalSeconds: number): number {
	if (lastScanAtMs == null) return 0;
	const elapsedSec = (nowMs - lastScanAtMs) / 1000;
	return Math.max(0, Math.ceil(minIntervalSeconds - elapsedSec));
}

/** 1.4 Durasi ronda minimal — true bila ronda diselesaikan sebelum durasi minimal tercapai. */
export function isPatrolDurationViolation(mulaiMs: number, nowMs: number, minPatrolDurationMinutes: number): boolean {
	const menitBerjalan = (nowMs - mulaiMs) / 60000;
	return menitBerjalan < minPatrolDurationMinutes;
}

/** 2.2 Two-Tap kebersihan — true bila Tap 2 (Selesai Kerja) terjadi sebelum dwell time minimal. */
export function isDwellViolation(mulaiKerjaMs: number, nowMs: number, minDwellMinutes: number): boolean {
	const menitBerjalan = (nowMs - mulaiKerjaMs) / 60000;
	return menitBerjalan < minDwellMinutes;
}

/** Menit yang sudah berjalan sejak sinceMs (dibulatkan ke bawah) — dipakai untuk tampilan timer. */
export function elapsedMinutes(sinceMs: number, nowMs: number): number {
	return Math.floor((nowMs - sinceMs) / 60000);
}
