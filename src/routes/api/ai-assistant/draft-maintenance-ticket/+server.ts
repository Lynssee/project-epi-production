// src/routes/api/ai-assistant/draft-maintenance-ticket/+server.ts
// 5B#1 (implementation_plan_asisten_ai_v2.md) — satu-satunya jalur yang benar-benar
// MENULIS dari alur "foto → draf tiket maintenance", dipanggil hanya setelah pengguna
// menekan "Buat Tiket" di AsistenSheet (bukan otomatis dari tool call gateway).
//
// Pola quick-create WO SAMA dengan auto-WO P2H (preventive/p2h/submit/+server.ts):
// is_quick_create:true, kategori_perbaikan_id/jenis_pekerjaan_id/order_status dari
// category id yang sama, supervisor melengkapi sisanya belakangan. Foto (bila ada)
// diupload ke Directus /files lalu ditautkan lewat foto_awal — field itu sudah ada
// di skema khusus untuk kasus ini ("Prioritaskan foto ini untuk quick-create dari
// lapangan", lihat catatan field work_order.foto_awal).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';

const WO_IDS = {
	DARURAT: 'c8006ed8-b434-402f-9fb0-97c2f5284a42',
	MINOR: '5e393139-0ff7-426a-8673-3af319161663',
	CORRECTIVE: '561ad0b7-c246-4c24-bb66-5cc7e123fbda',
	STATUS_OPEN: '0e119df1-b7e5-44c1-ace4-d14c5a99c10b'
};

// Pagu aksi sama dengan draft-requisition/+server.ts (§8.1).
const MAX_DRAFTS_PER_HOUR = 5;
const WINDOW_MS = 60 * 60 * 1000;
const draftCountMap = new Map<string, { count: number; reset: number }>();
function checkDraftRateLimit(uid: string): boolean {
	const now = Date.now();
	const entry = draftCountMap.get(uid);
	if (!entry || entry.reset < now) {
		draftCountMap.set(uid, { count: 1, reset: now + WINDOW_MS });
		return true;
	}
	if (entry.count >= MAX_DRAFTS_PER_HOUR) return false;
	entry.count++;
	return true;
}

// 5B#5 (Offline queue) — sama alasan/pola dengan draft-requisition/+server.ts:
// work_order tidak punya kolom unik untuk idempotency, jadi dicek lewat marker
// "[txn:<id>]" di `keluhan` (bukan skema baru).
async function findExistingByTxnId(equipmentId: string, clientTxnId: string): Promise<any | null> {
	const marker = `[txn:${clientTxnId}]`;
	const qs = new URLSearchParams({
		filter: JSON.stringify({ equipment_id: { _eq: equipmentId }, keluhan: { _contains: marker } }),
		fields: 'id,wo_number',
		limit: '1'
	});
	const res = await directusServerJson<{ data?: any[] }>(`/items/work_order?${qs.toString()}`).catch(() => null);
	return res?.data?.[0] || null;
}

async function resolvePersonnelId(karyawanId: number): Promise<string | null> {
	const qs = new URLSearchParams({ filter: JSON.stringify({ karyawan_id: { _eq: karyawanId } }), fields: 'id', limit: '1' });
	const res = await directusServerJson<{ data: Array<{ id: string }> }>(`/items/personnel?${qs.toString()}`).catch(() => null);
	return res?.data?.[0]?.id || null;
}

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** Upload foto (base64 dari klien) ke Directus /files, kembalikan file id atau null bila gagal/tak ada. */
async function uploadPhoto(photo: { mime?: string; base64?: string; name?: string } | undefined): Promise<string | null> {
	if (!photo?.base64) return null;
	const mime = String(photo.mime || '').toLowerCase();
	if (!IMAGE_MIME.has(mime)) return null;
	const bytes = Buffer.from(String(photo.base64).replace(/^data:[^,]+,/, ''), 'base64');
	if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null;

	const form = new FormData();
	// Uint8Array.from() menyalin ke ArrayBuffer baru — BlobPart tidak menerima Buffer langsung.
	form.append('file', new Blob([Uint8Array.from(bytes)], { type: mime }), photo.name || 'foto-kerusakan.jpg');
	try {
		const res = await directusServerUpload(form);
		if (!res.ok) return null;
		const data = await res.json().catch(() => null);
		return data?.data?.id || null;
	} catch (e: any) {
		console.error('[draft-maintenance-ticket] gagal upload foto (non-fatal):', e?.message);
		return null;
	}
}

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);

	if (!checkDraftRateLimit(fbUser.localId)) {
		throw error(429, `Batas ${MAX_DRAFTS_PER_HOUR} draf asisten per jam tercapai. Silakan buat tiket lewat halaman Maintenance secara manual, atau coba lagi nanti.`);
	}

	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);

	const body = await event.request.json().catch(() => ({}));
	const draft = body?.draft;
	const sourceQuestion = typeof body?.sourceQuestion === 'string' ? body.sourceQuestion.slice(0, 300) : '';
	const photo = body?.photo && typeof body.photo === 'object' ? body.photo : undefined;
	const clientTxnId = typeof body?.client_txn_id === 'string' ? body.client_txn_id.slice(0, 100) : '';

	if (!draft || draft.type !== 'maintenance_ticket' || !draft.equipmentId || !String(draft.keluhan || '').trim()) {
		throw error(400, 'Data draf tidak valid.');
	}

	if (clientTxnId) {
		const existing = await findExistingByTxnId(draft.equipmentId, clientTxnId);
		if (existing) return json({ success: true, data: existing, replay: true });
	}

	const personnelId = karyawan ? await resolvePersonnelId(karyawan.id) : null;
	const fotoAwalId = await uploadPhoto(photo);

	const keluhan = `[Draf Asisten AI] ${draft.keluhan}${sourceQuestion ? ` — diminta: "${sourceQuestion}"` : ''}${clientTxnId ? ` [txn:${clientTxnId}]` : ''}`;

	try {
		const created = await directusServerJson<{ data: any }>('/items/work_order', {
			method: 'POST',
			body: JSON.stringify({
				equipment_id: draft.equipmentId,
				keluhan,
				kategori_perbaikan_id: draft.urgency === 'darurat' ? WO_IDS.DARURAT : WO_IDS.MINOR,
				jenis_pekerjaan_id: WO_IDS.CORRECTIVE,
				order_status: WO_IDS.STATUS_OPEN,
				tanggal_rusak: new Date().toISOString().slice(0, 10),
				is_quick_create: true,
				pengaju_id: personnelId,
				foto_awal: fotoAwalId,
				alasan_pengajuan: `[Draf Asisten AI]${sourceQuestion ? ` diminta: "${sourceQuestion}"` : ''}`
			})
		});
		return json({ success: true, data: created?.data });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal membuat draf tiket maintenance');
	}
}
