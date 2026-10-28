// src/lib/server/atasNamaNotify.ts
// SERVER-ONLY. Minta admin erp-epi memberi tahu pemohon (WA dari master karyawan + in-app) untuk
// pengajuan atas nama. Best-effort: kegagalan TIDAK menggagalkan pengajuan (pemohon tetap melihat
// kartu "Perlu konfirmasi Anda" di Pusat Pengajuan, dan admin punya watchdog pengingat 30 menit).

import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function notifyPemohonViaAdmin(event: RequestEvent, jenis: 'anggaran' | 'pr', pengajuanId: number | string): Promise<boolean> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		console.warn('[atasNamaNotify] ERP_EPI1_BASE_URL kosong — notifikasi pemohon dilewati.');
		return false;
	}
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan-anggaran/notify-pemohon`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: event.request.headers.get('authorization') || '' },
			body: JSON.stringify({ jenis, pengajuanId }),
			signal: AbortSignal.timeout(15000)
		});
		if (!res.ok) console.warn('[atasNamaNotify] admin menolak notifikasi pemohon:', res.status);
		return res.ok;
	} catch (e: any) {
		console.warn('[atasNamaNotify] gagal menghubungi admin:', e?.message);
		return false;
	}
}
