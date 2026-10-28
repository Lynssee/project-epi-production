// src/lib/server/gates/patrolComplianceGate.ts
// G_SEC5 "Kepatuhan Checklist Ronda" (Security Fase 4). Fungsi MURNI (tanpa I/O).
// Skor dihitung di server dari data Directus — klien tidak dipercaya (dulu dihitung di klien lalu
// ditulis langsung ke security_patrol_log). Rumus sama dengan klien lama: titik rute yang sudah
// di-scan / total titik rute; tanpa rute: ada scan → 100, tidak ada → 0.

export function computePatrolScore(input: {
	routeCheckpointIds: Array<number | string> | null | undefined;
	scannedCheckpointIds: Array<number | string | null | undefined> | null | undefined;
}): { skor: number; total: number; scannedInRoute: number; missingIds: number[] } {
	const scanned = new Set((input.scannedCheckpointIds || []).filter((x) => x != null).map((x) => String(x)));
	const route = [...new Set((input.routeCheckpointIds || []).map((x) => String(x)))];
	if (route.length === 0) {
		return { skor: scanned.size > 0 ? 100 : 0, total: 0, scannedInRoute: scanned.size, missingIds: [] };
	}
	const hit = route.filter((id) => scanned.has(id));
	return {
		skor: Math.round((hit.length / route.length) * 100),
		total: route.length,
		scannedInRoute: hit.length,
		missingIds: route.filter((id) => !scanned.has(id)).map(Number).filter((n) => Number.isFinite(n))
	};
}

export interface PatrolGateResult {
	passed: boolean;
	summary: string;
}

/** Gagal bila skor di bawah ambang (ambang = setelan "Ambang Skor Ronda Rendah", default 70%). */
export function evaluatePatrolComplianceGate(input: {
	skor: number;
	total: number;
	scannedInRoute: number;
	threshold: number;
}): PatrolGateResult {
	if (!(input.threshold > 0) || input.skor >= input.threshold) {
		return { passed: true, summary: `Skor kepatuhan ronda ${input.skor}%.` };
	}
	const rincian = input.total > 0 ? ` (${input.scannedInRoute} dari ${input.total} titik rute ter-scan)` : '';
	return {
		passed: false,
		summary: `skor kepatuhan ronda ${input.skor}%${rincian}, di bawah standar minimal ${input.threshold}%`
	};
}
