// src/routes/api/kiosk/gudang/transfer/[id]/[action]/+server.ts
// Aksi atas satu transfer: approve | reject | receive | cancel. Diteruskan ke ERP (satu-satunya penulis stok);
// hak bertindak (PIC gudang) diverifikasi ERP. F4-C, Briefing Gate Dua Tingkat (21 Sep 2026).
//   reject  { reason }
//   receive { lines:[{ id, received_quantity, to_rak_id?, selisih_alasan? }] }

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { setujuiTransfer, tolakTransfer, terimaTransfer, batalkanTransfer, KioskTransferError } from '$lib/server/kioskTransfer';

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const transferId = Number(event.params.id);
	if (!Number.isFinite(transferId) || transferId <= 0) throw error(400, 'ID transfer tidak valid.');
	const body = (await event.request.json().catch(() => ({}))) as any;

	try {
		let data;
		switch (event.params.action) {
			case 'approve':
				data = await setujuiTransfer(session.karyawanId, transferId);
				break;
			case 'reject':
				data = await tolakTransfer(session.karyawanId, transferId, String(body.reason || ''));
				break;
			case 'cancel':
				data = await batalkanTransfer(session.karyawanId, transferId);
				break;
			case 'receive': {
				const lines = Array.isArray(body.lines)
					? body.lines.map((l: any) => ({
							id: Number(l.id),
							received_quantity: Number(l.received_quantity),
							to_rak_id: l.to_rak_id ? Number(l.to_rak_id) : null,
							selisih_alasan: l.selisih_alasan ? String(l.selisih_alasan).slice(0, 300) : null
						}))
					: [];
				data = await terimaTransfer(session.karyawanId, transferId, lines);
				break;
			}
			default:
				throw error(404, 'Aksi tidak dikenal.');
		}
		return json({ ok: true, data });
	} catch (e) {
		if (e instanceof KioskTransferError) throw error(e.status, e.message);
		throw e;
	}
};
