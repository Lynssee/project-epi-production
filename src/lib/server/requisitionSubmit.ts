// src/lib/server/requisitionSubmit.ts
// SERVER-ONLY. Submit Requisition dari dashboard lapangan (project-epi).
//
// project-epi dan erp-epi-1 berbagi SATU Directus instance yang sama
// (lihat directus.ts) — jadi submission menulis LANGSUNG ke koleksi
// requisition/requisition_items/budget_commitments/approval_requests,
// bukan lewat panggilan HTTP cross-app. Ini logika kembar dari
// erp-epi-1/src/lib/server/requisitionEngine.js::createRequisition
// (tanpa bagian reservasi stok — itu dikerjakan Inventory di admin,
// bukan saat submit). Verifikasi stok & keputusan approval tetap terjadi
// di erp-epi-1 (inbox admin existing); callback_url mengarah ke sana.

import { env } from '$env/dynamic/private';
import { directusServerJson } from './directus';
import { createApprovalRequest } from './approvalSubmit';
import { createMasterPengajuanEntry } from './masterPengajuanSubmit';
import { notifyProjectRequisitionSubmitted, notifyProjectRequisitionUrgent } from './projectNotify';

const num = (v: any) => parseFloat(v || 0) || 0;

// decideApprovalRequest() (erp-epi-1) memanggil fetch(callback_url) polos dari
// server — harus absolute URL. erp-epi-1 live di internal.eltamaprimaindo.com
// (lihat erp-epi-1/vite.config.js allowedHosts).
const ERP_EPI_1_ORIGIN = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');

function baseModuleKeyFor(requisitionType: string) {
	return requisitionType === 'project_material' ? 'requisition.project' : 'requisition.internal';
}

/**
 * karyawan.divisi adalah teks bebas, budgets.department_id FK ke koleksi
 * `department` (nama_department, punya duplikat/variasi kapitalisasi).
 * Best-effort: exact-match case-insensitive pada baris aktif; null bila tak
 * ada match (gate pagu di-skip, bukan memblokir submission).
 */
async function resolveDepartmentId(divisi: string | null | undefined): Promise<number | null> {
	if (!divisi) return null;
	const target = String(divisi).trim().toLowerCase();
	const res: any = await directusServerJson(
		`/items/department?limit=-1&fields=id,nama_department,is_active&filter[nama_department][_icontains]=${encodeURIComponent(target)}`
	);
	const rows = res?.data || [];
	const exact = rows.filter((d: any) => String(d.nama_department || '').trim().toLowerCase() === target);
	const active =
		exact.find((d: any) => d.is_active) ||
		rows.find((d: any) => d.is_active && String(d.nama_department || '').trim().toLowerCase() === target);
	return (active || exact[0] || rows[0] || {}).id ?? null;
}

async function resolveModuleKey(requisitionType: string, totalAmount: number) {
	const base = baseModuleKeyFor(requisitionType);
	const direkturKey = `${base}.direktur`;
	const res: any = await directusServerJson(
		`/items/approval_matrix?limit=1&fields=min_amount&filter[module_key][_eq]=${direkturKey}&filter[min_amount][_nnull]=true&sort=min_amount`
	);
	const threshold = res?.data?.[0]?.min_amount;
	if (threshold != null && totalAmount >= parseFloat(threshold)) return direkturKey;
	return base;
}

async function generateRequisitionNumber() {
	const year = new Date().getFullYear();
	const res: any = await directusServerJson(
		`/items/requisition?limit=1&sort=-id&fields=id&filter[requisition_number][_starts_with]=REQ-${year}-`
	);
	const last = res?.data?.[0];
	const seq = last?.id ? last.id + 1 : 1;
	return `REQ-${year}-${String(seq).padStart(6, '0')}`;
}

async function getDepartmentBudgetYTD(departmentId: number, accountCode: string | null = null) {
	const zero = { pagu_ytd: 0, realisasi_ytd: 0, komitmen_ytd: 0, sisa_pagu: 0 };
	if (!departmentId) return { ...zero, is_within_budget: () => false };
	const fiscalYear = new Date().getFullYear();
	const month = new Date().getMonth() + 1;

	const budgetRes: any = await directusServerJson(
		`/items/budgets?limit=-1&fields=id&filter[department_id][_eq]=${departmentId}&filter[fiscal_year][_eq]=${fiscalYear}`
	);
	const budgetIds = (budgetRes?.data || []).map((b: any) => b.id);

	let paguYtd = 0;
	if (budgetIds.length > 0) {
		let detailUrl = `/items/budget_details?limit=-1&filter[budget_id][_in]=${budgetIds.join(',')}`;
		if (accountCode) detailUrl += `&filter[account_code][_eq]=${encodeURIComponent(accountCode)}`;
		const detailRes: any = await directusServerJson(detailUrl);
		for (const d of detailRes?.data || []) {
			for (let m = 1; m <= month; m++) paguYtd += parseFloat(d[`m${m}_planned`] || 0);
		}
	}

	let itemsUrl =
		`/items/items_pengajuan_anggaran?limit=-1` +
		`&fields=total,account_code,pengajuan_anggaran_id.status,pengajuan_anggaran_id.project_id,pengajuan_anggaran_id.tanggal_dicairkan` +
		`&filter[pengajuan_anggaran_id][department_id][_eq]=${departmentId}`;
	if (accountCode) itemsUrl += `&filter[account_code][_eq]=${encodeURIComponent(accountCode)}`;
	const itemsRes: any = await directusServerJson(itemsUrl);

	let realisasiYtd = 0;
	let komitmenYtd = 0;
	const nonExpense = (code: any) => String(code || '').trim().startsWith('1');
	for (const it of itemsRes?.data || []) {
		if (!it.account_code || nonExpense(it.account_code)) continue;
		const parent = it.pengajuan_anggaran_id;
		if (!parent) continue;
		const total = parseFloat(it.total || 0);
		if (['Completed', 'Selesai'].includes(parent.status)) {
			const d = parent.tanggal_dicairkan ? new Date(parent.tanggal_dicairkan) : null;
			if (d && !isNaN(d.getTime()) && d.getFullYear() === fiscalYear && d.getMonth() + 1 <= month) {
				realisasiYtd += total;
			}
		} else if (['Pending', 'Approved', 'Diproses'].includes(parent.status)) {
			const parentProjectId =
				parent.project_id && typeof parent.project_id === 'object' ? parent.project_id.id : parent.project_id;
			if (!parentProjectId) komitmenYtd += total;
		}
	}

	let commitUrl =
		`/items/budget_commitments?limit=-1&fields=amount,account_code` +
		`&filter[department_id][_eq]=${departmentId}&filter[fiscal_year][_eq]=${fiscalYear}` +
		`&filter[status][_eq]=held&filter[month][_lte]=${month}`;
	if (accountCode) commitUrl += `&filter[account_code][_eq]=${encodeURIComponent(accountCode)}`;
	const commitRes: any = await directusServerJson(commitUrl);
	for (const c of commitRes?.data || []) komitmenYtd += parseFloat(c.amount || 0);

	const sisaPagu = paguYtd - realisasiYtd - komitmenYtd;
	return {
		pagu_ytd: paguYtd,
		realisasi_ytd: realisasiYtd,
		komitmen_ytd: komitmenYtd,
		sisa_pagu: sisaPagu,
		is_within_budget: (amount: number) => sisaPagu >= parseFloat(String(amount || 0))
	};
}

export interface RequisitionItemInput {
	identitas_barang_id?: number | null;
	nama_barang?: string | null;
	quantity_requested: number;
	units?: string | null;
	estimated_unit_price?: number | null;
}

export interface CreateRequisitionInput {
	requesterId: number;
	departmentId?: number | null;
	departmentKey: string;
	requisitionType: 'project_material' | 'general_internal';
	projectId?: number | null;
	spkId?: number | null;
	tujuanPenggunaan?: string | null;
	tanggalDibutuhkan?: string | null;
	destinationPicName?: string | null;
	destinationAddress?: string | null;
	accountCode?: string | null;
	/** F5.2 — ditandai mendesak: memicu WA ke rantai approval + GM. */
	urgent?: boolean;
	urgentReason?: string | null;
	items: RequisitionItemInput[];
}

export async function createRequisition({
	requesterId,
	departmentId = null,
	departmentKey,
	requisitionType,
	projectId = null,
	spkId = null,
	tujuanPenggunaan = null,
	tanggalDibutuhkan = null,
	destinationPicName = null,
	destinationAddress = null,
	accountCode = null,
	urgent = false,
	urgentReason = null,
	items = []
}: CreateRequisitionInput) {
	if (!requesterId) throw new Error('requesterId wajib diisi');
	if (!['project_material', 'general_internal'].includes(requisitionType)) {
		throw new Error('requisitionType tidak valid');
	}
	if (requisitionType === 'project_material' && !projectId) {
		throw new Error('project_id wajib diisi untuk requisition_type=project_material');
	}

	const cleanItems = (items || [])
		.filter((it) => (it.identitas_barang_id || it.nama_barang) && num(it.quantity_requested) > 0)
		.map((it) => ({
			identitas_barang_id: it.identitas_barang_id || null,
			nama_barang: it.nama_barang || null,
			quantity_requested: num(it.quantity_requested),
			units: it.units || null,
			estimated_unit_price: num(it.estimated_unit_price)
		}));
	if (!cleanItems.length) throw new Error('Minimal 1 item pengajuan wajib diisi');

	const totalAmount = cleanItems.reduce((sum, it) => sum + it.quantity_requested * it.estimated_unit_price, 0);

	if (!departmentId) departmentId = await resolveDepartmentId(departmentKey);

	let budgetGateResult: any = null;
	if (requisitionType === 'general_internal' && departmentId) {
		budgetGateResult = await getDepartmentBudgetYTD(departmentId, accountCode);
		if (!budgetGateResult.is_within_budget(totalAmount)) {
			const err: any = new Error(
				`Sisa pagu department tidak mencukupi. Dibutuhkan Rp ${totalAmount.toLocaleString('id-ID')}, ` +
					`sisa pagu Rp ${budgetGateResult.sisa_pagu.toLocaleString('id-ID')}.`
			);
			err.code = 'BUDGET_GATE_REJECTED';
			err.budgetGate = budgetGateResult;
			throw err;
		}
	}

	const requisitionNumber = await generateRequisitionNumber();
	const created: any = await directusServerJson('/items/requisition', {
		method: 'POST',
		body: JSON.stringify({
			requisition_number: requisitionNumber,
			requester_user_id: requesterId,
			department_key: departmentKey,
			requisition_type: requisitionType,
			project_id: projectId,
			spk_id: spkId,
			tujuan_penggunaan: tujuanPenggunaan,
			tanggal_dibutuhkan: tanggalDibutuhkan,
			destination_pic_name: destinationPicName,
			destination_address: destinationAddress,
			total_amount: totalAmount,
			urgent: !!urgent,
			urgent_reason: urgent ? (urgentReason || null) : null,
			status: 'draft',
			pr_generated: false,
			created_at: new Date().toISOString()
		})
	});
	const requisitionId = created?.data?.id;
	if (!requisitionId) throw new Error('Gagal membuat requisition header');

	await Promise.all(
		cleanItems.map((it) =>
			directusServerJson('/items/requisition_items', {
				method: 'POST',
				body: JSON.stringify({ ...it, requisition_id: requisitionId, item_status: 'pending_verification' })
			})
		)
	);

	let budgetCommitmentId: number | null = null;
	if (requisitionType === 'general_internal' && departmentId) {
		const commitment: any = await directusServerJson('/items/budget_commitments', {
			method: 'POST',
			body: JSON.stringify({
				module_key: baseModuleKeyFor(requisitionType),
				source_collection: 'requisition',
				source_id: requisitionId,
				department_id: departmentId,
				account_code: accountCode,
				amount: totalAmount,
				fiscal_year: new Date().getFullYear(),
				month: new Date().getMonth() + 1,
				status: 'held',
				created_at: new Date().toISOString()
			})
		});
		budgetCommitmentId = commitment?.data?.id || null;
	}

	const moduleKey = await resolveModuleKey(requisitionType, totalAmount);
	const approvalRequest = await createApprovalRequest({
		moduleKey,
		sourceCollection: 'requisition',
		sourceId: requisitionId,
		title: `Requisition ${requisitionNumber}`,
		summary: tujuanPenggunaan || undefined,
		amount: totalAmount,
		departmentKey,
		requesterId,
		callbackUrl: `${ERP_EPI_1_ORIGIN}/api/requisition/approval-callback`,
		payload: { requisitionType }
	});

	await directusServerJson(`/items/requisition/${requisitionId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			status: 'submitted_dept',
			approval_request_id: approvalRequest?.id || null,
			budget_commitment_id: budgetCommitmentId
		})
	});

	await notifyProjectRequisitionSubmitted(requisitionId, projectId || requisitionId, requesterId);

	// F5.2 — bila mendesak, WA tambahan ke rantai approval + GM (fail-soft).
	if (urgent) {
		await notifyProjectRequisitionUrgent(requisitionId, projectId || requisitionId, {
			requisitionNumber,
			moduleKey: baseModuleKeyFor(requisitionType),
			totalAmount,
			reason: urgentReason || null
		}).catch((e: any) => console.warn('[requisitionSubmit] notify urgent gagal (diabaikan):', e?.message));
	}

	createMasterPengajuanEntry({
		kategori: 'procurement',
		jenisPengajuan: 'REQ',
		judul: `Requisition ${requisitionNumber}`,
		deskripsi: tujuanPenggunaan || null,
		totalAmount,
		pengajuId: requesterId,
		departmentKey,
		projectId: projectId || null,
		detailRefCollection: 'requisition',
		detailRefId: requisitionId,
		approvalRequestId: approvalRequest?.id || null,
		sourceApp: 'field'
	}).catch((e: any) => console.warn('[masterPengajuanSubmit] gagal katalog REQ (diabaikan):', e?.message));

	return {
		requisitionId,
		requisitionNumber,
		totalAmount,
		approvalRequestId: approvalRequest?.id || null,
		budgetGate: budgetGateResult
	};
}

/** Daftar requisition milik satu karyawan (untuk halaman "Pengajuan Saya"). */
export async function listMyRequisitions(requesterId: number) {
	const res: any = await directusServerJson(
		`/items/requisition?filter[requester_user_id][_eq]=${requesterId}&sort=-created_at&limit=100&fields=*`
	);
	return res?.data || [];
}

/** Detail satu requisition + item-itemnya (dicek milik requester yang sama). */
export async function getRequisitionDetail(requisitionId: number, requesterId: number) {
	const res: any = await directusServerJson(`/items/requisition/${requisitionId}?fields=*`);
	const requisition = res?.data;
	if (!requisition || Number(requisition.requester_user_id) !== Number(requesterId)) return null;

	const itemsRes: any = await directusServerJson(
		`/items/requisition_items?filter[requisition_id][_eq]=${requisitionId}&fields=*`
	);
	return { ...requisition, items: itemsRes?.data || [] };
}
