// src/lib/server/ess/lemburNotify.ts
// P5: notifikasi WA lembur — dikirim LANGSUNG via Fonnte, lewat relay generik di erp-epi-1
// (/api/automation/wa-notify), karena FONNTE_TOKEN hanya ada di env erp-epi-1. Ini menggantikan
// webhook N8N_LEMBUR_WEBHOOK_URL lama yang sudah dead (0 workflow n8n menerimanya).
//
// Gagal kirim TIDAK BOLEH menggagalkan alur submit/approve/reject — semua di sini fail-soft
// (log warning saja), konsisten dengan pola webhook lama yang digantikan.

import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { resolveKepalaDivisiApprover } from '$lib/server/ess/divisi';
import type { LemburRecord } from '$lib/server/ess/lembur';

// Fase 6 (Notifikasi Terpusat v2, rollout): relay lewat notif-dispatch (bukan wa-notify polos)
// supaya event ini tercatat di notification_log erp-epi-1 & tunduk kill-switch
// notification_settings. Dikonfirmasi TIDAK dobel dgn essNotify.js sisi admin — submit lembur
// field (endpoint ini) dan submit manual admin adalah 2 endpoint terpisah, satu pengajuan
// hanya lewat salah satu. eventType submit reuse 'ess_lembur_submitted' yang sama dgn admin
// (event bisnis sama, resolusi penerima beda) — lihat catatan di registry.js.
async function relayNotifyDispatch(eventType: string, karyawanId: number | string, message: string): Promise<void> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[lemburNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi WA dilewati.');
		return;
	}
	try {
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, eventType, waKaryawanIds: [karyawanId], message })
		});
	} catch (e) {
		console.warn('[lemburNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
	}
}

type SubmittedTarget = Pick<LemburRecord, 'karyawan_id' | 'tanggal' | 'durasi_jam'>;

/** Penyetuju step-1: atasan_id langsung bila ada, else fallback kepala divisi (sama seperti
 * assertCanApproveLemburStep1) — supaya rute notifikasi konsisten dengan siapa yang boleh approve. */
async function resolveStep1ApproverKaryawanId(target: SubmittedTarget): Promise<number | null> {
	const query = new URLSearchParams({ fields: 'id,divisi,atasan_id' });
	const pemohon = await directusServerJson<{ data: { atasan_id: number | null; divisi: string | null } }>(
		`/items/karyawan/${target.karyawan_id}?${query.toString()}`
	);
	if (pemohon?.data?.atasan_id) return Number(pemohon.data.atasan_id);
	if (pemohon?.data?.divisi) return await resolveKepalaDivisiApprover(pemohon.data.divisi);
	return null;
}

export async function notifySubmitted(target: SubmittedTarget, karyawanNama: string): Promise<void> {
	try {
		const approverId = await resolveStep1ApproverKaryawanId(target);
		if (!approverId) return;
		const message = `Pengajuan lembur baru dari ${karyawanNama} tanggal ${target.tanggal} (${target.durasi_jam ?? '-'} jam) perlu approval Anda di ERP.`;
		await relayNotifyDispatch('ess_lembur_submitted', approverId, message);
	} catch (e) {
		console.warn('[lemburNotify] Gagal resolve/kirim notifikasi pengajuan:', e);
	}
}

export async function notifyApproved(target: LemburRecord, approverNama: string): Promise<void> {
	const message = `Pengajuan lembur Anda tanggal ${target.tanggal} telah DISETUJUI oleh ${approverNama}.`;
	await relayNotifyDispatch('ess_lembur_approved', target.karyawan_id, message);
}

export async function notifyRejected(target: LemburRecord, alasan: string, approverNama: string): Promise<void> {
	const message = `Pengajuan lembur Anda tanggal ${target.tanggal} DITOLAK oleh ${approverNama}. Alasan: ${alasan}`;
	await relayNotifyDispatch('ess_lembur_rejected', target.karyawan_id, message);
}
