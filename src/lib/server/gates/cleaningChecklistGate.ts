// src/lib/server/gates/cleaningChecklistGate.ts
// G_CLN2 "Eksekusi Checklist Area" (Security/Cleaning Fase 4). Evaluator MURNI (tanpa I/O)
// supaya bisa diuji unit; mode (shadow/soft/hard) dibaca pemanggil lewat resolveGateMode,
// opsi aturan dibaca dari patrolControlSettings (app_settings module='patrol_control').

export interface ClnItemDef {
	id: number;
	item_name?: string | null;
	is_critical?: boolean | null;
}

export interface ClnAnswer {
	item_id: number;
	answer: 'yes' | 'no' | 'na';
}

export interface ClnGateOptions {
	/** Item dijawab "No" wajib punya minimal satu foto bukti. */
	fotoWajibItemNo: boolean;
	/** Semua item template wajib dijawab (tidak ada item terlewat). */
	wajibSemuaItem: boolean;
}

export type ClnViolationCode = 'ITEM_BELUM_DIJAWAB' | 'ITEM_NO_TANPA_FOTO';

export interface ClnViolation {
	code: ClnViolationCode;
	itemIds: number[];
	message: string;
}

export interface ClnGateResult {
	passed: boolean;
	violations: ClnViolation[];
	/** Ringkasan satu kalimat untuk pesan error / audit. */
	summary: string;
}

function namaItem(defs: Map<number, ClnItemDef>, id: number): string {
	return defs.get(id)?.item_name?.trim() || `#${id}`;
}

/**
 * @param photoCountByItem jumlah file foto per item_id (dihitung dari FormData, sebelum diunggah)
 */
export function evaluateCleaningChecklistGate(input: {
	answers: ClnAnswer[] | null | undefined;
	itemDefs: ClnItemDef[] | null | undefined;
	photoCountByItem: Record<number, number> | null | undefined;
	options: ClnGateOptions;
}): ClnGateResult {
	const answers = input.answers || [];
	const defs = new Map<number, ClnItemDef>((input.itemDefs || []).map((d) => [d.id, d]));
	const photos = input.photoCountByItem || {};
	const violations: ClnViolation[] = [];

	// Template tanpa item terdaftar → tidak ada dasar evaluasi (fail-open).
	if (defs.size === 0) return { passed: true, violations, summary: 'Tidak ada item template untuk dievaluasi.' };

	if (input.options.wajibSemuaItem) {
		const answered = new Set(answers.map((a) => Number(a.item_id)));
		const missing = [...defs.keys()].filter((id) => !answered.has(id));
		if (missing.length > 0) {
			violations.push({
				code: 'ITEM_BELUM_DIJAWAB',
				itemIds: missing,
				message: `${missing.length} item belum dijawab: ${missing.slice(0, 3).map((id) => namaItem(defs, id)).join(', ')}${missing.length > 3 ? ', …' : ''}`
			});
		}
	}

	if (input.options.fotoWajibItemNo) {
		const tanpaFoto = answers
			.filter((a) => a.answer === 'no' && (photos[Number(a.item_id)] ?? 0) <= 0)
			.map((a) => Number(a.item_id));
		if (tanpaFoto.length > 0) {
			violations.push({
				code: 'ITEM_NO_TANPA_FOTO',
				itemIds: tanpaFoto,
				message: `${tanpaFoto.length} item "Tidak" belum ada foto bukti: ${tanpaFoto.slice(0, 3).map((id) => namaItem(defs, id)).join(', ')}${tanpaFoto.length > 3 ? ', …' : ''}`
			});
		}
	}

	return {
		passed: violations.length === 0,
		violations,
		summary: violations.length === 0 ? 'Checklist lengkap.' : violations.map((v) => v.message).join('; ')
	};
}
