// src/routes/api/kiosk/gudang/transfer/+server.ts
// Transfer antar gudang dari Kiosk Gudang. Guard: sesi kiosk (badge). F4-C, Briefing Gate Dua Tingkat (21 Sep 2026).
//   GET                    → { rows }            daftar transfer aktif + 7 hari terakhir, dengan flag aksi per orang
//   GET ?rak_di=<gudangId> → { rak }             rak/zona konkret di bawah gudang (untuk pilih/scan rak tujuan)
//   GET ?gudang=1          → { gudang }          gudang utama/produksi (pilihan tujuan)
//   POST { toGudangId, notes?, items:[{item_id, quantity, from_rak_id}] } → ajukan (draft, stok belum bergerak)

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { ajukanTransfer, listRakUnder, listTransfersForKiosk, KioskTransferError } from '$lib/server/kioskTransfer';
import { listTerminalGudang } from '$lib/server/kioskProfil';

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const rakDi = Number(event.url.searchParams.get('rak_di'));
	if (Number.isFinite(rakDi) && rakDi > 0) return json({ rak: await listRakUnder(rakDi) });
	if (event.url.searchParams.get('gudang')) {
		const opts = await listTerminalGudang();
		return json({ gudang: opts.map(({ id, nama, jenis }) => ({ id, nama, jenis })) });
	}
	return json({ rows: await listTransfersForKiosk(session.karyawanId), karyawanId: session.karyawanId });
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'gudang_transfer', 'Transfer Antar Gudang');
	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body tidak valid.');
	try {
		const data = await ajukanTransfer(session.karyawanId, {
			toGudangId: Number(body.toGudangId),
			notes: body.notes ? String(body.notes).slice(0, 500) : null,
			items: Array.isArray(body.items)
				? body.items.map((i: any) => ({ item_id: Number(i.item_id), quantity: Number(i.quantity), from_rak_id: Number(i.from_rak_id) }))
				: []
		});
		return json({ ok: true, data });
	} catch (e) {
		if (e instanceof KioskTransferError) throw error(e.status, e.message);
		throw e;
	}
};
