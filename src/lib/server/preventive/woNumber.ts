// src/lib/server/preventive/woNumber.ts
// SERVER-ONLY. Pembuat identitas resmi untuk Work Order yang lahir otomatis dari P2H/PM (Fase 5 Laporan Bulanan Maintenance & Pertajam KPI).
// Sebelumnya POST /items/work_order dari P2H TIDAK mengirim `created_at` & `wo_number` → ±100 WO yatim (tanpa nomor/tanggal dibuat)
// yang hilang dari filter KPI & Laporan Bulanan. Format mengikuti WO admin: WO-YYMM-NNNN (YYMM dari tanggal kejadian).
import { directusServerJson } from '$lib/server/directus';

/** Fungsi murni. @param date YYYY-MM-DD (tanggal kejadian/P2H) @param rand bilangan bulat 0..9999 */
export function formatWoNumber(date: string, rand: number): string {
	const m = /^(\d{4})-(\d{2})/.exec(String(date || ''));
	const yymm = m ? `${m[1].slice(2)}${m[2]}` : new Date().toISOString().slice(2, 4) + new Date().toISOString().slice(5, 7);
	const n = Math.abs(Math.trunc(Number(rand) || 0)) % 10000;
	return `WO-${yymm}-${String(n).padStart(4, '0')}`;
}

/**
 * Nomor WO yang belum dipakai. Cek unik ke Directus (maks `tries` percobaan); bila pengecekan gagal / habis percobaan tetap
 * mengembalikan nomor terakhir (lebih baik WO bernomor daripada WO yatim) — kegagalan dicatat, tidak menggagalkan submit P2H.
 */
export async function allocateWoNumber(date: string, tries = 5): Promise<string> {
	let candidate = formatWoNumber(date, Math.floor(Math.random() * 10000));
	for (let i = 0; i < tries; i++) {
		try {
			const res = await directusServerJson<{ data: any[] }>(
				`/items/work_order?${new URLSearchParams({ 'filter[wo_number][_eq]': candidate, fields: 'id', limit: '1' }).toString()}`
			);
			if (!res?.data?.length) return candidate;
		} catch (err) {
			console.warn('[woNumber] cek keunikan gagal — memakai nomor yang dibangkitkan:', err);
			return candidate;
		}
		candidate = formatWoNumber(date, Math.floor(Math.random() * 10000));
	}
	return candidate;
}

/** Field identitas wajib pada WO otomatis: nomor resmi + tanggal dibuat (UTC tanpa milidetik, format sama dengan WO admin). */
export async function autoWoIdentity(date: string): Promise<{ wo_number: string; created_at: string }> {
	return { wo_number: await allocateWoNumber(date), created_at: new Date().toISOString().slice(0, 19) };
}
