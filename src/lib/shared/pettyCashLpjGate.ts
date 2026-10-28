// src/lib/shared/pettyCashLpjGate.ts
// PC3-16 — salinan TS dari erp-epi `src/lib/server/pettyCashLpjGate.js` (evaluateEmployeeLpj, logika MURNI).
// JAGA IDENTIK: tes kontrak (pettyCashLpjGate.test.ts) memakai tabel harapan yang sama di kedua repo.

const DAY_MS = 86400000;
const rupiah = (n: unknown) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

export interface LpjTicket {
	request_number: string;
	mode?: string | null;
	status?: string | null;
	advance_settlement_status?: string | null;
	posted_at?: string | null;
	approved_amount?: number | null;
	amount?: number | null;
}

/** Uang muka pemohon yang LPJ-nya menunggak. `enforceFrom`: uang muka yang cair sebelum tanggal ini tidak dihitung (Aturan #3). */
export function evaluateEmployeeLpj(p: {
	tickets: LpjTicket[];
	batasHari?: number | null;
	enforceFrom?: string | null;
	now?: Date;
}): { overdue: Array<{ request_number: string; amount: number; lateDays: number }>; message: string | null } {
	const now = p.now ?? new Date();
	const batas = Number(p.batasHari) > 0 ? Number(p.batasHari) : 7;
	const from = p.enforceFrom ? String(p.enforceFrom).slice(0, 10) : null;
	const overdue: Array<{ request_number: string; amount: number; lateDays: number }> = [];
	for (const t of p.tickets || []) {
		if (t.mode !== 'advance' || t.status !== 'posted' || !t.posted_at) continue;
		if (![null, undefined, 'menunggu_lpj', 'revisi'].includes(t.advance_settlement_status as any)) continue;
		if (from && String(t.posted_at).slice(0, 10) < from) continue;
		const lateDays = Math.floor((now.getTime() - new Date(t.posted_at).getTime()) / DAY_MS) - batas;
		if (lateDays > 0) overdue.push({ request_number: t.request_number, amount: Number(t.approved_amount ?? t.amount) || 0, lateDays });
	}
	overdue.sort((a, b) => b.lateDays - a.lateDays);
	if (!overdue.length) return { overdue, message: null };
	const list = overdue
		.slice(0, 3)
		.map((o) => `${o.request_number} (${rupiah(o.amount)}, telat ${o.lateDays} hari)`)
		.join('; ');
	return {
		overdue,
		message: `Anda masih punya LPJ uang muka yang lewat batas: ${list}. Kirim LPJ dulu sebelum mengajukan uang muka baru. Reimburse (uang sendiri dulu) tetap bisa.`
	};
}
