// src/lib/utils/qcToleranceChecker.ts
// Fase 8 (opsional) — Auto-QC Tolerance Checker. Standarisasi Timeline v2 (TAJAM). Util MURNI
// (tanpa I/O) — bandingkan hasil ukur lapangan terhadap spek teknis subtask (sub.spec, diisi
// admin lewat SubtaskSpecDrawer.svelte, Fase 2). PERINGATAN SAJA, tidak pernah memblokir
// submit laporan (Aturan #6 — tombol/aksi utama tidak pernah dimatikan sepihak).
//
// Konvensi generik (BUKAN hardcode DFT): field spek dengan pola `<nama>_target` (angka) +
// `<nama>_tolerance` (array [min, max], opsional) dianggap "bisa diukur". Katalog Fase 1
// (dft_target/dft_tolerance) otomatis cocok tanpa perubahan di sini — spek baru di masa depan
// yang mengikuti pola ini otomatis ikut terdeteksi.

export type ToleranceStatus = 'sesuai' | 'di_bawah' | 'di_atas' | 'tidak_ada_spek';

export interface ToleranceCheckResult {
	status: ToleranceStatus;
	message: string;
}

export interface MeasurableSpecField {
	key: string; // nama dasar, mis. 'dft'
	label: string; // label tampil, mis. 'DFT'
	target: number;
	tolerance: [number, number] | null;
}

/**
 * Bandingkan nilai ukur terhadap target+toleransi. Tanpa toleransi eksplisit, target sendiri
 * dipakai sebagai batas bawah=atas (harus persis sama) — jarang dipakai, tapi tidak error.
 */
export function checkTolerance(measured: number, target: number, tolerance: [number, number] | null = null): ToleranceCheckResult {
	if (target == null || Number.isNaN(target) || measured == null || Number.isNaN(measured)) {
		return { status: 'tidak_ada_spek', message: '' };
	}
	const [min, max] = tolerance && tolerance.length === 2 ? tolerance : [target, target];
	if (measured < min) {
		return { status: 'di_bawah', message: `Di bawah spesifikasi (min ${min}), disarankan recoat tipis` };
	}
	if (measured > max) {
		return { status: 'di_atas', message: `Di atas spesifikasi (maks ${max}), cek ketebalan berlebih` };
	}
	return { status: 'sesuai', message: `Sesuai spesifikasi (${min}–${max})` };
}

/** Cari field spek yang "bisa diukur" (pola `*_target` + `*_tolerance` opsional) dari sub.spec. */
export function findMeasurableSpecFields(spec: Record<string, any> | null | undefined): MeasurableSpecField[] {
	if (!spec || typeof spec !== 'object') return [];
	const fields: MeasurableSpecField[] = [];
	for (const key of Object.keys(spec)) {
		if (!key.endsWith('_target')) continue;
		const base = key.slice(0, -'_target'.length);
		const target = Number(spec[key]);
		if (Number.isNaN(target)) continue;
		const toleranceRaw = spec[`${base}_tolerance`];
		const tolerance: [number, number] | null =
			Array.isArray(toleranceRaw) && toleranceRaw.length === 2
				? [Number(toleranceRaw[0]), Number(toleranceRaw[1])]
				: null;
		fields.push({ key: base, label: base.replace(/_/g, ' ').toUpperCase(), target, tolerance });
	}
	return fields;
}
