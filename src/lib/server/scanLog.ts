// src/lib/server/scanLog.ts
// SERVER-ONLY. Fase 5 (dipersempit) — catat riwayat scan ke koleksi scan_log
// (dipakai laporan "Riwayat Scan" di admin erp-epi-1). Non-fatal: kegagalan log
// TIDAK BOLEH menggagalkan alur picking yang sebenarnya — selalu panggil tanpa await
// atau bungkus .catch() di pemanggil.
import { directusServerJson } from './directus';

const karyawanIdCache = new Map<string, number | null>();

async function resolveKaryawanId(uid: string | null): Promise<number | null> {
	if (!uid) return null;
	if (karyawanIdCache.has(uid)) return karyawanIdCache.get(uid) ?? null;
	try {
		const res = await directusServerJson<{ data: Array<{ id: number }> }>(
			`/items/karyawan?filter[firebase_uid][_eq]=${encodeURIComponent(uid)}&fields=id&limit=1`
		);
		const id = res?.data?.[0]?.id ?? null;
		karyawanIdCache.set(uid, id);
		return id;
	} catch {
		return null;
	}
}

export async function logScanServer(entry: {
	refCollection: string;
	refId: string | number;
	scanType: string;
	uid: string | null;
	email: string | null;
	notes?: string;
}): Promise<void> {
	try {
		const actorId = await resolveKaryawanId(entry.uid);
		await directusServerJson('/items/scan_log', {
			method: 'POST',
			body: JSON.stringify({
				ref_collection: entry.refCollection,
				ref_id: String(entry.refId),
				scan_type: entry.scanType,
				actor_id: actorId,
				actor_role: 'lapangan',
				timestamp: new Date().toISOString(),
				notes: entry.notes || (actorId ? '' : `actor: ${entry.email || 'unknown'}`)
			})
		});
	} catch (err) {
		console.warn('[scanLog] Gagal catat scan_log (non-fatal):', err);
	}
}
