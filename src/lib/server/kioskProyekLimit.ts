// src/lib/server/kioskProyekLimit.ts
// Penghitung KEGAGALAN kode harian per proyek (memori proses) — Kiosk Proyek, Fase 3.
// Dipakai alih-alih isRateLimited karena limiter itu mencatat setiap panggilan dan tidak bisa "mengintip":
// penyerang tetap bisa menebak setelah batas lewat. Di sini percobaan ditolak SEBELUM kode diperiksa begitu
// kegagalan mencapai batas. Kru sah tetap bisa lewat QR aktivasi leader; kunci terbuka sendiri setelah jendela lewat.

export const GAGAL_MAKS = 20;
export const GAGAL_JENDELA_MS = 15 * 60 * 1000;

const gagal = new Map<number, number[]>();

function terbaru(projectId: number, now: number): number[] {
	const baru = (gagal.get(projectId) || []).filter((t) => now - t >= 0 && now - t < GAGAL_JENDELA_MS);
	if (baru.length) gagal.set(projectId, baru);
	else gagal.delete(projectId);
	return baru;
}

export function jumlahGagal(projectId: number, now = Date.now()): number {
	return terbaru(projectId, now).length;
}

export function terkunci(projectId: number, now = Date.now()): boolean {
	return jumlahGagal(projectId, now) >= GAGAL_MAKS;
}

export function catatGagal(projectId: number, now = Date.now()): void {
	gagal.set(projectId, [...terbaru(projectId, now), now]);
}

/** Untuk tes. */
export function resetGagal(): void {
	gagal.clear();
}
