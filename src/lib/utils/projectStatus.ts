// src/lib/utils/projectStatus.ts
// Util status proyek tunggal — sumber sebelumnya diduplikasi identik di
// routes/(app)/proyek/+page.svelte (list) dan routes/(app)/proyek/[project_id]/+page.svelte (detail).
// Nilai WAJIB selaras dengan STATUS_CANONICAL_ORDER/STATUS_LABEL_MAP di admin (erp-epi-1/src/lib/utils/projectUtils.js).

export function getProjectStatusLabel(status: string | null): string {
	if (!status) return '-';
	const s = status.toLowerCase().trim();
	if (s === 'on progress' || s === 'on_progress') return 'On Progress';
	if (s === 'repair') return 'Repair';
	if (s === 'waiting') return 'Waiting';
	if (s === 'prepare') return 'Persiapan';
	if (s === 'draft') return 'Draft';
	if (s === 'hold') return 'Hold';
	if (s === 'closed') return 'Closed';
	if (s === 'complete' || s === 'done' || s === 'selesai') return 'Selesai';
	if (s === 'menunggu verifikasi') return 'Selesai (Menunggu Verifikasi)';
	return status;
}

export function getProjectStatusClass(status: string | null): string {
	if (!status) return 'pend';
	const s = status.toLowerCase().trim();
	if (s === 'on progress' || s === 'on_progress' || s === 'repair') return 'ok';
	if (s === 'waiting' || s === 'prepare' || s === 'draft') return 'pend';
	if (s === 'hold' || s === 'closed') return 'warn';
	if (s === 'complete' || s === 'done' || s === 'selesai') return 'done';
	if (s === 'menunggu verifikasi') return 'info';
	return 'pend';
}
