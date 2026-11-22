// src/lib/services/plBasicsClient.ts
// Satu fetch /api/packing-list/kit-basics per proyek untuk SEMUA kartu form PL (Kit Standar + Set Produk/Equipment).
// Promise yang sedang berjalan/baru selesai dibagi bersama (cache 60 dtk) supaya dua kartu tidak memanggil API dua kali.
import { getIdToken } from '$lib/services/secureDirectus';

const TTL_MS = 60 * 1000;
const cache = new Map<number, { at: number; p: Promise<any> }>();

/** Mengembalikan payload sukses, atau null bila gagal (dilog). */
export function fetchPlBasics(projectId: number): Promise<any | null> {
	const hit = cache.get(projectId);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
	const p = (async () => {
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/packing-list/kit-basics?project_id=${projectId}`, { headers: { Authorization: `Bearer ${token}` } });
			const j = res.ok ? await res.json() : null;
			return j?.success ? j : null;
		} catch (e) {
			console.warn('[plBasicsClient] gagal memuat bahan form PL:', e);
			return null;
		}
	})();
	cache.set(projectId, { at: Date.now(), p });
	p.then((v) => { if (!v) cache.delete(projectId); });
	return p;
}
