// src/lib/shared/sjFieldTransitions.ts
// SJH-16 — tahap asal yang sah untuk aksi driver di lapangan. Sebelumnya endpoint stage
// menerima tahap apa pun (driver bisa "tiba" tanpa "berangkat", atau berangkat sebelum satpam).
// needsGate = kategori SJ requires_security_check.

export type DriverStageTo = 'dalam_perjalanan' | 'tiba_lokasi';

/** Tahap sebelum barang keluar gerbang (untuk kategori non-satpam semuanya sah untuk berangkat). */
const PRE_DEPARTURE = ['draft', 'disetujui', 'disiapkan', 'siap_muat', 'dimuat', 'menunggu_gerbang', 'lolos_gerbang'];

/** Turunkan tahap dari status legacy bila track_stage kosong (SJ terbaru umumnya belum punya). */
export function effectiveStage(trackStage: string | null | undefined, status: string | null | undefined): string {
	if (trackStage) return trackStage;
	switch (status) {
		case 'shipped': return 'lolos_gerbang';
		case 'needs_security_check': return 'menunggu_gerbang';
		case 'delivered': case 'received': case 'complete': case 'closed': return 'tiba_lokasi';
		default: return 'disiapkan';
	}
}

export function allowedFrom(stageTo: DriverStageTo, needsGate: boolean): string[] {
	if (stageTo === 'dalam_perjalanan') return needsGate ? ['lolos_gerbang'] : PRE_DEPARTURE;
	return ['dalam_perjalanan']; // tiba_lokasi
}

export function canDriverMark(stageTo: DriverStageTo, stage: string, needsGate: boolean): boolean {
	return allowedFrom(stageTo, needsGate).includes(stage);
}

export function stageBlockMessage(stageTo: DriverStageTo, stage: string, needsGate: boolean): string {
	if (stageTo === 'dalam_perjalanan') {
		if (needsGate && stage !== 'lolos_gerbang') return 'Barang belum lolos gerbang. Tombol Berangkat muncul setelah satpam meloloskan.';
		return `Tidak bisa berangkat dari tahap "${stage}".`;
	}
	return 'Tandai "Berangkat" dulu sebelum menandai tiba di lokasi.';
}
