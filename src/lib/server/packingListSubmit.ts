// src/lib/server/packingListSubmit.ts
// SERVER-ONLY. Submit pengajuan Packing List dari dashboard lapangan (project-epi)
// dengan approval gate — logika kembar dari requisitionSubmit.ts (lihat file itu
// untuk penjelasan pola cross-app: project-epi & erp-epi-1 berbagi SATU Directus
// instance, jadi submission menulis langsung ke koleksi project_budgets/
// approval_requests, bukan lewat panggilan HTTP cross-app).
//
// Sebelum perubahan ini, submitPackingRequest() hanya flip packing_status='requested'
// tanpa approval sama sekali (lihat Rencana Implementasi Packing List Approval
// Workflow, Fase 1). Sekarang: packing_status='pending_approval' + createApprovalRequest()
// dengan moduleKey kondisional (packing_list.project / .direktur) berdasar threshold
// di approval_matrix — sama seperti requisition.project.

import { env } from '$env/dynamic/private';
import { directusServerJson } from './directus';
import { createApprovalRequest } from './approvalSubmit';
import { createMasterPengajuanEntry } from './masterPengajuanSubmit';
import { evaluateFieldPLGatesWithDisiplin } from './gates/plDisiplinFieldGates';
import { recordFieldGateOverride } from './gates/plFieldOverride';
import { formatPlTitle, resolveProjectTitleParts } from './approvalTitle';

const num = (v: any) => parseFloat(v || 0) || 0;

// decideApprovalRequest() (erp-epi-1) memanggil fetch(callback_url) polos dari
// server — harus absolute URL. erp-epi-1 live di internal.eltamaprimaindo.com.
const ERP_EPI_1_ORIGIN = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');

export async function resolvePackingModuleKey(totalAmount: number) {
	const base = 'packing_list.project';
	const direkturKey = `${base}.direktur`;
	const res: any = await directusServerJson(
		`/items/approval_matrix?limit=1&fields=min_amount&filter[module_key][_eq]=${direkturKey}&filter[min_amount][_nnull]=true&sort=min_amount`
	);
	const threshold = res?.data?.[0]?.min_amount;
	if (threshold != null && totalAmount >= parseFloat(threshold)) return direkturKey;
	return base;
}

function normalizeDeptKey(value: any) {
	return (value || '').toString().trim().toUpperCase();
}

function amountInRange(amount: number | null, minAmount: any, maxAmount: any) {
	if (amount === null || amount === undefined) return minAmount == null && maxAmount == null;
	if (minAmount != null && amount < parseFloat(minAmount)) return false;
	if (maxAmount != null && amount > parseFloat(maxAmount)) return false;
	return true;
}

/**
 * Fase 3: cari karyawan berwenang approve (moduleKey, departmentKey, amount) untuk
 * dinotifikasi in-app saat pengajuan baru masuk. Resolusi kembar dari
 * erp-epi-1/src/lib/server/approvalEngine.js::resolveApproversWithData (di-duplikasi
 * bukan diimpor lintas-app, sama seperti resolveModuleKey di atas).
 */
async function resolveApproverIds(moduleKey: string, departmentKey: string | null | undefined, amount: number) {
	const deptNorm = normalizeDeptKey(departmentKey);
	const matrixRes: any = await directusServerJson(
		`/items/approval_matrix?limit=-1&filter[is_active][_eq]=true&filter[_or][0][module_key][_eq]=${moduleKey}&filter[_or][1][module_key][_eq]=*`
	);
	const matrixRows: any[] = matrixRes?.data || [];
	const matched = matrixRows.filter((row) => amountInRange(amount, row.min_amount, row.max_amount));
	if (!matched.length) return [];

	const karyawanRes: any = await directusServerJson(`/items/karyawan?limit=-1&filter[status][_eq]=On&fields=id,divisi,jabatan_id`);
	const allKaryawan: any[] = karyawanRes?.data || [];

	const approverIds = new Set<number>();
	for (const row of matched) {
		const jabatanId = row.jabatan_id?.id ?? row.jabatan_id ?? null;
		const rowDept = normalizeDeptKey(row.department_key);
		for (const k of allKaryawan) {
			if (jabatanId != null && k.jabatan_id !== jabatanId) continue;
			if (rowDept !== '*' && normalizeDeptKey(k.divisi) !== rowDept) continue;
			if (row.scope === 'own_dept' && normalizeDeptKey(k.divisi) !== deptNorm) continue;
			if (row.can_approve) approverIds.add(k.id);
		}
	}
	return [...approverIds];
}

export interface SubmitPackingListInput {
	requesterId: number;
	departmentKey?: string | null;
	items: { id: number; qty: number }[];
	/** F0 (Audit & Hardening Gate v2): true bila pengaju super admin / GM — gate
	 *  G_PKL_PROJECT yang gagal jadi peringatan (dicatat), bukan penolak submit. */
	overrideAllowed?: boolean;
	/** dipakai untuk mencatat jejak override ke app_notifications. */
	firebaseUid?: string;
}

/**
 * Batch-submit pengajuan packing list milik leader: PATCH packing_status=
 * 'pending_approval' pada baris project_budgets terpilih, lalu terbitkan satu
 * approval_requests yang menaungi seluruh batch (itemIds disimpan di payload
 * approval_requests — dipakai callback untuk update balik seluruh baris,
 * karena satu pengajuan = banyak baris project_budgets, bukan satu header).
 */
export async function submitPackingListRequest({
	requesterId,
	departmentKey,
	items,
	overrideAllowed = false,
	firebaseUid
}: SubmitPackingListInput) {
	if (!requesterId) throw new Error('requesterId wajib diisi');
	const cleanItems = (items || []).filter((it) => it?.id && num(it.qty) > 0);
	if (!cleanItems.length) throw new Error('Minimal 1 item pengajuan wajib diisi');

	const ids = cleanItems.map((it) => it.id);
	const rowsRes: any = await directusServerJson(
		`/items/project_budgets?filter[id][_in]=${ids.join(',')}&fields=id,project_id,material_name,material_color,unit_price,identitas_barang_id,no_item_needed,is_manpower`
	);
	const rows: any[] = rowsRes?.data || [];
	const rowById = new Map(rows.map((r) => [r.id, r]));

	// F0 (Audit & Hardening Gate v2, Path A) — gerbang Packing List sisi lapangan.
	// Hanya G_PKL_PROJECT (hard) yang bisa memblokir; G_PKL_STOK cuma peringatan.
	// Lihat $lib/server/gates/plFieldGates.ts untuk alasan cuma 2 gate.
	{
		const gateRows = cleanItems.map((it) => {
			const r: any = rowById.get(it.id) || {};
			const pid = r.project_id
				? typeof r.project_id === 'object'
					? r.project_id.id
					: r.project_id
				: null;
			const idb = r.identitas_barang_id
				? typeof r.identitas_barang_id === 'object'
					? r.identitas_barang_id.id
					: r.identitas_barang_id
				: null;
			return {
				id: it.id,
				project_id: pid,
				qty: num(it.qty),
				identitas_barang_id: idb,
				material_name: r.material_name,
				material_color: r.material_color || null,
				no_item_needed: r.no_item_needed === true || r.no_item_needed === 1 || r.no_item_needed === '1',
				is_manpower: r.is_manpower === true || r.is_manpower === 1 || r.is_manpower === '1'
			};
		});
		const gateRes = await evaluateFieldPLGatesWithDisiplin(gateRows, directusServerJson, { overrideAllowed });
		if (gateRes.blocking.length) {
			const detail = gateRes.gates
				.filter((g) => g.status === 'failed' && g.severity === 'WAJIB')
				.map((g) => `• ${g.label}: ${g.message}`)
				.join('\n');
			throw new Error(`Pengajuan packing list belum bisa dikirim:\n${detail}`);
		}
		if (gateRes.overridden.length && firebaseUid) {
			void recordFieldGateOverride({
				firebaseUid,
				failedGates: gateRes.overridden,
				context: 'field_submit',
				sourceId: cleanItems[0].id
			});
		}
	}

	const totalAmount = cleanItems.reduce((sum, it) => {
		const row = rowById.get(it.id);
		return sum + num(it.qty) * num(row?.unit_price);
	}, 0);

	const firstRow = rowById.get(cleanItems[0].id);
	const projectId = firstRow?.project_id
		? typeof firstRow.project_id === 'object'
			? firstRow.project_id.id
			: firstRow.project_id
		: null;

	// 1. Tandai batch sebagai menunggu approval (menggantikan langsung 'requested').
	await Promise.all(
		cleanItems.map((it) =>
			directusServerJson(`/items/project_budgets/${it.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ packing_status: 'pending_approval', qty: it.qty })
			})
		)
	);

	// 2. Terbitkan approval_requests yang menaungi seluruh batch.
	const moduleKey = await resolvePackingModuleKey(totalAmount);
	const materialNames = rows.map((r) => r.material_name).filter(Boolean).slice(0, 3).join(', ');
	// PRJ-27: judul memuat nama proyek, jumlah item, nilai, dan pengaju (bukan "Project #id").
	const proj = await resolveProjectTitleParts(projectId);
	const plTitle = formatPlTitle({ projectLabel: proj.label, itemCount: cleanItems.length, total: totalAmount, leader: proj.leader });
	const approvalRequest = await createApprovalRequest({
		moduleKey,
		sourceCollection: 'project_budgets',
		sourceId: cleanItems[0].id,
		title: plTitle,
		summary: materialNames || undefined,
		amount: totalAmount,
		departmentKey: departmentKey || undefined,
		requesterId,
		callbackUrl: `${ERP_EPI_1_ORIGIN}/api/packing-list/approval-callback`,
		payload: { itemIds: ids }
	});

	createMasterPengajuanEntry({
		kategori: 'procurement',
		jenisPengajuan: 'PKL',
		judul: plTitle,
		deskripsi: materialNames || null,
		totalAmount,
		pengajuId: requesterId,
		departmentKey: departmentKey || null,
		projectId: projectId || null,
		detailRefCollection: 'project_budgets',
		detailRefId: cleanItems[0].id,
		approvalRequestId: approvalRequest?.id || null,
		sourceApp: 'field'
	}).catch((e: any) => console.warn('[masterPengajuanSubmit] gagal katalog PKL (diabaikan):', e?.message));

	// Fase 3: notifikasi in-app (aktif) ke approver yang berwenang -- WA masih
	// no-op, lihat erp-epi-1/src/lib/server/packingListNotify.js. Best-effort,
	// tidak pernah menggagalkan submission.
	resolveApproverIds(moduleKey, departmentKey, totalAmount)
		.then((approverIds) =>
			Promise.all(
				approverIds.map((karyawanId) =>
					directusServerJson('/items/app_notifications', {
						method: 'POST',
						body: JSON.stringify({
							type: 'packing_list_pending_approval',
							title: 'Pengajuan Packing List Baru',
							message: `${plTitle} menunggu persetujuan Anda${materialNames ? ` (${materialNames})` : ''}.`,
							priority: 'medium',
							department: departmentKey || null,
							karyawan_id: karyawanId,
							action_required: true,
							action_url: '/approval',
							source_collection: 'project_budgets',
							source_id: String(cleanItems[0].id),
							read: false,
							created_at: new Date().toISOString()
						})
					}).catch(() => {})
				)
			)
		)
		.catch((e) => console.warn('[packingListSubmit] gagal notifikasi approver (diabaikan):', e?.message));

	return {
		itemIds: ids,
		totalAmount,
		approvalRequestId: approvalRequest?.id || null
	};
}
