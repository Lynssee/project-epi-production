// src/lib/utils/idleLoans.ts
// MURNI. Fase 5b (audit hidden cost #1051, 20 Okt 2026) — peringatan ALAT MENGANGGUR: alat pinjaman yang masih tercatat di
// proyek (internal_loan_log belum dikembalikan) tetapi tidak muncul di laporan harian beberapa hari. Alat yang menganggur
// tetap menanggung biaya (penyusutan/sewa internal harian) dan tidak bisa dipakai proyek lain → minta retur lebih awal.
// Tanpa nominal rupiah (Project Leader hanya melihat level/jumlah hari).
//
// "Terpakai" = nama/kode alat disebut di `reports.tools` (string JSON, array string, atau array objek {name|nama|tool_name|code|kode}).

export interface LoanLike {
	id: string | number;
	start_date?: string | null;
	equipment?: { name?: string | null; code?: string | null } | null;
}

export interface ReportToolsLike {
	date?: string | null;
	tools?: unknown;
}

export interface IdleLoan {
	loan_id: string | number;
	name: string;
	code: string | null;
	idle_days: number;
	last_used: string | null; // YYYY-MM-DD; null = tidak pernah disebut di laporan sejak dipinjam
	basis: 'laporan_terakhir' | 'sejak_dipinjam';
}

const DAY = 86_400_000;

const norm = (s: unknown) =>
	String(s ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/** Ambil nama/kode alat dari satu entri `tools` (string atau objek). */
function toolTokens(entry: unknown): string[] {
	if (entry == null) return [];
	if (typeof entry === 'string' || typeof entry === 'number') return [norm(entry)];
	if (typeof entry === 'object') {
		const o = entry as Record<string, unknown>;
		return [o.name, o.nama, o.tool_name, o.code, o.kode].map(norm).filter(Boolean);
	}
	return [];
}

export function parseReportTools(raw: unknown): string[] {
	let list: unknown = raw;
	if (typeof raw === 'string') {
		const t = raw.trim();
		if (!t) return [];
		try {
			list = JSON.parse(t);
		} catch {
			list = [t];
		}
	}
	if (!Array.isArray(list)) return [];
	return list.flatMap(toolTokens).filter(Boolean);
}

function dayOnly(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const t = new Date(iso).getTime();
	return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * @param idleDays ambang hari (setelan project.alat.idle_days); ≤ 0 / tak valid ⇒ fitur nonaktif (daftar kosong)
 */
export function computeIdleLoans(p: { loans?: LoanLike[] | null; reports?: ReportToolsLike[] | null; idleDays: number; now?: Date }): IdleLoan[] {
	const threshold = Math.floor(Number(p.idleDays));
	if (!Number.isFinite(threshold) || threshold <= 0) return [];
	const now = (p.now ?? new Date()).getTime();

	const reportTokens = (p.reports || [])
		.map((r) => ({ date: dayOnly(r.date), tokens: parseReportTools(r.tools) }))
		.filter((r) => r.date && r.tokens.length);

	const out: IdleLoan[] = [];
	for (const loan of p.loans || []) {
		const name = loan.equipment?.name ? String(loan.equipment.name) : 'Unit Alat';
		const code = loan.equipment?.code ? String(loan.equipment.code) : null;
		const nName = norm(name);
		const nCode = norm(code);
		const startMs = loan.start_date ? new Date(loan.start_date).getTime() : NaN;

		let lastUsed: string | null = null;
		for (const r of reportTokens) {
			const used = r.tokens.some((t) => (nCode && t === nCode) || (nName.length >= 4 && (t === nName || t.includes(nName) || nName.includes(t)) && t.length >= 4));
			if (used && (!lastUsed || r.date! > lastUsed)) lastUsed = r.date;
		}
		// Pemakaian sebelum tanggal pinjam tidak dihitung (alat/nama yang sama dari pinjaman lama).
		if (lastUsed && !Number.isNaN(startMs) && new Date(lastUsed).getTime() < startMs - DAY) lastUsed = null;

		const baseMs = lastUsed ? new Date(lastUsed).getTime() : startMs;
		if (Number.isNaN(baseMs)) continue; // tanggal pinjam tak diketahui → jangan menebak
		const idle = Math.floor((now - baseMs) / DAY);
		if (idle >= threshold) {
			out.push({ loan_id: loan.id, name, code, idle_days: idle, last_used: lastUsed, basis: lastUsed ? 'laporan_terakhir' : 'sejak_dipinjam' });
		}
	}
	return out.sort((a, b) => b.idle_days - a.idle_days);
}
