// src/routes/api/ess/petty-cash/[id]/+server.ts
// F2.4 — Aksi pemohon atas pengajuan kas kecil miliknya dari lapangan.
//   POST { action: 'cancel' | 'lpj', settlement_amount?, confirm_outlier? }
// F13 (Fase 3 Petty Cash ESS v2) — atasan langsung sekarang juga bisa approve/tolak/
// minta revisi dari HP, tidak wajib buka dashboard admin. Posting kasir tetap di admin.
//   POST { action: 'atasan_approve' | 'atasan_reject' | 'atasan_revisi', note? }
// Audit petty cash 21 Sep 2026 (Fase 0):
//   PUT (multipart) — FLD-01: pemohon memperbaiki tiket berstatus "revisi" lalu langsung kirim ulang
//   (sebelumnya jalan buntu: satu-satunya tombol = Batalkan). Validasi fund/ceiling ikut (BUG-01).
//   Alasan revisi/tolak dimuat di notifikasi (BUG-15); atasan_action(_at) ikut diisi (paritas admin).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { patchIf } from '$lib/server/ess/pettyCashAtomic';
import { reconcilePcrApproval } from '$lib/server/ess/pettyCashApprovalSync';
import { transitionGuard, conflictMessage } from '$lib/shared/pettyCashTransitions';
import { effectiveRulesMode, evaluateLpjRules, isLpjOutlier, resolveImprestProject, canUseFund } from '$lib/shared/pettyCashRules';
import { readPettyCashSetting, logLpjGateDecision } from '$lib/server/ess/pettyCashLpjSettings';
import { todayJakarta } from '$lib/server/ess/time';
import {
	STATUS,
	SETTLEMENT,
	loadRequest,
	logRequestEvent,
	notifyPending,
	resolveAtasanKaryawanId,
	resolveAtasanDetailed,
	resolveKasirKaryawanId,
	resolveKasir,
	noKasirMessage,
	classifyDescription,
	getCategoryCoa,
	syncPcrSubmitToPusat,
	syncPcrStatusToPusat,
	assertFundAndAmount,
	parseRequestForm,
	validateRequestForm,
	uploadBukti,
	deleteOrphanBukti,
	asId
} from '$lib/server/ess/pettyCashRequest';

const fmtRp = (n: unknown) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

/**
 * PC3-20 U7 — riwayat tiket (dimuat HANYA saat "Riwayat" ditekan, hemat API). Hanya pemohon, atasan, atau kasir tiket.
 */
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const row = await loadRequest(event.params.id!);
	if (!row) throw error(404, 'Pengajuan tidak ditemukan.');
	const me = karyawan.id;
	const allowed = [asId(row.requester_karyawan_id), asId(row.atasan_karyawan_id), asId(row.kasir_karyawan_id)].some((x) => x != null && x === me);
	if (!allowed) throw error(403, 'Anda tidak berhak melihat riwayat pengajuan ini.');
	const logs = await directusServerJson<{ data: any[] }>(
		`/items/petty_cash_request_logs?limit=100&sort=id&fields=event,actor,actor_name,actor_role,status_to,note,date_created&filter[request_id][_eq]=${row.id}`
	);
	return json({ logs: logs?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);
	// PC3-14 — aksi LPJ dikirim multipart (nominal + foto nota); aksi lain tetap JSON.
	const isMultipart = (event.request.headers.get('content-type') || '').includes('multipart/form-data');
	const form = isMultipart ? await event.request.formData().catch(() => null) : null;
	const body: Record<string, any> = form
		? {
				action: form.get('action'),
				note: form.get('note'),
				settlement_amount: form.get('settlement_amount'),
				overage_reason: form.get('overage_reason'),
				confirm_outlier: form.get('confirm_outlier') === '1'
			}
		: await event.request.json().catch(() => ({}));
	const action = String(body?.action || '').trim();
	const note = String(body?.note || '').trim();

	const row = await loadRequest(event.params.id!);
	if (!row) throw error(404, 'Pengajuan tidak ditemukan.');

	const isRequester = asId(row.requester_karyawan_id) === karyawan.id;
	const isAtasan = asId(row.atasan_karyawan_id) === karyawan.id;

	let patch: Record<string, unknown> = {};
	let evt = action;
	let actorRole = 'pemohon';
	let notifyText: string | null = null;
	let lpjBuktiIds: string[] | null = null; // foto LPJ yang baru diunggah (untuk dibersihkan bila tulis gagal)

	if (action === 'cancel' || action === 'lpj') {
		if (!isRequester) throw error(403, 'Ini bukan pengajuan Anda.');
		if (action === 'cancel') {
			if ([STATUS.POSTED, STATUS.CANCELLED, STATUS.REJECTED].includes(row.status)) {
				throw error(400, `Pengajuan berstatus "${row.status}" tidak bisa dibatalkan.`);
			}
			patch = { status: STATUS.CANCELLED };
			evt = 'cancelled';
		} else {
			if (row.mode !== 'advance' || row.status !== STATUS.POSTED) {
				throw error(400, 'LPJ hanya untuk uang muka yang sudah cair.');
			}
			if (
				row.advance_settlement_status &&
				![SETTLEMENT.MENUNGGU_LPJ, 'revisi'].includes(row.advance_settlement_status)
			) {
				throw error(400, `LPJ sudah berstatus "${row.advance_settlement_status}".`);
			}
			const amt = Math.round(Number(body?.settlement_amount) * 100) / 100;
			if (!Number.isFinite(amt) || amt <= 0) throw error(400, 'Nominal realisasi tidak valid.');

			// (2) Outlier SEBELUM unggah foto (hemat kuota): di luar 1%–150% uang muka → wajib konfirmasi eksplisit
			const advanceAmount = Number(row.approved_amount ?? row.amount) || 0;
			if (isLpjOutlier(advanceAmount, amt) && body?.confirm_outlier !== true) {
				return json(
					{
						code: 'LPJ_OUTLIER',
						message: `Nominal realisasi ${fmtRp(amt)} tidak wajar terhadap uang muka ${fmtRp(advanceAmount)} (di luar 1%–150%). Periksa kembali angkanya; bila memang benar, konfirmasi.`
					},
					{ status: 422 }
				);
			}

			// (3–4) Aturan LPJ: bukti wajib di atas ambang fund, alasan kelebihan. Mode shadow/soft → catat & lanjut; hard → 422.
			const files = form ? (form.getAll('bukti') as FormDataEntryValue[]).filter((f) => f instanceof File && f.size > 0) : [];
			if (files.length > 5) throw error(400, 'Maksimal 5 foto nota per LPJ.');
			const fundRow = await directusServerJson<{ data: any }>(
				`/items/petty_cash_funds/${asId(row.fund_id)}?fields=wajib_bukti_diatas`
			).catch((e) => {
				console.error('[ess/petty-cash] gagal baca fund untuk aturan LPJ:', e?.message || e);
				return null;
			});
			const violations = evaluateLpjRules({
				advance: advanceAmount,
				settlement: amt,
				buktiCount: files.length || (Array.isArray(row.lpj_bukti_file) ? row.lpj_bukti_file.length : 0),
				wajibBuktiDiatas: fundRow?.data?.wajib_bukti_diatas,
				maxOveragePct: await readPettyCashSetting('petty_cash.lpj_max_overage_pct', 0),
				overageReason: String(body?.overage_reason || '')
			});
			if (violations.length) {
				const mode = effectiveRulesMode(
					await readPettyCashSetting('petty_cash.lpj_rules_mode', 'shadow'),
					await readPettyCashSetting('petty_cash.lpj_rules_enforce_from', null),
					todayJakarta()
				);
				if (mode !== 'off') {
					await logLpjGateDecision({
						gate: 'G_PC_LPJ_BUKTI',
						decision: mode === 'hard' ? 'block' : 'warn',
						reason: violations.map((v) => v.message).join(' | '),
						recordId: row.id,
						email: user.email,
						snapshot: { request_number: row.request_number, settlement: amt, advance: advanceAmount, channel: 'ess_lapangan' }
					});
				}
				if (mode === 'hard') {
					return json({ code: violations[0].code, message: violations.map((v) => v.message).join(' ') }, { status: 422 });
				}
			}

			// (5) Unggah foto nota LPJ (divalidasi ukuran/isi seperti foto pengajuan, PC3-06)
			const uploaded: string[] = [];
			try {
				for (const f of files) {
					const ids = await uploadBukti(f, karyawan.id);
					if (ids) uploaded.push(...ids);
				}
			} catch (e) {
				await deleteOrphanBukti(uploaded);
				throw e;
			}
			lpjBuktiIds = uploaded.length ? uploaded : null;
			const overageReason = String(body?.overage_reason || '').trim();
			patch = {
				advance_settlement_status: SETTLEMENT.LPJ_DIAJUKAN,
				settlement_amount: amt,
				// foto LPJ disimpan TERPISAH dari foto nota pengajuan (tidak menimpa bukti_file)
				...(lpjBuktiIds ? { lpj_bukti_file: lpjBuktiIds } : {}),
				...(overageReason ? { requester_note: `${row.requester_note ? row.requester_note + ' | ' : ''}[Alasan kelebihan LPJ] ${overageReason}`.slice(0, 500) } : {}),
				// PC3-13: kirim ulang setelah dikembalikan kasir → bersihkan catatan pengembalian (jejak tetap di log admin)
				...(row.advance_settlement_status === 'revisi' ? { lpj_reject_note: null, lpj_rejected_at: null } : {})
			};
			evt = 'lpj_submitted';
		}
	} else if (['atasan_approve', 'atasan_reject', 'atasan_revisi'].includes(action)) {
		if (!isAtasan) throw error(403, 'Anda bukan atasan untuk pengajuan ini.');
		// F4 — anti self-approval: port dari erp-epi-1. Tidak ada permission-bypass di
		// kanal lapangan (lebih sederhana & lebih aman daripada admin RBAC).
		if (isRequester) throw error(403, 'Anda tidak bisa menyetujui pengajuan milik sendiri sebagai atasan.');
		if (row.status !== STATUS.MENUNGGU_ATASAN) throw error(400, `Status "${row.status}" bukan menunggu atasan.`);
		const decision = action === 'atasan_approve' ? 'approved' : action === 'atasan_reject' ? 'rejected' : 'revisi';
		if (decision !== 'approved' && !note) throw error(400, 'Alasan wajib diisi untuk tolak / minta revisi.');
		actorRole = 'atasan';
		// Paritas admin: catat keputusan & waktunya (audit/SLA memakai atasan_action_at).
		const decided = { atasan_action: decision, atasan_action_at: new Date().toISOString() };
		if (decision === 'approved') {
			const kasirId = asId(row.kasir_karyawan_id) || (await resolveKasirKaryawanId(asId(row.fund_id)!, asId(row.requester_karyawan_id)));
			patch = { ...decided, status: STATUS.MENUNGGU_KASIR, kasir_karyawan_id: kasirId, atasan_note: note || null };
			evt = 'atasan_approved';
		} else if (decision === 'rejected') {
			patch = { ...decided, status: STATUS.REJECTED, reject_reason: note, atasan_note: note };
			evt = 'atasan_rejected';
			notifyText = `Pengajuan kas kecil ${row.request_number} (${fmtRp(row.amount)}) ditolak atasan — ${note}`;
		} else {
			patch = { ...decided, status: STATUS.REVISI, atasan_note: note };
			evt = 'atasan_revisi';
			notifyText = `Pengajuan kas kecil ${row.request_number} (${fmtRp(row.amount)}) diminta revisi oleh atasan: ${note}`;
		}
	} else {
		throw error(400, `Aksi tidak dikenal: ${action}`);
	}

	// PC3-04 — tulis BERSYARAT (tabel transisi bersama dgn admin). Status sudah berubah → 409, dan
	// log/notifikasi di bawah TIDAK jalan. 'lpj' di kanal ini = lpj_submit di tabel transisi.
	const guardAction = action === 'lpj' ? 'lpj_submit' : action;
	const guard = transitionGuard(guardAction);
	if (!guard) throw error(500, 'Aksi belum terdaftar di tabel transisi.');
	if (!(await patchIf('petty_cash_requests', row.id, guard, patch))) {
		console.warn(`[ess/petty-cash] ${row.request_number}: ${action} ditolak 409 (status sudah berubah dari "${row.status}")`);
		await deleteOrphanBukti(lpjBuktiIds); // foto LPJ yang baru diunggah tak terpakai → jangan yatim
		throw error(409, conflictMessage(guardAction));
	}
	const updated = { data: { ...row, ...patch } };

	await logRequestEvent({
		requestId: row.id,
		event: evt,
		actor: user.email,
		actorName: karyawan.nama_karyawan,
		actorRole,
		statusFrom: row.status,
		statusTo: (patch.status as string) || row.status,
		note: note || null,
		meta: { action, channel: 'ess_lapangan' }
	});

	// PC3-09 — Approval Inbox diselaraskan berdasar status SESUDAH transisi (keputusan atasan dari HP, batal pemohon, dst.)
	await reconcilePcrApproval(updated.data, {
		action,
		actorKaryawanId: karyawan.id,
		note
	});
	// PC3-10 — status Pusat Pengajuan ikut berubah dari HP (batal/tolak/revisi/setuju/LPJ) — sebelumnya tak pernah diperbarui
	await syncPcrStatusToPusat(updated.data);

	if (actorRole === 'atasan') {
		const toKasir = patch.status === STATUS.MENUNGGU_KASIR;
		await notifyPending(
			toKasir ? (patch.kasir_karyawan_id as number | null) : asId(row.requester_karyawan_id),
			row.request_number,
			row.amount,
			false,
			{ sourceId: row.id, ...(notifyText ? { text: notifyText } : {}) }
		);
	}

	return json({ record: updated?.data });
};

/**
 * FLD-01 — pemohon memperbaiki tiket "Perlu Revisi" lalu langsung kirim ulang (nomor PCR tetap).
 * multipart, field sama dengan POST buat baru; foto nota opsional (kosong = pakai foto lama).
 */
export const PUT: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);

	const row = await loadRequest(event.params.id!);
	if (!row) throw error(404, 'Pengajuan tidak ditemukan.');
	if (asId(row.requester_karyawan_id) !== karyawan.id) throw error(403, 'Ini bukan pengajuan Anda.');
	if (row.status !== STATUS.REVISI) {
		throw error(400, `Hanya pengajuan berstatus "Perlu Revisi" yang bisa diperbaiki (status sekarang: "${row.status}").`);
	}

	const form = await event.request.formData();
	const p = parseRequestForm(form);
	validateRequestForm(p);
	const { mode, fundId, amount, description } = p;

	// BUG-01 — batas per-transaksi & fund aktif juga berlaku saat perbaikan revisi
	const fund = await assertFundAndAmount(fundId, amount);
	// PRJ-22: dana kerja proyek (imprest) mengunci proyek tiket ke proyek dana itu.
	if (!canUseFund(fund, karyawan.id)) throw error(403, 'Dana kerja ini hanya untuk Leader pemegangnya.');
	const imprest = resolveImprestProject(fund, p.projectId);
	if (imprest.error) throw error(400, imprest.error);
	p.projectId = imprest.projectId;

	// BUG-10 — gagal baca atasan/kasir → 503 sebelum apa pun ditulis
	const atasanRes = await resolveAtasanDetailed(karyawan.id);
	const atasanId = atasanRes.id;
	// selalu resolusi ulang: fund bisa berganti saat revisi, kasir lama tak lagi relevan
	const { kasirId } = await resolveKasir(fundId, karyawan.id);
	// PC3-07 — perbaikan revisi ke fund tanpa kasir aktif → tolak (bukan macet diam-diam).
	if (!kasirId) throw error(422, noKasirMessage(fund.fund_name));
	const nextStatus = atasanId ? STATUS.MENUNGGU_ATASAN : STATUS.MENUNGGU_KASIR;

	const newBukti = await uploadBukti(p.bukti, karyawan.id);

	const cls = await classifyDescription(description);
	let categoryCode = cls.category_code;
	let categorySource = cls.category_source;
	if (p.isInventoryIn) {
		categoryCode = 'pembelian_stok_inventory';
		categorySource = 'system_stock_in';
	}
	const expenseAccountCode = await getCategoryCoa(categoryCode);

	// Kirim ulang: bersihkan SEMUA kolom keputusan putaran sebelumnya (paritas admin BUG-14e)
	const patch: Record<string, unknown> = {
		status: nextStatus,
		mode,
		fund_id: fundId,
		project_id: p.projectId,
		needed_date: mode === 'advance' && p.neededDate ? p.neededDate.slice(0, 10) : null,
		description,
		category_code: categoryCode,
		category_source: categorySource,
		expense_account_code: expenseAccountCode,
		amount,
		payee_name: p.payeeName || null,
		receipt_number: p.receiptNumber || null,
		// Form revisi mengirim ulang seluruh isian disiplin lapangan — null = dikosongkan pemohon.
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
		gudang_id: p.isInventoryIn ? p.gudangId : null,
		requester_divisi: karyawan.divisi || fund.department || row.requester_divisi || null,
		atasan_karyawan_id: atasanId,
		kasir_karyawan_id: kasirId,
		atasan_action: null,
		atasan_action_at: null,
		atasan_note: null,
		finance_karyawan_id: null,
		finance_action: null,
		finance_action_at: null,
		finance_note: null,
		kasir_action: null,
		kasir_action_at: null,
		kasir_note: null,
		reject_reason: null
	};
	if (newBukti) patch.bukti_file = newBukti;

	// PC3-04 — perbaikan revisi hanya sah bila tiket masih draft/revisi & tak sedang dikunci proses.
	let patched = false;
	try {
		patched = await patchIf('petty_cash_requests', row.id, transitionGuard('edit')!, patch);
	} catch (e) {
		await deleteOrphanBukti(newBukti);
		throw e;
	}
	if (!patched) {
		await deleteOrphanBukti(newBukti); // status sudah berubah → foto baru tak terpakai
		throw error(409, conflictMessage('edit'));
	}
	const updated = { data: { ...row, ...patch } };

	await logRequestEvent({
		requestId: row.id,
		event: 'revised',
		actor: user.email,
		actorName: karyawan.nama_karyawan,
		statusFrom: STATUS.REVISI,
		statusTo: STATUS.REVISI,
		meta: { amount, fund_id: fundId, mode, channel: 'ess_lapangan' }
	});
	await logRequestEvent({
		requestId: row.id,
		event: 'submitted',
		actor: user.email,
		actorName: karyawan.nama_karyawan,
		statusFrom: STATUS.REVISI,
		statusTo: nextStatus,
		...(atasanRes.delegatedFrom ? { meta: { delegated_from: atasanRes.delegatedFrom } } : {}) // PC3-15
	});

	// FLD-03 — idempoten: memakai baris katalog yang sama dengan pengiriman pertama
	await syncPcrSubmitToPusat({ ...row, ...patch, id: row.id }, karyawan.id);
	// PC3-09 — kirim ulang setelah revisi: item Inbox diaktifkan ulang (returned → pending) atau dibuat
	await reconcilePcrApproval({ ...row, ...patch, id: row.id }, { action: 'submit', actorKaryawanId: karyawan.id });
	// PC3-10 — kirim ulang setelah revisi: Pusat Pengajuan kembali 'pending' (sebelumnya tertinggal 'revisi')
	await syncPcrStatusToPusat({ ...row, ...patch, id: row.id });

	const toAtasan = nextStatus === STATUS.MENUNGGU_ATASAN;
	await notifyPending(toAtasan ? atasanId : kasirId, row.request_number, amount, toAtasan, {
		sourceId: row.id,
		text: `Pengajuan kas kecil ${row.request_number} (${fmtRp(amount)}) sudah diperbaiki pemohon dan menunggu tindakan Anda.`
	});

	return json({ record: updated?.data, status: nextStatus });
};
