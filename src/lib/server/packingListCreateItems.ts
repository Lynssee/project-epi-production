// src/lib/server/packingListCreateItems.ts
// SERVER-ONLY. Path A — Audit & Hardening Gate v2 (30 Agu 2026), F0.
//
// Jalur "item baru" / "dari template" packing list lapangan. Sebelumnya
// createPackingListItems() / submitPackingFromTemplate() di services/packingList.ts
// menulis `project_budgets` LANGSUNG dari klien via SDK lalu registerPackingApproval()
// juga di klien — tak ada gerbang server. Sekarang keduanya lewat sini supaya
// G_PKL_PROJECT ditegakkan authoritative, sejajar dengan submitPackingListRequest()
// (jalur item RAB) di packingListSubmit.ts.

import { env } from '$env/dynamic/private';
import { directusServerJson } from './directus';
import { createApprovalRequest } from './approvalSubmit';
import { createMasterPengajuanEntry } from './masterPengajuanSubmit';
import { evaluateFieldPLGatesWithDisiplin } from './gates/plDisiplinFieldGates';
import { recordFieldGateOverride } from './gates/plFieldOverride';
import { resolvePackingModuleKey } from './packingListSubmit';
import { formatPlTitle, resolveProjectTitleParts } from './approvalTitle';

/** PRJ-11 / K9: ambang barang di luar RAP yang wajib naik ke tier Direktur (app_settings project.pl_non_rap_direktur_above). */
async function readNonRapDirekturThreshold(): Promise<number | null> {
	try {
		const res: any = await directusServerJson(
			'/items/app_settings?filter[module][_eq]=project&filter[setting_key][_eq]=pl_non_rap_direktur_above&fields=setting_value&limit=1'
		);
		const raw = res?.data?.[0]?.setting_value;
		const n = Number(raw);
		return raw !== undefined && raw !== null && raw !== '' && Number.isFinite(n) && n > 0 ? n : null;
	} catch (e: any) {
		console.warn('[packingListCreateItems] gagal baca pl_non_rap_direktur_above (dilewati):', e?.message);
		return null;
	}
}

const num = (v: any) => parseFloat(v || 0) || 0;
const ERP_EPI_1_ORIGIN = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');

export interface NewPackingItem {
	budget_category?: string | null;
	material_name: string;
	material_color?: string | null;
	qty: number;
	unit: string;
	description?: string | null;
	identitas_barang_id?: number | null;
	/** Catatan baris project_budgets; dipakai sumber otomatis (mis. kebutuhan urgent laporan) sebagai penanda idempoten. */
	note?: string | null;
	/** PRJ-11: estimasi harga satuan barang di luar RAP (Rp). Tanpa ini nominal approval 0 dan approver buta nilainya. */
	unit_price?: number | null;
}

export interface CreatePackingItemsInput {
	projectId: number;
	requesterId: number;
	pic: string;
	departmentKey?: string | null;
	items: NewPackingItem[];
	projectName?: string | null;
	overrideAllowed?: boolean;
	firebaseUid?: string;
}

export async function createPackingItemsRequest({
	projectId,
	requesterId,
	pic,
	departmentKey,
	items,
	projectName,
	overrideAllowed = false,
	firebaseUid
}: CreatePackingItemsInput) {
	if (!projectId) throw new Error('projectId wajib diisi');
	if (!requesterId) throw new Error('requesterId wajib diisi');
	const clean = (items || [])
		.map((it) => {
			const matName = (it?.material_name || it?.description || '').trim();
			return {
				...it,
				material_name: matName,
				description: it?.description && it.description.trim() !== matName ? it.description.trim() : (it?.material_name || matName)
			};
		})
		.filter((it) => it.material_name && num(it.qty) > 0);
	if (!clean.length) throw new Error('Minimal 1 item wajib diisi');

	// --- Gerbang gate PL lapangan (G_PKL_PROJECT hard; stok N/A utk item baru) ---
	const gateRows = clean.map((it, i) => ({
		id: i,
		project_id: projectId,
		qty: num(it.qty),
		identitas_barang_id: it.identitas_barang_id ?? null,
		material_name: it.material_name,
		material_color: it.material_color ?? null
	}));
	const gateRes = await evaluateFieldPLGatesWithDisiplin(gateRows, directusServerJson, { overrideAllowed });
	if (gateRes.blocking.length) {
		const detail = gateRes.gates
			.filter((g) => g.status === 'failed' && g.severity === 'WAJIB')
			.map((g) => `• ${g.label}: ${g.message}`)
			.join('\n');
		throw new Error(`Pengajuan packing list belum bisa dikirim:\n${detail}`);
	}

	// --- Buat baris project_budgets: SATU batch POST (array) — bukan satu POST per item (PRJ-11) ---
	const now = new Date().toISOString();
	const masterIds = [...new Set(clean.map((it) => it.identitas_barang_id).filter(Boolean))];
	const masterMap = new Map<number, any>();
	if (masterIds.length > 0) {
		try {
			const mRes: any = await directusServerJson(
				`/items/identitas_barang?filter[id][_in]=${masterIds.join(',')}&fields=id,avg_cost,harga_beli,is_borrowable&limit=-1`
			);
			for (const m of mRes?.data || []) masterMap.set(m.id, m);
		} catch (e: any) {
			console.warn('[packingListCreateItems] Gagal fetch master avg_cost (fallback ke unit_price klien):', e?.message);
		}
	}
	const priceOf = (it: NewPackingItem) => {
		const clientPrice = Math.max(0, num(it.unit_price));
		if (clientPrice > 0) return clientPrice;
		if (it.identitas_barang_id && masterMap.has(it.identitas_barang_id)) {
			const m = masterMap.get(it.identitas_barang_id);
			if (m.is_borrowable) return 0; // Alat pinjaman proyek Rp 0
			return num(m.avg_cost) || num(m.harga_beli) || 0;
		}
		return 0;
	};
	const rows = clean.map((item) => ({
		project_id: projectId,
		budget_category: item.budget_category || 'packing_supplier',
		material_name: item.material_name,
		material_color: item.material_color || '',
		qty: num(item.qty),
		unit: item.unit,
		unit_price: priceOf(item),
		planned_amount: num(item.qty) * priceOf(item),
		actual_amount: 0,
		variance: 0,
		description: item.description || item.material_name,
		pic,
		packing_status: 'requested',
		qty_sudah_dikirim: 0,
		requested_at: now,
		...(item.note ? { note: item.note } : {}),
		...(item.identitas_barang_id ? { identitas_barang_id: item.identitas_barang_id } : {})
	}));
	const createdRes: any = await directusServerJson('/items/project_budgets', { method: 'POST', body: JSON.stringify(rows) });
	const created: any[] = Array.isArray(createdRes?.data) ? createdRes.data : createdRes?.data ? [createdRes.data] : [];
	const ids = created.map((c) => c?.id).filter(Boolean);
	if (ids.length !== clean.length) {
		// Batch seharusnya atomik; bila jumlah tak cocok, bersihkan apa pun yang terbentuk.
		await rollbackCreated(ids);
		throw new Error('Gagal membuat item packing list (jumlah baris tidak sesuai) — tidak ada yang dikirim, silakan coba lagi.');
	}

	// --- Nominal approval = Σ qty × estimasi; barang di luar RAP ditandai di judul/ringkasan ---
	const totalAmount = clean.reduce((sum, it) => sum + num(it.qty) * priceOf(it), 0);
	const noEstimate = clean.filter((it) => priceOf(it) <= 0).length;
	const rpFmt = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
	const materialNames = clean.map((i) => i.material_name).filter(Boolean).slice(0, 3).join(', ');
	const summary = [
		`${ids.length} barang di luar RAP (${rpFmt(totalAmount)})`,
		noEstimate > 0 ? `${noEstimate} belum diberi estimasi harga` : null,
		pic ? `Diajukan oleh ${pic}` : null,
		materialNames || null
	].filter(Boolean).join(' · ');

	// --- Daftarkan approval. GAGAL = rollback + error ke user (dulu: diabaikan → item 'requested' tanpa approval, tak terlihat siapa pun) ---
	let approvalRequestId: string | null = null;
	// PRJ-27: judul informatif (nama proyek dari DB bila `projectName` klien kosong).
	const proj = await resolveProjectTitleParts(projectId);
	const plTitle = formatPlTitle({
		projectLabel: projectName || proj.label,
		itemCount: ids.length,
		total: totalAmount,
		leader: pic || proj.leader,
		suffix: 'di luar RAP'
	});
	try {
		const nonRapThreshold = await readNonRapDirekturThreshold();
		const baseKey = await resolvePackingModuleKey(totalAmount);
		const moduleKey = nonRapThreshold !== null && totalAmount >= nonRapThreshold && !baseKey.endsWith('.direktur')
			? 'packing_list.project.direktur'
			: baseKey;
		const approvalRequest = await createApprovalRequest({
			moduleKey,
			sourceCollection: 'project_budgets',
			sourceId: ids[0],
			title: plTitle,
			summary,
			amount: totalAmount,
			departmentKey: departmentKey || 'PROJECT',
			requesterId,
			callbackUrl: `${ERP_EPI_1_ORIGIN}/api/packing-list/approval-callback`,
			payload: { itemIds: ids, nonRap: true }
		});
		approvalRequestId = approvalRequest?.id || null;
		if (!approvalRequestId) throw new Error('Approval engine tidak mengembalikan id request');
	} catch (e: any) {
		console.error('[packingListCreateItems] gagal daftar approval — rollback item baru:', e?.message);
		await rollbackCreated(ids);
		throw new Error('Pengajuan belum terkirim karena sistem approval sedang bermasalah. Tidak ada data yang tersimpan — silakan kirim ulang beberapa saat lagi.');
	}

	createMasterPengajuanEntry({
		kategori: 'procurement',
		jenisPengajuan: 'PKL',
		judul: plTitle,
		deskripsi: materialNames || null,
		totalAmount,
		pengajuId: requesterId,
		departmentKey: departmentKey || null,
		projectId,
		detailRefCollection: 'project_budgets',
		detailRefId: ids[0],
		approvalRequestId,
		sourceApp: 'field'
	}).catch((e: any) => console.warn('[packingListCreateItems] gagal katalog PKL (diabaikan):', e?.message));

	if (gateRes.overridden.length && firebaseUid) {
		void recordFieldGateOverride({
			firebaseUid,
			failedGates: gateRes.overridden,
			context: 'field_create_items',
			sourceId: ids[0]
		});
	}

	return { itemIds: ids, approvalRequestId };
}

/** Hapus baris project_budgets yang baru dibuat di request ini (best-effort, dilog bila gagal). */
async function rollbackCreated(ids: Array<number | string>) {
	if (!ids.length) return;
	try {
		// Batch delete Directus: DELETE /items/<koleksi> dengan array primary key. Hanya baris yang dibuat request ini.
		await directusServerJson('/items/project_budgets', { method: 'DELETE', body: JSON.stringify(ids) });
	} catch (e: any) {
		console.error('[packingListCreateItems] ROLLBACK GAGAL — baris yatim perlu dibersihkan manual:', ids, e?.message);
	}
}
