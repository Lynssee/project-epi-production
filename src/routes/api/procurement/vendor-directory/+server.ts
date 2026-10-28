// src/routes/api/procurement/vendor-directory/+server.ts
// Vendor Wajib Terdaftar & Identitas Lengkap — Fase 7 (Dashboard Lapangan B1).
// Direktori vendor terdaftar untuk tim lapangan — "sebelum melarang belanja di
// toko tak terdaftar, beri dulu daftar toko terdaftar."
//
//   GET /api/procurement/vendor-directory?q=&kota=&bidang=
//     -> { data: [{ id, nama, kota, telp, kategori, bidang_usaha, identitas_lengkap }] }
//
// Lewat token server (admin) — master_supplier belum tentu terbaca peran lapangan.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const q = (event.url.searchParams.get('q') || '').trim();
	const kota = (event.url.searchParams.get('kota') || '').trim();
	const bidang = (event.url.searchParams.get('bidang') || '').trim();

	const and: any[] = [{ status: { _eq: 'aktif' } }, { is_duplicate_of: { _null: true } }];
	if (q) and.push({ _or: [{ nama: { _icontains: q } }, { kategori: { _icontains: q } }] });
	if (kota) and.push({ kota: { _icontains: kota } });
	if (bidang) and.push({ bidang_usaha: { _icontains: bidang } });

	const baseFields = 'id,nama,kota,provinsi,telp,kategori,tipe_mitra,bidang_usaha';
	const qs = new URLSearchParams({
		filter: JSON.stringify({ _and: and }),
		sort: 'nama',
		limit: '60'
	});

	// coba dengan identitas_lengkap; fallback tanpa (kolom mungkin belum di-apply)
	let res = await directusServerJson<{ data: any[] }>(
		`/items/master_supplier?fields=${baseFields},identitas_lengkap&${qs.toString()}`
	).catch(() => null);
	if (!res) {
		res = await directusServerJson<{ data: any[] }>(
			`/items/master_supplier?fields=${baseFields}&${qs.toString()}`
		).catch(() => ({ data: [] }));
	}

	const data = (res?.data || []).map((r) => ({
		id: r.id,
		nama: r.nama || '',
		kota: r.kota || r.provinsi || '',
		telp: r.telp || '',
		kategori: r.kategori || r.tipe_mitra || '',
		bidang_usaha: Array.isArray(r.bidang_usaha) ? r.bidang_usaha : [],
		identitas_lengkap: r.identitas_lengkap ?? null
	}));
	return json({ data });
}
