// src/routes/api/inventory-proyek/rebuild-balance/+server.ts
// F2 (Rencana Implementasi Inventory arsitektur navigasi v2.0): trigger on-demand untuk
// rebuildProjectStockBalance(), dipanggil dari widget "Stok Proyek" di halaman opname pilot.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';
import { rebuildProjectStockBalance } from '$lib/server/projectLedger';

export const POST: RequestHandler = async (event) => {
	const { projectIds } = await authenticateProjectLeader(event);
	const body = await event.request.json().catch(() => ({}));
	const projectId = Number(body?.projectId);
	if (!Number.isFinite(projectId)) throw error(400, 'projectId tidak valid.');
	if (!projectIds.includes(projectId)) throw error(403, 'Anda bukan leader proyek ini.');

	try {
		const result = await rebuildProjectStockBalance({ projectId });
		return json({ success: true, ...result });
	} catch (e: any) {
		throw error(500, e?.message || 'Gagal rebuild stok proyek.');
	}
};
