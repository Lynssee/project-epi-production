// src/routes/api/packing-list/set-rules/+server.ts
// Aturan Set Produk (Cat↔Thinner) untuk pemilih produk di Kalkulator Cat lapangan + Set Equipment untuk saran aksesoris di SJI (Rencana Product Pairing, Fase 3). Hanya baca; cache server 5 menit.
// Gagal => success:false (kalkulator tetap berfungsi manual tanpa pemilih).
//   GET
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { loadFieldSetRules } from '$lib/server/plSetFieldLoader';

export async function GET(event: RequestEvent) {
	await requireUser(event);
	try {
		const r = await loadFieldSetRules(directusServerJson as any);
		return json({ success: true, product: r.product.filter((x: any) => x.active !== false), equipment: r.equipment.filter((x: any) => x.active !== false) });
	} catch (e: any) {
		console.error('[packing-list/set-rules] gagal:', e?.message || e);
		return json({ success: false, error: 'Gagal memuat aturan pasangan thinner' }, { status: 500 });
	}
}
