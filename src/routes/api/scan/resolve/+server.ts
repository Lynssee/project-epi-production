// src/routes/api/scan/resolve/+server.ts
// Resolver tunggal untuk QR Surat Jalan (Keputusan D1/rencana v2.0 Bab 6.2): parse →
// lookup record → baca peran user dari sesi → allowedActions[]. Klien hanya merutekan
// berdasarkan allowedActions; tidak ada aturan bisnis peran di klien.
//
// Lingkup: tipe QR 'SJ' (EPI:SJ:<id>:<token>) dan 'RTN' (EPI:RTN:<id>:<token>,
// dokumen retur_gudang — 4-Gate Retur Gudang v2 Fase 1). Tipe checkpoint GA/Satpam &
// label inventory (ITEM/LOC/BATCH) tetap lewat resolver masing-masing yang sudah ada
// (resolveCheckpoint, halaman /scan/[code] untuk label inventory).

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';
import { parseEpiQr } from '$lib/utils/qrParse';

interface SuratJalanRow {
	id: number;
	nomor_sj: string;
	status: string;
	driver: string | null;
	qr_token: string | null;
	type: string | null;
	so_customer_id: { customer_name: string | null; kode_customer: string | null } | null;
}

interface CiketingSjkRow {
	id: number;
	no_sj: string;
	status_kirim: string | null;
	diterima_oleh: string | null;
	diterima_at: string | null;
	qr_token: string | null;
	approval_status?: string | null;
	security_verified_at?: string | null;
}

interface ReturGudangRow {
	id: number;
	nomor_retur: string;
	status: string;
	qr_token: string | null;
	project_id: number | null;
	sumber: string | null;
	driver_name: string | null;
}

// 4-Gate Retur Gudang v2 Fase 1 — matriks aksi dokumen retur per peran.
//   satpam (gate_log)                      -> verify_gate  (Gate 1: verifikasi sebelum barang masuk)
//   gudang/leader (input_stock_lapangan)   -> receive_retur (+ view)
//   admin (view_all_projects/admin_panel)  -> view_detail
//   lainnya                                -> view_summary
async function resolveRetur(id: number | string, token: string, permissions: string[]) {
	const res = await directusServerJson<{ data: ReturGudangRow }>(
		`/items/retur_gudang/${id}?fields=id,nomor_retur,status,qr_token,project_id,sumber,driver_name`
	).catch(() => null);
	const rtn = res?.data;
	if (!rtn) throw error(404, 'Dokumen retur tidak ditemukan.');
	if (!rtn.qr_token || rtn.qr_token !== token) {
		throw error(400, 'Token QR tidak cocok — kemungkinan QR rusak atau sudah tidak berlaku.');
	}

	let role: 'satpam' | 'project_leader' | 'admin_finance' | 'other' = 'other';
	const allowedActions: string[] = [];
	if (hasAnyPermission(permissions, 'gate_log')) {
		role = 'satpam';
		allowedActions.push('verify_gate');
	} else if (hasAnyPermission(permissions, 'input_stock_lapangan')) {
		role = 'project_leader';
		allowedActions.push('receive_retur', 'view');
	} else if (hasAnyPermission(permissions, ['view_all_projects', 'admin_panel'])) {
		role = 'admin_finance';
		allowedActions.push('view_detail');
	} else {
		allowedActions.push('view_summary');
	}

	return json({
		kind: 'retur_gudang',
		retur: {
			id: rtn.id,
			nomorRetur: rtn.nomor_retur,
			status: rtn.status,
			projectId: rtn.project_id,
			sumber: rtn.sumber,
			driver: rtn.driver_name
		},
		role,
		allowedActions
	});
}

// R7 (24 Sep 2026) — Gate Ketat v2 SJ Keluar Ciketing: serah-terima digital via QR
// CIK-SJK-V2 (chokepoint cetak baru, erp-epi). Siapa pun yang login boleh confirm_receipt
// (mirror pengecualian D3 SJ peminjaman di atas — penerima barang customer di lapangan
// biasanya bukan staf sistem, tidak punya permission khusus). Sekali diterima
// (diterima_at terisi), hanya view_summary — cegah re-submit/dobel.
// Fase 7 Unifikasi Workshop: Balaraja memakai jalur yang sama (QR BLJ-SJK-V2, koleksi balaraja_surat_jalan_keluar).
async function resolveWorkshopSjk(workshop: 'ciketing' | 'balaraja', id: number | string, token: string) {
	const label = workshop === 'balaraja' ? 'Balaraja' : 'Ciketing';
	const res = await directusServerJson<{ data: CiketingSjkRow }>(
		`/items/${workshop}_surat_jalan_keluar/${id}?fields=id,no_sj,status_kirim,diterima_oleh,diterima_at,qr_token,approval_status,security_verified_at`
	).catch(() => null);
	const sjk = res?.data;
	if (!sjk) throw error(404, `SJ Keluar ${label} tidak ditemukan.`);
	if (!sjk.qr_token || sjk.qr_token !== token) {
		throw error(400, 'Token QR tidak cocok — kemungkinan QR rusak atau sudah tidak berlaku.');
	}

	const allowedActions: string[] = [];
	if (sjk.diterima_at) {
		allowedActions.push('view_summary');
	} else {
		allowedActions.push('confirm_receipt', 'view_summary');
	}

	return json({
		kind: `${workshop}_sjk`,
		workshop,
		sjk: {
			id: sjk.id,
			noSj: sjk.no_sj,
			statusKirim: sjk.status_kirim,
			diterimaOleh: sjk.diterima_oleh,
			diterimaAt: sjk.diterima_at,
			// WSK-14 §4e: ringkasan untuk penerima sebelum menekan Konfirmasi
			approvalStatus: sjk.approval_status ?? null,
			securityVerified: !!sjk.security_verified_at
		},
		role: 'other',
		allowedActions
	});
}

async function handle(event: RequestEvent, code: string) {
	const user = await requireUser(event);
	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId, { email: user.email });

	const parsed = parseEpiQr(code);
	if (!parsed || !parsed.token || (parsed.type !== 'SJ' && parsed.type !== 'RTN' && parsed.type !== 'CIK-SJK-V2' && parsed.type !== 'BLJ-SJK-V2')) {
		throw error(400, 'Kode QR ini bukan Surat Jalan / Dokumen Retur yang dikenali.');
	}

	if (parsed.type === 'RTN') {
		return resolveRetur(parsed.id, parsed.token, permissions);
	}
	if (parsed.type === 'CIK-SJK-V2') {
		return resolveWorkshopSjk('ciketing', parsed.id, parsed.token);
	}
	if (parsed.type === 'BLJ-SJK-V2') {
		return resolveWorkshopSjk('balaraja', parsed.id, parsed.token);
	}

	const sjRes = await directusServerJson<{ data: SuratJalanRow }>(
		`/items/surat_jalan/${parsed.id}?fields=id,nomor_sj,status,driver,qr_token,type,so_customer_id.customer_name,so_customer_id.kode_customer`
	).catch(() => null);
	const sj = sjRes?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');
	if (!sj.qr_token || sj.qr_token !== parsed.token) {
		throw error(400, 'Token QR tidak cocok — kemungkinan QR rusak atau sudah tidak berlaku.');
	}

	// Matriks aksi per peran (Bab 6.2) — ditentukan di server, klien hanya merutekan.
	let role: 'satpam' | 'project_leader' | 'admin_finance' | 'other' = 'other';
	const allowedActions: string[] = [];

	if (hasAnyPermission(permissions, 'gate_log')) {
		role = 'satpam';
		allowedActions.push('gate_scan');
	} else if (hasAnyPermission(permissions, 'input_stock_lapangan')) {
		role = 'project_leader';
		allowedActions.push('goods_receipt');
	} else if (hasAnyPermission(permissions, ['view_all_projects', 'admin_panel'])) {
		role = 'admin_finance';
		allowedActions.push('view_detail');
	} else {
		allowedActions.push('view_summary');
	}

	// F3 (rencana v2.0, Keputusan D3): SJ peminjaman yang belum diserahkan (status 'created')
	// boleh di-PoD oleh SIAPA PUN yang login — driver tidak punya permission khusus, HP driver
	// sendiri yang dipakai scan. Ditambahkan di luar percabangan peran karena bukan gate peran.
	if (sj.type === 'peminjaman' && sj.status === 'created') {
		allowedActions.push('proof_of_delivery');
	}

	return json({
		kind: 'sj',
		suratJalan: {
			id: sj.id,
			nomorSj: sj.nomor_sj,
			status: sj.status,
			driver: sj.driver,
			type: sj.type,
			customerName: sj.so_customer_id?.customer_name || sj.so_customer_id?.kode_customer || null
		},
		role,
		allowedActions
	});
}

export async function POST(event: RequestEvent) {
	const body = await event.request.json().catch(() => ({}));
	const code = String(body?.code || '');
	return handle(event, code);
}

export async function GET(event: RequestEvent) {
	const code = event.url.searchParams.get('code') || '';
	return handle(event, code);
}
