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
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveFieldProjectScope } from '$lib/server/fieldProjectScope';
import { directusServerJson } from '$lib/server/directus';
import { buildPaStatusLapangan, DEFAULT_SLA_CONFIG } from '$lib/utils/paStatusLapangan';
import { readSettingsNamespace, positiveNumber } from '$lib/server/fieldSettings';

export async function GET(event: RequestEvent) {
	const user = await requireUser(event);
	const projectId = Number(event.params.project_id);
	if (!Number.isSafeInteger(projectId) || projectId <= 0) throw error(400, 'project_id tidak valid.');

	// Visibilitas Leader Fase 1: scope SAMA dengan gerbang halaman proyek di klien (bolehAksesProyek) —
	// role manajemen (read-only, tanpa nominal), Project Leader & Co-Leader (id/nama), Manpower Leader/Wakil.
	// Sebelumnya hanya leader_id/nama utama + proyek aktif, sehingga co-leader, manpower leader, dan
	// admin/manajer yang lolos gerbang halaman justru mendapat 403 dan kartu birokrasi "gagal dimuat".
	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const scope = await resolveFieldProjectScope(idToken, user.localId, user.email);
	if (!scope.unrestricted && !scope.projectIds.includes(projectId)) {
		throw error(403, 'Anda tidak memegang proyek ini (bukan Leader, Co-Leader, atau Manpower Leader proyek ini).');
	}

	const warnings: string[] = [];

	// Fase 4 (rencana monitoring fetch & optimasi): sebelumnya 7 await berurutan (~7 round-trip ke Directus,
	// ~180 ms each). Tiap relasi TETAP diambil dengan query terpisah (Aturan #2), tapi yang tidak saling
	// bergantung dijalankan bersamaan: packing list, pembelian lokal, & reimbursement hanya butuh projectId
	// -> dimulai langsung; approval_requests & approval_actions hanya butuh reqIds dari PA -> bersamaan;
	// approval_workflow_steps butuh workflow_id dari requests. Jalur terpanjang 3 round-trip (bukan 7).
	// Hasil sumber opsional dikembalikan sebagai {ok}, bukan reject, sehingga tidak ada rejection menggantung
	// bila PA gagal (502) sebelum sempat di-await; peringatan tetap ditambahkan dalam urutan lama.
	const optional = (url: string) =>
		directusServerJson<{ data: any[] }>(url).then(
			(r) => ({ ok: true as const, rows: r?.data || [] }),
			(e: any) => ({ ok: false as const, message: e?.message as string | undefined })
		);
	// Ambang SLA dari setelan project.field_birokrasi.* (satu query, bersamaan dengan sumber lain). Gagal -> default lama.
	const settingsPromise = readSettingsNamespace('project.field_birokrasi.');
	const plPromise = optional(
		`/items/project_budgets?filter[project_id][_eq]=${projectId}&filter[packing_status][_nin]=complete&fields=id,project_id,material_name,description,qty,qty_sudah_dikirim,unit,packing_status,reference_number,date_created&limit=-1`
	);
	const lpPromise = optional(
		`/items/pembelian_lokal_proyek?filter[project_id][_eq]=${projectId}&filter[status][_eq]=Menunggu Approval&fields=id,nomor_pembelian,nama_barang,keperluan,status,date_created&limit=-1`
	);
	const reimbPromise = optional(
		`/items/klaim_reimbursement?filter[project_id][_eq]=${projectId}&filter[status][_in]=Diajukan,Review,Pending&fields=id,nomor_klaim,kategori,keterangan,status,date_created&limit=-1`
	);

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
		const [reqRes, actRes] = await Promise.all([
			optional(`/items/approval_requests?filter[id][_in]=${reqIds.join(',')}&fields=id,status,current_step,workflow_id,date_created&limit=-1`),
			optional(`/items/approval_actions?filter[request_id][_in]=${reqIds.join(',')}&filter[action][_neq]=checklist&sort=-date_created&limit=-1&fields=request_id,date_created`)
		]);
		if (reqRes.ok) {
			requests = reqRes.rows;
		} else {
			console.error(`[pa-status] proyek ${projectId}: gagal baca approval_requests:`, reqRes.message);
			warnings.push('Status approval gagal dimuat — umur & SLA tidak dapat dihitung.');
		}
		if (actRes.ok) {
			for (const a of actRes.rows) if (!lastActionByReq[a.request_id]) lastActionByReq[a.request_id] = a.date_created;
		} else {
			console.error(`[pa-status] proyek ${projectId}: gagal baca approval_actions:`, actRes.message);
			warnings.push('Riwayat aksi approval gagal dimuat — umur dihitung sejak diajukan.');
		}
		const wfIds = [...new Set(requests.map((r) => (r.workflow_id && typeof r.workflow_id === 'object' ? r.workflow_id.id : r.workflow_id)).filter(Boolean))];
		if (wfIds.length) {
			const stepRes = await optional(`/items/approval_workflow_steps?filter[workflow_id][_in]=${wfIds.join(',')}&fields=workflow_id,step_order,sla_hours&limit=-1`);
			if (stepRes.ok) {
				for (const s of stepRes.rows) (stepsByWorkflow[s.workflow_id] ||= []).push(s);
			} else {
				console.error(`[pa-status] proyek ${projectId}: gagal baca approval_workflow_steps:`, stepRes.message);
				warnings.push('SLA tahap gagal dimuat — dipakai SLA bawaan 48 jam.');
			}
		}
	}

	// 2-4. Packing list (project_budgets: draft & requested & approved belum kirim, TANPA unit_price/planned_amount),
	// pembelian lokal (Menunggu Approval) & klaim reimbursement (Diajukan/Review) -- TANPA nominal. Sudah berjalan
	// sejak awal (lihat plPromise/lpPromise/reimbPromise di atas); di sini tinggal dikumpulkan.
	const [plRes, lpRes, reimbRes] = await Promise.all([plPromise, lpPromise, reimbPromise]);

	let packingListItems: any[] = [];
	if (plRes.ok) {
		packingListItems = plRes.rows;
	} else {
		console.warn(`[pa-status] proyek ${projectId}: gagal baca packing list:`, plRes.message);
		warnings.push('Status packing list belum dapat dimuat.');
	}

	let localPurchases: any[] = [];
	if (lpRes.ok) {
		localPurchases = lpRes.rows;
	} else {
		console.warn(`[pa-status] proyek ${projectId}: gagal baca pembelian lokal:`, lpRes.message);
	}

	let reimbursements: any[] = [];
	if (reimbRes.ok) {
		reimbursements = reimbRes.rows;
	} else {
		console.warn(`[pa-status] proyek ${projectId}: gagal baca klaim reimbursement:`, reimbRes.message);
	}

	const settings = await settingsPromise;
	const c = settings.cfg;
	const NS = 'project.field_birokrasi.';
	const yr = Number(c[NS + 'yellow_ratio']);
	const sla = {
		defaultHours: positiveNumber(c[NS + 'sla_default_hours'], DEFAULT_SLA_CONFIG.defaultHours),
		draftHours: positiveNumber(c[NS + 'sla_draft_pl_hours'], DEFAULT_SLA_CONFIG.draftHours),
		localPurchaseHours: positiveNumber(c[NS + 'sla_local_purchase_hours'], DEFAULT_SLA_CONFIG.localPurchaseHours),
		reimbursementHours: positiveNumber(c[NS + 'sla_reimbursement_hours'], DEFAULT_SLA_CONFIG.reimbursementHours),
		yellowRatio: yr > 0 && yr < 1 ? yr : DEFAULT_SLA_CONFIG.yellowRatio
	};

	const result = buildPaStatusLapangan({
		sla,
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
