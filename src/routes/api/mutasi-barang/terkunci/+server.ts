// src/routes/api/mutasi-barang/terkunci/+server.ts
// RSM-13 §4.2 — qty yang terkunci oleh mutasi (belum berangkat) per barang pada proyek yang dipimpin pemanggil.
// Dipakai form retur & Saldo Barang Saya supaya barang yang akan dimutasi tidak diretur/dipindah lagi.
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { authenticateProjectLeader } from '$lib/server/projectLeaderGuard';
import { getQtyTerkunciMutasi } from '$lib/server/mutasiQtyTerkunci';

export const GET: RequestHandler = async (event) => {
	const projectId = Number(event.url.searchParams.get('project_id'));
	if (!Number.isInteger(projectId) || projectId <= 0) throw error(400, 'project_id wajib diisi');
	await authenticateProjectLeader(event, projectId);
	const map = await getQtyTerkunciMutasi(projectId);
	return json({ terkunci: Object.fromEntries(map) });
};
