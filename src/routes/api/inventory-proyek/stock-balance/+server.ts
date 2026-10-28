// src/routes/api/inventory-proyek/stock-balance/+server.ts
// F2 (Rencana Implementasi Inventory arsitektur navigasi v2.0): baca project_stock_balance
// untuk proyek yang dipimpin user (guard sama seperti endpoint opname lainnya).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	const { projectIds } = await authenticateProjectLeader(event);
	const projectId = Number(event.url.searchParams.get('projectId'));
	if (!Number.isFinite(projectId)) throw error(400, 'projectId tidak valid.');
	if (!projectIds.includes(projectId)) throw error(403, 'Anda bukan leader proyek ini.');

	const query = new URLSearchParams({
		filter: JSON.stringify({ project_id: { _eq: projectId } }),
		fields: 'id,item_id.id,item_id.nama_barang_lengkap,item_id.satuan,qty_received,qty_used,qty_lost,qty_returned,qty_on_hand,rab_qty,last_movement_date,last_rebuilt_at,status,ownership_type,owner_name',
		sort: 'item_id.nama_barang_lengkap',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/project_stock_balance?${query.toString()}`);
	return json({ rows: res?.data || [] });
};
