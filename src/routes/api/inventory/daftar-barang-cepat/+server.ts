// src/routes/api/inventory/daftar-barang-cepat/+server.ts
// Fase 0 Penajaman PR (24 Agu 2026, T1/Q1): katup "Ajukan Pendaftaran Barang Baru" di
// wizard PR lapangan — begitu tautan barang master jadi wajib untuk kategori INV*,
// pengaju butuh jalan keluar saat barang belum ada di identitas_barang. Salinan tipis
// dari erp-epi-1/src/routes/api/inventory/daftar-barang-cepat/+server.js (kedua app
// berbagi Directus yang sama). Baris dibuat perlu_verifikasi_pendaftaran=true, TANPA
// kode_item resmi — itu wewenang Inventory saat verifikasi (Fase 0 langkah 12).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const body = await event.request.json().catch(() => ({}));
	const namaBarang = (body.nama_barang_lengkap || '').trim();
	const satuan = (body.satuan || '').trim();
	const parentCategory = body.parent_category || null;

	if (!namaBarang) throw error(400, 'Nama barang wajib diisi');
	if (!satuan) throw error(400, 'Satuan wajib diisi');

	const existing: any = await directusServerJson(
		`/items/identitas_barang?filter[nama_barang_lengkap][_eq]=${encodeURIComponent(namaBarang)}&limit=1&fields=id,nama_barang_lengkap,satuan`
	).catch(() => null);
	if (existing?.data?.length) {
		return json({ success: true, data: existing.data[0], reused: true });
	}

	try {
		const created: any = await directusServerJson('/items/identitas_barang', {
			method: 'POST',
			body: JSON.stringify({
				nama_barang_lengkap: namaBarang,
				satuan,
				parent_category: parentCategory,
				perlu_verifikasi_pendaftaran: true,
				stok_tersedia: 0,
				stok_total: 0
			})
		});
		return json({ success: true, data: created.data, reused: false });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal mendaftarkan barang baru');
	}
}

export async function GET() {
	throw error(405, 'Gunakan POST');
}
