// src/routes/api/kiosk/gudang/opname/cari/+server.ts
// Cari item untuk opname dari Kiosk Gudang: ?q=<nama/kode>. Guard: sesi kiosk.
// Fase 3, rencana "Penajaman Kiosk Inventory" (8 Sep 2026).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import {
	searchItemsForOpname,
	getOpnameRecommendations,
	getItemsOnRackForOpname,
	readGudangHqGate
} from '$lib/server/kioskGudang';
import { anotasiBlindKiosk } from '$lib/server/opnameSesi';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const q = (event.url.searchParams.get('q') || '').trim();
	const gudangId = Number(event.url.searchParams.get('gudang_id'));
	const isRekomendasi = event.url.searchParams.get('rekomendasi') === '1' || (!q && !gudangId);

	const gate = await readGudangHqGate();
	const gateInfo = {
		toleransi_pct: gate.opname_toleransi_pct,
		wajib_approval: gate.opname_wajib_approval
	};

	if (Number.isFinite(gudangId) && gudangId > 0) {
		const rackData = await getItemsOnRackForOpname(gudangId);
		return json({
			type: 'rack',
			rack: rackData.rack,
			items: await anotasiBlindKiosk(rackData.items, gudangId),
			gate: gateInfo
		});
	}

	if (isRekomendasi) {
		const items = await getOpnameRecommendations(15);
		return json({
			type: 'rekomendasi',
			items: await anotasiBlindKiosk(items, null),
			gate: gateInfo
		});
	}

	if (q.length < 1) {
		return json({ type: 'search', q, items: [], gate: gateInfo });
	}

	const items = await searchItemsForOpname(q);
	return json({
		type: 'search',
		q,
		items: await anotasiBlindKiosk(items, null),
		gate: gateInfo
	});
};
