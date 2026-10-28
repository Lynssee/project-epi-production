// src/routes/api/inventory-proyek/opname/items/+server.ts
// Daftar baris RAB proyek pilot yang sudah punya identitas_barang_id (siap diopname).
// Baris tanpa identitas_barang_id (jasa/OH/Ls, atau material belum dipetakan) sengaja
// tidak muncul di sini -- lihat blocker identitas item, Fase 0.7.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';
import { resolvePilotProjectIds, isPilotProject } from '$lib/server/inventorySettings';

export const GET: RequestHandler = async (event) => {
	const { projectIds } = await authenticateProjectLeader(event);
	const projectId = Number(event.url.searchParams.get('projectId'));

	if (!Number.isFinite(projectId)) throw error(400, 'projectId tidak valid.');
	const pilotIds = await resolvePilotProjectIds();
	if (!isPilotProject(pilotIds, projectId)) throw error(400, 'Proyek ini bukan pilot inventory.');
	if (!projectIds.includes(projectId)) throw error(403, 'Anda bukan leader proyek ini.');

	const query = new URLSearchParams({
		filter: JSON.stringify({ project_id: { _eq: projectId }, identitas_barang_id: { _nnull: true } }),
		fields: 'id,material_name,unit,qty,qty_sudah_diterima,identitas_barang_id',
		sort: 'material_name',
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/project_budgets?${query.toString()}`);
	const items = (res?.data || []).map((row) => ({
		project_budget_id: row.id,
		identitas_barang_id: row.identitas_barang_id,
		material_name: row.material_name || '-',
		unit: row.unit || '',
		rab_qty: Number(row.qty) || 0,
		qty_diterima: Number(row.qty_sudah_diterima) || 0
	}));

	return json({ items });
};
