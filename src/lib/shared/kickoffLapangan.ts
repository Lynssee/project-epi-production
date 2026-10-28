// Fase 4 (memperbaiki data PO proyek) — aturan murni "Mulai Bekerja (Kickoff Lapangan)".
// Leader boleh memulai walau Gerbang Kesiapan belum lolos; kekurangan DICATAT sebagai override (bukan dikunci),
// karena penguncian justru yang menahan proyek di Waiting. Proyek lama (pra-ERP) tak pernah dikunci retroaktif.

export const KICKOFF_FROM_STATUSES = ['waiting', 'draft'];
export const KICKOFF_TARGET_STATUS = 'on progress';

export type KickoffDecision =
	| { can: true }
	| { can: false; already?: boolean; reason: string };

export function canKickoffFrom(status: string | null | undefined): KickoffDecision {
	const s = String(status ?? '').toLowerCase().trim();
	if (KICKOFF_FROM_STATUSES.includes(s)) return { can: true };
	if (s === 'on progress') return { can: false, already: true, reason: 'Proyek sudah berstatus On Progress.' };
	if (s === 'hold') return { can: false, reason: 'Proyek berstatus Hold — hubungi admin proyek untuk mengaktifkan kembali.' };
	return { can: false, reason: `Proyek berstatus "${s || '-'}" — kickoff hanya untuk proyek Waiting/Draft.` };
}

export interface KickoffSignals {
	leaderAssigned: boolean;
	charterApproved: boolean;
	rabTotal: number;
	timelineSet: boolean;
	timelineScheduled?: boolean;
}

/** Item wajib kesiapan yang belum terpenuhi (label sama dengan admin: readiness-summary). */
export function failedReadiness(s: KickoffSignals): string[] {
	const failed: string[] = [];
	if (!s.leaderAssigned) failed.push('Leader ditunjuk');
	if (!s.charterApproved) failed.push('Charter disetujui');
	if (!((s.rabTotal ?? 0) > 0)) failed.push('RAB > 0');
	if (!s.timelineSet) failed.push('Timeline tersusun');
	if (s.timelineScheduled === false) failed.push('Jadwal timeline terisi');
	return failed;
}

export function timelineHasContent(tl: unknown): boolean {
	if (!tl) return false;
	let p: any = tl;
	if (typeof tl === 'string') {
		try {
			p = JSON.parse(tl);
		} catch {
			return tl.trim().length > 0;
		}
	}
	const sub = Array.isArray(p) ? p : (p?.subtasks ?? p?.categories);
	return Array.isArray(sub) ? sub.length > 0 : !!p;
}
