import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { getGaAsetSettings } from '$lib/server/gaAsetSettings';

/**
 * Daftar semua ruangan untuk /ruangan (Barang per Ruangan via QR Patroli, Fase 2).
 * Relasi DIPISAH per query (Aturan #2); agregat count/max di sisi Directus agar
 * payload kecil. READ-ONLY.
 */
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const settings = await getGaAsetSettings();
	const intervalMs = settings.intervalCekHari * 86_400_000;

	const [areaRes, zoneRes, locRes, countRes, cpRes, checkRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(`/items/ga_areas?fields=id,area_name,zone_id&sort=area_name&limit=-1`),
		directusServerJson<{ data: any[] }>(`/items/ga_zones?fields=id,zone_name,location_id&limit=-1`),
		directusServerJson<{ data: any[] }>(`/items/ga_locations?fields=id,location_name&limit=-1`),
		directusServerJson<{ data: any[] }>(
			`/items/ga_asset?groupBy=area_id&aggregate[count]=id&filter[status][_neq]=disposal&limit=-1`
		).catch((e) => {
			console.error('[ga-ruangan] gagal agregat count barang:', e);
			return { data: [] };
		}),
		directusServerJson<{ data: any[] }>(
			`/items/security_checkpoint?filter[status][_eq]=active&fields=area_id&limit=-1`
		),
		directusServerJson<{ data: any[] }>(
			`/items/ga_room_check?groupBy=area_id&aggregate[max]=waktu&limit=-1`
		).catch((e) => {
			console.error('[ga-ruangan] gagal agregat cek terakhir:', e);
			return { data: [] };
		})
	]);

	const zoneById = new Map((zoneRes?.data || []).map((z) => [z.id, z]));
	const locById = new Map((locRes?.data || []).map((l) => [l.id, l]));
	const countByArea = new Map(
		(countRes?.data || []).map((r) => [Number(r.area_id), Number(r.count?.id ?? r.count ?? 0)])
	);
	const cpAreas = new Set((cpRes?.data || []).map((c) => Number(c.area_id)).filter(Boolean));
	const lastCheckByArea = new Map(
		(checkRes?.data || []).map((r) => [Number(r.area_id), r.max?.waktu ?? r.waktu ?? null])
	);

	const now = Date.now();
	const ruangan = (areaRes?.data || []).map((a) => {
		const zone = a.zone_id != null ? zoneById.get(a.zone_id) : null;
		const loc = zone && zone.location_id != null ? locById.get(zone.location_id) : null;
		const lastCheck = lastCheckByArea.get(Number(a.id));
		const jumlah = countByArea.get(Number(a.id)) ?? 0;
		const perluDicek = jumlah > 0 && (!lastCheck || now - new Date(lastCheck).getTime() > intervalMs);
		return {
			area_id: a.id,
			area_name: a.area_name ?? `Ruangan #${a.id}`,
			zone_name: zone?.zone_name ?? null,
			location_name: loc?.location_name ?? null,
			jumlah_barang: jumlah,
			perlu_dicek: perluDicek,
			punya_qr: cpAreas.has(Number(a.id))
		};
	});

	return json({ ruangan });
};
