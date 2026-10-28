// Centralized status definitions — avoids brittle string-matching scattered across files
//
// SUMBER KEBENARAN TUNGGAL untuk status `pengajuan_anggaran`.
// Jangan bikin salinan getStatusLabel/isPaid lokal di komponen — impor dari sini.
//
// Nilai kanonik didefinisikan di admin (`erp-epi-1` → budgetRequestApi.js `STATUS_FLOW`).
// Nilai warisan tetap dipetakan supaya baris lama tidak jatuh ke bucket yang salah.
//
// Verifikasi data produksi 24 Agu 2026 (515 baris):
//   Pending 351 · Completed 121 · Approved 39 · Rejected 2 · Selesai 2
// Sebelum perbaikan ini, `Approved` + `Completed` (160 baris / 31%) jatuh ke label
// "Menunggu" karena tidak dikenali sama sekali, dan bucket "Dibayarkan" selalu 0.
//
// Catatan `Selesai`: terverifikasi dari data — kedua barisnya punya `tanggal_dicairkan`
// dan `finance_processed = true`, jadi `Selesai` berarti SUDAH DIBAYAR (nama lama dari
// `Completed`), bukan sekadar "disetujui".

export const BUDGET_STATUS = {
	// Kanonik (dipakai admin saat ini)
	PENDING: 'Pending',
	APPROVED: 'Approved',
	PARTIAL: 'Partial',
	COMPLETED: 'Completed',
	POSTED: 'Dibukukan',
	REJECTED: 'Rejected',
	// BIZ-04: ditarik pengaju / dibatalkan Finance (soft-cancel, nomor tetap)
	DIBATALKAN: 'Dibatalkan',
	// Warisan — masih ada di data lama / kode lama
	DIPROSES: 'Diproses',
	VERIFIED: 'Verified',
	SELESAI: 'Selesai',
	DITOLAK: 'Ditolak',
	DIBAYARKAN: 'Dibayarkan',
	PAID: 'Paid',
} as const;

export type BudgetStatusValue = typeof BUDGET_STATUS[keyof typeof BUDGET_STATUS];

/** Label yang dilihat user di lapangan. */
export type BudgetStatusLabel =
	| 'Menunggu'
	| 'Diproses'
	| 'Disetujui'
	| 'Dibayar Sebagian'
	| 'Dibayarkan'
	| 'Ditolak'
	| 'Dibatalkan';

/** Kelas semantik untuk styling. */
export type BudgetStatusClass = 'pend' | 'warn' | 'ok' | 'partial' | 'paid' | 'rej' | 'cancel';

// ==================== BUCKET ====================

/** Menunggu tindakan approval. */
export const BUDGET_PENDING_STATUSES = new Set<string>([
	BUDGET_STATUS.PENDING,
]);

/** Sudah lolos approval, menunggu Finance memproses. */
export const BUDGET_IN_PROCESS_STATUSES = new Set<string>([
	BUDGET_STATUS.DIPROSES,
]);

/** Disetujui tapi dananya belum keluar. */
export const BUDGET_APPROVED_STATUSES = new Set<string>([
	BUDGET_STATUS.APPROVED,
	BUDGET_STATUS.VERIFIED,
]);

/** Dibayar sebagian — sisanya masih hutang. */
export const BUDGET_PARTIAL_STATUSES = new Set<string>([
	BUDGET_STATUS.PARTIAL,
]);

/** Dana sudah keluar sepenuhnya (termasuk yang sudah dibukukan Manager Finance). */
export const BUDGET_PAID_STATUSES = new Set<string>([
	BUDGET_STATUS.COMPLETED,
	BUDGET_STATUS.SELESAI,
	BUDGET_STATUS.DIBAYARKAN,
	BUDGET_STATUS.PAID,
	BUDGET_STATUS.POSTED,
]);

/**
 * Sudah dibukukan ke pos laporan keuangan (disetujui Manager Finance).
 * Subset dari PAID — dipakai kalau laporan hanya mau menghitung yang sudah diakui.
 */
export const BUDGET_POSTED_STATUSES = new Set<string>([
	BUDGET_STATUS.POSTED,
]);

/** Sudah dibayar tapi masih menunggu pembukuan Manager Finance. */
export const BUDGET_AWAITING_POSTING_STATUSES = new Set<string>([
	BUDGET_STATUS.COMPLETED,
	BUDGET_STATUS.SELESAI,
	BUDGET_STATUS.DIBAYARKAN,
	BUDGET_STATUS.PAID,
]);

export const BUDGET_REJECTED_STATUSES = new Set<string>([
	BUDGET_STATUS.REJECTED,
	BUDGET_STATUS.DITOLAK,
]);

/**
 * Belum lunas — masih jadi kewajiban kas.
 * Dipakai untuk filter "menunggu"/outstanding. Sengaja disusun sebagai daftar
 * eksplisit (bukan `_nin` dari daftar selesai) supaya status baru yang belum
 * dikenal tidak diam-diam terhitung sebagai outstanding.
 */
export const BUDGET_OUTSTANDING_STATUSES: string[] = [
	BUDGET_STATUS.PENDING,
	BUDGET_STATUS.DIPROSES,
	BUDGET_STATUS.APPROVED,
	BUDGET_STATUS.VERIFIED,
	BUDGET_STATUS.PARTIAL,
];

/** Semua nilai status yang dikenal. Dipakai test regresi. */
export const BUDGET_KNOWN_STATUSES: string[] = Object.values(BUDGET_STATUS);

// ==================== PEMETAAN ====================

export function getBudgetStatusLabel(status: string | null | undefined): BudgetStatusLabel {
	if (!status) return 'Menunggu';
	const s = status.trim();
	if (s === BUDGET_STATUS.DIBATALKAN) return 'Dibatalkan';
	if (BUDGET_REJECTED_STATUSES.has(s)) return 'Ditolak';
	if (BUDGET_PAID_STATUSES.has(s)) return 'Dibayarkan';
	if (BUDGET_PARTIAL_STATUSES.has(s)) return 'Dibayar Sebagian';
	if (BUDGET_APPROVED_STATUSES.has(s)) return 'Disetujui';
	if (BUDGET_IN_PROCESS_STATUSES.has(s)) return 'Diproses';
	return 'Menunggu';
}

export function getBudgetStatusClass(status: string | null | undefined): BudgetStatusClass {
	switch (getBudgetStatusLabel(status)) {
		case 'Ditolak': return 'rej';
		case 'Dibatalkan': return 'cancel';
		case 'Dibayarkan': return 'paid';
		case 'Dibayar Sebagian': return 'partial';
		case 'Disetujui': return 'ok';
		case 'Diproses': return 'warn';
		default: return 'pend';
	}
}

/** Kelas Tailwind untuk badge status. Satu tempat, supaya warnanya konsisten. */
export function getBudgetStatusBadgeClass(status: string | null | undefined): string {
	switch (getBudgetStatusLabel(status)) {
		case 'Ditolak':
			return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20';
		case 'Dibatalkan':
			return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20';
		case 'Dibayarkan':
			return 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20';
		case 'Dibayar Sebagian':
			return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20';
		case 'Disetujui':
			return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20';
		case 'Diproses':
			return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20';
		default:
			return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
	}
}

/** Titik indikator status. Hanya yang masih menunggu yang berkedip. */
export function getBudgetStatusDotClass(status: string | null | undefined): string {
	switch (getBudgetStatusLabel(status)) {
		case 'Ditolak': return 'bg-rose-500';
		case 'Dibatalkan': return 'bg-slate-400';
		case 'Dibayarkan': return 'bg-sky-500';
		case 'Dibayar Sebagian': return 'bg-indigo-500';
		case 'Disetujui': return 'bg-emerald-500';
		case 'Diproses': return 'bg-blue-500';
		default: return 'bg-amber-500 animate-pulse';
	}
}

/**
 * Penjelasan singkat untuk user lapangan — dipakai sebagai tooltip/hint
 * supaya pengaju paham arti tiap tahap tanpa perlu bertanya ke Finance.
 */
export function getBudgetStatusHint(status: string | null | undefined): string {
	switch (getBudgetStatusLabel(status)) {
		case 'Menunggu':
			return 'Pengajuan sudah masuk dan sedang menunggu persetujuan atasan.';
		case 'Diproses':
			return 'Sudah disetujui atasan, sedang diproses oleh Finance.';
		case 'Disetujui':
			return 'Disetujui Finance dan masuk antrean pembayaran. Dana belum cair.';
		case 'Dibayar Sebagian':
			return 'Sebagian dana sudah dicairkan. Sisanya masih dalam antrean pembayaran.';
		case 'Dibayarkan':
			return 'Dana sudah dicairkan Finance. Cek bukti transfer pada detail pengajuan.';
		case 'Ditolak':
			return 'Pengajuan ditolak. Lihat catatan penolakan pada detail pengajuan.';
		case 'Dibatalkan':
			return 'Pengajuan ditarik/dibatalkan. Nomor dan riwayatnya tetap tersimpan; ajukan baru bila masih dibutuhkan.';
	}
}

// ==================== PREDIKAT ====================

export function isBudgetApproved(status: string | null | undefined): boolean {
	return BUDGET_APPROVED_STATUSES.has((status ?? '').trim());
}

export function isBudgetRejected(status: string | null | undefined): boolean {
	return BUDGET_REJECTED_STATUSES.has((status ?? '').trim());
}

export function isBudgetPending(status: string | null | undefined): boolean {
	const s = (status ?? '').trim();
	return !s || BUDGET_PENDING_STATUSES.has(s);
}

export function isBudgetPaid(status: string | null | undefined): boolean {
	return BUDGET_PAID_STATUSES.has((status ?? '').trim());
}

/** Sudah dibukukan ke pos laporan keuangan (diakui di laporan). */
export function isBudgetPosted(status: string | null | undefined): boolean {
	return BUDGET_POSTED_STATUSES.has((status ?? '').trim());
}

/** Sudah dibayar tapi belum dibukukan Manager Finance. */
export function isBudgetAwaitingPosting(status: string | null | undefined): boolean {
	return BUDGET_AWAITING_POSTING_STATUSES.has((status ?? '').trim());
}

export function isBudgetPartiallyPaid(status: string | null | undefined): boolean {
	return BUDGET_PARTIAL_STATUSES.has((status ?? '').trim());
}

/** Sudah lolos approval Finance — dana boleh/akan cair. */
export function isBudgetFinanceApproved(status: string | null | undefined): boolean {
	const s = (status ?? '').trim();
	return (
		BUDGET_APPROVED_STATUSES.has(s) ||
		BUDGET_IN_PROCESS_STATUSES.has(s) ||
		BUDGET_PARTIAL_STATUSES.has(s) ||
		BUDGET_PAID_STATUSES.has(s)
	);
}

/** Masih jadi kewajiban kas (belum lunas dan belum ditolak). */
export function isBudgetOutstanding(status: string | null | undefined): boolean {
	const s = (status ?? '').trim();
	if (!s) return true;
	return !BUDGET_PAID_STATUSES.has(s) && !BUDGET_REJECTED_STATUSES.has(s);
}

/** Status yang tidak dikenal sama sekali — dipakai untuk peringatan/diagnostik. */
export function isBudgetStatusUnknown(status: string | null | undefined): boolean {
	const s = (status ?? '').trim();
	if (!s) return false;
	return !BUDGET_KNOWN_STATUSES.includes(s);
}

// ==================== PROYEK & DEADLINE (tidak berubah) ====================

export const PROJECT_DONE_STATUSES = new Set<string>([
	'complete', 'done', 'closed', 'cancel', 'cancelled'
]);

export const DEADLINE_WARNING_DAYS = 7;

export function daysUntilDeadline(endDate: string | null | undefined): number | null {
	if (!endDate) return null;
	const today = new Date(); today.setHours(0, 0, 0, 0);
	const deadline = new Date(endDate); deadline.setHours(0, 0, 0, 0);
	return Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function isProjectAtRisk(project: { end_date?: string | null; status?: string | null }): boolean {
	const days = daysUntilDeadline(project.end_date);
	if (days === null) return false;
	return days < 0 && !PROJECT_DONE_STATUSES.has((project.status ?? '').toLowerCase().trim());
}

export function isDeadlineUpcoming(project: { end_date?: string | null; status?: string | null }): boolean {
	const days = daysUntilDeadline(project.end_date);
	if (days === null) return false;
	return days >= 0 && days <= DEADLINE_WARNING_DAYS && !PROJECT_DONE_STATUSES.has((project.status ?? '').toLowerCase().trim());
}
