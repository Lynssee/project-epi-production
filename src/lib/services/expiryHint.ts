// src/lib/services/expiryHint.ts
// Klien tipis petunjuk kadaluarsa batch aktif (Expired Date v2 Fase 5). Satu panggilan untuk banyak barang.
// Tidak pernah melempar: gagal → {} (badge disembunyikan, pekerjaan lapangan tidak terblokir).
import { getIdToken } from './secureDirectus';
import type { ExpiryHintItem } from '$lib/utils/batchKelayakan';

export type { ExpiryHintItem };

/**
 * @param mode 'kiosk' = sesi kiosk (cookie), 'app' = pengguna login Firebase (Bearer)
 */
export async function fetchExpiryHints(itemIds: number[], mode: 'kiosk' | 'app' = 'app'): Promise<Record<number, ExpiryHintItem>> {
	const ids = [...new Set(itemIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
	if (!ids.length) return {};
	try {
		const url = `${mode === 'kiosk' ? '/api/kiosk/expiry-hint' : '/api/inventory-proyek/expiry-hint'}?item_ids=${ids.join(',')}`;
		const headers: Record<string, string> = {};
		if (mode === 'app') headers.Authorization = `Bearer ${await getIdToken()}`;
		const res = await fetch(url, { headers });
		if (!res.ok) {
			console.warn(`[expiryHint] gagal memuat petunjuk kadaluarsa (HTTP ${res.status}).`);
			return {};
		}
		return ((await res.json())?.items ?? {}) as Record<number, ExpiryHintItem>;
	} catch (e: any) {
		console.warn('[expiryHint] gagal memuat petunjuk kadaluarsa:', e?.message || e);
		return {};
	}
}

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export interface HintTampil {
	teks: string;
	bg: string;
	fg: string;
	ikon: string;
	/** Anjuran FEFO singkat (null bila tak perlu). */
	anjuran: string | null;
}

/** Bentuk tampilan badge per barang; null bila barang tak punya batch ber-tanggal (tidak ada yang ditampilkan). */
export function hintTampil(h: ExpiryHintItem | undefined | null): HintTampil | null {
	if (!h?.terdekat || !h.status) return null;
	const d = new Date(`${h.terdekat.tanggal}T00:00:00Z`);
	const tgl = `${String(d.getUTCDate()).padStart(2, '0')} ${BLN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
	const sisa = h.terdekat.sisaHari < 0 ? `lewat ${Math.abs(h.terdekat.sisaHari)}h` : `${h.terdekat.sisaHari}h`;
	const base = { teks: `Exp ${tgl} (${sisa})` };
	if (h.status === 'stop') return { ...base, bg: '#FEE2E2', fg: '#B91C1C', ikon: '⛔', anjuran: 'Ada batch sudah lewat tanggal — jangan dipakai, minta uji ulang Lab QC.' };
	if (h.status === 'prioritas') return { ...base, bg: '#FEF9C3', fg: '#854D0E', ikon: '⏳', anjuran: `Pakai lot ${h.terdekat.lot || '(tanpa no.)'} DULU (FEFO).` };
	return { ...base, bg: '#DCFCE7', fg: '#166534', ikon: '✅', anjuran: null };
}
