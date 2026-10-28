// src/lib/shared/pettyCashRules.ts
// Aturan murni (tanpa I/O) Kas Kecil lapangan — dipakai server & UI, bisa diuji tanpa Directus.
// Kembar sebagian dengan erp-epi `pettyCashRequest.js` (checkRequestAgainstFund) & `pettyCashUi.js`
// (collectDecisionNotes) — jaga tetap identik (audit petty cash 21 Sep 2026, BUG-01/BUG-15).

export interface FundLike {
	id?: number;
	fund_name?: string | null;
	status?: string | null;
	ceiling_per_transaksi?: number | string | null;
	fund_type?: string | null;
	project_id?: number | string | null;
	custodian_karyawan_id?: number | { id: number } | null;
	backup_custodian_karyawan_id?: number | { id: number } | null;
}

/** Pesan error bila nominal/fund tidak boleh diajukan, atau null bila lolos. */
export function checkRequestAgainstFund(fund: FundLike | null | undefined, amount: number): string | null {
	if (!fund) return 'Dana kas kecil tidak ditemukan.';
	if (String(fund.status || '').toUpperCase() !== 'ACTIVE') {
		return `Dana ${fund.fund_name || `#${fund.id}`} tidak aktif.`;
	}
	const ceiling = parseFloat(String(fund.ceiling_per_transaksi ?? ''));
	if (ceiling > 0 && Number(amount) > ceiling) {
		return (
			`Nominal melebihi batas per transaksi dana ini (Rp ${ceiling.toLocaleString('id-ID')}). ` +
			'Untuk nominal lebih besar, ajukan lewat Pengajuan Anggaran.'
		);
	}
	return null;
}

/**
 * PRJ-22 / K16 — dana kerja proyek (imprest) terikat ke SATU proyek: tiket ke dana ini otomatis memakai fund.project_id
 * (pemohon tidak perlu/tidak boleh memilih proyek lain). Dana biasa: proyek mengikuti isian pemohon (perilaku lama).
 */
export function resolveImprestProject(
	fund: FundLike | null | undefined,
	requestedProjectId: number | null
): { projectId: number | null; error?: string } {
	if (fund?.fund_type !== 'project_imprest') return { projectId: requestedProjectId };
	const fixed = Number(fund.project_id);
	if (!Number.isFinite(fixed) || fixed <= 0) {
		return { projectId: requestedProjectId, error: `Dana kerja ${fund.fund_name || ''} belum terikat ke proyek — hubungi Finance.`.replace('  ', ' ') };
	}
	if (requestedProjectId != null && Number(requestedProjectId) !== fixed) {
		return { projectId: fixed, error: 'Dana kerja ini hanya untuk satu proyek; proyek yang dipilih tidak cocok dengan dana.' };
	}
	return { projectId: fixed };
}

const idOf = (v: unknown) => (v && typeof v === 'object' ? (v as { id?: number }).id : v);

/**
 * PRJ-22 — dana kerja proyek (imprest) hanya boleh dipakai pemegangnya (Leader = kasir utama atau cadangan).
 * Dana biasa: terbuka untuk semua pemohon (perilaku lama).
 */
export function canUseFund(fund: FundLike | null | undefined, karyawanId: number | null): boolean {
	if (fund?.fund_type !== 'project_imprest') return true;
	if (karyawanId == null) return false;
	return [idOf(fund.custodian_karyawan_id), idOf(fund.backup_custodian_karyawan_id)].some((x) => x != null && String(x) === String(karyawanId));
}

export interface DecisionNote {
	role: 'atasan' | 'finance' | 'kasir' | 'kasir_lpj' | 'sistem';
	label: string;
	text: string;
}

/** BUG-15 — gabungkan alasan tolak/revisi dari atasan, Finance Pusat, dan kasir (bukan hanya reject_reason). */
export function collectDecisionNotes(row: any): DecisionNote[] {
	const out: DecisionNote[] = [];
	const add = (role: DecisionNote['role'], label: string, action: unknown, text: unknown) => {
		const t = String(text ?? '').trim();
		if (t && (action === 'revisi' || action === 'rejected')) out.push({ role, label, text: t });
	};
	add('atasan', 'Atasan', row?.atasan_action, row?.atasan_note);
	add('finance', 'Finance Pusat', row?.finance_action, row?.finance_note);
	add('kasir', 'Kasir', row?.kasir_action, row?.kasir_note);
	// PC3-13 — LPJ dikembalikan kasir (status LPJ 'revisi'); catatan disimpan terpisah dari catatan posting kasir.
	const lpjNote = String(row?.lpj_reject_note ?? '').trim();
	if (lpjNote && row?.advance_settlement_status === 'revisi') {
		out.push({ role: 'kasir_lpj', label: 'LPJ dikembalikan kasir', text: lpjNote });
	}
	// Lapangan lama tidak mengisi atasan_action — catatan atasan tetap dianggap alasan bila tiket revisi/ditolak.
	if (!out.some((o) => o.role === 'atasan') && row?.atasan_note && ['revisi', 'rejected'].includes(row?.status)) {
		out.unshift({ role: 'atasan', label: 'Atasan', text: String(row.atasan_note).trim() });
	}
	const rr = String(row?.reject_reason ?? '').trim();
	if (rr && !out.some((o) => o.text === rr)) out.push({ role: 'sistem', label: 'Alasan', text: rr });
	return out;
}

/** Batas awal (ISO) jendela deteksi tiket ganda. */
export function duplicateWindowStartIso(now = new Date(), minutes = 10): string {
	return new Date(now.getTime() - minutes * 60_000).toISOString();
}

/**
 * SEC-01 — proxy Directus meneruskan dengan token admin. Tanpa blokir ini, karyawan mana pun yang
 * login bisa PATCH tiket (melompati atasan/kasir) atau saldo fund lewat DevTools. Semua tulis ke
 * koleksi ini WAJIB lewat /api/ess/petty-cash/* (route server memakai directusServerJson langsung,
 * tidak lewat proxy, jadi tidak terpengaruh). Koleksi tiket sudah/masih kosong → aman dari
 * lockdown retroaktif (Aturan #3); tak ada klien lapangan yang menulis ke sana via proxy.
 */
const PETTY_CASH_WRITE_BLOCKED =
	/^items\/(petty_cash_requests|petty_cash_request_logs|petty_cash_funds|petty_cash_categories|petty_cash_category_rules|petty_cash_period_close)(\/|$)/i;
export function isPettyCashWriteBlocked(path: string, method: string): boolean {
	if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(String(method || '').toUpperCase())) return false;
	return PETTY_CASH_WRITE_BLOCKED.test(String(path || '').replace(/^\/+/, ''));
}

// ── PC3-14 — aturan LPJ (kembar erp-epi src/lib/server/pettyCashPolicy.js; tes kontrak identik) ─────────────────────

/** Mode efektif aturan LPJ: 'hard' hanya berlaku sejak enforce_from (masa tenggang, Aturan #3). */
export function effectiveRulesMode(mode: unknown, enforceFrom: unknown, today: string): 'off' | 'shadow' | 'hard' {
	const m = ['off', 'shadow', 'hard'].includes(String(mode)) ? (String(mode) as 'off' | 'shadow' | 'hard') : 'shadow';
	if (m === 'hard' && enforceFrom && String(today) < String(enforceFrom).slice(0, 10)) return 'shadow';
	return m;
}

/** Nominal realisasi di luar 1%–150% uang muka hampir pasti salah ketik (mis. "650.000" terbaca 650). */
export function isLpjOutlier(advance: number, settlement: number): boolean {
	const a = Number(advance) || 0;
	const st = Number(settlement) || 0;
	return a > 0 && (st < a * 0.01 || st > a * 1.5);
}

export interface LpjRuleViolation {
	code: 'LPJ_BUKTI' | 'LPJ_OVERAGE';
	message: string;
}

/** Pelanggaran aturan LPJ (BUG-04): bukti wajib di atas ambang; alasan wajib bila kelebihan melewati batas %. */
export function evaluateLpjRules(p: {
	advance: number;
	settlement: number;
	buktiCount?: number;
	wajibBuktiDiatas?: number | string | null;
	maxOveragePct?: number | string | null;
	overageReason?: string | null;
}): LpjRuleViolation[] {
	const out: LpjRuleViolation[] = [];
	const wajib = Number(p.wajibBuktiDiatas);
	if (wajib > 0 && Number(p.settlement) >= wajib && (p.buktiCount ?? 0) < 1) {
		out.push({
			code: 'LPJ_BUKTI',
			message: `Realisasi Rp ${Math.round(Number(p.settlement)).toLocaleString('id-ID')} ≥ batas wajib bukti (Rp ${wajib.toLocaleString('id-ID')}): lampirkan foto nota.`
		});
	}
	const maxPct = Number(p.maxOveragePct);
	if (maxPct > 0 && Number(p.advance) > 0 && Number(p.settlement) > Number(p.advance)) {
		const pct = ((Number(p.settlement) - Number(p.advance)) / Number(p.advance)) * 100;
		if (pct > maxPct && String(p.overageReason || '').trim().length < 5) {
			out.push({
				code: 'LPJ_OVERAGE',
				message: `Realisasi melebihi uang muka ${pct.toFixed(0)}% (batas ${maxPct}%): isi alasan kelebihan (min. 5 karakter).`
			});
		}
	}
	return out;
}

// ── PC3-15 — lama menunggu (hari kerja Sen–Jum; libur nasional diabaikan) — kembar erp-epi pettyCashUi.js ────────────
const DAY_MS = 86400000;

/** Hari kerja penuh yang berlalu dari `from` sampai `now`. */
export function businessDaysSince(from: string | Date | null | undefined, now: Date = new Date()): number {
	const start = new Date(from as any);
	if (Number.isNaN(start.getTime())) return 0;
	let n = 0;
	for (let t = start.getTime() + DAY_MS; t <= now.getTime(); t += DAY_MS) {
		const dow = new Date(t).getUTCDay();
		if (dow !== 0 && dow !== 6) n++;
	}
	return n;
}

const WAIT_LABEL: Record<string, string> = { menunggu_atasan: 'atasan', menunggu_finance: 'Finance Pusat', menunggu_kasir: 'kasir' };

/** Teks "Menunggu atasan 2 hari kerja · pengingat otomatis dikirim" untuk kartu tiket; null bila belum ≥ 1 hari kerja. */
export function waitingInfo(row: any, now: Date = new Date()): { days: number; label: string } | null {
	const who = WAIT_LABEL[row?.status];
	if (!who || row?.hold_reason) return null;
	const days = businessDaysSince(row.date_updated || row.date_created, now);
	if (days < 1) return null;
	return { days, label: `Menunggu ${who} ${days} hari kerja · pengingat otomatis dikirim` };
}

/** Umur tertua (hari kerja) di antrean — untuk lencana "tertua N hari". */
export function oldestWaitDays(rows: any[] | null | undefined, now: Date = new Date()): number {
	let max = 0;
	for (const r of rows || []) max = Math.max(max, businessDaysSince(r.date_updated || r.date_created, now));
	return max;
}

/** Murni: delegated_from TERBARU per tiket dari baris log 'submitted' (urut lama→baru); submit ulang tanpa delegasi menghapus jejak. */
export function extractDelegatedFrom(logs: Array<{ request_id: number | string; meta?: unknown }> | null | undefined): Map<string, number | null> {
	const out = new Map<string, number | null>();
	for (const l of logs || []) {
		let meta: any = l?.meta;
		if (typeof meta === 'string') {
			try {
				meta = JSON.parse(meta);
			} catch {
				meta = null;
			}
		}
		const id = meta && typeof meta === 'object' ? meta.delegated_from : null;
		out.set(String(l.request_id), id ? Number(id) : null);
	}
	return out;
}

/**
 * PC3-05 — BACA lewat proxy juga ditutup: tak ada klien lapangan yang membaca koleksi ini lewat proxy
 * (semua lewat /api/ess/petty-cash/*, yang membatasi ke tiket milik/atasan sendiri). Tanpa ini, siapa pun
 * yang login bisa membaca saldo fund & tiket orang lain lewat DevTools. Aman terhadap Aturan #3 (tak ada pemakai sah).
 */
export function isPettyCashReadBlocked(path: string, method: string): boolean {
	if (!['GET', 'HEAD'].includes(String(method || '').toUpperCase())) return false;
	return PETTY_CASH_WRITE_BLOCKED.test(String(path || '').replace(/^\/+/, ''));
}

export const PETTY_CASH_PROXY_BLOCK_MESSAGE =
	'Data kas kecil hanya dapat diakses lewat menu Kas Kecil (alur persetujuan), bukan langsung ke database.';
