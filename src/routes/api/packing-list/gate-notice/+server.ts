// GET /api/packing-list/gate-notice — info gate PL untuk banner leader (hitung mundur ke tanggal gate berlaku).
// Hanya baca, cache 5 menit. Gagal tidak mengganggu halaman (banner sekadar tidak tampil).
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { readGateInfo } from '$lib/server/plGateNotice';

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const [inventoryLink, benahi] = await Promise.all([readGateInfo('G_PKL_INVENTORY_LINK'), readGateInfo('G_PKL_BENAHI_DATA')]);
	return json({ inventoryLink, benahi });
}
