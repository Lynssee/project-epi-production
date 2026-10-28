// src/lib/server/gates/gatePersonGate.ts
// G_SEC2 "Verifikasi Izin Jam Kerja" (Security Fase 4). Evaluator MURNI (tanpa I/O).
// Dievaluasi saat satpam mencatat orang keluar/masuk gerbang. Jalur QR izin jam-jaman
// (/api/ess/izin-jam/gate-scan) sudah berizin per definisi dan tidak melewati gate ini.

export interface PersonGateOptions {
	/** Jam kerja mulai (jam WIB, 0-23). */
	jamKerjaMulai: number;
	/** Jam kerja selesai (jam WIB, 1-24, eksklusif). */
	jamKerjaSelesai: number;
	/** Karyawan keluar dengan keperluan "pribadi" pada jam kerja wajib punya izin jam-jaman aktif. */
	wajibIzinPribadi: boolean;
}

export type PersonViolationCode = 'KELUAR_TANPA_IZIN' | 'KELUAR_SEBELUMNYA_BELUM_KEMBALI';

export interface PersonViolation {
	code: PersonViolationCode;
	message: string;
}

export interface PersonGateResult {
	passed: boolean;
	violations: PersonViolation[];
	summary: string;
}

/**
 * @param izinAktif  true = ada izin jam-jaman disetujui/berjalan hari ini; null = gagal baca (aturan dilewati)
 * @param openOutAda true = orang yang sama masih punya catatan KELUAR hari ini yang belum berpasangan MASUK; null = gagal baca
 */
export function evaluateGatePersonGate(input: {
	arah: 'in' | 'out';
	tipe: string;
	keperluan: string | null | undefined;
	jamWib: number;
	izinAktif: boolean | null | undefined;
	openOutAda: boolean | null | undefined;
	options: PersonGateOptions;
}): PersonGateResult {
	const violations: PersonViolation[] = [];
	const { options: o } = input;

	if (input.arah === 'out') {
		const dalamJamKerja = input.jamWib >= o.jamKerjaMulai && input.jamWib < o.jamKerjaSelesai;
		if (
			o.wajibIzinPribadi &&
			input.tipe === 'tetap' &&
			input.keperluan === 'pribadi' &&
			dalamJamKerja &&
			input.izinAktif === false
		) {
			violations.push({
				code: 'KELUAR_TANPA_IZIN',
				message: `karyawan keluar untuk keperluan pribadi pada jam kerja (${o.jamKerjaMulai}:00–${o.jamKerjaSelesai}:00) tanpa izin jam-jaman yang disetujui`
			});
		}
		if (input.openOutAda === true) {
			violations.push({
				code: 'KELUAR_SEBELUMNYA_BELUM_KEMBALI',
				message: 'orang ini masih tercatat keluar hari ini dan belum tercatat kembali'
			});
		}
	}

	return {
		passed: violations.length === 0,
		violations,
		summary: violations.length === 0 ? 'Gate orang sesuai ketentuan.' : violations.map((v) => v.message).join('; ')
	};
}
