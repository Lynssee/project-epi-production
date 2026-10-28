// src/lib/server/sjTracking.ts
// SERVER-ONLY. Penajaman Tracking Surat Jalan v2 — Fase 3 (sisi kiosk project-epi).
//
// CERMIN RINGAN dari erp-epi-1 `src/lib/server/sjTracking.js`. Directus-nya SAMA
// (satu instance), jadi kiosk menulis langsung ke koleksi `scan_log` + cache
// `surat_jalan.track_*`. Aksi kiosk SELALU maju (menunggu_gerbang→lolos_gerbang,
// disiapkan/…→dimuat), jadi validasi transisi penuh tidak diulang di sini — cron
// rekonsiliasi cache di erp yang menjaga konsistensi. JANGAN ubah bentuk baris
// scan_log tanpa menyesuaikan sisi erp.

import { directusServerJson } from './directus';

const REF_COLLECTION = 'surat_jalan';

// Canon tahap yang boleh ditulis dari lapangan/kiosk — samakan dengan erp $lib/data/sjStages.js.
// Aksi lapangan & kiosk selalu MAJU; validasi transisi penuh (mundur/lompat) tetap di erp.
export const FIELD_STAGES = [
	'disiapkan', 'siap_muat', 'dimuat', 'menunggu_gerbang', 'lolos_gerbang',
	'dalam_perjalanan', 'tiba_lokasi', 'diterima', 'selisih'
] as const;
export type FieldStage = (typeof FIELD_STAGES)[number];
/** @deprecated pakai FIELD_STAGES */
export const KIOSK_STAGES = FIELD_STAGES;
export type KioskStage = FieldStage;

export const STAGE_LABELS: Record<string, string> = {
	draft: 'Draft', menunggu_approval: 'Menunggu Approval', disetujui: 'Disetujui',
	disiapkan: 'Disiapkan', siap_muat: 'Siap Muat', dimuat: 'Dimuat',
	menunggu_gerbang: 'Menunggu Gerbang', lolos_gerbang: 'Lolos Gerbang',
	// Fase 1 Pengiriman Ekspedisi (15 Okt 2026) — hanya ditulis dari admin erp-epi
	// (halaman Serah ke Ekspedisi), BUKAN dari lapangan/kiosk. Tidak masuk FIELD_STAGES
	// karena bukan aksi yang bisa dipicu driver/kiosk; label di sini murni utk tampilan.
	diserahkan_ekspedisi: 'Diserahkan ke Ekspedisi',
	dalam_perjalanan: 'Dalam Perjalanan', tiba_lokasi: 'Tiba di Lokasi',
	diterima: 'Diterima', selisih: 'Selisih / Komplain', dokumen_kembali: 'Dokumen Kembali', tutup: 'Tutup'
};

const SCAN_TYPE_BY_STAGE: Record<string, string> = {
	dimuat: 'Muat',
	lolos_gerbang: 'Lolos Gerbang',
	tiba_lokasi: 'Tiba Lokasi'
};

let scanTypeCache: { map: Map<string, string>; exp: number } | null = null;

async function scanTypeId(name: string | null): Promise<string | null> {
	if (!name) return null;
	if (!scanTypeCache || scanTypeCache.exp < Date.now()) {
		const res = await directusServerJson<{ data: Array<{ id: string; name: string }> }>(
			`/items/category?filter[group][_eq]=scan_type&fields=id,name&limit=-1`
		).catch(() => null);
		const map = new Map<string, string>();
		for (const r of res?.data || []) map.set(String(r.name).toLowerCase().trim(), r.id);
		scanTypeCache = { map, exp: Date.now() + 10 * 60 * 1000 };
	}
	return scanTypeCache.map.get(name.toLowerCase().trim()) || null;
}

const isBlank = (v: unknown) => v == null || String(v).trim() === '' || String(v).trim() === '-';

export interface KioskTrackInput {
	sjId: number | string;
	stageTo: KioskStage;
	actor: { id?: number; nama?: string; role?: string };
	gps?: { lat?: number; lng?: number; accuracy?: number } | null;
	fotoId?: string | null;
	ttdId?: string | null;
	notes?: string | null;
	clientEventId?: string | null;
	source?: 'kiosk' | 'lapangan' | 'admin';
}

/**
 * Catat event tracking dari kiosk: cek idempotensi → insert scan_log → patch cache.
 * Best-effort pada cache (ledger tetap sumber kebenaran).
 */
export async function recordKioskTrackingEvent(input: KioskTrackInput): Promise<{ ok: true; idempotent?: boolean; scanLogId?: number }> {
	const { sjId, stageTo, actor, gps, fotoId, ttdId, notes, clientEventId, source = 'kiosk' } = input;
	if (isBlank(sjId)) throw new Error('sjId wajib diisi');
	if (!FIELD_STAGES.includes(stageTo)) throw new Error(`stageTo tidak dikenal: ${stageTo}`);

	// 1) idempotensi
	if (!isBlank(clientEventId)) {
		const dup = await directusServerJson<{ data: Array<{ id: number }> }>(
			`/items/scan_log?filter[client_event_id][_eq]=${encodeURIComponent(String(clientEventId))}` +
			`&filter[ref_collection][_eq]=${REF_COLLECTION}&fields=id&limit=1`
		).catch(() => null);
		if (dup?.data?.[0]) return { ok: true, idempotent: true, scanLogId: dup.data[0].id };
	}

	// 2) tahap terkini
	const sjRes = await directusServerJson<{ data: { id: number; track_stage: string | null } }>(
		`/items/${REF_COLLECTION}/${encodeURIComponent(String(sjId))}?fields=id,track_stage`
	);
	const stageFrom = sjRes?.data?.track_stage || null;

	// 3) ledger
	const nowISO = new Date().toISOString();
	const row: Record<string, unknown> = {
		ref_collection: REF_COLLECTION,
		ref_id: String(sjId),
		scan_type: await scanTypeId(SCAN_TYPE_BY_STAGE[stageTo] || null),
		actor_id: actor.id ?? null,
		actor_role: actor.role || 'kiosk',
		timestamp: nowISO,
		gps_lat: Number.isFinite(Number(gps?.lat)) ? Number(gps?.lat) : null,
		gps_lng: Number.isFinite(Number(gps?.lng)) ? Number(gps?.lng) : null,
		gps_accuracy: Number.isFinite(Number(gps?.accuracy)) ? Number(gps?.accuracy) : null,
		signature_id: ttdId || null,
		foto_id: fotoId || null,
		notes: notes || null,
		stage_from: stageFrom,
		stage_to: stageTo,
		source,
		client_event_id: clientEventId || null
	};

	let scanLogId: number | undefined;
	try {
		const c = await directusServerJson<{ data: { id: number } }>(`/items/scan_log`, {
			method: 'POST',
			body: JSON.stringify(row)
		});
		scanLogId = c?.data?.id;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (/RECORD_NOT_UNIQUE|unique/i.test(msg) && !isBlank(clientEventId)) {
			const again = await directusServerJson<{ data: Array<{ id: number }> }>(
				`/items/scan_log?filter[client_event_id][_eq]=${encodeURIComponent(String(clientEventId))}&fields=id&limit=1`
			).catch(() => null);
			if (again?.data?.[0]) return { ok: true, idempotent: true, scanLogId: again.data[0].id };
		}
		throw e;
	}

	// 4) cache (best-effort)
	try {
		await directusServerJson(`/items/${REF_COLLECTION}/${encodeURIComponent(String(sjId))}`, {
			method: 'PATCH',
			body: JSON.stringify({
				track_stage: stageTo,
				track_stage_at: nowISO,
				track_actor: actor.nama || actor.role || source
			})
		});
	} catch (e) {
		console.error(`[sjTracking kiosk] ledger OK (scan_log ${scanLogId}) tapi cache SJ ${sjId} gagal:`, e instanceof Error ? e.message : e);
	}

	return { ok: true, scanLogId };
}
