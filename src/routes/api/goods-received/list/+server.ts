// src/routes/api/goods-received/list/+server.ts
// Daftar "Barang Dalam Perjalanan" — Surat Jalan material proyek berstatus shipped
// (gr_enabled=true) untuk proyek yang dipimpin oleh Project Leader yang login.
// Bagian dari alur Goods Received (Integrasi Logistik & Cost Actual Proyek, Fase 3).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGRActor } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';
import { toLegacyHeader } from '$lib/server/sjManualFields';

export const GET: RequestHandler = async (event) => {
	const { projectIds } = await authenticateGRActor(event);

	if (projectIds !== null && projectIds.length === 0) {
		return json({ shipments: [] });
	}

	// 1. Cari baris project_expenses yang masih berupa akrual transit (belum diterima)
	// projectIds === null (Admin) -> tidak dibatasi per-proyek, tampilkan semua.
	const expFilter: Record<string, any> = {
		is_received: { _eq: false },
		surat_jalan_id: { _nnull: true }
	};
	if (projectIds !== null) {
		expFilter.project_id = { _in: projectIds };
	}
	const expQuery = new URLSearchParams({
		filter: JSON.stringify(expFilter),
		fields: 'id,project_id,surat_jalan_id,material_name,unit,unit_price,qty_sent,expense_type,identitas_barang_id',
		limit: '-1'
	});
	const expResult = await directusServerJson<{ data: any[] }>(`/items/project_expenses?${expQuery.toString()}`);
	const expenses = expResult?.data || [];

	const suratJalanIds = [...new Set(expenses.map((e) => e.surat_jalan_id))];
	const projectIdsInvolved = [...new Set(expenses.map((e) => e.project_id))];

	// 2. Ambil detail Surat Jalan yang masih menunggu GR di lapangan
	let sjById = new Map<number, any>();
	if (suratJalanIds.length > 0) {
		const sjFilter = {
			id: { _in: suratJalanIds },
			status: { _in: ['shipped', 'delivered', 'needs_security_check'] },
			received_at: { _null: true }
		};
		const sjQuery = new URLSearchParams({
			filter: JSON.stringify(sjFilter),
			fields: 'id,nomor_sj,driver,date_created,notes,qr_token,status',
			limit: '-1'
		});
		const sjResult = await directusServerJson<{ data: any[] }>(`/items/surat_jalan?${sjQuery.toString()}`);
		sjById = new Map((sjResult?.data || []).map((sj) => [sj.id, sj]));
	}

	// 3. Ambil nama proyek untuk label
	let projectNameById = new Map<number, string>();
	if (projectIdsInvolved.length > 0) {
		const projQuery = new URLSearchParams({
			filter: JSON.stringify({ id: { _in: projectIdsInvolved } }),
			fields: 'id,name',
			limit: '-1'
		});
		const projResult = await directusServerJson<{ data: any[] }>(`/items/projects?${projQuery.toString()}`);
		projectNameById = new Map((projResult?.data || []).map((p) => [p.id, p.name]));
	}

	// 4. Kelompokkan expenses per surat_jalan_id
	const shipmentsBySJ = new Map<number, any>();
	for (const exp of expenses) {
		const sj = sjById.get(exp.surat_jalan_id);
		if (!sj) continue; // SJ sudah bukan 'shipped' lagi (race condition/sudah diterima sesi lain)

		if (!shipmentsBySJ.has(sj.id)) {
			shipmentsBySJ.set(sj.id, {
				suratJalanId: sj.id,
				nomorSJ: sj.nomor_sj,
				driver: sj.driver,
				tanggalKirim: sj.date_created,
				qrToken: sj.qr_token || null,
				projectId: exp.project_id,
				projectName: projectNameById.get(exp.project_id) || toLegacyHeader(sj).manual_customer_name || '-',
				items: []
			});
		}
		shipmentsBySJ.get(sj.id).items.push({
			itemType: 'rab',
			projectExpenseId: exp.id,
			materialName: exp.material_name,
			unit: exp.unit,
			unitPrice: exp.unit_price,
			qtySent: exp.qty_sent,
			expenseType: exp.expense_type,
			identitasBarangId: exp.identitas_barang_id || null
		});
	}

	// 5. Jalur GR generik (Gap #5/C, diperluas Fase 4 utk Packing List): SJ
	// gr_enabled=true, shipped, TANPA baris project_expenses (barang internal umum/
	// non-RAB, atau leader request packing list yang tak bikin project_expenses).
	// Discovery lewat surat_jalan_items langsung. Admin lihat SEMUA (termasuk yang
	// project_id null / barang internal generik); Project Leader HANYA lihat yang
	// project_id-nya cocok dengan proyek yang ia pimpin (kolom project_id ditambahkan
	// khusus untuk packing list, lihat suratJalanApi.js::createSuratJalanFromPackingList).
	{
		const genericSjFilter: Record<string, any> =
			projectIds === null
				? { status: { _in: ['shipped', 'delivered', 'needs_security_check'] }, received_at: { _null: true }, id: { _nin: [...shipmentsBySJ.keys()] } }
				: {
						status: { _in: ['shipped', 'delivered', 'needs_security_check'] },
						received_at: { _null: true },
						id: { _nin: [...shipmentsBySJ.keys()] },
						project_id: { _in: projectIds }
					};
		const genericSjQuery = new URLSearchParams({
			filter: JSON.stringify(genericSjFilter),
			fields: 'id,nomor_sj,driver,date_created,notes,qr_token,project_id',
			limit: '-1'
		});
		const genericSjResult = await directusServerJson<{ data: any[] }>(`/items/surat_jalan?${genericSjQuery.toString()}`);
		const genericSj = genericSjResult?.data || [];

		if (genericSj.length > 0) {
			const genericSjIds = genericSj.map((sj) => sj.id);
			const sjiQuery = new URLSearchParams({
				filter: JSON.stringify({
					surat_jalan_id: { _in: genericSjIds },
					qty_delivered: { _gt: 0 },
					qty_gr_received: { _null: true }
				}),
				fields: 'id,surat_jalan_id,nama_barang,unit,price,qty_delivered',
				limit: '-1'
			});
			const sjiResult = await directusServerJson<{ data: any[] }>(`/items/surat_jalan_items?${sjiQuery.toString()}`);
			const sjItems = sjiResult?.data || [];
			const genericSjById = new Map(genericSj.map((sj) => [sj.id, sj]));

			for (const sji of sjItems) {
				const sj = genericSjById.get(sji.surat_jalan_id);
				if (!sj) continue;
				if (!shipmentsBySJ.has(sj.id)) {
					shipmentsBySJ.set(sj.id, {
						suratJalanId: sj.id,
						nomorSJ: sj.nomor_sj,
						driver: sj.driver,
						tanggalKirim: sj.date_created,
						qrToken: sj.qr_token || null,
						projectId: sj.project_id ?? null,
						projectName: projectNameById.get(sj.project_id) || toLegacyHeader(sj).manual_customer_name || 'Barang Internal (Non-RAB)',
						items: []
					});
				}
				shipmentsBySJ.get(sj.id).items.push({
					itemType: 'generic',
					suratJalanItemId: sji.id,
					materialName: sji.nama_barang,
					unit: sji.unit,
					unitPrice: sji.price,
					qtySent: sji.qty_delivered,
					expenseType: null,
					identitasBarangId: null
				});
			}
		}
	}

	return json({ shipments: [...shipmentsBySJ.values()] });
};
