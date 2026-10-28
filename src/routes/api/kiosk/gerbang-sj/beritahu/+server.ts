// src/routes/api/kiosk/gerbang-sj/beritahu/+server.ts
// SJH-13 — satpam menekan "Kirim pemberitahuan" saat SJ belum boleh lewat: notifikasi in-app ke
// pihak yang harus bertindak (admin logistik / approver / gudang). Anti-spam: sekali per SJ per
// pihak per 15 menit. Guard: sesi kiosk. Tidak mengubah status SJ.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { directusServerJson } from '$lib/server/directus';

const WHO_DEPT: Record<string, string> = {
	'Admin Logistik': 'logistik',
	'Approver SJ': 'logistik',
	'Gudang / QC': 'logistik'
};
const COOLDOWN_MS = 15 * 60 * 1000;

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'gerbang_sj', 'Gerbang Satpam');
	const body = await event.request.json().catch(() => null);
	const sjId = Number(body?.sjId);
	const who = String(body?.who || '');
	if (!Number.isFinite(sjId) || sjId <= 0) throw error(400, 'sjId tidak valid.');
	if (!(who in WHO_DEPT)) throw error(400, 'Pihak tujuan tidak valid.');

	const sj = (await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}?fields=id,nomor_sj`).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');

	const title = `SJ ${sj.nomor_sj} tertahan di gerbang — butuh ${who}`;
	const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
	const dup = await directusServerJson<{ data: any[] }>(
		`/items/app_notifications?filter[type][_eq]=surat_jalan&filter[title][_eq]=${encodeURIComponent(title)}` +
		`&filter[created_at][_gte]=${encodeURIComponent(since)}&fields=id&limit=1`
	).catch(() => ({ data: [] as any[] }));
	if (dup?.data?.length) return json({ success: true, already_sent: true });

	await directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'surat_jalan',
			title,
			message: `Satpam (${session.nama}) tidak bisa meloloskan SJ ini. Mohon segera ditindaklanjuti agar truk tidak menunggu.`,
			priority: 'high',
			department: WHO_DEPT[who],
			read: false,
			action_url: '/inventory/keluar-masuk?tab=surat_jalan',
			created_at: new Date().toISOString()
		})
	}).catch((e) => {
		console.error('[gerbang-sj/beritahu] gagal kirim notifikasi:', e instanceof Error ? e.message : e);
		throw error(502, 'Notifikasi gagal terkirim. Hubungi langsung lewat telepon.');
	});

	return json({ success: true });
};
