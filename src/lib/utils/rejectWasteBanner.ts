// src/lib/utils/rejectWasteBanner.ts
// MODUL MURNI (tanpa I/O). Fase 3 Blueprint SOP Manufaktur: peringatan laju reject/waste saat input harian produksi.
// Rumus SAMA dengan gate G_PRD_REJECT_WASTE_RATE di erp-epi (evaluateRejectWasteRate): kg ÷ (output + reject + waste).
// Ambang dari setelan admin (app_settings production.reject_rate_alert_pct / waste_rate_alert_pct); default hanya jaring pengaman.

export const DEFAULT_REJECT_MAX_PCT = 2;
export const DEFAULT_WASTE_MAX_PCT = 1.5;

export type RejectWasteBanner = {
	level: 'none' | 'warn';
	rejectPct: number;
	wastePct: number;
	rejectOver: boolean;
	wasteOver: boolean;
	messages: string[];
};

const num = (v: unknown): number => {
	const n = parseFloat(String(v ?? ''));
	return Number.isFinite(n) ? n : 0;
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const limitOr = (v: unknown, fallback: number) => (num(v) > 0 ? num(v) : fallback);

export function computeRejectWasteBanner(p: {
	outputKg: unknown;
	rejectKg: unknown;
	wasteKg: unknown;
	rejectMaxPct?: unknown;
	wasteMaxPct?: unknown;
}): RejectWasteBanner {
	const out = Math.max(0, num(p.outputKg));
	const rej = Math.max(0, num(p.rejectKg));
	const wst = Math.max(0, num(p.wasteKg));
	const total = out + rej + wst;
	const none: RejectWasteBanner = { level: 'none', rejectPct: 0, wastePct: 0, rejectOver: false, wasteOver: false, messages: [] };
	if (total <= 0 || (rej <= 0 && wst <= 0)) return none;
	const rejLimit = limitOr(p.rejectMaxPct, DEFAULT_REJECT_MAX_PCT);
	const wstLimit = limitOr(p.wasteMaxPct, DEFAULT_WASTE_MAX_PCT);
	const rejectPct = (rej / total) * 100;
	const wastePct = (wst / total) * 100;
	const rejectOver = rejectPct > rejLimit;
	const wasteOver = wastePct > wstLimit;
	const messages: string[] = [];
	if (rejectOver) messages.push(`Reject ${r1(rejectPct)}% melebihi ambang ${rejLimit}%. Tulis alasan di Catatan; bila batch gagal mutu, laporkan NCR ke QC.`);
	if (wasteOver) messages.push(`Waste ${r1(wastePct)}% melebihi ambang ${wstLimit}%. Tulis alasan di Catatan dan cek sisa di pipa/tangki.`);
	return { level: rejectOver || wasteOver ? 'warn' : 'none', rejectPct: r1(rejectPct), wastePct: r1(wastePct), rejectOver, wasteOver, messages };
}
