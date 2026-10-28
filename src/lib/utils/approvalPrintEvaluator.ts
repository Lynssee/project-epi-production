// src/lib/utils/approvalPrintEvaluator.ts
// Port 1:1 dari erp-epi (src/lib/utils/approvalPrintEvaluator.js) — evaluator murni
// (tanpa I/O) untuk kelayakan cetak "Lembar Disposisi & Pengajuan Resmi" pra-Finance,
// dipakai bareng oleh Admin (erp-epi) dan Lapangan (project-epi) supaya aturannya
// SATU sumber kebenaran walau di dua repo (disalin manual — tidak ada package bersama
// antar repo erp-epi/project-epi saat ini).
//
// Keputusan bisnis (lihat dokumen rencana "(analyst) implementation_plan_Fitur Cetak
// Pengajuan Pra-Finance"): tombol cetak aktif begitu SELURUH langkah manajerial
// non-finance yang berlaku (applicable) sudah disetujui, walau status pengajuan masih
// 'Pending' menunggu Finance. Kertas yang dicetak memuat jejak audit digital manajer +
// kolom kosong tanda tangan fisik untuk Finance/Kasir.
//
// Pengajuan tier kecil (matriks hanya 1 tahap: langsung Finance, tanpa manajer non-
// finance sama sekali) boleh langsung dicetak begitu diajukan — tidak ada apa pun
// untuk "ditunggu" sebelum sampai ke meja Finance.

export interface ApprovalTimelineStep {
	department_key?: string | null;
	label?: string | null;
	status?: string | null;
	applicable?: boolean;
}

export interface IsReadyForPaperApprovalInput {
	pengajuanStatus?: string | null;
	requestStatus?: string | null;
	steps?: ApprovalTimelineStep[];
}

const TERMINAL_BLOCKED_STATUSES = ['rejected', 'ditolak', 'returned', 'dikembalikan'];
const FULLY_APPROVED_STATUSES = ['approved', 'fully approved', 'disetujui'];
// Status per-step yang TIDAK menghalangi cetak: sudah diputuskan disetujui, atau
// dilewati (tier itu memang tidak berlaku untuk pengajuan ini — bukan "belum jalan").
const STEP_STATUS_NOT_BLOCKING = ['disetujui', 'dilewati'];
const STEP_STATUS_BLOCKING_HARD = ['ditolak', 'dikembalikan'];

/**
 * Sebuah step dianggap "langkah Finance" bila department_key ATAU label jabatannya
 * mengandung kata FINANCE — konsisten dengan heuristik yang sudah dipakai server-side
 * di erp-epi (anggaranEngine.js, pemeriksaan `isFinanceStep` sebelum wajib-COA saat
 * approve). Sengaja TIDAK mencocokkan string persis satu nilai (mis. "PROJECT
 * FINANCE") supaya tetap ikut config matriks/departemen yang diatur lewat UI, bukan
 * hardcode satu department_key.
 */
function isFinanceStep(step: ApprovalTimelineStep): boolean {
	const dept = String(step?.department_key || '').toUpperCase();
	const label = String(step?.label || '').toUpperCase();
	return dept.includes('FINANCE') || label.includes('FINANCE');
}

function statusIn(status: string | null | undefined, list: string[]): boolean {
	return list.includes(String(status || '').toLowerCase());
}

/**
 * Evaluasi murni: apakah pengajuan sudah layak dicetak sebagai Lembar Disposisi Fisik
 * pra-Finance?
 */
export function isReadyForPaperApproval({
	pengajuanStatus = null,
	requestStatus = null,
	steps = []
}: IsReadyForPaperApprovalInput = {}): boolean {
	// Sudah final (disetujui penuh, sudah dibayar/dibukukan, dst) -> pasti boleh cetak.
	if (statusIn(pengajuanStatus, FULLY_APPROVED_STATUSES)) return true;
	if (statusIn(requestStatus, FULLY_APPROVED_STATUSES)) return true;

	// Ditolak / dikembalikan (baik di level pengajuan maupun level approval_requests,
	// atau ada satu step yang statusnya begitu) -> terkunci keras, tidak peduli riwayat
	// step lain yang sempat disetujui sebelumnya.
	if (statusIn(pengajuanStatus, TERMINAL_BLOCKED_STATUSES)) return false;
	if (statusIn(requestStatus, TERMINAL_BLOCKED_STATUSES)) return false;
	const stepList = Array.isArray(steps) ? steps : [];
	if (stepList.some((s) => statusIn(s?.status, STEP_STATUS_BLOCKING_HARD))) return false;

	// Hanya step yang applicable (relevan untuk pengajuan ini) yang dihitung. Step tanpa
	// field `applicable` (mis. mode non-workflow M16) dianggap applicable secara default.
	const applicableSteps = stepList.filter((s) => s?.applicable !== false);
	const nonFinanceSteps = applicableSteps.filter((s) => !isFinanceStep(s));

	// Tier kecil: tidak ada langkah manajerial non-finance sama sekali (matriks hanya
	// 1 tahap, langsung Finance) -> tidak ada yang perlu "ditunggu" sebelum sampai meja
	// Finance, boleh cetak begitu diajukan.
	if (nonFinanceSteps.length === 0) return true;

	// Selain itu: boleh cetak hanya jika SELURUH langkah manajerial non-finance sudah
	// disetujui (atau memang dilewati karena tidak berlaku untuk pengajuan ini).
	return nonFinanceSteps.every((s) => statusIn(s?.status, STEP_STATUS_NOT_BLOCKING));
}
