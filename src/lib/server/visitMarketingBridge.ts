// src/lib/server/visitMarketingBridge.ts
// Fase 3 "4-Gate Site Visit System" (8 Sep 2026) — check-out site_checkin tipe 'marketing'
// menulis baris `follow_ups` otomatis, mirror bridgeToVisitLeader() (visitLeaderBridge.ts).
// Kill-switch TERPISAH (tulis_visit_marketing_aktif). Kegagalan di sini TIDAK PERNAH boleh
// menggagalkan check-out — selalu dipanggil di dalam try/catch oleh caller (siteCheckin.ts).
//
// SENGAJA TIDAK mengubah prospects.stage — plan awal mengusulkan ini, tapi stage pipeline
// (new -> qualified -> proposal -> negotiation -> won/lost) adalah keputusan sales yang
// diverifikasi sendiri di modul Prospek (updateProspectStage, ada logic stage_entered_at
// dsb) — auto-transisi dari kunjungan lapangan berisiko menabrak alur itu tanpa konteks
// penuh (BANT belum tentu berarti pindah stage). Follow-up tercatat, stage tetap manual.
//
// Paket 08d Site Visit Release §6.2 (SVR-37) — sebelumnya 1 baris SEKALIGUS `completed: true`
// DAN `next_follow_up` diisi tanggal follow-up: karena `completed: true`, baris itu TIDAK
// PERNAH muncul di widget/filter pengingat (`completed != true`). Sekarang ditulis 2 baris
// terpisah: riwayat (completed:true, next_follow_up:null) + jadwal (completed:false, bila ada
// tanggal follow-up). Juga mendukung kunjungan ke master_customer TANPA prospek tertaut
// (prospect_id null) — sebelumnya closeCheckin() mensyaratkan referensi_id (prospect) ada,
// jadi bridge ini tidak pernah terpanggil untuk kunjungan customer langsung.

import { directusServerJson } from '$lib/server/directus';

async function getTulisVisitMarketingAktif(): Promise<boolean> {
	const result = await directusServerJson<{ data: { tulis_visit_marketing_aktif: boolean } }>('/items/site_checkin_settings');
	return !!result?.data?.tulis_visit_marketing_aktif;
}

export interface BantStatus {
	budget?: string | null; // 'ada' | 'belum' | 'belum_tahu'
	authority?: string | null; // 'decision_maker' | 'bukan' | 'belum_tahu'
	need?: string | null; // 'ada' | 'tidak' | 'belum_tahu'
	timeline?: string | null; // '<3bulan' | '3-6bulan' | '>6bulan'
}

export interface VisitMarketingBridgeInput {
	// Salah satu wajib ada (prospectId ATAU masterCustomerId) — divalidasi caller (closeCheckin).
	prospectId?: number | null;
	masterCustomerId?: number | null;
	salesName?: string | null;
	siteCheckinId?: string | null;
	visitSalesId?: number | null;
	picDitemui?: string | null;
	jabatanPic?: string | null;
	noWaPic?: string | null;
	hasilMeeting?: string | null;
	statusBant?: BantStatus | null;
	nextAction?: string | null;
	followUpDate?: string | null; // ISO datetime (sudah dirangkai ke 09:00 WIB oleh caller)
}

function formatBant(bant: BantStatus | null | undefined): string {
	if (!bant) return '';
	const parts = [
		bant.budget ? `Budget: ${bant.budget}` : null,
		bant.authority ? `Authority: ${bant.authority}` : null,
		bant.need ? `Need: ${bant.need}` : null,
		bant.timeline ? `Timeline: ${bant.timeline}` : null
	].filter(Boolean);
	return parts.length > 0 ? `BANT — ${parts.join(', ')}` : '';
}

/** Cari prospek yang sudah tertaut ke customer existing ini (Paket 08d §6.2). Query terpisah
 *  (Aturan #2) — gagal/tidak ketemu BUKAN error, cuma berarti baris follow-up ditulis tanpa
 *  prospect_id (fallback nama customer di notes). */
async function findLinkedProspectId(masterCustomerId: number): Promise<number | null> {
	try {
		const res = await directusServerJson<{ data: { id: number }[] }>(
			`/items/prospects?filter[customer_id][_eq]=${masterCustomerId}&fields=id&limit=1`
		);
		return res?.data?.[0]?.id ?? null;
	} catch {
		return null;
	}
}

async function getCustomerName(masterCustomerId: number): Promise<string | null> {
	try {
		const res = await directusServerJson<{ data: { nama_sj_fp: string } }>(
			`/items/master_customer/${masterCustomerId}?fields=nama_sj_fp`
		);
		return res?.data?.nama_sj_fp || null;
	} catch {
		return null;
	}
}

export async function bridgeToVisitMarketing(
	input: VisitMarketingBridgeInput
): Promise<{ created: boolean; followUpId: number | null; scheduleFollowUpId: number | null }> {
	const aktif = await getTulisVisitMarketingAktif();
	if (!aktif) {
		return { created: false, followUpId: null, scheduleFollowUpId: null };
	}

	let prospectId = input.prospectId ?? null;
	let customerNamaFallback: string | null = null;
	if (!prospectId && input.masterCustomerId) {
		prospectId = await findLinkedProspectId(input.masterCustomerId);
		if (!prospectId) customerNamaFallback = await getCustomerName(input.masterCustomerId);
	}
	if (!prospectId && !input.masterCustomerId) {
		return { created: false, followUpId: null, scheduleFollowUpId: null };
	}

	const notePrefix = customerNamaFallback ? `Customer: ${customerNamaFallback} — ` : '';

	const resultLines = [
		input.picDitemui ? `PIC: ${input.picDitemui}${input.jabatanPic ? ` (${input.jabatanPic})` : ''}${input.noWaPic ? ` — ${input.noWaPic}` : ''}` : null,
		input.hasilMeeting ? `Hasil: ${input.hasilMeeting}` : null,
		formatBant(input.statusBant) || null,
		input.nextAction ? `Next Action: ${input.nextAction}` : null
	].filter(Boolean);

	const baseFields = {
		prospect_id: prospectId,
		status: 'published',
		sales_name: input.salesName || null,
		site_checkin_id: input.siteCheckinId || null,
		visit_sales_id: input.visitSalesId || null
	};

	// Baris riwayat — SELALU completed:true, next_follow_up:null (tidak pernah dianggap
	// pengingat aktif, hanya jejak kunjungan).
	const historyPayload = {
		...baseFields,
		type: 'visit',
		notes: `${notePrefix}${input.picDitemui ? `Kunjungan — PIC ${input.picDitemui}` : 'Kunjungan lapangan'}`.slice(0, 255),
		result: resultLines.join('\n') || null,
		next_follow_up: null,
		completed: true
	};
	const historyRes = await directusServerJson<{ data: { id: number } }>('/items/follow_ups', {
		method: 'POST',
		body: JSON.stringify(historyPayload)
	});

	let scheduleFollowUpId: number | null = null;
	if (input.followUpDate) {
		const schedulePayload = {
			...baseFields,
			type: 'call',
			notes: `${notePrefix}${input.nextAction || 'Follow-up terjadwal'}`.slice(0, 255),
			next_follow_up: input.followUpDate,
			completed: false
		};
		const scheduleRes = await directusServerJson<{ data: { id: number } }>('/items/follow_ups', {
			method: 'POST',
			body: JSON.stringify(schedulePayload)
		});
		scheduleFollowUpId = scheduleRes?.data?.id ?? null;
	}

	return { created: true, followUpId: historyRes?.data?.id ?? null, scheduleFollowUpId };
}
