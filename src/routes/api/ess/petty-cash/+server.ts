// src/routes/api/ess/petty-cash/+server.ts
// F2.4 — Pengajuan Kas Kecil dari dashboard lapangan.
//   GET  → daftar pengajuan milik sendiri + dana kas kecil aktif
//   POST → buat + langsung kirim ke persetujuan atasan (multipart: bisa lampirkan foto nota)
//
// Audit petty cash 21 Sep 2026 (Fase 0): validasi fund/ceiling dipakai bersama PUT revisi
// (BUG-01), gagal baca atasan/kasir → 503 bukan lompat ke kasir (BUG-10), peringatan lunak
// tiket ganda sebelum upload foto (FLD-04).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { evaluateEmployeeLpj } from '$lib/shared/pettyCashLpjGate';
import { canUseFund, resolveImprestProject } from '$lib/shared/pettyCashRules';
import { balanceLevel } from '$lib/shared/pettyCashUx';
import { readGateConfig, logLpjGateDecision, readPettyCashSetting } from '$lib/server/ess/pettyCashLpjSettings';
import { reconcilePcrApproval } from '$lib/server/ess/pettyCashApprovalSync';
import { todayJakarta } from '$lib/server/ess/time';
import {
	STATUS,
	REQUEST_FIELDS,
	createRequestWithUniqueNumber,
	findRequestByTxn,
	syncPcrSubmitToPusat,
	resolveAtasanKaryawanId,
	resolveAtasanDetailed,
	attachDelegatedFrom,
	resolveKasir,
	noKasirMessage,
	kasirViaNote,
	classifyDescription,
	getCategoryCoa,
	logRequestEvent,
	notifyPending,
	assertFundAndAmount,
	findRecentDuplicate,
	parseRequestForm,
	validateRequestForm,
	uploadBukti,
	deleteOrphanBukti,
	asId
} from '$lib/server/ess/pettyCashRequest';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	// PC3-08 — form PA "Petty Cash" hanya butuh daftar dana: lewati query tiket (hemat API).
	const onlyFunds = event.url.searchParams.get('only') === 'funds';

	// PC3-12 — 30 terbaru (bisa "Muat lagi" via ?limit=), meta.filter_count untuk hitungan yang benar.
	const limit = Math.min(Math.max(parseInt(event.url.searchParams.get('limit') || '30', 10) || 30, 1), 100);

	// F13 — "Persetujuan Tim": tiket bawahan yang menunggu atasan ini, dari HP.
	// Dipisah dari daftar milik sendiri (Aturan #2 — jangan query relasi bersarang).
	const [reqRes, atasanRes, fundRes] = await Promise.all([
		onlyFunds
			? Promise.resolve({ data: [] as any[] })
			: directusServerJson<{ data: any[]; meta?: { filter_count?: number } }>(
					`/items/petty_cash_requests?fields=${REQUEST_FIELDS}&sort=-date_created&limit=${limit}&meta=filter_count` +
						`&filter[requester_karyawan_id][_eq]=${karyawan.id}`
				),
		onlyFunds
			? Promise.resolve({ data: [] as any[] })
			: directusServerJson<{ data: any[] }>(
			`/items/petty_cash_requests?fields=${REQUEST_FIELDS}&sort=-date_created&limit=100` +
				`&filter[atasan_karyawan_id][_eq]=${karyawan.id}&filter[status][_eq]=${STATUS.MENUNGGU_ATASAN}`
		).catch((e) => {
			console.error('[ess/petty-cash] gagal baca antrean persetujuan atasan:', e?.message || e);
			return { data: [] };
		}),
		directusServerJson<{ data: any[] }>(
			`/items/petty_cash_funds?fields=id,fund_name,department,current_balance,fund_limit,fund_type,project_id,replenish_threshold_pct,status,custodian_karyawan_id,backup_custodian_karyawan_id,wajib_bukti_diatas,lpj_batas_hari,ceiling_per_transaksi` +
				`&filter[status][_eq]=ACTIVE&sort=fund_name&limit=-1` +
				// PRJ-22: dana tanpa kasir (utama & cadangan) pasti ditolak saat submit — jangan ditawarkan ke pemohon.
				`&filter[_or][0][custodian_karyawan_id][_nnull]=true&filter[_or][1][backup_custodian_karyawan_id][_nnull]=true`
		).catch((e) => {
			console.error('[ess/petty-cash] gagal baca daftar dana:', e?.message || e);
			return { data: [] };
		})
	]);

	// PC3-12 — bila daftar terpotong: (1) tiket yang BUTUH aksi pemohon (draf/revisi/LPJ) tetap ikut & dipin, (2) KPI dihitung
	// di SERVER (aggregate), bukan menjumlah array yang terpotong. Hanya dipanggil saat terpotong (hemat API).
	const shown = reqRes?.data || [];
	const total = (reqRes as any)?.meta?.filter_count ?? shown.length;
	let requests = shown;
	let meta: Record<string, any> = { total, truncated: false };
	if (!onlyFunds && total > shown.length) {
		const me = { requester_karyawan_id: { _eq: karyawan.id } };
		const f = (o: object) => encodeURIComponent(JSON.stringify({ _and: [me, o] }));
		const needsAction = {
			_or: [
				{ status: { _in: ['draft', 'revisi'] } },
				{ _and: [{ status: { _eq: 'posted' } }, { advance_settlement_status: { _in: ['menunggu_lpj', 'revisi'] } }] }
			]
		};
		const lpjFilter = {
			_and: [
				{ mode: { _eq: 'advance' } },
				{ status: { _eq: 'posted' } },
				{ _or: [{ advance_settlement_status: { _null: true } }, { advance_settlement_status: { _in: ['menunggu_lpj', 'revisi'] } }] }
			]
		};
		try {
			const [pinRes, byStatus, lpjRes] = await Promise.all([
				directusServerJson<{ data: any[] }>(`/items/petty_cash_requests?fields=${REQUEST_FIELDS}&sort=-date_created&limit=100&filter=${f(needsAction)}`),
				directusServerJson<{ data: any[] }>(`/items/petty_cash_requests?aggregate[count]=id&aggregate[sum]=amount&groupBy[]=status&filter=${f({})}`),
				directusServerJson<{ data: any[] }>(`/items/petty_cash_requests?aggregate[count]=id&filter=${f(lpjFilter)}`)
			]);
			const pins = pinRes?.data || [];
			const pinIds = new Set(pins.map((r: any) => r.id));
			requests = [...pins, ...shown.filter((r: any) => !pinIds.has(r.id))];
			let sumAmount = 0;
			const cnt: Record<string, number> = {};
			for (const g of byStatus?.data || []) {
				cnt[g.status] = Number(g.count?.id ?? g.count) || 0;
				sumAmount += Number(g.sum?.amount ?? g.sum) || 0;
			}
			meta = {
				total,
				truncated: true,
				pinned: pins.length,
				sum_amount: sumAmount,
				pending_review: (cnt.menunggu_atasan || 0) + (cnt.menunggu_finance || 0) + (cnt.menunggu_kasir || 0),
				cair: cnt.posted || 0,
				perlu_lpj: Number(lpjRes?.data?.[0]?.count?.id ?? lpjRes?.data?.[0]?.count) || 0
			};
		} catch (e: any) {
			console.error('[ess/petty-cash] gagal memuat tiket butuh tindakan / KPI server:', e?.message || e);
		}
	}

	// PC3-07 — fund tanpa kustodian/cadangan pasti membuat tiket macet → tidak ditawarkan di dropdown.
	// PC3-20 U8 — pemohon TIDAK menerima angka saldo/limit: hanya balance_level (cukup/rendah/habis) + batas transaksi & bukti.
	const funds = (fundRes?.data || [])
		.filter((f: any) => f.custodian_karyawan_id != null || f.backup_custodian_karyawan_id != null)
		// PRJ-22: dana kerja proyek hanya ditawarkan kepada pemegangnya.
		.filter((f: any) => canUseFund(f, karyawan.id))
		.map(
			({ custodian_karyawan_id: _c, backup_custodian_karyawan_id: _b, current_balance, fund_limit, replenish_threshold_pct, ...rest }: any) => ({
				...rest,
				balance_level: balanceLevel(current_balance, fund_limit, replenish_threshold_pct)
			})
		);

	// PC3-15: antrean atasan diberi jejak delegasi ("Atas nama X (delegasi)")
	return json({ requests, atasan: await attachDelegatedFrom(atasanRes?.data || []), funds, meta });
};

export const POST: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);

	// PC3-18 §4.2 — sakelar darurat lapangan (system_settings petty_cash.field_enabled, default true): rollback cepat
	// tanpa deploy. Semua karyawan aktif boleh mengajukan (kebijakan, bukan kelalaian: tak ada izin `create` di lapangan).
	const fieldEnabled = await readPettyCashSetting<boolean | string>('petty_cash.field_enabled', true);
	if (fieldEnabled === false || fieldEnabled === 'false') {
		throw error(503, 'Pengajuan kas kecil lewat aplikasi lapangan sedang dijeda. Hubungi admin/Finance atau gunakan dashboard admin.');
	}

	const form = await event.request.formData();
	const p = parseRequestForm(form);
	validateRequestForm(p);
	const { mode, fundId, amount, description } = p;

	// PC3-19 — kirim ulang (timeout/sinyal putus) dengan kunci yang sama → tiket YANG SAMA, tanpa upload foto/cek lain
	// (hemat kuota). Urutan: validasi → cek txn → cek duplikat lunak → resolusi → upload → create.
	if (p.clientTxnId) {
		const ex = await findRequestByTxn(p.clientTxnId);
		if (ex) {
			if (asId(ex.requester_karyawan_id) !== karyawan.id) throw error(409, 'Kunci pengiriman sudah dipakai pengguna lain. Buka ulang form lalu coba lagi.');
			return json({ record: ex, status: ex.status, idempotent: true });
		}
	}

	// BUG-01 — fund aktif & ceiling (kembar dengan validasi PUT revisi)
	const fund = await assertFundAndAmount(fundId, amount);
	// PRJ-22: dana kerja proyek (imprest) mengunci proyek tiket ke proyek dana itu.
	if (!canUseFund(fund, karyawan.id)) throw error(403, 'Dana kerja ini hanya untuk Leader pemegangnya.');
	const imprest = resolveImprestProject(fund, p.projectId);
	if (imprest.error) throw error(400, imprest.error);
	p.projectId = imprest.projectId;

	// FLD-04 — sebelum upload foto (supaya kirim ulang tidak menumpuk file yatim): bila sinyal buruk
	// membuat klien mengirim ulang, tawarkan tiket yang sudah tersimpan alih-alih membuat kembar.
	if (!p.allowDuplicate) {
		const dup = await findRecentDuplicate({ requesterId: karyawan.id, fundId, amount, description });
		if (dup) {
			return json(
				{
					code: 'possible_duplicate',
					message: `Pengajuan yang sama (${dup.request_number}) sudah tersimpan beberapa menit lalu. Cek riwayat Anda — kirim lagi hanya bila memang pengajuan baru.`,
					record: dup
				},
				{ status: 409 }
			);
		}
	}

	// PC3-16 — G_PC_EMP_LPJ (kembar admin): pemohon dengan LPJ uang muka menunggak tak boleh mengajukan uang muka BARU.
	// Dicek SEBELUM upload foto (hemat kuota). Reimburse tidak dicek. shadow/soft: dicatat & lanjut; hard: 422.
	if (mode === 'advance') {
		const cfg = await readGateConfig('G_PC_EMP_LPJ');
		const lpjTickets = await directusServerJson<{ data: any[] }>(
			`/items/petty_cash_requests?limit=-1&fields=request_number,mode,status,advance_settlement_status,posted_at,approved_amount,amount` +
				`&filter[requester_karyawan_id][_eq]=${karyawan.id}&filter[mode][_eq]=advance&filter[status][_eq]=posted` +
				`&filter[_or][0][advance_settlement_status][_null]=true&filter[_or][1][advance_settlement_status][_in]=menunggu_lpj,revisi`
		);
		const emp = evaluateEmployeeLpj({ tickets: lpjTickets?.data || [], batasHari: fund.lpj_batas_hari, enforceFrom: cfg.enforceFrom });
		if (emp.message) {
			await logLpjGateDecision({
				gate: 'G_PC_EMP_LPJ',
				decision: cfg.mode === 'hard' ? 'block' : 'warn',
				reason: emp.message,
				recordId: 'baru',
				email: user.email,
				snapshot: { requester_karyawan_id: karyawan.id, channel: 'ess_lapangan' }
			});
			if (cfg.mode === 'hard') throw error(422, emp.message);
		}
	}

	// BUG-10 — resolusi atasan/kasir fail-closed (503) SEBELUM upload & create
	const atasanRes = await resolveAtasanDetailed(karyawan.id);
	const atasanId = atasanRes.id;
	const { kasirId, via: kasirVia } = await resolveKasir(fundId, karyawan.id);
	// PC3-07 — tiket yang pasti macet (tak ada kasir aktif) ditolak SEKARANG, sebelum upload & create.
	if (!kasirId) throw error(422, noKasirMessage(fund.fund_name));
	const status = atasanId ? STATUS.MENUNGGU_ATASAN : STATUS.MENUNGGU_KASIR;

	const buktiIds = await uploadBukti(p.bukti, karyawan.id);

	// Kategori otomatis dari uraian; bila masuk stok persediaan, otomatis pakai kategori pembelian_stok_inventory
	const cls = await classifyDescription(description);
	let categoryCode = cls.category_code;
	let categorySource = cls.category_source;
	if (p.isInventoryIn) {
		categoryCode = 'pembelian_stok_inventory';
		categorySource = 'system_stock_in';
	}
	const expenseAccountCode = await getCategoryCoa(categoryCode);

	const buildPayload = (requestNumber: string) => ({
		request_number: requestNumber,
		mode,
		status,
		requester_karyawan_id: karyawan.id,
		requester_name: karyawan.nama_karyawan || null,
		requester_divisi: karyawan.divisi || fund.department || null,
		fund_id: fundId,
		project_id: p.projectId,
		request_date: todayJakarta(),
		needed_date: mode === 'advance' && p.neededDate ? p.neededDate.slice(0, 10) : null,
		description,
		category_code: categoryCode,
		category_source: categorySource,
		expense_account_code: expenseAccountCode,
		amount,
		payee_name: p.payeeName || null,
		receipt_number: p.receiptNumber || null,
		bukti_file: buktiIds,
		source_channel: 'ess_lapangan',
		atasan_karyawan_id: atasanId,
		kasir_karyawan_id: kasirId,
		...(p.clientTxnId ? { client_txn_id: p.clientTxnId } : {}),
		// Fase 2/F1 lanjutan "Gate Disiplin Lapangan" (6 Okt 2026) — lihat parseRequestForm.
		site_checkin_id: p.siteCheckinId,
		visit_exception: p.visitException,
		equipment_ref_id: p.equipmentRefId,
		liter_bbm: p.literBbm,
		vehicle_ref_id: p.vehicleRefId,
		odometer_km: p.odometerKm,
		hm_alat: p.hmAlat,
		receipt_date: p.receiptDate,
		// Integrasi Kas Kecil Pembelian Stok Persediaan (Cash Purchase / Stock-IN)
		is_inventory_in: p.isInventoryIn,
		inventory_item_id: p.isInventoryIn ? p.inventoryItemId : null,
		inventory_qty: p.isInventoryIn ? p.inventoryQty : null,
		gudang_id: p.isInventoryIn ? p.gudangId : null
	});

	// BUG-08a — retry bila nomor PCR bentrok dengan pemohon lain
	let row;
	try {
		row = await createRequestWithUniqueNumber(buildPayload, { clientTxnId: p.clientTxnId });
	} catch (e) {
		await deleteOrphanBukti(buktiIds); // tiket gagal dibuat → foto yang baru diunggah jangan yatim
		throw e;
	}
	// race: request lain dengan kunci sama menang → tiket sudah ada; foto yang baru diunggah tak terpakai, tanpa log/notifikasi ganda
	if (row._idempotent) {
		await deleteOrphanBukti(buktiIds);
		return json({ record: row, status: row.status, idempotent: true });
	}
	const requestNumber: string = row.request_number;

	await logRequestEvent({
		requestId: row.id,
		event: 'created',
		actor: user.email,
		actorName: karyawan.nama_karyawan,
		statusTo: STATUS.DRAFT,
		meta: { amount, fund_id: fundId, mode, source: 'ess_lapangan' }
	});
	await logRequestEvent({
		requestId: row.id,
		event: 'submitted',
		actor: user.email,
		actorName: karyawan.nama_karyawan,
		statusFrom: STATUS.DRAFT,
		statusTo: status,
		...(atasanRes.delegatedFrom ? { meta: { delegated_from: atasanRes.delegatedFrom } } : {}) // PC3-15
	});

	// FLD-03 — tampil di Pusat Pengajuan seperti tiket admin
	await syncPcrSubmitToPusat(row, karyawan.id);
	// PC3-09 — tiket lapangan tampil di Approval Inbox atasan (hanya bila menunggu_atasan; tanpa atasan → tak ada item hantu)
	await reconcilePcrApproval(row, { action: 'submit', actorKaryawanId: karyawan.id });

	const toAtasan = status === STATUS.MENUNGGU_ATASAN;
	// PC3-07: kasir pengganti diberi tahu alasannya ("Anda kasir pengganti untuk dana X").
	const viaNote = !toAtasan ? kasirViaNote(kasirVia, fund.fund_name) : '';
	await notifyPending(toAtasan ? atasanId : kasirId, requestNumber, amount, toAtasan, {
		sourceId: row.id,
		...(viaNote ? { text: `Pengajuan kas kecil ${requestNumber} (Rp ${Math.round(amount).toLocaleString('id-ID')}) dari lapangan menunggu tindakan Anda${viaNote}.` } : {})
	});

	return json({ record: row, status });
};
