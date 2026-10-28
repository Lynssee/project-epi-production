// src/routes/api/ai-assistant/draft-requisition/+server.ts
// Fase 2 — Rencana Implementasi Asisten Eltama v2.0 §8: satu-satunya jalur
// yang benar-benar MENULIS dari alur Asisten AI, dan hanya dipanggil setelah
// pengguna menekan tombol "Buat Draf" secara eksplisit di AsistenSheet
// (bukan otomatis dari tool call gateway /api/ai-assistant).
//
// Sengaja TIDAK menduplikasi logika createRequisition() — dipanggil langsung
// (sama seperti routes/api/requisition/+server.ts, jalur manual), jadi
// budget gate department & routing approval yang sudah teruji tetap berlaku
// tanpa kode baru. Yang baru DI SINI hanya: pagu aksi 5/jam/pengguna (§8.1)
// dan penanda "[Draf Asisten AI]" + kutipan pertanyaan asli untuk jejak audit
// dan lencana "draf asisten" bagi penyetuju.
//
// 5B#5 (Offline queue, implementation_plan_asisten_ai_v2.md): klien boleh
// mengirim `client_txn_id` (dibuat SEBELUM percobaan kirim pertama, lihat
// offlineAsistenDraftQueue.ts) supaya retry (auto-flush saat online kembali)
// aman — request yang sudah SUKSES tapi responsnya tak sempat sampai ke klien
// (sinyal putus di tengah) tidak membuat requisition dobel. requisition tidak
// punya kolom unik seperti project_punch_list.client_txn_id, jadi idempotency
// dicek lewat marker "[txn:<id>]" di tujuan_penggunaan (bukan skema baru).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { createRequisition } from '$lib/server/requisitionSubmit';
import { directusServerJson } from '$lib/server/directus';

async function findExistingByTxnId(requesterId: number, clientTxnId: string): Promise<any | null> {
	const marker = `[txn:${clientTxnId}]`;
	const qs = new URLSearchParams({
		filter: JSON.stringify({ requester_user_id: { _eq: requesterId }, tujuan_penggunaan: { _contains: marker } }),
		fields: 'id,requisition_number',
		limit: '1'
	});
	const res = await directusServerJson<{ data?: any[] }>(`/items/requisition?${qs.toString()}`).catch(() => null);
	return res?.data?.[0] || null;
}

// Pagu aksi (§8.1): maks 5 draf per pengguna per jam. In-memory, mengikuti
// pola checkRateLimit() yang sudah dipakai di routes/api/search/+server.js (erp-epi-1).
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

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);

	if (!checkDraftRateLimit(fbUser.localId)) {
		throw error(429, `Batas ${MAX_DRAFTS_PER_HOUR} draf asisten per jam tercapai. Silakan ajukan lewat halaman Requisition secara manual, atau coba lagi nanti.`);
	}

	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}

	const body = await event.request.json().catch(() => ({}));
	const draft = body?.draft;
	const sourceQuestion = typeof body?.sourceQuestion === 'string' ? body.sourceQuestion.slice(0, 300) : '';
	const clientTxnId = typeof body?.client_txn_id === 'string' ? body.client_txn_id.slice(0, 100) : '';

	if (!draft || draft.type !== 'requisition' || !Array.isArray(draft.items) || !draft.items.length) {
		throw error(400, 'Data draf tidak valid.');
	}

	if (clientTxnId) {
		const existing = await findExistingByTxnId(karyawan.id, clientTxnId);
		if (existing) return json({ success: true, data: existing, replay: true });
	}

	const tujuanPenggunaan = `[Draf Asisten AI] ${draft.tujuanPenggunaan || ''}${sourceQuestion ? ` — diminta: "${sourceQuestion}"` : ''}${clientTxnId ? ` [txn:${clientTxnId}]` : ''}`.trim();

	try {
		const result = await createRequisition({
			requesterId: karyawan.id,
			departmentKey: karyawan.divisi,
			requisitionType: 'general_internal',
			tujuanPenggunaan,
			items: draft.items
		});
		return json({ success: true, data: result });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal membuat draf requisition');
	}
}
