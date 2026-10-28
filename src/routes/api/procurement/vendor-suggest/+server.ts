// src/routes/api/procurement/vendor-suggest/+server.ts
// Vendor Wajib Terdaftar & Identitas Lengkap — Fase 2 (celah C4, sisi lapangan).
// Autocomplete opsional vendor terdaftar untuk form Beli Lokal.
//
//   GET /api/procurement/vendor-suggest?q=<teks>
//     -> { data: [{ id, nama, kode_supplier, identitas_lengkap }], threshold: number }
//
// Lewat token server (admin) — master_supplier dibuat erp-epi-1 & peran lapangan
// belum tentu punya izin baca.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

const DEFAULT_THRESHOLD = 1_000_000;

async function loadThreshold(): Promise<number> {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/app_settings?filter[module][_eq]=procurement` +
			`&filter[setting_key][_eq]=vendor_identitas.beli_lokal_threshold` +
			`&fields=setting_value&limit=1`
	).catch(() => null);
	const raw = res?.data?.[0]?.setting_value;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD;
}

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const q = (event.url.searchParams.get('q') || '').trim();
	const threshold = await loadThreshold();

	if (q.length < 2) return json({ data: [], threshold });

	// Kolom KIV mungkin belum ada (sebelum setup Fase 0 --apply) → coba dengan,
	// fallback tanpa. Aturan #1: kolom absen = Directus 403.
	const enc = encodeURIComponent(q);
	const filter =
		`&filter[status][_eq]=aktif&filter[is_duplicate_of][_null]=true` +
		`&filter[_or][0][nama][_icontains]=${enc}&filter[_or][1][kode_supplier][_icontains]=${enc}`;

	let res = await directusServerJson<{ data: any[] }>(
		`/items/master_supplier?fields=id,nama,kode_supplier,identitas_lengkap${filter}&sort=nama&limit=8`
	).catch(() => null);
	if (!res) {
		res = await directusServerJson<{ data: any[] }>(
			`/items/master_supplier?fields=id,nama,kode_supplier${filter}&sort=nama&limit=8`
		).catch(() => ({ data: [] }));
	}

	const data = (res?.data || []).map((r) => ({
		id: r.id,
		nama: r.nama || '',
		kode_supplier: r.kode_supplier || null,
		identitas_lengkap: r.identitas_lengkap ?? null
	}));
	return json({ data, threshold });
}
