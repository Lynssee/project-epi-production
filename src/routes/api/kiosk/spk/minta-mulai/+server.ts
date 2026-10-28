// src/routes/api/kiosk/spk/minta-mulai/+server.ts
// File 03 §3.4 — SPK yang belum "Mulai Produksi" (status worksheet_generated/waiting_for_stock)
// tidak bisa diisi dari kiosk (bahan belum dipotong dari stok). Endpoint ini HANYA mengirim
// notifikasi WA ke supervisor supaya mereka menekan "Mulai Produksi" di dashboard — TIDAK
// memotong stok atau mengubah status SPK dari sini (Keputusan Lead: opsi b).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { isRateLimited } from '$lib/server/rateLimit';
import { notifyKioskAndon } from '$lib/server/kioskAndonNotify';
import { resolveSupervisorPenerima } from '$lib/server/kioskSupervisor';

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const body = await event.request.json().catch(() => ({}));
	const sid = Number(body?.spkId);
	if (!Number.isInteger(sid) || sid <= 0) throw error(400, 'SPK tidak valid.');

	const spk = (await directusServerJson<{ data: any }>(`/items/spk/${sid}?fields=id,nomor,status`).catch((e) => {
		console.error('[kiosk/spk/minta-mulai] Gagal memuat SPK', sid, e);
		throw error(502, 'Gagal memuat data SPK. Coba lagi.');
	}))?.data;
	if (!spk) throw error(404, 'SPK tidak ditemukan.');
	if (spk.status === 'in_progress') return json({ success: true, alreadyStarted: true });

	// Anti-spam: satu permintaan per SPK per 10 menit.
	if (isRateLimited(`kiosk-minta-mulai:${sid}`, { windowMs: 10 * 60_000, max: 1 })) {
		return json({ success: true, throttled: true });
	}

	const { waKaryawanIds } = await resolveSupervisorPenerima();
	if (waKaryawanIds.length === 0) {
		throw error(422, 'Belum ada supervisor terdaftar untuk dihubungi. Hubungi supervisor langsung.');
	}

	const sent = await notifyKioskAndon({
		eventType: 'kiosk_spk_start_request',
		message: `${session.nama} minta SPK ${spk.nomor} dimulai (bahan disiapkan) dari Kiosk Produksi.`,
		waKaryawanIds,
		karyawanId: session.karyawanId,
		sourceId: sid,
		actionUrl: `/production?tab=spk&highlight=${sid}`
	});
	if (!sent) throw error(502, 'Gagal mengirim permintaan ke server notifikasi. Coba lagi.');

	return json({ success: true });
};
