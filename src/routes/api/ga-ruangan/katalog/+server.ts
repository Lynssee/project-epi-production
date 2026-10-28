import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

/**
 * Pencarian katalog barang untuk form sensus (Barang per Ruangan via QR Patroli, Fase 3).
 * identitas_barang.parent_category: 134=perabotan, 138=elektronik, 133=peralatan.
 * READ-ONLY.
 */
const KATEGORI_MAP: Record<string, number> = { perabotan: 134, elektronik: 138, peralatan: 133 };

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const q = (event.url.searchParams.get('q') || '').trim();
	const kategori = event.url.searchParams.get('kategori') || '';
	const parts: string[] = ['fields=id,nama_barang_lengkap,parent_category', 'limit=20', 'sort=nama_barang_lengkap'];
	if (q) parts.push(`filter[nama_barang_lengkap][_icontains]=${encodeURIComponent(q)}`);
	const catId = KATEGORI_MAP[kategori];
	if (catId) parts.push(`filter[parent_category][_eq]=${catId}`);
	else parts.push(`filter[parent_category][_in]=133,134,138`);

	const res = await directusServerJson<{ data: any[] }>(`/items/identitas_barang?${parts.join('&')}`);
	const CAT_LABEL: Record<number, string> = { 134: 'perabotan', 138: 'elektronik', 133: 'peralatan' };
	const hasil = (res?.data || []).map((r) => ({
		id: r.id,
		nama: r.nama_barang_lengkap ?? `#${r.id}`,
		kategori: CAT_LABEL[r.parent_category] ?? 'lainnya'
	}));
	return json({ hasil });
};
