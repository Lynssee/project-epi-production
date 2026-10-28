// src/lib/services/masterObjekApi.ts
// Master Objek — katalog global tipe objek (Tangki Silinder, Pipa, dll) dengan gambar
// referensi, dikelola dari Dashboard Admin (Sales > Master Objek). Read-only di sini:
// dashboard lapangan hanya menampilkan thumbnail objek pada kartu tugas, tidak mengedit.

import { secureDirectusFetch } from './secureDirectus';

export interface MasterObjek {
	id: number;
	nama_objek: string;
	kategori: string | null;
	gambar: string | { id: string } | null;
	dimensi_referensi: string | null;
	satuan_default: string | null;
	aktif: boolean;
}

let cache: MasterObjek[] | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit — katalog jarang berubah, hemat API

/** Ambil seluruh Master Objek (termasuk nonaktif, karena tugas lama bisa masih menaut ke sana). Di-cache 5 menit di memori tab ini. */
export async function getMasterObjekMap(forceRefresh = false): Promise<Map<number, MasterObjek>> {
	const now = Date.now();
	if (!forceRefresh && cache && now - cacheAt < CACHE_TTL_MS) {
		return new Map(cache.map((o) => [o.id, o]));
	}
	try {
		const res = await secureDirectusFetch(
			'/items/master_objek?fields=id,nama_objek,kategori,gambar,dimensi_referensi,satuan_default,aktif&limit=500'
		);
		if (!res.ok) throw new Error('Gagal memuat master objek');
		const data = await res.json();
		cache = data.data || [];
		cacheAt = now;
	} catch (err) {
		console.warn('[masterObjekApi] gagal memuat, pakai cache lama bila ada:', err);
		if (!cache) cache = [];
	}
	return new Map((cache || []).map((o) => [o.id, o]));
}

/**
 * Normalisasi field `gambar` (bisa string uuid atau {id}) jadi path asset Directus, atau null.
 * Menerima bentuk minimal `{ gambar }` supaya bisa dipakai juga untuk snapshot ringan
 * `sub.object` yang tersimpan langsung di timeline_planning (bukan hasil fetch master_objek).
 */
export function objekGambarPath(objek: { gambar?: MasterObjek['gambar'] } | null | undefined, size = 80): string | null {
	if (!objek?.gambar) return null;
	const id = typeof objek.gambar === 'string' ? objek.gambar : objek.gambar.id;
	if (!id) return null;
	return `/assets/${id}?width=${size}&height=${size}&fit=cover`;
}
