// src/lib/server/processPicContext.ts
// ⚠️ SERVER-ONLY. Konteks pemetaan PIC → jabatan untuk "Tugas Saya": master `posisi` + peta alias (app_settings
// module process_guidance, key pic_aliases — dikelola di erp-epi tab "Peta PIC"). Dua query terpisah, cache 5 menit;
// gagal → MELEMPAR dan tidak di-cache. Juga menentukan jabatan seorang karyawan.
import { directusServerJson } from '$lib/server/directus';
import type { MyPosisi } from '$lib/utils/processMyTasks';
import { buildPosisiIndex, matchPicToken, parseAliasSetting, type PosisiIndex } from '$lib/utils/processPicResolver';

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; index: PosisiIndex } | null = null;

export async function loadPicIndex({ now = Date.now(), useCache = true } = {}): Promise<PosisiIndex> {
	if (useCache && cache && now - cache.at < TTL_MS) return cache.index;
	const [pos, ali] = await Promise.all([
		directusServerJson<{ data: any[] }>('/items/posisi?fields=id,nama_posisi&limit=-1'),
		directusServerJson<{ data: any[] }>(
			'/items/app_settings?filter[module][_eq]=process_guidance&filter[setting_key][_eq]=pic_aliases&fields=setting_value&limit=1'
		)
	]);
	const index = buildPosisiIndex(pos?.data ?? [], parseAliasSetting(ali?.data?.[0]?.setting_value));
	cache = { at: now, index };
	return index;
}

export function clearPicIndexCache(): void {
	cache = null;
	karyawanCache = null;
}

// Daftar karyawan untuk "Kontak Approver" (nama + no_hp + jabatan). Satu query, cache 5 menit, hanya dimuat bila ada tugas yang punya
// serah-terima. Jabatan dipetakan di server dari jabatan_id/teks posisi (±2/3 karyawan belum punya jabatan_id) — itu sebabnya semua baris diambil.
let karyawanCache: { at: number; rows: any[] } | null = null;
export async function loadKaryawanForContacts({ now = Date.now(), useCache = true } = {}): Promise<any[]> {
	if (useCache && karyawanCache && now - karyawanCache.at < TTL_MS) return karyawanCache.rows;
	const res = await directusServerJson<{ data: any[] }>('/items/karyawan?fields=id,nama_karyawan,no_hp,posisi,jabatan_id,status_kerja,status&limit=-1');
	const rows = res?.data ?? [];
	karyawanCache = { at: now, rows };
	return rows;
}

/**
 * Jabatan karyawan: `jabatan_id` bila masih aktif di master; kalau kosong (±2/3 karyawan belum terisi) pakai teks `karyawan.posisi`
 * yang cocok PASTI (nama sama / alias). Tebakan tidak dipakai. null = jabatan tak bisa ditentukan.
 */
export function resolveMyPosisi(karyawan: { jabatan_id?: number | null; posisi?: string | null }, index: PosisiIndex): MyPosisi | null {
	const jid = Number(karyawan?.jabatan_id);
	if (Number.isInteger(jid) && jid > 0 && index.byId.has(jid)) return { id: jid, nama: index.byId.get(jid)!.nama, via: 'jabatan_id' };
	const text = (karyawan?.posisi ?? '').trim();
	if (text) {
		const m = matchPicToken(text, index);
		if (m.resolved && m.posisi_id) return { id: m.posisi_id, nama: index.byId.get(m.posisi_id)!.nama, via: 'posisi_teks' };
	}
	return null;
}
