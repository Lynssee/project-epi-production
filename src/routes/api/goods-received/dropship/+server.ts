// src/routes/api/goods-received/dropship/+server.ts
// Daftar READ-ONLY PO drop-ship yang sedang menuju site proyek (dikirim supplier langsung, tanpa Surat Jalan gudang).
// Scope sama dengan /api/goods-received/list: Project Leader hanya melihat proyek yang ia pimpin; Admin melihat semua.
// Query dipisah per koleksi (aturan #2). Tidak ada penulisan — penerimaan dicatat Admin lewat penerimaan PO di ERP.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGRActor } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';
import { buildDropshipOrders } from '$lib/server/goodsReceived/dropshipOrders';

const CHUNK = 150;

async function readIn<T>(collection: string, field: string, ids: number[], extra: Record<string, unknown>, fields: string): Promise<T[]> {
	const out: T[] = [];
	for (let i = 0; i < ids.length; i += CHUNK) {
		const query = new URLSearchParams({
			filter: JSON.stringify({ ...extra, [field]: { _in: ids.slice(i, i + CHUNK) } }),
			fields,
			limit: '-1'
		});
		const res = await directusServerJson<{ data: T[] }>(`/items/${collection}?${query.toString()}`);
		out.push(...(res?.data || []));
	}
	return out;
}

export const GET: RequestHandler = async (event) => {
	const { projectIds } = await authenticateGRActor(event);
	if (projectIds !== null && projectIds.length === 0) return json({ orders: [] });

	const prFilter: Record<string, unknown> = {
		metode_pengadaan: { _eq: 'drop_ship' },
		status: { _nin: ['Rejected', 'Cancelled', 'Draft'] },
		project_id: projectIds === null ? { _nnull: true } : { _in: projectIds }
	};
	const prRes = await directusServerJson<{ data: any[] }>(
		`/items/pengajuan?${new URLSearchParams({ filter: JSON.stringify(prFilter), fields: 'id,project_id', limit: '-1' }).toString()}`
	);
	const prs = prRes?.data || [];
	if (!prs.length) return json({ orders: [] });

	const pos = await readIn<any>(
		'purchase_orders_supplier',
		'pengajuan_id',
		prs.map((p) => p.id),
		{ status: { _in: ['sent', 'partial_received'] } },
		'id,po_number,pengajuan_id,status,supplier_name,delivery_date'
	);
	if (!pos.length) return json({ orders: [] });
	const items = await readIn<any>('purchase_order_supplier_items', 'po_id', pos.map((p) => p.id), {}, 'id,po_id,item_name,quantity,received_qty,unit');

	const projectIdsInvolved = [...new Set(prs.map((p) => Number(p.project_id?.id ?? p.project_id)).filter(Boolean))];
	const projects = await readIn<any>('projects', 'id', projectIdsInvolved, {}, 'id,name');
	const projectNameById = new Map<number, string>(projects.map((p) => [p.id, p.name]));

	return json({ orders: buildDropshipOrders({ prs, pos, items, projectNameById }) });
};
