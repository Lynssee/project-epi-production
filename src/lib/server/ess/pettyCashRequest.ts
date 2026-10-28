// src/lib/server/ess/pettyCashRequest.ts
// SERVER-ONLY. Dukungan "Pengajuan Kas Kecil" dari dashboard lapangan (F2.4).
//
// Kanal lapangan hanya melakukan aksi milik PEMOHON: buat + kirim, sunting draf/revisi,
// batal, kirim LPJ (mode advance). Persetujuan atasan & posting jurnal oleh kasir tetap
// di dashboard admin (erp-epi-1) — koleksi Directus `petty_cash_requests` sama, jadi
// pengajuan dari lapangan langsung muncul di antre approval admin.
//
// Port ringkas dari erp-epi-1 src/lib/server/pettyCashRequest.js (mesin status penuh
// tetap di admin — di sini hanya transisi yang boleh dijalankan pemohon).

import { isKaryawanAktif, pickKasir, noKasirMessage, kasirViaNote, type KasirVia, type KasirCandidate } from '$lib/shared/pettyCashKasir';
import { error } from '@sveltejs/kit';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { checkRequestAgainstFund, duplicateWindowStartIso } from '$lib/shared/pettyCashRules';
import { createMasterPengajuanEntry } from '$lib/server/masterPengajuanSubmit';
import { masterStatusFor } from '$lib/shared/pettyCashPusatStatus';
import { pickDelegate, PETTY_CASH_MODULE_KEY } from '$lib/shared/pettyCashDelegation';
import { extractDelegatedFrom } from '$lib/shared/pettyCashRules';
import { isClientTxnConflict, normalizeTxnId } from '$lib/shared/pettyCashIdempotency';
import { todayJakarta } from '$lib/server/ess/time';

export const STATUS = {
	DRAFT: 'draft',
	MENUNGGU_ATASAN: 'menunggu_atasan',
	MENUNGGU_FINANCE: 'menunggu_finance', // dijalankan admin; lapangan hanya perlu mengenali labelnya
	MENUNGGU_KASIR: 'menunggu_kasir',
	POSTED: 'posted',
	REJECTED: 'rejected',
	REVISI: 'revisi',
	CANCELLED: 'cancelled'
} as const;

export const SETTLEMENT = {
	MENUNGGU_LPJ: 'menunggu_lpj',
	LPJ_DIAJUKAN: 'lpj_diajukan',
	SELESAI: 'selesai'
} as const;

export const FALLBACK_CATEGORY_CODE = 'ops_lainnya';

export const REQUEST_FIELDS = [
	'id', 'request_number', 'mode', 'status', 'requester_karyawan_id', 'requester_name',
	'requester_divisi', 'fund_id', 'project_id', 'request_date', 'needed_date', 'description',
	'category_code', 'category_source', 'expense_account_code', 'amount', 'approved_amount',
	'payee_name', 'receipt_number', 'bukti_file', 'source_channel', 'requester_note',
	'atasan_karyawan_id', 'atasan_action', 'atasan_action_at', 'atasan_note',
	'finance_karyawan_id', 'finance_action', 'finance_note',
	'kasir_karyawan_id', 'kasir_action', 'kasir_note', 'reject_reason',
	'journal_entry_id', 'posted_at', 'advance_settlement_status', 'settlement_amount',
	'settlement_diff', 'settlement_at', 'hold_reason', 'hold_since', 'lpj_reject_note', 'lpj_rejected_at', 'lpj_bukti_file',
	'liter_bbm', 'vehicle_ref_id', 'odometer_km', 'hm_alat', 'receipt_date',
	// Integrasi Petty Cash untuk Pembelian Stok Persediaan (Cash Purchase / Stock-IN)
	'is_inventory_in', 'inventory_item_id', 'inventory_qty', 'gudang_id',
	'date_created', 'date_updated'
].join(',');

const asId = (v: any): number | null =>
	v == null ? null : typeof v === 'object' ? (v.id ?? null) : v;

/**
 * BUG-10 (audit petty cash) — gagal baca data resolusi (atasan/kasir) BUKAN "tidak ada atasan".
 * Sebelumnya `.catch(() => null)` membuat error transien terbaca "tanpa atasan" sehingga tiket
 * melompat ke kasir. Sekarang 503 tanpa mengubah/membuat tiket; pemohon tinggal coba lagi.
 */
async function readOrUnavailable<T>(url: string, what: string): Promise<T> {
	try {
		return await directusServerJson<T>(url);
	} catch (e) {
		console.error(`[ess/pettyCashRequest] gagal baca ${what}:`, (e as Error)?.message || e);
		throw error(503, `Data ${what} sedang tidak dapat dibaca. Coba lagi beberapa saat — pengajuan Anda belum terkirim.`);
	}
}

/** BUG-01 — validasi fund & nominal (POST dan PUT revisi). Lempar 400/404/503 bila ditolak; return fund bila lolos. */
export async function assertFundAndAmount(fundId: number, amount: number) {
	const res = await readOrUnavailable<{ data: any }>(
		`/items/petty_cash_funds/${fundId}?fields=id,fund_name,status,department,ceiling_per_transaksi,lpj_batas_hari,fund_type,project_id,custodian_karyawan_id,backup_custodian_karyawan_id`,
		'dana kas kecil'
	);
	const fund = res?.data || null;
	if (!fund) throw error(404, 'Dana kas kecil tidak ditemukan.');
	const msg = checkRequestAgainstFund(fund, amount);
	if (msg) throw error(400, msg);
	return fund;
}

/**
 * FLD-04 — deteksi tiket ganda (timeout lalu Kirim lagi). Cari tiket aktif milik pemohon dengan
 * fund+nominal+uraian identik dalam 10 menit terakhir. Peringatan lunak: UI boleh mengirim ulang
 * dengan allow_duplicate. Gagal cek → jangan blokir pengajuan (log saja).
 */
export async function findRecentDuplicate(p: {
	requesterId: number;
	fundId: number;
	amount: number;
	description: string;
}): Promise<any | null> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/petty_cash_requests?limit=1&sort=-date_created&fields=id,request_number,status,amount,date_created` +
				`&filter[requester_karyawan_id][_eq]=${p.requesterId}&filter[fund_id][_eq]=${p.fundId}` +
				`&filter[amount][_eq]=${p.amount}&filter[description][_eq]=${encodeURIComponent(p.description)}` +
				`&filter[status][_nin]=cancelled,rejected&filter[date_created][_gte]=${encodeURIComponent(duplicateWindowStartIso())}`
		);
		return res?.data?.[0] || null;
	} catch (e) {
		console.warn('[ess/pettyCashRequest] cek tiket ganda gagal (dilewati):', (e as Error)?.message);
		return null;
	}
}

function yymm(d = new Date()): string {
	return `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** PCR-YYMM-NNNN, urut per bulan. */
export async function generateRequestNumber(): Promise<string> {
	const prefix = `PCR-${yymm()}-`;
	const res = await directusServerJson<{ data: { request_number: string }[] }>(
		`/items/petty_cash_requests?limit=1&sort=-request_number&fields=request_number` +
			`&filter[request_number][_starts_with]=${encodeURIComponent(prefix)}`
	).catch(() => ({ data: [] }));
	const last = res?.data?.[0]?.request_number || '';
	const n = last ? parseInt(last.split('-').pop() || '0', 10) : 0;
	return `${prefix}${String((Number.isNaN(n) ? 0 : n) + 1).padStart(4, '0')}`;
}

// Fase 1 Petty Cash ESS v2 (§9 Q4) — port dari erp-epi-1 pettyCashRequest.js, supaya
// perilaku lapangan konsisten dengan admin (bukan cuma bug-fix di satu sisi kanal).
// Fallback approver saat karyawan tidak punya atasan_id maupun atasan_fungsional_id.
// Config: system_settings `petty_cash.fallback_approver_jabatan_ids` (array id posisi,
// urutan = urutan eskalasi). Kosong = tidak ada fallback (perilaku lama).
async function resolveFallbackApproverKaryawanId(excludeKaryawanId: number | null): Promise<number | null> {
	const raw = await readOrUnavailable<{ data: { setting_value: any }[] }>(
		`/items/system_settings?limit=1&fields=setting_value&filter[setting_key][_eq]=petty_cash.fallback_approver_jabatan_ids`,
		'setelan approver cadangan'
	);
	let jabatanIds: unknown[] = [];
	try {
		const v = raw?.data?.[0]?.setting_value;
		jabatanIds = Array.isArray(v) ? v : JSON.parse(String(v ?? '[]'));
	} catch {
		jabatanIds = [];
	}
	if (!Array.isArray(jabatanIds) || jabatanIds.length === 0) return null;
	for (const jabatanId of jabatanIds) {
		if (jabatanId == null) continue;
		const res = await readOrUnavailable<{ data: any[] }>(
			`/items/karyawan?limit=1&sort=id&fields=id&filter[jabatan_id][_eq]=${encodeURIComponent(String(jabatanId))}` +
				`&filter[status][_eq]=On` +
				(excludeKaryawanId ? `&filter[id][_neq]=${encodeURIComponent(String(excludeKaryawanId))}` : ''),
			'approver cadangan'
		);
		const found = asId(res?.data?.[0]);
		if (found) return found;
	}
	return null;
}

/**
 * PC3-15 — ganti penerima dengan delegasi aktif (cuti) untuk modul kas kecil / '*' (kembar admin applyDelegation).
 * Delegasi ke pemohon dilewati. Gagal baca → 503 (fail-closed seperti resolusi lain).
 */
export async function applyDelegation(
	karyawanId: number | null,
	requesterId: number | null = null
): Promise<{ id: number | null; delegatedFrom: number | null }> {
	if (!karyawanId) return { id: null, delegatedFrom: null };
	const today = todayJakarta();
	const filter = encodeURIComponent(
		JSON.stringify({
			_and: [
				{ from_user: { _eq: Number(karyawanId) } },
				{ is_active: { _eq: true } },
				{ start_date: { _lte: today } },
				{ end_date: { _gte: today } },
				{ module_key: { _in: [PETTY_CASH_MODULE_KEY, '*'] } }
			]
		})
	);
	const res = await readOrUnavailable<{ data: any[] }>(
		`/items/approval_delegations?limit=-1&fields=from_user,to_user,module_key,start_date,end_date,is_active&filter=${filter}`,
		'delegasi approver'
	);
	const to = pickDelegate(Array.isArray(res?.data) ? res.data : [], karyawanId, { requesterId, todayIso: today });
	return to ? { id: to, delegatedFrom: Number(karyawanId) } : { id: Number(karyawanId), delegatedFrom: null };
}

/** Atasan tahap-1 + info delegasi (untuk jejak "atas nama <atasan> (delegasi)" di log tiket). */
export async function resolveAtasanDetailed(karyawanId: number): Promise<{ id: number | null; delegatedFrom: number | null }> {
	if (!karyawanId) return { id: null, delegatedFrom: null };
	const res = await readOrUnavailable<{ data: any }>(
		`/items/karyawan/${karyawanId}?fields=id,atasan_id,atasan_fungsional_id`,
		'atasan pemohon'
	);
	const k = res?.data;
	const direct = asId(k?.atasan_id) || asId(k?.atasan_fungsional_id);
	// atasan tidak boleh pemohon sendiri (salah tautan data karyawan) → lanjut fallback
	const base = direct && String(direct) !== String(karyawanId) ? direct : await resolveFallbackApproverKaryawanId(karyawanId);
	// penerima delegasi disimpan sebagai atasan_karyawan_id tiket → cek isAtasan yang lama tetap bekerja
	return applyDelegation(base, karyawanId);
}

/** Atasan tahap-1: karyawan.atasan_id → atasan_fungsional_id → fallback jabatan → delegasi cuti (PC3-15). */
export async function resolveAtasanKaryawanId(karyawanId: number): Promise<number | null> {
	return (await resolveAtasanDetailed(karyawanId)).id;
}

/** Tambahkan delegated_from_id / delegated_from_name ke antrean atasan (2 panggilan, hanya bila ada baris). */
export async function attachDelegatedFrom(rows: any[]): Promise<any[]> {
	const list = Array.isArray(rows) ? rows : [];
	if (!list.length) return list;
	try {
		const ids = list.map((r) => r.id).join(',');
		const logs = await directusServerJson<{ data: any[] }>(
			`/items/petty_cash_request_logs?limit=-1&sort=id&fields=request_id,meta&filter[event][_eq]=submitted&filter[request_id][_in]=${ids}`
		);
		const map = extractDelegatedFrom(logs?.data);
		const froms = [...new Set([...map.values()].filter((v): v is number => !!v))];
		const names = new Map<number, string>();
		if (froms.length) {
			const kar = await directusServerJson<{ data: any[] }>(`/items/karyawan?limit=-1&fields=id,nama_karyawan&filter[id][_in]=${froms.join(',')}`);
			for (const k of kar?.data || []) names.set(Number(k.id), k.nama_karyawan);
		}
		return list.map((r) => {
			const from = map.get(String(r.id)) || null;
			return from ? { ...r, delegated_from_id: from, delegated_from_name: names.get(from) || `#${from}` } : r;
		});
	} catch (e: any) {
		console.error('[ess/pettyCashRequest] gagal memuat jejak delegasi (kartu tampil tanpa info delegasi):', e?.message || e);
		return list;
	}
}

/** Kasir tahap-2 = kustodian dana. */
export async function resolveCustodianKaryawanId(fundId: number): Promise<number | null> {
	if (!fundId) return null;
	const res = await readOrUnavailable<{ data: any }>(
		`/items/petty_cash_funds/${fundId}?fields=id,custodian_karyawan_id`,
		'kustodian dana'
	);
	return asId(res?.data?.custodian_karyawan_id) || null;
}

/**
 * Kasir tahap-2 dengan cadangan berjenjang (PC3-07): kustodian → cadangan → kustodian Fund Pusat
 * (PCF-PST-001) → cadangan Pusat. Dilewati bila = pemohon (anti self-approval) atau karyawan Off.
 * `via` dipakai untuk pesan notifikasi ("kasir pengganti"). Logika murni: shared/pettyCashKasir.ts.
 */
export async function resolveKasir(
	fundId: number,
	requesterKaryawanId: number | null
): Promise<{ kasirId: number | null; via: KasirVia | null }> {
	if (!fundId) return { kasirId: null, via: null };
	const fund = await readOrUnavailable<{ data: any }>(
		`/items/petty_cash_funds/${fundId}?fields=id,custodian_karyawan_id,backup_custodian_karyawan_id`,
		'kustodian dana'
	);
	const pusat = await readOrUnavailable<{ data: any[] }>(
		`/items/petty_cash_funds?limit=1&fields=custodian_karyawan_id,backup_custodian_karyawan_id&filter[fund_code][_eq]=PCF-PST-001`,
		'kustodian dana pusat'
	);
	const candidates: KasirCandidate[] = [
		[asId(fund?.data?.custodian_karyawan_id), 'custodian'],
		[asId(fund?.data?.backup_custodian_karyawan_id), 'backup'],
		[asId(pusat?.data?.[0]?.custodian_karyawan_id), 'pusat'],
		[asId(pusat?.data?.[0]?.backup_custodian_karyawan_id), 'pusat_backup']
	];
	const ids = [
		...new Set(candidates.map(([id]) => id).filter((id) => id && String(id) !== String(requesterKaryawanId ?? '')))
	];
	if (!ids.length) return { kasirId: null, via: null };
	const kar = await readOrUnavailable<{ data: any[] }>(
		`/items/karyawan?limit=-1&fields=id,status&filter[id][_in]=${ids.join(',')}`,
		'status kasir'
	);
	const activeIds = new Set((kar?.data || []).filter(isKaryawanAktif).map((k) => String(k.id)));
	const picked = pickKasir(candidates, requesterKaryawanId, activeIds);
	if (!picked.kasirId) return picked;
	// PC3-15 — kasir yang cuti/didelegasikan diganti penerima delegasi (bukan pemohon)
	const del = await applyDelegation(picked.kasirId, requesterKaryawanId);
	return del.delegatedFrom ? { kasirId: del.id, via: picked.via } : picked;
}

/** Kompatibel dengan pemanggil lama: hanya id kasir (atau null). */
export async function resolveKasirKaryawanId(
	fundId: number,
	requesterKaryawanId: number | null
): Promise<number | null> {
	return (await resolveKasir(fundId, requesterKaryawanId)).kasirId;
}

export { noKasirMessage, kasirViaNote };

// ── Klasifikasi deskripsi → kategori (port pettyCashClassifier.js) ─────────────
function normalizeDescription(desc: string): string {
	let s = String(desc || '').trim();
	const m = s.match(/^[^-:–]{1,40}?\s*[-:–]\s*(.+)$/);
	if (m && /biaya|ops|isi|beli|bayar|reimburse|kasbon|pindah|penarikan|tambahan|kirim/i.test(m[1])) {
		s = m[1];
	}
	return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

interface Rule {
	keyword: string;
	match_mode?: string;
	category_code: string;
	priority?: number;
	is_active?: boolean;
}

function classify(description: string, rules: Rule[]): string | null {
	const text = normalizeDescription(description);
	if (!text || !Array.isArray(rules) || rules.length === 0) return null;
	const active = rules
		.filter((r) => r && r.is_active !== false && r.keyword && r.category_code)
		.slice()
		.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
	for (const r of active) {
		const kw = String(r.keyword).toLowerCase().trim();
		if (!kw) continue;
		let hit = false;
		try {
			if (r.match_mode === 'regex') hit = new RegExp(r.keyword, 'i').test(text);
			else if (r.match_mode === 'starts_with') hit = text.startsWith(kw);
			else hit = text.includes(kw);
		} catch {
			hit = text.includes(kw);
		}
		if (hit) return r.category_code;
	}
	return null;
}

export async function classifyDescription(
	description: string
): Promise<{ category_code: string; category_source: string }> {
	const rulesRes = await directusServerJson<{ data: Rule[] }>(
		`/items/petty_cash_category_rules?limit=-1&filter[is_active][_eq]=true` +
			`&fields=keyword,match_mode,category_code,priority,is_active`
	).catch(() => ({ data: [] }));
	const hit = classify(description, rulesRes?.data || []);
	return hit
		? { category_code: hit, category_source: 'auto' }
		: { category_code: FALLBACK_CATEGORY_CODE, category_source: 'fallback' };
}

/** COA beban default dari kategori (m2o → chart_of_accounts). */
export async function getCategoryCoa(categoryCode: string): Promise<string | null> {
	if (!categoryCode) return null;
	const res = await directusServerJson<{ data: any[] }>(
		`/items/petty_cash_categories?limit=1&filter[category_code][_eq]=${encodeURIComponent(categoryCode)}` +
			`&fields=category_code,expense_account_code.account_code`
	).catch(() => ({ data: [] }));
	const coa = res?.data?.[0]?.expense_account_code;
	return coa && typeof coa === 'object' ? coa.account_code || null : (coa ?? null);
}

/**
 * BUG-08a — buat tiket dengan nomor PCR baru; bila nomor bentrok (dua pemohon membaca nomor terakhir yang
 * sama → error unik request_number) ambil nomor berikutnya dan coba lagi (≤ 4×, jeda acak kecil).
 * Foto nota sebaiknya sudah terunggah SEBELUM ini agar retry tidak mengunggah ulang.
 */
/** PC3-19 — tiket dengan client_txn_id ini (kirim ulang karena timeout → tiket yang sama). */
export async function findRequestByTxn(clientTxnId: string | null): Promise<any | null> {
	if (!clientTxnId) return null;
	const r = await directusServerJson<{ data: any[] }>(
		`/items/petty_cash_requests?limit=1&fields=${REQUEST_FIELDS}&filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}`
	);
	return r?.data?.[0] || null;
}

export async function createRequestWithUniqueNumber(
	buildPayload: (requestNumber: string) => Record<string, unknown>,
	opts: { clientTxnId?: string | null } = {}
): Promise<any> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < 4; attempt++) {
		const requestNumber = await generateRequestNumber();
		try {
			const created = await directusServerJson<{ data: any }>('/items/petty_cash_requests', {
				method: 'POST',
				body: JSON.stringify(buildPayload(requestNumber))
			});
			if (created?.data?.id) return created.data;
			lastErr = new Error('Gagal menyimpan pengajuan.');
		} catch (e) {
			lastErr = e;
			if (!/unique|duplicate/i.test((e as Error)?.message || '')) throw e;
			// PC3-19 — bentrok pada client_txn_id (race dua request berkunci sama) = TIKET YANG SAMA: kembalikan yang sudah ada
			if (opts.clientTxnId && isClientTxnConflict(e)) {
				const ex = await findRequestByTxn(opts.clientTxnId);
				if (ex) return Object.assign(ex, { _idempotent: true });
			}
			await new Promise((r) => setTimeout(r, 30 + Math.floor(Math.random() * 120)));
		}
	}
	throw lastErr || new Error('Gagal menyimpan pengajuan.');
}

/**
 * FLD-03 — daftarkan tiket ke katalog Pusat Pengajuan (kembar admin syncPcrSubmitToPusat). Idempoten per
 * tiket (clientTxnId), jadi kirim ulang setelah revisi tidak menggandakan baris. Best-effort: tidak
 * boleh menggagalkan pengajuan aslinya.
 */
export async function syncPcrSubmitToPusat(row: any, pengajuId: number): Promise<boolean> {
	try {
		await createMasterPengajuanEntry({
			kategori: 'keuangan',
			jenisPengajuan: 'PCR',
			judul: `Kas Kecil — ${String(row.description || row.request_number || '').slice(0, 180)}`,
			deskripsi: row.description || null,
			totalAmount: Number(row.amount) || 0,
			pengajuId,
			departmentKey: row.requester_divisi || null,
			projectId: asId(row.project_id),
			detailRefCollection: 'petty_cash_requests',
			detailRefId: row.id,
			sourceApp: 'field',
			clientTxnId: `pcr:${row.id}:submit`
		});
		return true;
	} catch (e) {
		console.warn('[ess/pettyCashRequest] sinkron Pusat Pengajuan gagal (diabaikan):', (e as Error)?.message);
		return false;
	}
}

/** Cari baris katalog tiket ini lalu ubah statusnya. @returns id baris, atau null bila tak ada. */
async function updateMasterStatusByTicket(ticketId: number | string, status: string): Promise<string | null> {
	const found = await directusServerJson<{ data: any[] }>(
		`/items/master_pengajuan?filter[detail_ref_collection][_eq]=petty_cash_requests` +
			`&filter[detail_ref_id][_eq]=${encodeURIComponent(String(ticketId))}&limit=1&fields=id`
	);
	const id = found?.data?.[0]?.id;
	if (!id) return null;
	await directusServerJson(`/items/master_pengajuan/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
	return id;
}

/**
 * PC3-10 — selaraskan master_pengajuan.status dengan status tiket SESUDAH transisi (kembar admin
 * syncPcrStatusToPusat). Idempoten. Baris katalog belum ada (tiket lama) → dibuat via clientTxnId lalu diselaraskan.
 * Best-effort: TIDAK menggagalkan transisi, tetapi kegagalan tercatat console.error.
 */
export async function syncPcrStatusToPusat(rowAfter: any): Promise<boolean> {
	const status = masterStatusFor(rowAfter);
	if (!status || !rowAfter?.id) return false;
	try {
		let id = await updateMasterStatusByTicket(rowAfter.id, status);
		if (!id && (await syncPcrSubmitToPusat(rowAfter, asId(rowAfter.requester_karyawan_id) as number))) {
			id = await updateMasterStatusByTicket(rowAfter.id, status);
		}
		if (!id) console.error(`[ess/pettyCashRequest] master_pengajuan tidak ditemukan / gagal update untuk tiket ${rowAfter.id} → ${status}`);
		return !!id;
	} catch (e) {
		console.error(`[ess/pettyCashRequest] sinkron status Pusat Pengajuan tiket ${rowAfter?.id} gagal:`, (e as Error)?.message || e);
		return false;
	}
}

/** Jejak audit — best-effort. */
export async function logRequestEvent(entry: {
	requestId: number | string;
	event: string;
	actor?: string;
	actorName?: string | null;
	actorRole?: string;
	statusFrom?: string | null;
	statusTo?: string | null;
	note?: string | null;
	meta?: Record<string, unknown> | null;
}): Promise<void> {
	try {
		await directusServerJson('/items/petty_cash_request_logs', {
			method: 'POST',
			body: JSON.stringify({
				request_id: entry.requestId,
				event: entry.event,
				actor: entry.actor || 'system',
				actor_name: entry.actorName || null,
				actor_role: entry.actorRole || 'pemohon',
				status_from: entry.statusFrom || null,
				status_to: entry.statusTo || null,
				note: entry.note || null,
				meta: entry.meta ? JSON.stringify(entry.meta) : null
			})
		});
	} catch (e) {
		console.warn('[ess/pettyCashRequest] gagal tulis log:', (e as Error)?.message);
	}
}

/** Notifikasi in-app ke pihak yang harus bertindak berikutnya (best-effort).
 * Tulis langsung ke `app_notifications` — sama seperti notificationHub in_app di admin. */
export async function notifyPending(
	karyawanId: number | null,
	requestNumber: string,
	amount: number,
	toAtasan: boolean,
	opts: { sourceId?: number | string | null; text?: string } = {}
): Promise<void> {
	if (!karyawanId) return;
	try {
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'petty_cash_request_pending',
				title: 'Pengajuan Kas Kecil',
				// BUG-15: teks kustom memuat alasan revisi/tolak; default = menunggu tindakan penerima.
				message:
					opts.text ||
					`Pengajuan kas kecil ${requestNumber} (Rp ${Math.round(amount).toLocaleString('id-ID')}) dari lapangan menunggu tindakan Anda.`,
				priority: 'medium',
				source_collection: 'petty_cash_requests',
				source_id: opts.sourceId != null ? String(opts.sourceId) : null,
				karyawan_id: karyawanId,
				action_required: true,
				action_url: toAtasan ? '/ess/petty-cash' : '/finance?tab=petty-cash',
				module: 'finance',
				read: false,
				created_at: new Date().toISOString()
			})
		});
	} catch (e) {
		console.warn('[ess/pettyCashRequest] gagal tulis notifikasi:', (e as Error)?.message);
	}
}

export async function loadRequest(id: string | number) {
	const res = await directusServerJson<{ data: any }>(
		`/items/petty_cash_requests/${id}?fields=${REQUEST_FIELDS}`
	).catch(() => null);
	return res?.data || null;
}

const MAX_AMOUNT = 100_000_000;

/** Field form (multipart) yang dipakai POST baru maupun PUT revisi. */
export function parseRequestForm(form: FormData) {
	const mode = form.get('mode')?.toString() === 'advance' ? 'advance' : 'reimburse';
	const fundId = Number(form.get('fund_id'));
	const amount = Math.round(Number(form.get('amount')) * 100) / 100;
	const description = (form.get('description')?.toString() || '').trim();
	const neededDate = form.get('needed_date')?.toString() || '';
	return {
		mode: mode as 'reimburse' | 'advance',
		fundId,
		amount,
		description,
		payeeName: (form.get('payee_name')?.toString() || '').trim(),
		receiptNumber: (form.get('receipt_number')?.toString() || '').trim(),
		neededDate,
		projectId: form.get('project_id') ? Number(form.get('project_id')) : null,
		bukti: form.get('bukti'),
		allowDuplicate: form.get('allow_duplicate')?.toString() === '1',
		// PC3-19: kunci idempoten dari klien (UUID per pengisian form)
		clientTxnId: normalizeTxnId(form.get('client_txn_id')),
		// Fase 2/F1 lanjutan "Gate Disiplin Lapangan" (6 Okt 2026): dasar G_PC_VISIT/
		// G_P2H_ALAT_BBM_PC/jatah darurat — opsional, kosong = N/A di gate (perilaku lama).
		siteCheckinId: (form.get('site_checkin_id')?.toString() || '').trim() || null,
		visitException: (form.get('visit_exception')?.toString() || '').trim() || null,
		equipmentRefId: (form.get('equipment_ref_id')?.toString() || '').trim() || null,
		literBbm: form.get('liter_bbm') ? Number(form.get('liter_bbm')) : null,
		// Interlocking Kas Kecil Fase 3 (13 Okt 2026): dasar G_PC_BBM_VEHICLE_P2H/ODOMETER/EQUIPMENT_HM/RECEIPT_INTEGRITY.
		vehicleRefId: form.get('vehicle_ref_id') ? Number(form.get('vehicle_ref_id')) : null,
		odometerKm: form.get('odometer_km') ? Number(form.get('odometer_km')) : null,
		hmAlat: form.get('hm_alat') ? Number(form.get('hm_alat')) : null,
		receiptDate: (form.get('receipt_date')?.toString() || '').trim().slice(0, 10) || null,
		// Integrasi Kas Kecil Pembelian Stok Persediaan (Cash Purchase / Stock-IN)
		isInventoryIn: form.get('is_inventory_in')?.toString() === '1' || form.get('is_inventory_in')?.toString() === 'true',
		inventoryItemId: form.get('inventory_item_id') ? Number(form.get('inventory_item_id')) : null,
		inventoryQty: form.get('inventory_qty') ? Number(form.get('inventory_qty')) : null,
		gudangId: form.get('gudang_id') ? Number(form.get('gudang_id')) : null
	};
}

export function validateRequestForm(p: {
	fundId: number;
	amount: number;
	description: string;
	vehicleRefId?: number | null;
	odometerKm?: number | null;
	receiptDate?: string | null;
	isInventoryIn?: boolean;
	inventoryItemId?: number | null;
	inventoryQty?: number | null;
	gudangId?: number | null;
}) {
	if (!Number.isFinite(p.fundId) || p.fundId <= 0) throw error(400, 'Pilih dana kas kecil.');
	if (!Number.isFinite(p.amount) || p.amount <= 0 || p.amount > MAX_AMOUNT) throw error(400, 'Nominal tidak valid.');
	if (p.description.length < 5) throw error(400, 'Uraian keperluan minimal 5 karakter.');
	// Keputusan Lead (13 Okt 2026): klaim BBM kendaraan WAJIB KM odometer + tanggal nota. Hanya berlaku bila kendaraan
	// dipilih (klaim tanpa kendaraan terdaftar tidak dikunci). Tanggal nota tidak boleh di masa depan.
	if (p.vehicleRefId != null) {
		if (!Number.isFinite(p.vehicleRefId) || p.vehicleRefId <= 0) throw error(400, 'Kendaraan tidak valid.');
		if (p.odometerKm == null || !Number.isFinite(p.odometerKm) || p.odometerKm <= 0) throw error(400, 'Isi angka KM odometer saat isi BBM.');
		if (!p.receiptDate) throw error(400, 'Isi tanggal pada nota BBM.');
	}
	if (p.receiptDate) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(p.receiptDate) || Number.isNaN(Date.parse(p.receiptDate))) throw error(400, 'Tanggal nota tidak valid.');
		const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
		if (p.receiptDate > today) throw error(400, 'Tanggal nota tidak boleh di masa depan.');
	}
	// Integrasi Stock-IN Kas Kecil: jika ditandai masuk persediaan, wajib lengkapi barang, kuantitas, dan gudang.
	if (p.isInventoryIn) {
		if (!p.inventoryItemId || p.inventoryItemId <= 0) throw error(400, 'Pilih barang inventori/workshop yang dibeli.');
		if (!p.inventoryQty || p.inventoryQty <= 0) throw error(400, 'Isi kuantitas barang yang dibeli (harus lebih dari 0).');
		if (!p.gudangId || p.gudangId <= 0) throw error(400, 'Pilih gudang tujuan penyimpanan barang.');
	}
}

export const BUKTI_MAX_BYTES = 10 * 1024 * 1024;

/** Deteksi jenis dari magic bytes (bukan ekstensi/MIME kiriman klien). */
export function detectImageExt(head: Uint8Array): 'jpg' | 'png' | 'webp' | null {
	if (head[0] === 0xff && head[1] === 0xd8) return 'jpg';
	if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
	// RIFF....WEBP
	if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'webp';
	return null;
}

/** Unggah foto nota (opsional) → id file Directus. Validasi ukuran & isi (PC3-06). */
export async function uploadBukti(bukti: FormDataEntryValue | null, karyawanId: number): Promise<string[] | null> {
	if (!(bukti instanceof File) || bukti.size <= 0) return null;
	if (bukti.size > BUKTI_MAX_BYTES) throw error(413, 'Foto nota maksimal 10 MB. Foto ulang dengan ukuran lebih kecil, atau kirim tanpa foto dan serahkan nota fisik ke kasir.');
	const ext = detectImageExt(new Uint8Array(await bukti.slice(0, 12).arrayBuffer()));
	if (!ext) throw error(415, 'File harus berupa foto (JPG/PNG/WEBP).');
	const up = new FormData();
	up.append('file', bukti, `pcr-${karyawanId}-${Date.now()}.${ext}`);
	const upRes = await directusServerUpload(up);
	if (!upRes.ok) throw error(502, 'Gagal mengunggah foto nota.');
	const uploaded = await upRes.json();
	return uploaded?.data?.id ? [uploaded.data.id] : null;
}

/**
 * Hapus file yang baru diunggah bila pembuatan/pembaruan tiket gagal (cegah foto yatim menumpuk).
 * Best-effort: kegagalan hanya dicatat, tidak menutupi error aslinya.
 */
export async function deleteOrphanBukti(ids: string[] | null | undefined): Promise<void> {
	for (const id of ids || []) {
		try {
			await directusServerJson(`/files/${id}`, { method: 'DELETE' });
		} catch (e: any) {
			console.error(`[ess/petty-cash] gagal hapus foto yatim ${id}:`, e?.message || e);
		}
	}
}

export { asId };
