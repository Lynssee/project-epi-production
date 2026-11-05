// Fase gate PL untuk banner lapangan (hitung mundur ke enforce_from). Murni, aman di klien dan server.
// Padanannya di erp-epi: src/lib/shared/plBenahiRules.js (gatePhase) — WAJIB tetap sejalan.

export interface GateInfo {
	terdaftar?: boolean;
	aktif?: boolean;
	mode?: string;
	enforceFrom?: string | null;
}
export type GatePhaseName = 'belum_terdaftar' | 'nonaktif' | 'masa_tenggang' | 'berlaku' | 'pantau';
export interface GatePhase {
	phase: GatePhaseName;
	daysLeft: number | null;
	tone: 'none' | 'amber' | 'red' | 'blue';
}

const MS_DAY = 86_400_000;

export function gatePhase(info: GateInfo | null | undefined, now: Date = new Date()): GatePhase {
	if (!info || !info.terdaftar) return { phase: 'belum_terdaftar', daysLeft: null, tone: 'none' };
	if (info.aktif === false) return { phase: 'nonaktif', daysLeft: null, tone: 'none' };
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const ef = info.enforceFrom ? new Date(`${String(info.enforceFrom).slice(0, 10)}T00:00:00`) : null;
	const future = !!ef && ef.getTime() > today.getTime();
	if (info.mode === 'hard') {
		if (future) return { phase: 'masa_tenggang', daysLeft: Math.round((ef!.getTime() - today.getTime()) / MS_DAY), tone: 'amber' };
		return { phase: 'berlaku', daysLeft: 0, tone: 'red' };
	}
	return { phase: 'pantau', daysLeft: future ? Math.round((ef!.getTime() - today.getTime()) / MS_DAY) : null, tone: 'blue' };
}

/** Kalimat untuk leader. null = tidak perlu banner. */
export function leaderNoticeText(phase: GatePhase, enforceFrom?: string | null): string | null {
	const tgl = enforceFrom ? String(enforceFrom).slice(0, 10) : '';
	if (phase.phase === 'berlaku') {
		return 'Barang yang belum tertaut ke Master Barang TIDAK BISA diajukan/disetujui. Pilih dari saran Master Katalog, atau centang "usulkan ke Admin Logistik" bila barangnya memang belum ada.';
	}
	if (phase.phase === 'masa_tenggang') {
		const sisa = phase.daysLeft === 0 ? 'HARI INI' : `${phase.daysLeft} hari lagi`;
		return `Mulai ${tgl} (${sisa}) barang yang belum tertaut ke Master Barang TIDAK BISA diajukan. Biasakan memilih dari saran Master Katalog, atau centang "usulkan ke Admin Logistik" bila barangnya belum ada.`;
	}
	return null;
}
