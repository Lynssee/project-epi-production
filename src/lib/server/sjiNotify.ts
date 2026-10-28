// src/lib/server/sjiNotify.ts
// Fase 4 (Rencana-Implementasi-SJ-Internal-v2-manual.md): notifikasi WA SJI, dikirim via relay
// generik erp-epi-1 (/api/automation/wa-notify) — pola identik ess/lemburNotify.ts, karena
// FONNTE_TOKEN hanya ada di env erp-epi-1.
//
// SENGAJA NON-AKTIF secara default: dikunci di belakang setelan inventory.sji.notif_wa_enabled
// (default false, lihat system_settings) sampai pesan & nomor tujuan divalidasi manual —
// keputusan eksplisit user saat Fase 4 dimulai, jangan aktifkan tanpa konfirmasi ulang.
//
// Gagal kirim TIDAK BOLEH menggagalkan alur create/approve/reject SJI — fail-soft (log warning saja).

import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';

async function isWaNotifEnabled(): Promise<boolean> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=inventory.sji.notif_wa_enabled&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		return raw != null ? JSON.parse(raw) === true : false;
	} catch {
		return false;
	}
}

// Fase 6 (Notifikasi Terpusat v2, rollout): relay lewat notif-dispatch (bukan wa-notify polos)
// supaya event ini tercatat di notification_log erp-epi-1 & tunduk kill-switch
// notification_settings. eventType 'sji_submitted' terdaftar di registry.js erp-epi-1.
async function relayNotifyDispatch(eventType: string, waKaryawanIds: number[], message: string): Promise<void> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[sjiNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi WA dilewati.');
		return;
	}
	try {
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, eventType, waKaryawanIds, message })
		});
	} catch (e) {
		console.warn('[sjiNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
	}
}

/** Resolusi target approver sesuai inventory.sji.approver_mode (Q14, informasi saja — TIDAK
 * enforced/blokir siapa yang boleh klik Setujui di admin, hanya menentukan siapa yang di-WA).
 * - 'gudang': gudang.pic_karyawan_ids milik lokasi SJI ini (bisa >1 orang)
 * - 'atasan_langsung' / fallback: atasan_id langsung pemohon
 * - 'role': tidak ada target spesifik (siapapun dg izin) -> kembalikan [] */
async function resolveApproverIds(karyawanId: number, gudangId: number | null): Promise<number[]> {
	const modeRes = await directusServerJson<{ data: any[] }>(
		`/items/system_settings?filter[setting_key][_eq]=inventory.sji.approver_mode&limit=1`
	);
	let mode = 'atasan_langsung';
	try {
		mode = JSON.parse(modeRes?.data?.[0]?.setting_value || '"atasan_langsung"');
	} catch {
		/* pakai default */
	}

	if (mode === 'gudang' && gudangId) {
		const res = await directusServerJson<{ data: { pic_karyawan_ids: number[] | null } }>(
			`/items/gudang/${gudangId}?fields=pic_karyawan_ids`
		);
		const ids = res?.data?.pic_karyawan_ids;
		if (Array.isArray(ids) && ids.length > 0) return ids;
		return []; // gudang belum ada PIC-nya -> tidak ada yang di-WA, bukan error
	}

	if (mode === 'role') return [];

	const res = await directusServerJson<{ data: { atasan_id: number | null } }>(
		`/items/karyawan/${karyawanId}?fields=atasan_id`
	);
	return res?.data?.atasan_id ? [res.data.atasan_id] : [];
}

// Catatan: notifikasi disetujui/ditolak SENGAJA tidak ada di sini — keputusan approve/reject
// terjadi di admin (erp-epi-1), yang sudah punya FONNTE_TOKEN sendiri (lihat
// erp-epi-1/src/routes/api/sji/notify-decision/+server.js), jadi tidak perlu lompat relay
// balik ke project-epi untuk itu.

export async function notifySjiSubmitted(
	karyawanId: number,
	karyawanNama: string,
	referenceNo: string,
	gudangId: number | null = null
): Promise<void> {
	if (!(await isWaNotifEnabled())) return;
	try {
		const approverIds = await resolveApproverIds(karyawanId, gudangId);
		if (approverIds.length === 0) return;
		const message = `SJI baru dari ${karyawanNama}: ${referenceNo}, perlu approval Anda di ERP.`;
		await relayNotifyDispatch('sji_submitted', approverIds, message);
	} catch (e) {
		console.warn('[sjiNotify] Gagal resolve/kirim notifikasi pengajuan:', e);
	}
}
