// src/lib/server/ess/geo.ts
// Utilitas geospasial server-side untuk geofence absensi ESS.
// Perhitungan jarak WAJIB di server — jangan pernah percaya validasi klien.

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number | null {
	const a1 = Number(lat1),
		o1 = Number(lng1),
		a2 = Number(lat2),
		o2 = Number(lng2);
	if ([a1, o1, a2, o2].some((v) => v == null || Number.isNaN(v))) return null;
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(a2 - a1);
	const dLng = toRad(o2 - o1);
	const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
	return Math.round(R * c);
}

export function withinRadius(
	lat: number,
	lng: number,
	centerLat: number,
	centerLng: number,
	radiusM = 100
): { valid: boolean; jarak: number | null } {
	const jarak = haversineMeters(lat, lng, centerLat, centerLng);
	if (jarak == null) return { valid: false, jarak: null };
	return { valid: jarak <= Number(radiusM || 100), jarak };
}

/**
 * Skor 0-1 anti-fake-GPS Fase 1 (web-only): heuristic accuracy + velocity.
 * BUKAN deteksi WiFi SSID / mock-provider Android — itu tidak bisa dibaca dari browser
 * standar, ditunda ke fase dengan native wrapper. 1 = wajar, mendekati 0 = mencurigakan.
 * Tidak pernah dipakai untuk hard-block (fail-safe, bukan fail-closed) — hanya disimpan
 * untuk review HRD di absensi_harian.anti_fake_gps_score.
 */
export function computeAntiFakeGpsScore(params: {
	accuracy: number | null;
	previous?: { lat: number; lng: number; atMs: number } | null;
	current: { lat: number; lng: number; atMs: number };
	// Penajaman SDM v2 Fase 5 (Pengerasan Verifikasi) — MEMPERLUAS bobot skor yang sama, bukan
	// membuat verification_score baru yang bersaing (keputusan rencana: field lama sudah dipakai
	// tab Anomali + cron alert, jangan diduakan).
	deviceCountToday?: number; // >1 = karyawan ini pakai >1 perangkat berbeda hari ini (indikasi berbagi HP)
	isFotoReused?: boolean; // true = foto ini identik dengan salah satu dari 10 check-in terakhirnya
}): number {
	let score = 1;

	const accuracy = params.accuracy;
	if (accuracy != null && Number.isFinite(accuracy)) {
		if (accuracy > 500) score -= 0.6;
		else if (accuracy > 100) score -= 0.3;
	}

	if (params.previous) {
		const distanceM = haversineMeters(
			params.previous.lat,
			params.previous.lng,
			params.current.lat,
			params.current.lng
		);
		const elapsedHours = Math.max((params.current.atMs - params.previous.atMs) / 3_600_000, 1 / 3600);
		if (distanceM != null) {
			const speedKmh = distanceM / 1000 / elapsedHours;
			if (speedKmh > 500) score = 0;
			else if (speedKmh > 150) score -= 0.5;
		}
	}

	if (params.deviceCountToday != null && params.deviceCountToday > 1) {
		score -= 0.3 * Math.min(params.deviceCountToday - 1, 2); // -0.3 per perangkat tambahan, maks -0.6
	}
	if (params.isFotoReused) {
		score -= 0.7; // foto daur-ulang = indikasi kuat, bukan sekadar GPS meleset
	}

	return Math.max(0, Math.min(1, score));
}
