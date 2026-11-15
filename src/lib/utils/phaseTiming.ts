// src/lib/utils/phaseTiming.ts
// Visibilitas Leader Fase 2 — durasi fase berjalan vs target (murni, tanpa I/O).
// HANYA tampilan: tidak menjadi gate dan tidak memblokir apa pun (Aturan #3/#11 tidak terpicu).
// Ambang peringatan dari setelan `project.wizard.timing_warn_pct` (bukan hardcode).

export type PhaseTimingLevel = 'none' | 'ok' | 'warn' | 'over';

export interface PhaseTiming {
	level: PhaseTimingLevel;
	/** Hari ke-N sejak fase dimulai (1 = hari mulai). null bila tak diketahui. */
	dayNumber: number | null;
	targetDays: number | null;
	/** Sisa hari ke target (negatif = lewat). null bila tanpa target. */
	remainingDays: number | null;
	/** Fase selesai: lama pengerjaan (hari), null bila belum / tak valid. */
	doneInDays: number | null;
}

const DAY_MS = 86_400_000;

function toMs(v: unknown): number | null {
	if (!v) return null;
	const t = new Date(String(v)).getTime();
	return Number.isFinite(t) ? t : null;
}

export function phaseTiming(
	def: { target_duration_days?: number | null } | null | undefined,
	row: { status?: string | null; started_at?: string | null; completed_at?: string | null } | null | undefined,
	now: number = Date.now(),
	warnPct: number = 80
): PhaseTiming {
	const none: PhaseTiming = { level: 'none', dayNumber: null, targetDays: null, remainingDays: null, doneInDays: null };
	if (!row) return none;

	const started = toMs(row.started_at);
	const target = Number(def?.target_duration_days) > 0 ? Number(def?.target_duration_days) : null;

	if (row.status === 'completed') {
		const done = toMs(row.completed_at);
		// Backfill sering mengisi started_at = completed_at -> 0 hari: dianggap tak informatif, bukan "selesai 0 hari".
		const days = started != null && done != null && done - started >= DAY_MS ? Math.round((done - started) / DAY_MS) : null;
		return { ...none, targetDays: target, doneInDays: days };
	}
	if (row.status !== 'in_progress' || started == null || started > now + DAY_MS) return { ...none, targetDays: target };

	const dayNumber = Math.floor((now - started) / DAY_MS) + 1;
	if (target == null) return { level: 'none', dayNumber, targetDays: null, remainingDays: null, doneInDays: null };

	const remaining = target - dayNumber;
	const pct = Number.isFinite(warnPct) && warnPct > 0 ? warnPct : 80;
	const level: PhaseTimingLevel = dayNumber > target ? 'over' : dayNumber / target >= pct / 100 ? 'warn' : 'ok';
	return { level, dayNumber, targetDays: target, remainingDays: remaining, doneInDays: null };
}

/** Teks ringkas untuk leader. Kosong bila tak ada informasi bermakna. */
export function phaseTimingText(t: PhaseTiming): string {
	if (t.doneInDays != null) return `Selesai dalam ${t.doneInDays} hari${t.targetDays ? ` (target ${t.targetDays} hari)` : ''}`;
	if (t.dayNumber == null) return '';
	if (t.targetDays == null) return `Berjalan hari ke-${t.dayNumber}`;
	if (t.level === 'over') return `Hari ke-${t.dayNumber} — lewat target ${t.targetDays} hari (${Math.abs(t.remainingDays ?? 0)} hari)`;
	return `Hari ke-${t.dayNumber} dari target ${t.targetDays} hari`;
}
