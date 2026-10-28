// src/lib/server/sjManualNotify.ts
// Fase 4 (Penajaman Surat Jalan Manual): notifikasi WA ke approver saat pengajuan,
// dikirim via relay generik erp-epi-1 (/api/automation/wa-notify) — pola identik
// sjiNotify.ts, karena FONNTE_TOKEN hanya ada di env erp-epi-1.
//
// SENGAJA NON-AKTIF secara default: dikunci di belakang konfigurasi_surat_jalan
// .kanal_notifikasi.sj_manual_submitted (default kosong/absen) sampai pesan & nomor
// tujuan divalidasi manual — konsisten dengan pola sjiNotify.ts (notif_wa_enabled
// default false), jangan aktifkan tanpa konfirmasi ulang.
//
// Gagal kirim TIDAK BOLEH menggagalkan alur submit/resubmit — fail-soft (log warning saja).

import { env } from '$env/dynamic/private';
import { directusServerJson } from './directus';

async function isWaNotifEnabled(): Promise<boolean> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/konfigurasi_surat_jalan?sort=-berlaku_dari&limit=1&fields=kanal_notifikasi`
		);
		const kanal = res?.data?.[0]?.kanal_notifikasi?.sj_manual_submitted;
		return Array.isArray(kanal) && kanal.includes('wa');
	} catch {
		return false;
	}
}

// Fase 6 (Notifikasi Terpusat v2, rollout): relay lewat notif-dispatch (bukan wa-notify polos)
// supaya event ini tercatat di notification_log erp-epi-1 & tunduk kill-switch
// notification_settings. eventType 'sj_manual_submitted' terdaftar di registry.js erp-epi-1.
async function relayNotifyDispatch(eventType: string, waKaryawanIds: number[], message: string): Promise<void> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[sjManualNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi WA dilewati.');
		return;
	}
	try {
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, eventType, waKaryawanIds, message })
		});
	} catch (e) {
		console.warn('[sjManualNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
	}
}

/**
 * Approver = karyawan aktif yang cocok dengan baris approval_matrix aktif untuk
 * module_key logistik.surat_jalan_manual (jabatan_id sama, + divisi sama bila scope
 * own_dept). Sengaja query langsung (bukan reuse resolveApproversWithData admin,
 * yang ada di repo lain) — daftarnya kecil (1 baris matrix per Fase 1), brute force cukup.
 */
async function resolveApproverIds(requesterDivisi: string | null): Promise<number[]> {
	const matrixRes = await directusServerJson<{ data: any[] }>(
		`/items/approval_matrix?filter[module_key][_eq]=logistik.surat_jalan_manual&filter[is_active][_eq]=true&fields=jabatan_id,department_key,scope`
	);
	const rows = matrixRes?.data || [];
	if (!rows.length) return [];

	const ids = new Set<number>();
	for (const row of rows) {
		const jabatanId = typeof row.jabatan_id === 'object' ? row.jabatan_id?.id : row.jabatan_id;
		if (!jabatanId) continue;

		const filterParts: any[] = [{ jabatan_id: { _eq: jabatanId } }, { status: { _eq: 'On' } }];
		if (row.scope === 'own_dept' && requesterDivisi) {
			filterParts.push({ divisi: { _eq: requesterDivisi } });
		} else if (row.department_key && row.department_key !== '*') {
			filterParts.push({ divisi: { _eq: row.department_key } });
		}

		const filter = encodeURIComponent(JSON.stringify({ _and: filterParts }));
		const kRes = await directusServerJson<{ data: any[] }>(`/items/karyawan?filter=${filter}&fields=id&limit=-1`);
		for (const k of kRes?.data || []) ids.add(k.id);
	}
	return [...ids];
}

export async function notifySjManualSubmitted(
	karyawanNama: string,
	requesterDivisi: string | null,
	nomorSj: string
): Promise<void> {
	if (!(await isWaNotifEnabled())) return;
	try {
		const approverIds = await resolveApproverIds(requesterDivisi);
		if (approverIds.length === 0) return;
		const message = `SJ Manual baru dari ${karyawanNama}: ${nomorSj}, perlu approval Anda di ERP.`;
		await relayNotifyDispatch('sj_manual_submitted', approverIds, message);
	} catch (e) {
		console.warn('[sjManualNotify] Gagal resolve/kirim notifikasi pengajuan:', e);
	}
}
