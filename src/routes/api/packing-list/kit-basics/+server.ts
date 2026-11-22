// src/routes/api/packing-list/kit-basics/+server.ts
// Bahan Kit Standar + aturan Set Produk/Equipment untuk form Packing List lapangan (Rencana Keyakinan PL Fase 2 + Product Pairing Fase 3):
// kit yang berlaku untuk jenis pekerjaan proyek, aturan pasangan cat↔thinner & alat↔aksesoris, dan nama barang yang sudah dikomit/ada di site.
// Satu panggilan per proyek; form mengevaluasi sendiri di browser. Hanya baca & informatif. Gagal => success:false (form tetap berfungsi tanpa kartu).
//   GET ?project_id=123
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { loadFieldKit } from '$lib/server/plKitFieldLoader';
import { loadFieldSetRules } from '$lib/server/plSetFieldLoader';

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const projectId = event.url.searchParams.get('project_id');
	if (!projectId || !/^\d+$/.test(projectId)) return json({ success: false, error: 'project_id wajib (angka)' }, { status: 400 });
	try {
		const [k, set_rules] = await Promise.all([
			loadFieldKit(projectId, directusServerJson as any, { alwaysSources: true }),
			loadFieldSetRules(directusServerJson as any)
		]);
		return json({ success: true, ...k, set_rules });
	} catch (e: any) {
		console.error(`[packing-list/kit-basics] proyek ${projectId} gagal:`, e?.message || e);
		return json({ success: false, error: 'Gagal memuat bahan kit standar' }, { status: 500 });
	}
}
