// src/lib/server/ess/autoDelegation.ts
// Approval Delegation — auto-trigger (rencana "Package & Fitur Addons" §3), padanan
// erp-epi-1/src/lib/server/ess/autoDelegation.js. Cuti bisa disetujui lewat DUA jalur
// paralel: Approval Center erp-epi-1 (approvalEngine.js -> callback) ATAU langsung dari
// sini (api/ess/cuti/[id]/approve, lihat T4-lanjutan di callback erp-epi-1) — keduanya
// perlu memicu delegasi otomatis supaya tidak ada celah tergantung jalur mana yang dipakai.
//
// Delegate diambil dari `delegasi_karyawan_id` yang SUDAH WAJIB diisi user sendiri saat
// mengajukan cuti (lihat validasi di api/ess/cuti/+server.ts) — bukan ditebak dari
// atasan_id. Kalau kosong, skip (tidak menebak siapa pun).

import { directusServerJson } from '$lib/server/directus';

export async function createAutoDelegationForLeave(p: {
	karyawanId: string | number;
	delegateId: string | number | null | undefined;
	startDate: string;
	endDate: string;
	moduleKey?: string;
}): Promise<{ skipped?: string; created?: unknown; error?: string }> {
	const { karyawanId, delegateId, startDate, endDate, moduleKey = '*' } = p;
	if (!delegateId) return { skipped: 'delegasi_karyawan_id_kosong' };
	if (Number(delegateId) === Number(karyawanId)) return { skipped: 'delegate_sama_dengan_pemohon' };
	if (!startDate || !endDate) return { skipped: 'rentang_tanggal_tidak_lengkap' };

	try {
		const created = await directusServerJson('/items/approval_delegations', {
			method: 'POST',
			body: JSON.stringify({
				from_user: Number(karyawanId),
				to_user: Number(delegateId),
				module_key: moduleKey,
				start_date: startDate,
				end_date: endDate,
				is_active: true
			})
		});
		return { created: (created as { data?: unknown })?.data };
	} catch (e) {
		console.warn('[autoDelegation] gagal membuat delegasi otomatis:', e instanceof Error ? e.message : e);
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
