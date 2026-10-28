// src/routes/api/proyek/[project_id]/pa-status/+server.ts
// Fase 5a & 5b (audit hidden cost #1051 & penajaman birokrasi, 21 Okt 2026).
// GET status antrean birokrasi & komitmen tertahan pada satu proyek untuk Project Leader:
// 1. Pengajuan Anggaran (PA) pending
// 2. Packing List Draft & In-Flight (requested/approved belum full SJ)
// 3. Pembelian Lokal Proyek (menunggu approval)
// 4. Klaim Reimbursement (menunggu review)
//
// ⚠️ ATURAN KERAHASIAAN HPP (KEPUTUSAN USER 21 OKT 2026 - "DIBATASI"):
// Nominal rupiah TIDAK PERNAH dimuat dari Directus atau dikirim ke klien Project Leader.
// Auth: Firebase → karyawan → harus leader proyek ini. Query dipisah per sumber (Aturan #2).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';
import { buildPaStatusLapangan } from '$lib/utils/paStatusLapangan';

export async function GET(event: RequestEvent) {
	const { projectIds } = await authenticateProjectLeader(event);
	const projectId = Number(event.params.project_id);
	if (!Number.isSafeInteger(projectId) || projectId <= 0) throw error(400, 'project_id tidak valid.');
	if (!projectIds.includes(projectId)) throw error(403, 'Anda bukan leader proyek ini.');

	const warnings: string[] = [];

	// 1. Pengajuan Anggaran (tanpa total_amount)
	const paRes = await directusServerJson<{ data: any[] }>(
		`/items/pengajuan_anggaran?filter[project_id][_eq]=${projectId}&filter[status][_eq]=Pending` +
			`&fields=id,nomor_pengajuan,date_created,tujuan_pengajuan,current_stage,interlocking_status,approval_request_id&limit=-1`
	).catch((e) => {
		console.error(`[pa-status] proyek ${projectId}: gagal baca pengajuan_anggaran:`, e?.message);
		throw error(502, 'Gagal memuat daftar pengajuan anggaran.');
	});
	const pas = paRes?.data || [];
	const reqIds = [...new Set(pas.map((p) => p.approval_request_id).filter(Boolean))];

	let requests: any[] = [];
	const lastActionByReq: Record<string, string> = {};
	const stepsByWorkflow: Record<string, Array<{ step_order: number; sla_hours: number | null }>> = {};

	if (reqIds.length) {
		try {
			requests = (await directusServerJson<{ data: any[] }>(
				`/items/approval_requests?filter[id][_in]=${reqIds.join(',')}&fields=id,status,current_step,workflow_id,date_created&limit=-1`
			))?.data || [];
		} catch (e: any) {
			console.error(`[pa-status] proyek ${projectId}: gagal baca approval_requests:`, e?.message);
			warnings.push('Status approval gagal dimuat — umur & SLA tidak dapat dihitung.');
		}
		try {
			const acts = (await directusServerJson<{ data: any[] }>(
				`/items/approval_actions?filter[request_id][_in]=${reqIds.join(',')}&filter[action][_neq]=checklist&sort=-date_created&limit=-1&fields=request_id,date_created`
			))?.data || [];
			for (const a of acts) if (!lastActionByReq[a.request_id]) lastActionByReq[a.request_id] = a.date_created;
		} catch (e: any) {
			console.error(`[pa-status] proyek ${projectId}: gagal baca approval_actions:`, e?.message);
			warnings.push('Riwayat aksi approval gagal dimuat — umur dihitung sejak diajukan.');
		}
		const wfIds = [...new Set(requests.map((r) => (r.workflow_id && typeof r.workflow_id === 'object' ? r.workflow_id.id : r.workflow_id)).filter(Boolean))];
		if (wfIds.length) {
			try {
				const steps = (await directusServerJson<{ data: any[] }>(
					`/items/approval_workflow_steps?filter[workflow_id][_in]=${wfIds.join(',')}&fields=workflow_id,step_order,sla_hours&limit=-1`
				))?.data || [];
				for (const s of steps) (stepsByWorkflow[s.workflow_id] ||= []).push(s);
			} catch (e: any) {
				console.error(`[pa-status] proyek ${projectId}: gagal baca approval_workflow_steps:`, e?.message);
				warnings.push('SLA tahap gagal dimuat — dipakai SLA bawaan 48 jam.');
			}
		}
	}

	// 2. Packing List Items (project_budgets: draft & requested & approved belum kirim, TANPA unit_price/planned_amount)
	let packingListItems: any[] = [];
	try {
		const plRes = await directusServerJson<{ data: any[] }>(
			`/items/project_budgets?filter[project_id][_eq]=${projectId}&filter[packing_status][_nin]=complete&fields=id,project_id,material_name,description,qty,qty_sudah_dikirim,unit,packing_status,reference_number,date_created&limit=-1`
		);
		packingListItems = plRes?.data || [];
	} catch (e: any) {
		console.warn(`[pa-status] proyek ${projectId}: gagal baca packing list:`, e?.message);
		warnings.push('Status packing list belum dapat dimuat.');
	}

	// 3. Pembelian Lokal Proyek (Menunggu Approval, TANPA nominal)
	let localPurchases: any[] = [];
	try {
		const lpRes = await directusServerJson<{ data: any[] }>(
			`/items/pembelian_lokal_proyek?filter[project_id][_eq]=${projectId}&filter[status][_eq]=Menunggu Approval&fields=id,nomor_pembelian,nama_barang,keperluan,status,date_created&limit=-1`
		);
		localPurchases = lpRes?.data || [];
	} catch (e: any) {
		console.warn(`[pa-status] proyek ${projectId}: gagal baca pembelian lokal:`, e?.message);
	}

	// 4. Klaim Reimbursement (Diajukan/Review, TANPA nominal)
	let reimbursements: any[] = [];
	try {
		const rRes = await directusServerJson<{ data: any[] }>(
			`/items/klaim_reimbursement?filter[project_id][_eq]=${projectId}&filter[status][_in]=Diajukan,Review,Pending&fields=id,nomor_klaim,kategori,keterangan,status,date_created&limit=-1`
		);
		reimbursements = rRes?.data || [];
	} catch (e: any) {
		console.warn(`[pa-status] proyek ${projectId}: gagal baca klaim reimbursement:`, e?.message);
	}

	const result = buildPaStatusLapangan({
		pas,
		requests,
		lastActionByReq,
		stepsByWorkflow,
		packingListItems,
		localPurchases,
		reimbursements
	});

	return json({ success: true, data: { ...result, warnings, generated_at: new Date().toISOString() } });
}
