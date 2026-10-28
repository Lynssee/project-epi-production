// src/routes/api/packing-list/customer-material-hint/+server.ts
// Grand PO Fase 6 (rencana §5.2) — hint SHADOW: PL proyek memuat produk yang JUGA ada di PO material customer
// (saudara dalam Grand PO). Tidak pernah memblokir & tidak mengubah status gate apa pun; hanya mengembalikan
// daftar kecocokan untuk ditampilkan sebagai catatan di modal konfirmasi. Tiap kecocokan dicatat di log server
// (tag [shadow][G_PKL_CUSTOMER_MATERIAL]) untuk kalibrasi ≥14 hari sebelum ada keputusan menaikkan mode.
//   POST { projectId, names: string[] } -> { mode: 'shadow', hits: [{ material_name, produk_po, unit }] }
// Bukan pemegang proyek → hits kosong (bukan error): hint tidak boleh membocorkan data proyek lain.

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveFieldProjectScope } from '$lib/server/fieldProjectScope';
import { loadGrandPoLapangan } from '$lib/server/grandPoLapangan';
import { matchCustomerMaterial } from '$lib/utils/grandPoLapangan';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const body = await event.request.json().catch(() => ({}) as any);
	const projectId = Number(body?.projectId);
	const names: string[] = Array.isArray(body?.names) ? body.names.map((n: any) => String(n || '')).filter(Boolean).slice(0, 100) : [];
	if (!Number.isInteger(projectId) || projectId <= 0) return json({ error: 'projectId tidak valid' }, { status: 400 });
	if (names.length === 0) return json({ mode: 'shadow', hits: [] });

	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const scope = await resolveFieldProjectScope(idToken, user.localId, user.email);
	if (!scope.unrestricted && !scope.projectIds.includes(projectId)) return json({ mode: 'shadow', hits: [] });

	let hits: ReturnType<typeof matchCustomerMaterial> = [];
	try {
		const data = await loadGrandPoLapangan(projectId);
		hits = matchCustomerMaterial(names, data.pilihan_produk);
	} catch (e) {
		console.error('[packing-list/customer-material-hint] gagal (hint dilewati):', (e as Error)?.message);
		return json({ mode: 'shadow', hits: [], unavailable: true });
	}
	if (hits.length) {
		console.info('[shadow][G_PKL_CUSTOMER_MATERIAL]', JSON.stringify({ projectId, uid: user.localId, hits: hits.map((h) => `${h.material_name} ~ ${h.produk_po}`) }));
	}
	return json({ mode: 'shadow', hits }, { headers: { 'Cache-Control': 'no-store' } });
};
