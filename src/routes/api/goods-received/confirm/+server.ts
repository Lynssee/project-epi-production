// src/routes/api/goods-received/confirm/+server.ts
// Konfirmasi Goods Received (Tahap 4 · Komitmen) — dipanggil Project Leader setelah
// verifikasi fisik barang di lapangan (foto + GPS sudah divalidasi di klien via
// alur stock-lapangan/masuk mode GR).
//
// PORT dari erp-epi-1 src/lib/services/suratJalanApi.js::confirmGoodsReceivedForRAB —
// dua sisi harus tetap sinkron bila logika akuntansi berubah. Duplikasi tidak
// terhindarkan karena erp-epi-1 dan project-epi adalah dua deployment terpisah
// yang sama-sama menulis ke instance Directus yang sama.
//
// Satu aksi ini meng-update: (1) project_expenses per item — is_received, qty
// aktual, selisih, reklas HPP; (2) surat_jalan — status received + bukti
// serah-terima; (3) logistik_klaim bila ada selisih (D2, default klaim vendor).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGRActor, isProjectAllowed } from '$lib/server/goodsReceived/guard';
import { assertEquipmentChecklistGate } from '$lib/server/goodsReceived/equipmentGate';
import { directusServerJson } from '$lib/server/directus';
import { appendLedgerEntry, rebuildProjectStockBalance, TRANSACTION_TYPES } from '$lib/server/projectLedger';
import { listRangkapForSj, advanceRangkapStatus } from '$lib/server/rangkap';
import { resolvePilotProjectIds, isPilotProject } from '$lib/server/inventorySettings';
import type { GRCondition } from '$lib/constants/grCondition';

// Fase 2 (Rencana Implementasi Inventory Proyek v2.0, 24 Juli 2026): tulis IN-RECEIPT ke
// project_stock_ledger untuk GR di proyek pilot SAJA. Proyek lain terus jalan seperti biasa
// (HPP/jurnal transit tidak berubah) -- ledger baru relevan setelah opname pembuka proyek itu
// dilakukan, jadi sengaja tidak dinyalakan global. F0 (Rencana TAJAM v2.0): gerbang kini via
// resolvePilotProjectIds() terpadu (sama dgn opname & usage), bukan lagi array hardcode terpisah.

const GR_TRANSIT_ACCOUNT = { code: '1131-005', name: 'Persediaan Dalam Perjalanan (Proyek)' };

const RAB_COA_MAPPING: Record<string, { debit: string; debitName: string }> = {
	supplier: { debit: '5100001', debitName: 'Harga Pokok Proyek' },
	consumable: { debit: '6161-001', debitName: 'Biaya Pembelian Barang Sekali Pakai' },
	jasa: { debit: '5100011', debitName: 'Upah Kerja Proyek' },
	operasional: { debit: '5100013', debitName: 'Biaya Operasional Proyek' },
	sewa_alat: { debit: '5130-013', debitName: 'Biaya Penyusutan Peralatan Proyek' },
	lain_lain: { debit: '8120000', debitName: 'Biaya lainnya' }
};

interface ConfirmItem {
	project_expense_id?: number;
	surat_jalan_item_id?: number; // Jalur GR generik non-RAB (Gap #5/C)
	qty_received: number;
	// Hanya 'rusak' yang dibaca langsung di bawah; 'ok'/'kurang' diperlakukan sama karena
	// server menyimpulkan sendiri kekurangan/kehilangan dari perbandingan qty.
	condition?: GRCondition;
}

export const POST: RequestHandler = async (event) => {
	const { karyawan, projectIds, role } = await authenticateGRActor(event);

	const body = await event.request.json().catch(() => null);
	const suratJalanId = Number(body?.suratJalanId);
	const items: ConfirmItem[] = Array.isArray(body?.items) ? body.items : [];
	const fotoTerimaFileId: string | null = body?.fotoTerimaFileId || null;
	// Bukti tambahan (Fase 1/Gap #1/#2): opsional — form lama tanpa bukti ini masih valid.
	const scanSjFileId: string | null = body?.scanSjFileId || null;
	const ttdPenerimaFileId: string | null = body?.ttdPenerimaFileId || null;
	const ttdDriverFileId: string | null = body?.ttdDriverFileId || null;
	const evidencePhotoIds: string[] = Array.isArray(body?.evidencePhotoIds) ? body.evidencePhotoIds : [];
	const gps: { lat?: number; lng?: number; accuracy?: number } | null = body?.gps || null;
	// F1 (Rencana TAJAM v2.0, dashboard "SJ Menunggu Konfirmasi Terima"): Admin logistik boleh
	// menutup SJ atas nama penerima yang belum sempat konfirmasi sendiri -- wajib alasan tertulis,
	// tercatat eksplisit sebagai received_by_proxy (bukan disamarkan sebagai konfirmasi lapangan).
	const proxyReason: string | null = body?.proxyReason || null;

	if (!Number.isFinite(suratJalanId)) throw error(400, 'suratJalanId tidak valid.');
	if (items.length === 0) throw error(400, 'Tidak ada item untuk dikonfirmasi.');
	if (!fotoTerimaFileId) throw error(400, 'Foto bukti serah-terima wajib diunggah.');
	if (role === 'admin' && !proxyReason) {
		throw error(400, 'Konfirmasi oleh Admin atas nama penerima wajib menyertakan alasan (proxyReason).');
	}

	const sj = (await directusServerJson<{ data: any }>(
		`/items/surat_jalan/${suratJalanId}?fields=id,nomor_sj,status,gr_enabled,project_id`
	).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');
	if (!sj.gr_enabled) throw error(400, 'Surat Jalan ini tidak memakai alur Goods Received.');
	if (sj.status === 'received' || sj.status === 'closed') {
		throw error(409, `Surat Jalan ${sj.nomor_sj} sudah dikonfirmasi diterima sebelumnya.`);
	}

	// Fase 8 (Revamp Project Management v2 tambahan, 3 Agu 2026): equipment yang ikut SJ ini
	// wajib punya checklist serah-terima terisi sebelum GR bisa dikonfirmasi. Gated di belakang
	// system_settings 'project.feature.sj_equipment_gate_enabled' (default false) — endpoint ini
	// menangani GR untuk SEMUA SJ perusahaan, jadi gate ini sengaja dibuat sekecil & sesempit
	// mungkin: hanya jalan bila flag ON dan SJ ini punya baris equipment_id.
	await assertEquipmentChecklistGate(suratJalanId, sj.project_id);

	const pilotIds = await resolvePilotProjectIds();

	const rabItems = items.filter((it) => Number.isFinite(it.project_expense_id));
	const genericItems = items.filter((it) => Number.isFinite(it.surat_jalan_item_id));

	// Verifikasi item yang dikonfirmasi memang milik proyek yang dipimpin karyawan ini —
	// jangan percaya project_expense_id dari klien tanpa cross-check kepemilikan.
	const expIds = rabItems.map((it) => it.project_expense_id!).filter((id) => Number.isFinite(id));
	let expenses: any[] = [];
	if (expIds.length > 0) {
		const expQuery = new URLSearchParams({
			filter: JSON.stringify({ id: { _in: expIds }, surat_jalan_id: { _eq: suratJalanId } }),
			fields: 'id,project_id,qty_sent,unit_price,expense_type,material_name,rab_budget_id,identitas_barang_id',
			limit: '-1'
		});
		const expResult = await directusServerJson<{ data: any[] }>(`/items/project_expenses?${expQuery.toString()}`);
		expenses = expResult?.data || [];
	}
	const expById = new Map(expenses.map((e) => [e.id, e]));

	const unauthorized = expenses.some((e) => !isProjectAllowed(projectIds, e.project_id));
	if (unauthorized) {
		throw error(403, 'Anda tidak berwenang mengonfirmasi item di luar proyek yang Anda pimpin/di-assign.');
	}
	// Jalur generik (non-RAB) tidak punya project_id untuk di-cross-check kepemilikan —
	// hanya Admin (projectIds === null) yang boleh memakai jalur ini (lihat list/+server.ts).
	if (genericItems.length > 0 && projectIds !== null) {
		throw error(403, 'Konfirmasi barang non-RAB (generik) hanya bisa dilakukan Admin.');
	}

	let hasVariance = false;
	let totalReklas = 0;
	const claimsCreated: number[] = [];
	const journalLines: Array<{ budgetCategory: string; amount: number; materialName: string }> = [];
	const rabAccumulation = new Map<number, number>(); // rab_budget_id -> qty diterima batch ini

	for (const it of rabItems) {
		const exp = expById.get(it.project_expense_id!);
		if (!exp) continue;

		const qtySent = parseFloat(exp.qty_sent) || 0;
		const qtyReceived = Math.max(parseFloat(String(it.qty_received)) || 0, 0);
		const qtyLostDamaged = Math.max(qtySent - qtyReceived, 0);
		const unitPrice = parseFloat(exp.unit_price) || 0;
		const expenseAmount = qtyReceived * unitPrice;

		await directusServerJson(`/items/project_expenses/${exp.id}`, {
			method: 'PATCH',
			body: JSON.stringify({
				is_received: true,
				qty: qtyReceived,
				qty_lost_damaged: qtyLostDamaged,
				expense_amount: expenseAmount,
				debit_amount: expenseAmount
			})
		});

		if (exp.rab_budget_id) {
			rabAccumulation.set(exp.rab_budget_id, (rabAccumulation.get(exp.rab_budget_id) || 0) + qtyReceived);
		}

		// RSM-11 §2: jalur PL menulis IN-RECEIPT saat SJ dibuat (kunci sj-…) — kunci GR berbeda (gr-…) sehingga IN-RECEIPT
		// bisa ganda. Bila SJ ini SUDAH punya IN-RECEIPT untuk item yang sama, jangan tulis lagi (dilaporkan di log).
		let ledgerLamaAda = false;
		if (qtyReceived > 0 && exp.identitas_barang_id) {
			const lama = await directusServerJson<{ data: Array<{ id: number; quantity: number }> }>(
				`/items/project_stock_ledger?filter[reference_type][_eq]=surat_jalan&filter[reference_id][_eq]=${suratJalanId}` +
					`&filter[item_id][_eq]=${exp.identitas_barang_id}&filter[transaction_type][_eq]=${encodeURIComponent(TRANSACTION_TYPES.IN_RECEIPT)}&fields=id,quantity&limit=5`
			).catch((e) => {
				// Aturan #1: tidak bisa memastikan -> jangan menulis (lebih baik kurang daripada ganda), dan lapor jelas.
				console.error('[goods-received/confirm] gagal cek IN-RECEIPT lama, ledger dilewati agar tidak ganda:', e instanceof Error ? e.message : e);
				return { data: [{ id: -1, quantity: 0 }] };
			});
			ledgerLamaAda = (lama?.data?.length ?? 0) > 0;
			if (ledgerLamaAda) {
				console.warn(`[goods-received/confirm] SJ ${suratJalanId} item ${exp.identitas_barang_id}: IN-RECEIPT lama sudah ada (qty ${lama.data.map((x) => x.quantity).join('+')}) — tidak menulis ulang; diterima ${qtyReceived}.`);
			}
		}

		// Catat ke ledger untuk seluruh proyek bila item memiliki identitas_barang_id
		if (
			qtyReceived > 0 &&
			exp.identitas_barang_id &&
			!ledgerLamaAda
		) {
			await appendLedgerEntry({
				projectId: exp.project_id,
				itemId: exp.identitas_barang_id,
				projectBudgetId: exp.rab_budget_id || null,
				transactionType: TRANSACTION_TYPES.IN_RECEIPT,
				quantity: qtyReceived,
				unitPrice,
				referenceType: 'surat_jalan',
				referenceId: suratJalanId,
				referenceNo: sj.nomor_sj,
				submittedBy: karyawan.id,
				clientTxnId: `gr-${suratJalanId}-exp-${exp.id}`
			}).catch((e) => console.error('[goods-received/confirm] Gagal tulis ledger IN-RECEIPT:', e));
		}

		if (expenseAmount > 0) {
			totalReklas += expenseAmount;
			journalLines.push({
				budgetCategory: (exp.expense_type || 'supplier').replace(/^packing_/, ''),
				amount: expenseAmount,
				materialName: exp.material_name || ''
			});
		}

		if (qtyLostDamaged > 0) {
			hasVariance = true;
			const jenis = it.condition === 'rusak' ? 'rusak' : qtyReceived === 0 ? 'hilang' : 'kurang';
			const claim = await directusServerJson<{ data: any }>('/items/logistik_klaim', {
				method: 'POST',
				body: JSON.stringify({
					surat_jalan_id: suratJalanId,
					project_expense_id: exp.id,
					project_id: exp.project_id,
					jenis,
					tipe_komplain: 'qty_short',
					sumber: 'auto_qty',
					qty_klaim: qtyLostDamaged,
					nilai_klaim: qtyLostDamaged * unitPrice,
					pihak: 'vendor',
					status: 'diajukan',
					diajukan_oleh: karyawan.nama_karyawan
				})
			}).catch(() => null);
			if (claim?.data?.id) {
				claimsCreated.push(claim.data.id);
				await directusServerJson(`/items/project_expenses/${exp.id}`, {
					method: 'PATCH',
					body: JSON.stringify({ claim_id: claim.data.id })
				}).catch(() => {});
			}
		}
	}

	// Gap D (partial delivery): akumulasi qty_sudah_diterima di project_budgets (RAB),
	// terpisah dari qty_sudah_dikirim (yang diupdate saat SJ dibuat). "delivered lengkap"
	// baru true bila jumlah SEMUA batch penerimaan >= qty RAB awal (bukan hanya batch ini).
	for (const [rabBudgetId, qtyReceivedThisBatch] of rabAccumulation) {
		try {
			const budget = (await directusServerJson<{ data: any }>(
				`/items/project_budgets/${rabBudgetId}?fields=qty,qty_sudah_diterima`
			).catch(() => null))?.data;
			if (!budget) continue;
			const currentReceived = parseFloat(budget.qty_sudah_diterima) || 0;
			const totalReceived = currentReceived + qtyReceivedThisBatch;
			const qtyOriginal = parseFloat(budget.qty) || totalReceived;
			const grStatus = totalReceived >= qtyOriginal ? 'lengkap' : totalReceived > 0 ? 'partial' : 'belum_diterima';
			await directusServerJson(`/items/project_budgets/${rabBudgetId}`, {
				method: 'PATCH',
				body: JSON.stringify({ qty_sudah_diterima: totalReceived, gr_status: grStatus })
			}).catch(() => {});
		} catch (e) {
			console.error('[goods-received/confirm] Gagal akumulasi qty_sudah_diterima:', e);
		}
	}

	// Jalur GR generik (non-RAB): tidak ada reklas HPP/jurnal — hanya catat qty/kondisi
	// diterima di surat_jalan_items dan buat klaim bila ada selisih.
	if (genericItems.length > 0) {
		const sjiIds = genericItems.map((it) => it.surat_jalan_item_id!);
		const sjiQuery = new URLSearchParams({
			filter: JSON.stringify({ id: { _in: sjiIds }, surat_jalan_id: { _eq: suratJalanId } }),
			fields: 'id,qty_delivered,price,nama_barang',
			limit: '-1'
		});
		const sjiResult = await directusServerJson<{ data: any[] }>(`/items/surat_jalan_items?${sjiQuery.toString()}`);
		const sjiById = new Map((sjiResult?.data || []).map((s) => [s.id, s]));

		for (const it of genericItems) {
			const sji = sjiById.get(it.surat_jalan_item_id!);
			if (!sji) continue;

			const qtySent = parseFloat(sji.qty_delivered) || 0;
			const qtyReceived = Math.max(parseFloat(String(it.qty_received)) || 0, 0);
			const qtyLostDamaged = Math.max(qtySent - qtyReceived, 0);
			const condition = it.condition === 'rusak' ? 'rusak' : qtyReceived === 0 && qtySent > 0 ? 'hilang' : 'ok';

			await directusServerJson(`/items/surat_jalan_items/${sji.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ qty_gr_received: qtyReceived, gr_condition: condition })
			});

			if (qtyLostDamaged > 0) {
				hasVariance = true;
				const unitPrice = parseFloat(sji.price) || 0;
				const jenis = condition === 'rusak' ? 'rusak' : qtyReceived === 0 ? 'hilang' : 'kurang';
				const claim = await directusServerJson<{ data: any }>('/items/logistik_klaim', {
					method: 'POST',
					body: JSON.stringify({
						surat_jalan_id: suratJalanId,
						jenis,
						tipe_komplain: 'qty_short',
						sumber: 'auto_qty',
						qty_klaim: qtyLostDamaged,
						nilai_klaim: qtyLostDamaged * unitPrice,
						pihak: 'internal',
						status: 'diajukan',
						diajukan_oleh: karyawan.nama_karyawan,
						keterangan: `Barang non-RAB: ${sji.nama_barang || ''}`
					})
				}).catch(() => null);
				if (claim?.data?.id) claimsCreated.push(claim.data.id);
			}
		}
	}

	if (totalReklas > 0) {
		try {
			// Nomor jurnal sederhana (bukan nomor urut resmi seperti generateJournalNumber() di ERP) —
			// cukup unik & tertelusuri ke SJ sumbernya untuk keperluan review Finance.
			const journalNumber = `JE-GR-${suratJalanId}-${Date.now()}`;

			const je = await directusServerJson<{ data: any }>('/items/journal_entries', {
				method: 'POST',
				body: JSON.stringify({
					journal_number: journalNumber,
					transaction_date: new Date().toISOString().split('T')[0],
					reference_type: 'GR_COMMIT',
					reference_id: suratJalanId,
					reference_number: sj.nomor_sj,
					description: `Reklas Transit -> HPP (Goods Received): SJ ${sj.nomor_sj}`,
					total_debit: totalReklas,
					total_credit: totalReklas,
					created_by: karyawan.nama_karyawan,
					is_posted: false
				})
			});
			const journalId = je?.data?.id;

			if (journalId) {
				let lineNumber = 1;
				for (const line of journalLines) {
					const mapping = RAB_COA_MAPPING[line.budgetCategory] || RAB_COA_MAPPING.supplier;
					await directusServerJson('/items/journal_entry_details', {
						method: 'POST',
						body: JSON.stringify({
							journal_entry_id: journalId,
							account_code: mapping.debit,
							account_name: mapping.debitName,
							debit_amount: line.amount,
							credit_amount: 0,
							description: `HPP aktual (GR) [${line.budgetCategory}] - ${line.materialName}`,
							line_number: lineNumber++
						})
					}).catch(() => {});
					await directusServerJson('/items/journal_entry_details', {
						method: 'POST',
						body: JSON.stringify({
							journal_entry_id: journalId,
							account_code: GR_TRANSIT_ACCOUNT.code,
							account_name: GR_TRANSIT_ACCOUNT.name,
							debit_amount: 0,
							credit_amount: line.amount,
							description: `Reklas transit [${line.budgetCategory}] - ${line.materialName}`,
							line_number: lineNumber++
						})
					}).catch(() => {});
				}
			}
		} catch (journalErr) {
			console.error('[goods-received/confirm] Gagal membuat jurnal GR_COMMIT:', journalErr);
		}
	}

	const grNowISO = new Date().toISOString();
	const grStage = hasVariance ? 'selisih' : 'diterima';
	await directusServerJson(`/items/surat_jalan/${suratJalanId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			status: 'received',
			received_at: grNowISO,
			received_by: karyawan.nama_karyawan,
			foto_terima: fotoTerimaFileId,
			delivery_variance: hasVariance,
			confirmed_by: karyawan.nama_karyawan,
			confirmed_role: role,
			received_by_proxy: role === 'admin',
			proxy_reason: role === 'admin' ? proxyReason : null,
			scan_sj_file: scanSjFileId,
			ttd_penerima_file: ttdPenerimaFileId,
			ttd_driver_file: ttdDriverFileId,
			gr_gps_lat: gps?.lat ?? null,
			gr_gps_lng: gps?.lng ?? null,
			gr_gps_accuracy: gps?.accuracy ?? null,
			// Tracking SJ v2 Fase 4: tahap tracking mengikuti hasil GR.
			track_stage: grStage,
			track_stage_at: grNowISO,
			track_actor: karyawan.nama_karyawan
		})
	});

	// Tracking SJ v2 Fase 4: event ledger `diterima` / `selisih` (best-effort, tak
	// menggagalkan GR). Idempoten via client_event_id bila dikirim dari antrean offline.
	await directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify({
			ref_collection: 'surat_jalan',
			ref_id: String(suratJalanId),
			actor_id: karyawan.id ?? null,
			actor_role: role === 'admin' ? 'admin' : 'penerima',
			timestamp: grNowISO,
			gps_lat: gps?.lat ?? null,
			gps_lng: gps?.lng ?? null,
			gps_accuracy: gps?.accuracy ?? null,
			signature_id: ttdPenerimaFileId || null,
			foto_id: fotoTerimaFileId || null,
			notes: hasVariance ? 'Diterima dengan selisih (GR)' : (role === 'admin' ? `Diterima (proxy admin): ${proxyReason || '-'}` : 'Diterima (GR lapangan)'),
			stage_from: sj.status === 'received' ? 'diterima' : null,
			stage_to: grStage,
			source: 'lapangan',
			client_event_id: body?.clientEventId ? `gr:${body.clientEventId}` : null
		})
	}).catch((e) => console.error('[goods-received/confirm] event tracking gagal (GR sudah tersimpan):', e));

	// BK Gate v2 Fase 7 — lembar Merah (peruntukan penerima) otomatis dianggap
	// diterima_pic saat GR dikonfirmasi: penerima yang tanda tangan GR pasti sudah
	// memegang lembar fisiknya. Best-effort, tak menggagalkan GR bila gagal.
	try {
		const rangkap = await listRangkapForSj(suratJalanId);
		const merah = rangkap.find((r) => r.lembar_kode === 'merah' && !['diterima_pic', 'diarsip', 'discan', 'hilang'].includes(r.status));
		if (merah) await advanceRangkapStatus(merah.id, 'diterima_pic', karyawan.nama_karyawan);
	} catch (e) {
		console.error('[goods-received/confirm] gagal majukan lembar Merah (GR sudah tersimpan):', e);
	}

	if (evidencePhotoIds.length > 0) {
		await Promise.all(
			evidencePhotoIds.map((fileId, idx) =>
				directusServerJson('/items/surat_jalan_evidence_photos', {
					method: 'POST',
					body: JSON.stringify({ surat_jalan_id: suratJalanId, file: fileId, sort: idx })
				}).catch(() => {})
			)
		);
	}

	if (sj?.project_id) {
		rebuildProjectStockBalance({ projectId: sj.project_id }).catch((err) => {
			console.error('[goods-received/confirm] Gagal auto-rebuild balance:', err);
		});
	}

	return json({ success: true, hasVariance, claimsCreated, totalReklas });
};
