// src/lib/server/gerbangSj/selfVerify.ts
// WSK-35 §4a — sisi server kunci "pembuat SJ ≠ satpam" untuk gerbang workshop. SELF-ACTIVATING: kolom dibuat_oleh_karyawan_id baru ada
// setelah skema disetujui; selama belum ada, tidak ada yang dibaca (kolom tak dikenal = 403) dan kunci tidak aktif.
import { directusServerJson } from '../directus';
import { SJK_CREATOR_COLUMN, SELF_VERIFY_SETTING_KEY, DEFAULT_SELF_VERIFY_MODE, normalizeSelfVerifyMode, type SelfVerifyMode } from '$lib/utils/sjkSelfVerify';

const TTL_MS = 10 * 60 * 1000;
const readyCache = new Map<string, { at: number; ready: boolean }>();
export function resetSelfVerifyCache() { readyCache.clear(); }

export async function isCreatorColumnReady(collection: string): Promise<boolean> {
	const hit = readyCache.get(collection);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.ready;
	let ready = false;
	try {
		await directusServerJson(`/fields/${collection}/${SJK_CREATOR_COLUMN}`);
		ready = true;
	} catch (e) {
		const st = (e as any)?.status;
		if (st !== 403 && st !== 404) console.warn(`[gerbangSj/selfVerify] cek kolom ${collection}.${SJK_CREATOR_COLUMN} gagal (dianggap belum siap):`, e instanceof Error ? e.message : e);
	}
	readyCache.set(collection, { at: Date.now(), ready });
	return ready;
}

export async function getSelfVerifyMode(): Promise<SelfVerifyMode> {
	try {
		const res = await directusServerJson<{ data: any[] }>(`/items/app_settings?filter[module][_eq]=finance_interlocking&filter[setting_key][_eq]=${SELF_VERIFY_SETTING_KEY}&fields=setting_value&limit=1`);
		return normalizeSelfVerifyMode(res?.data?.[0]?.setting_value);
	} catch (e) {
		console.warn('[gerbangSj/selfVerify] gagal baca mode kunci, pakai default:', e instanceof Error ? e.message : e);
		return DEFAULT_SELF_VERIFY_MODE;
	}
}

/** Pembuat (karyawan.id) baris SJ — [] bila kolom belum siap. Melempar bila baca gagal (pemanggil memutuskan; jangan diam-diam melewati kunci). */
export async function readCreatorIds(collection: string, rowIds: number[]): Promise<number[]> {
	if (!rowIds.length || !(await isCreatorColumnReady(collection))) return [];
	const res = await directusServerJson<{ data: any[] }>(`/items/${collection}?filter[id][_in]=${rowIds.join(',')}&fields=id,${SJK_CREATOR_COLUMN}&limit=-1`);
	return (res?.data || []).map((r) => r[SJK_CREATOR_COLUMN]).filter((v) => v != null).map(Number);
}

/** Beri tahu atasan satpam bahwa ia memverifikasi SJ buatannya sendiri (gagal = dilog, tidak membatalkan verifikasi). */
export async function notifyAtasanSelfVerify(opts: { karyawanId: number; actorLabel: string; noSj: string; wsLabel: string; alasan: string; collection: string; headerId: number }): Promise<boolean> {
	try {
		const k = await directusServerJson<{ data: { atasan_id?: any; atasan_fungsional_id?: any } }>(`/items/karyawan/${opts.karyawanId}?fields=atasan_id,atasan_fungsional_id`);
		const pick = (v: any) => (v && typeof v === 'object' ? v.id : v);
		const atasan = pick(k?.data?.atasan_id) || pick(k?.data?.atasan_fungsional_id) || null;
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'sjk_verifikasi_sendiri', module: 'workshop', title: `Verifikasi gerbang oleh pembuat SJ: ${opts.noSj}`,
				message: `${opts.actorLabel} memverifikasi gerbang SJ ${opts.noSj} (${opts.wsLabel}) yang ia buat sendiri. Alasan: ${opts.alasan}`.slice(0, 1000),
				priority: 'high', department: 'logistik', karyawan_id: atasan != null ? Number(atasan) : null, read: false, action_required: false,
				source_collection: opts.collection, source_id: String(opts.headerId), created_at: new Date().toISOString()
			})
		});
		return true;
	} catch (e) {
		console.error('[gerbangSj/selfVerify] PERINGATAN: verifikasi-sendiri tersimpan tetapi notifikasi atasan gagal:', e instanceof Error ? e.message : e);
		return false;
	}
}
