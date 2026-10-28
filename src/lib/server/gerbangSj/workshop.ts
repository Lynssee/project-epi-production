// src/lib/server/gerbangSj/workshop.ts
// WSK-35 (4b) — Gerbang satpam untuk SJ KELUAR WORKSHOP (Ciketing & Balaraja), lewat satu pintu server yang sama
// dengan SJ pusat (aktor: resolveGateActor — kiosk / app HP / ERP). Satu SJ = banyak baris ber-no_sj (+ project) yang
// sama; QR memuat id baris header + qr_token (EPI:CIK-SJK(-V2)/BLJ-SJK(-V2):<id>:<token>).
//
// Aturan:
//  • Loloskan: SJ harus sudah DISETUJUI Finance (approval_status = approved) dan satpam mengonfirmasi jumlah barang
//    sesuai. Menulis security_verified_at/by pada SEMUA baris grup (satu PATCH {keys,data}), jejak di scan_log.
//    Gate G_CIK_SJ_SECURITY / G_BL_SJ_SECURITY (erp-epi) membaca kolom ini.
//  • Tahan: tidak ada kolom "ditahan" di skema workshop → hanya jejak scan_log (notes diawali "TAHAN") + notifikasi;
//    antrean menampilkannya sebagai ditahan sampai akhirnya diloloskan.
//  • Idempoten lewat client_event_id (scan_log). Gagal tulis utama = error ke satpam (tidak ada sukses palsu).

import { directusServerJson } from '../directus';
import { parseEpiQr } from '$lib/utils/qrParse';
import { evaluateSelfVerify } from '$lib/utils/sjkSelfVerify';
import { getSelfVerifyMode, isCreatorColumnReady, readCreatorIds, notifyAtasanSelfVerify } from './selfVerify';
import { GateError, SCAN_SOURCE_BY_SUMBER, type GateActor, type GateBlocker, type GateWarning } from './types';

export type WsKey = 'ciketing' | 'balaraja';
export const WS_GATE: Record<WsKey, { collection: string; label: string; erpUrl: string }> = {
	ciketing: { collection: 'ciketing_surat_jalan_keluar', label: 'Ciketing', erpUrl: '/ws-ciketing' },
	balaraja: { collection: 'balaraja_surat_jalan_keluar', label: 'Balaraja', erpUrl: '/ws-balaraja' }
};
export const isWsKey = (v: unknown): v is WsKey => v === 'ciketing' || v === 'balaraja';

const FIELDS =
	'id,no_sj,tanggal,tujuan,project,nama_barang,no_part,qty,satuan,luasan_m2,approval_status,approved_by,catatan_finance,' +
	'pracetak_gudang,security_verified_at,security_verified_by,qr_token,date_created';
const ANTRIAN_HARI = 14;
const unwrap = (v: any) => (v && typeof v === 'object' ? v.id : v);
const isBlank = (v: unknown) => v == null || String(v).trim() === '' || String(v).trim() === '-';
const safeJson = (v: any) => { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
const gateKey = (ws: WsKey, r: any) => `${r.no_sj}|${unwrap(r.project) ?? ''}`;

export type WsGateItem = { nama_barang: string; no_part: string | null; qty: number; satuan: string | null; luasan_m2: number | null };
export type WsGateHold = { alasan: string | null; oleh: string | null; waktu: string | null };
export type WsGateDetail = {
	workshop: WsKey; label: string; header_id: number; no_sj: string; tanggal: string | null; tujuan: string | null; project_nama: string | null;
	items: WsGateItem[];
	approval: 'approved' | 'menunggu' | 'rejected'; approval_oleh: string | null; catatan_finance: string | null;
	siap_gudang: { oleh: string | null; waktu: string | null } | null;
	sudah_lolos: boolean; lolos_oleh: string | null; lolos_waktu: string | null;
	ditahan: WsGateHold | null;
	blockers: GateBlocker[]; warnings: GateWarning[]; can_pass: boolean;
};

/** Murni: agregat approval satu grup baris. */
export function approvalOfGroup(rows: any[]): 'approved' | 'menunggu' | 'rejected' {
	const st = rows.map((r) => String(r.approval_status || 'menunggu').toLowerCase());
	if (st.some((s) => s === 'rejected')) return 'rejected';
	if (st.length > 0 && st.every((s) => s === 'approved')) return 'approved';
	return 'menunggu';
}

/** Murni: bentuk detail + blocker/warning dari baris grup (header = baris ber-id terkecil). */
export function buildDetail(ws: WsKey, rows: any[], projectNama: string | null, hold: WsGateHold | null): WsGateDetail {
	const sorted = [...rows].sort((a, b) => a.id - b.id);
	const h = sorted[0];
	const approval = approvalOfGroup(sorted);
	const lolos = sorted.every((r) => !!r.security_verified_at) && sorted.length > 0;
	const pg = safeJson(h.pracetak_gudang);
	const siap = pg && !isBlank(pg.by_name) ? { oleh: pg.by_name as string, waktu: (pg.at as string) || null } : null;

	const blockers: GateBlocker[] = [];
	const warnings: GateWarning[] = [];
	if (lolos) {
		blockers.push({ kode: 'SUDAH_LOLOS', pesan: `SJ ini sudah diloloskan oleh ${h.security_verified_by || 'petugas lain'}. Tidak perlu tindakan.`, siapa: null });
	} else {
		if (approval === 'rejected') {
			blockers.push({ kode: 'DITOLAK_APPROVER', pesan: 'Finance MENAHAN SJ ini — barang belum boleh keluar. Hubungi admin workshop/Finance.', siapa: 'Finance' });
		} else if (approval !== 'approved') {
			blockers.push({ kode: 'BELUM_DISETUJUI', pesan: 'SJ ini belum disetujui Finance — barang belum boleh keluar. Minta admin workshop menghubungi Finance.', siapa: 'Finance' });
		}
		if (!siap) warnings.push({ kode: 'BELUM_SIAP_GERBANG', pesan: 'Gudang belum menandai barang siap (TTD "Disiapkan oleh"). Pastikan barang memang sudah disiapkan.' });
	}

	return {
		workshop: ws, label: WS_GATE[ws].label, header_id: h.id, no_sj: h.no_sj, tanggal: h.tanggal ?? null, tujuan: h.tujuan ?? null, project_nama: projectNama,
		items: sorted.map((r) => ({ nama_barang: r.nama_barang || '-', no_part: r.no_part || null, qty: Number(r.qty) || 0, satuan: r.satuan || null, luasan_m2: r.luasan_m2 != null ? Number(r.luasan_m2) : null })),
		approval, approval_oleh: h.approved_by || null, catatan_finance: h.catatan_finance || null,
		siap_gudang: siap, sudah_lolos: lolos, lolos_oleh: lolos ? h.security_verified_by || null : null, lolos_waktu: lolos ? h.security_verified_at || null : null,
		ditahan: lolos ? null : hold,
		blockers, warnings, can_pass: blockers.length === 0
	};
}

async function list<T = any>(path: string, label: string): Promise<T[]> {
	try {
		return (await directusServerJson<{ data: T[] }>(path))?.data || [];
	} catch (e) {
		console.error(`[gerbangSj/workshop] gagal baca ${label}:`, e instanceof Error ? e.message : e);
		throw new GateError(503, 'SERVER_LAPANGAN_TIDAK_TERJANGKAU', 'Gagal membaca data SJ workshop. Coba lagi sebentar lagi.');
	}
}

async function projectName(id: any): Promise<string | null> {
	const pid = unwrap(id);
	if (!pid) return null;
	const r = await directusServerJson<{ data: { name?: string } }>(`/items/projects/${pid}?fields=name`).catch(() => null);
	return r?.data?.name || null;
}

const TAHAN_PREFIX = 'TAHAN';
/** Penahanan terakhir dari scan_log untuk satu/lebih baris header. */
async function holdsFor(ws: WsKey, headerIds: number[]): Promise<Map<number, WsGateHold>> {
	const out = new Map<number, WsGateHold>();
	if (!headerIds.length) return out;
	try {
		const rows = (await directusServerJson<{ data: any[] }>(
			`/items/scan_log?filter[ref_collection][_eq]=${WS_GATE[ws].collection}&filter[ref_id][_in]=${headerIds.join(',')}` +
			`&filter[notes][_starts_with]=${TAHAN_PREFIX}&fields=ref_id,notes,timestamp,actor_id&sort=-timestamp&limit=200`
		))?.data || [];
		for (const r of rows) {
			const id = Number(r.ref_id);
			if (out.has(id)) continue; // sudah terisi yang terbaru
			const m = String(r.notes || '').match(/^TAHAN \[([^\]]*)\] (.*?)(?: \| oleh (.*))?$/s);
			out.set(id, { alasan: m ? m[2] : r.notes, oleh: m?.[3] || null, waktu: r.timestamp || null });
		}
	} catch (e) {
		console.error('[gerbangSj/workshop] gagal baca penahanan:', e instanceof Error ? e.message : e);
	}
	return out;
}

/** Ambil seluruh baris grup (no_sj + project sama) dari id baris mana pun. */
async function getGroupById(ws: WsKey, id: number): Promise<any[]> {
	const one = await directusServerJson<{ data: any }>(`/items/${WS_GATE[ws].collection}/${id}?fields=${FIELDS}`).catch((e) => {
		if ((e as any)?.status === 404) return null;
		console.error('[gerbangSj/workshop] gagal baca SJ:', e instanceof Error ? e.message : e);
		throw new GateError(503, 'SERVER_LAPANGAN_TIDAK_TERJANGKAU', 'Gagal membaca data SJ workshop. Coba lagi.');
	});
	const row = one?.data;
	if (!row) throw new GateError(404, 'TIDAK_DITEMUKAN', `SJ Keluar ${WS_GATE[ws].label} tidak ditemukan.`);
	if (!row.no_sj) return [row];
	const pid = unwrap(row.project);
	const rows = await list(
		`/items/${WS_GATE[ws].collection}?filter[no_sj][_eq]=${encodeURIComponent(row.no_sj)}` +
		(pid ? `&filter[project][_eq]=${pid}` : `&filter[project][_null]=true`) + `&fields=${FIELDS}&sort=id&limit=-1`,
		'grup SJ workshop'
	);
	return rows.length ? rows : [row];
}

export async function getDetailWorkshop(ws: WsKey, id: number): Promise<WsGateDetail> {
	const rows = await getGroupById(ws, id);
	const headerId = Math.min(...rows.map((r) => r.id));
	const [nama, holds] = await Promise.all([projectName(rows[0].project), holdsFor(ws, [headerId])]);
	return buildDetail(ws, rows, nama, holds.get(headerId) || null);
}

/** Cari dari QR (EPI:CIK-SJK(-V2)/BLJ-SJK(-V2):<id>:<token>) atau nomor SJ. Token QR WAJIB cocok. */
export async function cariWorkshop(input: { code?: string; nomor?: string }): Promise<WsGateDetail> {
	if (input.code) {
		const p = parseEpiQr(String(input.code));
		const ws: WsKey | null = p && (p.type === 'CIK-SJK' || p.type === 'CIK-SJK-V2') ? 'ciketing' : p && (p.type === 'BLJ-SJK' || p.type === 'BLJ-SJK-V2') ? 'balaraja' : null;
		if (!p || !ws || !p.token) throw new GateError(400, 'INPUT_TIDAK_VALID', 'QR ini bukan Surat Jalan Keluar workshop.');
		const row = (await directusServerJson<{ data: any }>(`/items/${WS_GATE[ws].collection}/${p.id}?fields=id,qr_token`).catch(() => null))?.data;
		if (!row) throw new GateError(404, 'TIDAK_DITEMUKAN', `SJ Keluar ${WS_GATE[ws].label} tidak ditemukan.`);
		if (!row.qr_token || row.qr_token !== p.token) throw new GateError(400, 'QR_TIDAK_COCOK', 'Token QR tidak cocok — QR rusak atau bukan dari sistem. Cek SJ fisiknya.');
		return getDetailWorkshop(ws, Number(p.id));
	}
	const nomor = String(input.nomor || '').trim();
	if (nomor.length < 3) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Isi nomor SJ minimal 3 karakter.');
	for (const ws of ['ciketing', 'balaraja'] as WsKey[]) {
		const hit = await list(`/items/${WS_GATE[ws].collection}?filter[no_sj][_eq]=${encodeURIComponent(nomor)}&fields=id&sort=id&limit=1`, 'cari nomor SJ');
		if (hit[0]) return getDetailWorkshop(ws, Number(hit[0].id));
	}
	throw new GateError(404, 'TIDAK_DITEMUKAN', `SJ "${nomor}" tidak ditemukan di workshop Ciketing maupun Balaraja.`);
}

export type WsAntrianRow = {
	workshop: WsKey; label: string; header_id: number; no_sj: string; tujuan: string | null; jumlah_item: number;
	approval: 'approved' | 'menunggu' | 'rejected'; siap_gudang: boolean; dibuat: string | null; menunggu_menit: number | null;
	can_pass: boolean; ditahan: boolean; alasan_tahan: string | null;
};

/** Antrean: SJ workshop 14 hari terakhir yang belum diverifikasi satpam (urut terlama dulu). */
export async function getAntrianWorkshop(now = Date.now()): Promise<WsAntrianRow[]> {
	const since = new Date(now - ANTRIAN_HARI * 86400000).toISOString();
	const out: WsAntrianRow[] = [];
	for (const ws of ['ciketing', 'balaraja'] as WsKey[]) {
		const rows = await list(
			`/items/${WS_GATE[ws].collection}?filter[security_verified_at][_null]=true&filter[date_created][_gte]=${encodeURIComponent(since)}` +
			`&fields=${FIELDS}&sort=date_created&limit=400`, `antrean ${ws}`
		);
		const groups = new Map<string, any[]>();
		for (const r of rows) {
			if (!r.no_sj) continue;
			const k = gateKey(ws, r);
			(groups.get(k) || groups.set(k, []).get(k)!).push(r);
		}
		const headerIds = [...groups.values()].map((g) => Math.min(...g.map((r) => r.id)));
		const holds = await holdsFor(ws, headerIds);
		for (const g of groups.values()) {
			const d = buildDetail(ws, g, null, holds.get(Math.min(...g.map((r) => r.id))) || null);
			const created = g.map((r) => r.date_created).filter(Boolean).sort()[0] || null;
			out.push({
				workshop: ws, label: d.label, header_id: d.header_id, no_sj: d.no_sj, tujuan: d.tujuan, jumlah_item: d.items.length,
				approval: d.approval, siap_gudang: !!d.siap_gudang, dibuat: created,
				menunggu_menit: created ? Math.max(0, Math.round((now - new Date(created).getTime()) / 60000)) : null,
				can_pass: d.can_pass, ditahan: !!d.ditahan, alasan_tahan: d.ditahan?.alasan ?? null
			});
		}
	}
	return out.sort((a, b) => String(a.dibuat).localeCompare(String(b.dibuat)));
}

const clientEvent = (raw: any): string => {
	const v = String(raw ?? '').trim();
	if (v.length < 8 || v.length > 100) throw new GateError(400, 'CLIENT_EVENT_ID_WAJIB', 'Permintaan tidak lengkap (client_event_id). Muat ulang halaman lalu coba lagi.');
	return v;
};

async function priorEvent(ws: WsKey, clientEventId: string): Promise<boolean> {
	const r = await directusServerJson<{ data: any[] }>(
		`/items/scan_log?filter[client_event_id][_eq]=${encodeURIComponent(clientEventId)}&filter[ref_collection][_eq]=${WS_GATE[ws].collection}&fields=id&limit=1`
	).catch((e) => {
		console.error('[gerbangSj/workshop] cek idempoten gagal:', e instanceof Error ? e.message : e);
		return null;
	});
	return !!r?.data?.length;
}

async function logScan(ws: WsKey, headerId: number, actor: GateActor, notes: string, clientEventId: string) {
	await directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify({
			ref_collection: WS_GATE[ws].collection, ref_id: String(headerId), actor_id: actor.karyawanId, actor_role: 'satpam',
			timestamp: new Date().toISOString(), notes: notes.slice(0, 500), source: SCAN_SOURCE_BY_SUMBER[actor.sumber], client_event_id: clientEventId
		})
	});
}

export type WsLoloskanInput = { client_event_id: string; jumlah_ok?: boolean | null; catatan?: string | null };
export type WsTahanInput = { client_event_id: string; alasan: string };

export async function loloskanWorkshop(actor: GateActor, ws: WsKey, id: number, raw: any) {
	const clientEventId = clientEvent(raw?.client_event_id);
	if (await priorEvent(ws, clientEventId)) return { ok: true as const, hasil: 'lolos' as const, idempoten: true, pesan: 'Sudah tercatat sebelumnya.', effects_gagal: [] as string[] };

	const d = await getDetailWorkshop(ws, id);
	if (d.sudah_lolos) throw new GateError(409, 'SUDAH_LOLOS', d.blockers[0]?.pesan || 'SJ sudah diloloskan.', d.blockers);
	if (!d.can_pass) throw new GateError(409, d.blockers[0]?.kode || 'GATE', d.blockers[0]?.pesan || 'SJ belum bisa diloloskan.', d.blockers);
	if (raw?.jumlah_ok !== true) {
		throw new GateError(400, 'CEK_BELUM_LENGKAP', 'Cocokkan jumlah barang dengan Surat Jalan lalu centang "Jumlah barang sesuai" sebelum meloloskan.', []);
	}

	const rows = await getGroupById(ws, id);

	// WSK-35 §4a — kunci "pembuat SJ ≠ satpam". Berlaku hanya bila kolom pembuat sudah ada & baris terisi (SJ lama kosong ⇒ tidak terkunci).
	// Gagal membaca pembuat = ditolak 503 (JANGAN diam-diam melewati kunci).
	let selfAlasan: string | null = null;
	const selfMode = await getSelfVerifyMode();
	if (selfMode !== 'off' && (await isCreatorColumnReady(WS_GATE[ws].collection))) {
		let creatorIds: number[];
		try {
			creatorIds = await readCreatorIds(WS_GATE[ws].collection, rows.map((r) => r.id));
		} catch (e) {
			console.error('[gerbangSj/workshop] gagal membaca pembuat SJ:', e instanceof Error ? e.message : e);
			throw new GateError(503, 'SERVER_LAPANGAN_TIDAK_TERJANGKAU', 'Gagal memeriksa pembuat SJ. Tidak ada yang tercatat — coba lagi.');
		}
		const ev = evaluateSelfVerify({ creatorIds, actorKaryawanId: actor.karyawanId, alasan: String(raw?.alasan_diri ?? raw?.catatan ?? ''), mode: selfMode });
		if (!ev.allowed) throw new GateError(409, ev.code!, ev.message!, []);
		if (ev.needsNotify) selfAlasan = String(raw?.alasan_diri ?? raw?.catatan ?? '').trim().slice(0, 300);
	}

	const now = new Date().toISOString();
	try {
		await directusServerJson(`/items/${WS_GATE[ws].collection}`, {
			method: 'PATCH',
			body: JSON.stringify({ keys: rows.filter((r) => !r.security_verified_at).map((r) => r.id), data: { security_verified_at: now, security_verified_by: actor.label } })
		});
	} catch (e) {
		console.error('[gerbangSj/workshop] gagal menulis verifikasi:', e instanceof Error ? e.message : e);
		throw new GateError(503, 'SERVER_LAPANGAN_TIDAK_TERJANGKAU', 'Gagal menyimpan keputusan gerbang. Tidak ada yang tercatat — coba lagi.');
	}

	const gagal: string[] = [];
	const catatan = String(raw?.catatan ?? '').trim();
	await logScan(ws, d.header_id, actor, `Gerbang LOLOS ${d.no_sj} oleh ${actor.label}${catatan ? ` | ${catatan}` : ''}`, clientEventId).catch((e) => {
		console.error('[gerbangSj/workshop] scan_log lolos gagal:', e instanceof Error ? e.message : e);
		gagal.push('scan_log');
	});
	if (selfAlasan) {
		const okNotif = await notifyAtasanSelfVerify({ karyawanId: actor.karyawanId, actorLabel: actor.label, noSj: d.no_sj, wsLabel: d.label, alasan: selfAlasan, collection: WS_GATE[ws].collection, headerId: d.header_id });
		if (!okNotif) gagal.push('notifikasi_atasan');
	}
	return { ok: true as const, hasil: 'lolos' as const, idempoten: false, pesan: `SJ ${d.no_sj} diloloskan oleh ${actor.label}. Barang boleh berangkat.`, effects_gagal: gagal };
}

export async function tahanWorkshop(actor: GateActor, ws: WsKey, id: number, raw: any) {
	const clientEventId = clientEvent(raw?.client_event_id);
	const alasan = String(raw?.alasan ?? '').trim();
	if (alasan.length < 5) throw new GateError(400, 'ALASAN_WAJIB', 'Tulis alasan menahan (min. 5 karakter): mis. jumlah/plat/driver tidak cocok.');
	if (await priorEvent(ws, clientEventId)) return { ok: true as const, hasil: 'ditahan' as const, idempoten: true, pesan: 'Sudah tercatat sebelumnya.', effects_gagal: [] as string[] };

	const d = await getDetailWorkshop(ws, id);
	if (d.sudah_lolos) throw new GateError(409, 'TIDAK_BISA_DITAHAN', 'SJ ini sudah diloloskan — tidak bisa ditahan lagi dari gerbang.', d.blockers);

	try {
		await logScan(ws, d.header_id, actor, `${TAHAN_PREFIX} [gerbang] ${alasan} | oleh ${actor.label}`, clientEventId);
	} catch (e) {
		console.error('[gerbangSj/workshop] scan_log tahan gagal:', e instanceof Error ? e.message : e);
		throw new GateError(503, 'SERVER_LAPANGAN_TIDAK_TERJANGKAU', 'Gagal mencatat penahanan. Coba lagi.');
	}
	const gagal: string[] = [];
	await directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'surat_jalan', module: 'workshop', title: `SJ workshop ${d.label} ditahan satpam: ${d.no_sj}`,
			message: `${actor.label} menahan SJ ${d.no_sj} di gerbang. Alasan: ${alasan}`, priority: 'high', department: 'logistik',
			read: false, action_required: true, action_url: WS_GATE[ws].erpUrl, created_at: new Date().toISOString()
		})
	}).catch((e) => { console.error('[gerbangSj/workshop] notifikasi tahan gagal:', e instanceof Error ? e.message : e); gagal.push('notifikasi'); });
	return { ok: true as const, hasil: 'ditahan' as const, idempoten: false, pesan: `SJ ${d.no_sj} ditahan. Logistik/admin workshop diberi tahu.`, effects_gagal: gagal };
}
