import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

/**
 * B1 — "barang ini ada di ruangan mana" (Barang per Ruangan via QR Patroli, Fase 2).
 * Cari nama barang di ga_asset, kembalikan ruangannya. READ-ONLY.
 */
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const q = (event.url.searchParams.get('q') || '').trim();
	if (q.length < 2) throw error(400, 'Ketik minimal 2 huruf.');

	const assetRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_asset?filter[nama][_icontains]=${encodeURIComponent(q)}&filter[status][_neq]=disposal&filter[area_id][_nnull]=true&fields=area_id,nama,kategori,qty,kondisi&sort=nama&limit=50`
	);
	const rows = assetRes?.data || [];
	const areaIds = [...new Set(rows.map((r) => r.area_id).filter(Boolean))];

	let areaName = new Map<number, string>();
	if (areaIds.length) {
		const areaRes = await directusServerJson<{ data: any[] }>(
			`/items/ga_areas?filter[id][_in]=${areaIds.join(',')}&fields=id,area_name&limit=-1`
		);
		areaName = new Map((areaRes?.data || []).map((a) => [a.id, a.area_name ?? `Ruangan #${a.id}`]));
	}

	const hasil = rows.map((r) => ({
		area_id: r.area_id,
		area_name: areaName.get(r.area_id) ?? `Ruangan #${r.area_id}`,
		nama: r.nama ?? '(tanpa nama)',
		kategori: r.kategori ?? 'lainnya',
		qty: Number.isFinite(r.qty) ? r.qty : (r.qty ?? 1),
		kondisi: r.kondisi ?? 'baik'
	}));

	return json({ hasil });
};
