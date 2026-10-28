// src/lib/server/gates/securityHandoverGate.ts
// G_SEC7 "Serah Terima Lengkap Shift" (Security Fase 4). Evaluator MURNI (tanpa I/O).
// Mode (shadow/soft/hard) dibaca pemanggil lewat resolveGateMode; ambang & saklar aturan dari
// app_settings module='patrol_control' (patrolControlSettings.ts), bisa diatur di UI superadmin.

export interface HandoverGateOptions {
	/** Panjang minimal catatan serah-terima (karakter, setelah trim). 0 = tidak dievaluasi. */
	minCatatanChars: number;
	/** Satpam yang menyerahkan wajib punya minimal satu ronda selesai di tanggal serah-terima (jejak logbook). */
	wajibRondaTercatat: boolean;
}

export type HandoverViolationCode = 'CATATAN_TERLALU_PENDEK' | 'TIDAK_ADA_RONDA_TERCATAT';

export interface HandoverViolation {
	code: HandoverViolationCode;
	message: string;
}

export interface HandoverGateResult {
	passed: boolean;
	violations: HandoverViolation[];
	summary: string;
}

/**
 * @param rondaSelesaiCount jumlah security_patrol_log berstatus done milik pengirim pada tanggal itu;
 *   null = tidak diketahui (gagal baca) → aturan ronda dilewati (fail-open).
 */
export function evaluateSecurityHandoverGate(input: {
	catatan: string | null | undefined;
	rondaSelesaiCount: number | null | undefined;
	options: HandoverGateOptions;
}): HandoverGateResult {
	const violations: HandoverViolation[] = [];
	const catatan = (input.catatan ?? '').trim();

	if (input.options.minCatatanChars > 0 && catatan.length < input.options.minCatatanChars) {
		violations.push({
			code: 'CATATAN_TERLALU_PENDEK',
			message: `catatan serah-terima ${catatan.length} karakter (minimal ${input.options.minCatatanChars}) — tulis kondisi pos, barang belum kembali, tamu masih di dalam`
		});
	}

	if (input.options.wajibRondaTercatat && input.rondaSelesaiCount != null && input.rondaSelesaiCount <= 0) {
		violations.push({
			code: 'TIDAK_ADA_RONDA_TERCATAT',
			message: 'belum ada ronda selesai tercatat atas nama Anda pada tanggal ini (logbook kosong)'
		});
	}

	return {
		passed: violations.length === 0,
		violations,
		summary: violations.length === 0 ? 'Serah-terima lengkap.' : violations.map((v) => v.message).join('; ')
	};
}
