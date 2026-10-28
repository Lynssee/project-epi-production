// src/lib/server/gerbangSj/retur.ts
// RSM-04 (24 Okt 2026) — gerbang MASUK gudang untuk barang retur dari proyek (dokumen retur_gudang / RTN).
// Sebelumnya gerbang satu pintu hanya melayani SJ keluar; verifikasi retur hanya ada di ERP (HRD › Security)
// yang tidak dipakai satpam, sehingga tahap "Gerbang Gudang" tidak pernah tercapai.
//
// Aturan:
//   • hanya dokumen `dikirim` yang bisa diloloskan; `draft` -> pesan + opsi "Tandai berangkat sekarang" (Aturan #6)
//   • QR dipakai ulang -> "Sudah diverifikasi pada ..." (bukan error)
//   • Tahan tidak mengubah status dokumen; gudang tetap memutuskan
//   • Truk tanpa dokumen -> "Catat tanpa dokumen" membuat dokumen sumber 'karantina' (jangan tolak di gerbang)
//   • Checklist dari app_settings logistik.gerbang_retur_item_wajib (default di kode), disimpan di scan_log.notes
//     sampai kolom retur_gudang.security_checklist dibuat (jangan kirim kolom yang belum ada — Aturan #1).

import { directusServerJson } from '../directus';
import { casPatchBody } from '../directusCas';
import { createReturDocument } from '../returGudangServer';
import { notifyLogistik, runEffect } from './effects';
import { parseClientEventId } from './rules';
import { GateError, SCAN_SOURCE_BY_SUMBER, type GateActor } from './types';

export const RETUR_CHECKLIST_DEFAULT = ['jumlah_koli_cocok', 'plat_cocok', 'tidak_ada_barang_tambahan'] as const;
export const RETUR_CHECKLIST_LABEL: Record<string, string> = {
	jumlah_koli_cocok: 'Jumlah koli/barang cocok dengan dokumen',
	plat_cocok: 'Plat kendaraan cocok',
	tidak_ada_barang_tambahan: 'Tidak ada barang tambahan yang tidak tercatat'
};
const FIELDS = 'id,nomor_retur,status,sumber,project_id,driver_name,driver_phone,vehicle_plate,shipped_at,qr_token,qr_token_used,security_verified_at,security_verified_by,notes';
const TTL = 300_000;
let cl: { at: number; v: string[] } | null = null;

const unwrap = (v: any) => (v && typeof v === 'object' ? v.id : v);
const tgl = (v: string) => new Date(v).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });

async function list<T = any>(path: string, label: string): Promise<T[]> {
	try {
		return (await directusServerJson<{ data: T[] }>(path))?.data || [];
	} catch (e) {
		console.error(`[gerbangSj/retur] gagal baca ${label}:`, e instanceof Error ? e.message : e);
		return [];
	}
}

/** Item cek gerbang retur dari app_settings (logistik.gerbang_retur_item_wajib, daftar dipisah koma / array JSON). Cache 5 menit. */
export async function getReturChecklistItems(): Promise<string[]> {
	if (cl && Date.now() - cl.at < TTL) return cl.v;
	let v: string[] = [...RETUR_CHECKLIST_DEFAULT];
	const rows = await list(`/items/app_settings?filter[module][_eq]=logistik&filter[setting_key][_eq]=gerbang_retur_item_wajib&fields=setting_value&limit=1`, 'app_settings gerbang_retur_item_wajib');
	const raw = rows[0]?.setting_value;
	const parsed: string[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
	const clean = parsed.map((s) => String(s).trim()).filter(Boolean);
	if (clean.length) v = clean;
	cl = { at: Date.now(), v };
	return v;
}
export const resetReturChecklistCache = () => { cl = null; };

export type ReturGateDoc = {
	id: number; nomor_retur: string; status: string; sumber: string | null; project_id: number | null; proyek: string | null;
	driver_name: string | null; driver_phone: string | null; vehicle_plate: string | null; shipped_at: string | null;
	security_verified_at: string | null; security_verified_by: string | null;
	items: { id: number; material_name: string; qty_returned: number; unit: string }[];
	alat: number;
};

async function hydrate(h: any): Promise<ReturGateDoc> {
	const pid = unwrap(h.project_id);
	const [items, alat, proj] = await Promise.all([
		list(`/items/packing_returns?filter[retur_gudang_id][_eq]=${h.id}&fields=id,material_name,qty_returned,unit&limit=-1`, 'packing_returns'),
		list(`/items/internal_loan_log?filter[retur_gudang_id][_eq]=${h.id}&fields=id&limit=-1`, 'internal_loan_log'),
		pid ? list(`/items/projects?filter[id][_eq]=${pid}&fields=id,name&limit=1`, 'projects') : Promise.resolve([] as any[])
	]);
	return {
		id: h.id, nomor_retur: h.nomor_retur, status: h.status, sumber: h.sumber ?? null, project_id: pid ?? null,
		proyek: proj[0]?.name ?? null, driver_name: h.driver_name ?? null, driver_phone: h.driver_phone ?? null,
		vehicle_plate: h.vehicle_plate ?? null, shipped_at: h.shipped_at ?? null,
		security_verified_at: h.security_verified_at ?? null, security_verified_by: h.security_verified_by ?? null,
		items: items.map((i: any) => ({ id: i.id, material_name: i.material_name || '-', qty_returned: Number(i.qty_returned) || 0, unit: i.unit || '' })),
		alat: alat.length
	};
}

/** Antrean masuk: dokumen `dikirim` yang belum lewat gerbang. */
export async function getAntrianRetur(): Promise<{ count: number; antrian: (ReturGateDoc & { menunggu_menit: number | null })[]; checklist: { key: string; label: string }[] }> {
	const [heads, items] = await Promise.all([
		list(`/items/retur_gudang?filter[status][_eq]=dikirim&filter[security_verified_at][_null]=true&fields=${FIELDS}&sort=shipped_at&limit=100`, 'retur_gudang'),
		getReturChecklistItems()
	]);
	const antrian = await Promise.all(
		heads.map(async (h) => {
			const d = await hydrate(h);
			return { ...d, menunggu_menit: d.shipped_at ? Math.max(0, Math.round((Date.now() - new Date(d.shipped_at).getTime()) / 60000)) : null };
		})
	);
	return { count: antrian.length, antrian, checklist: items.map((key) => ({ key, label: RETUR_CHECKLIST_LABEL[key] || key })) };
}

/** Murni: pecah input scan "EPI:RTN:<id>:<token>" atau nomor RTN polos. */
export function parseReturQuery(q: string): { id: number | null; token: string | null; nomor: string | null } {
	const s = String(q ?? '').trim();
	if (s.toUpperCase().startsWith('EPI:RTN:')) {
		const [, , id, ...rest] = s.split(':');
		const n = Number(id);
		return { id: Number.isInteger(n) && n > 0 ? n : null, token: rest.join(':') || null, nomor: null };
	}
	return { id: null, token: null, nomor: s || null };
}

async function loadHeader(q: { id: number | null; nomor: string | null }) {
	if (q.id) return (await directusServerJson<{ data: any }>(`/items/retur_gudang/${q.id}?fields=${FIELDS}`).catch(() => null))?.data ?? null;
	if (q.nomor) return (await list(`/items/retur_gudang?filter[nomor_retur][_eq]=${encodeURIComponent(q.nomor)}&fields=${FIELDS}&limit=1`, 'retur_gudang by nomor'))[0] ?? null;
	return null;
}

/** Cari dokumen dari scan QR / nomor. Token QR (bila ada) harus cocok. */
export async function cariRetur(raw: string): Promise<{ doc: ReturGateDoc; perlu_tandai_berangkat: boolean; sudah_diverifikasi: boolean; pesan: string | null; checklist: { key: string; label: string }[] }> {
	const q = parseReturQuery(raw);
	if (!q.id && !q.nomor) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Scan QR di lembar RTN atau ketik nomor RTN.');
	const h = await loadHeader(q);
	if (!h) throw new GateError(404, 'TIDAK_DITEMUKAN', `Dokumen retur "${String(raw).trim()}" tidak ditemukan.`);
	if (q.token && h.qr_token && q.token !== h.qr_token) throw new GateError(400, 'QR_TIDAK_COCOK', 'QR tidak cocok dengan dokumen. Minta lembar RTN yang benar atau ketik nomor RTN.');
	const doc = await hydrate(h);
	const sudah = !!h.security_verified_at;
	const draft = h.status === 'draft';
	const pesan = sudah
		? `Sudah diverifikasi pada ${tgl(h.security_verified_at)}${h.security_verified_by ? ` oleh ${h.security_verified_by}` : ''}.`
		: draft
			? 'Dokumen belum ditandai berangkat. Minta sopir/admin menekan Tandai Dijemput dulu, atau tekan "Tandai berangkat sekarang" bila truk sudah di gerbang.'
			: ['diterima', 'diterima_sebagian', 'ditolak', 'batal'].includes(h.status)
				? `Dokumen berstatus "${h.status}" — tidak perlu lewat gerbang.`
				: null;
	return { doc, perlu_tandai_berangkat: draft && !sudah, sudah_diverifikasi: sudah, pesan, checklist: (await getReturChecklistItems()).map((key) => ({ key, label: RETUR_CHECKLIST_LABEL[key] || key })) };
}

async function priorEvent(clientEventId: string): Promise<boolean> {
	const r = await list(`/items/scan_log?filter[client_event_id][_eq]=${encodeURIComponent(clientEventId)}&filter[ref_collection][_eq]=retur_gudang&fields=id&limit=1`, 'scan_log idempoten');
	return r.length > 0;
}

async function writeScan(a: { returId: number; actor: GateActor; stageFrom: string | null; stageTo: string; notes: string; clientEventId: string; fotoId?: string | null }) {
	await directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify({
			ref_collection: 'retur_gudang', ref_id: String(a.returId), actor_id: a.actor.karyawanId, actor_role: 'satpam',
			timestamp: new Date().toISOString(), foto_id: a.fotoId ?? null, notes: a.notes.slice(0, 2000),
			stage_from: a.stageFrom, stage_to: a.stageTo, source: SCAN_SOURCE_BY_SUMBER[a.actor.sumber], client_event_id: a.clientEventId
		})
	});
}

export type ReturGateResult = { ok: true; hasil: 'lolos' | 'ditahan' | 'dicatat'; idempoten: boolean; doc: { id: number; nomor_retur: string; status: string }; pesan: string; effects_gagal: string[] };

/** Loloskan masuk. Idempoten (client_event_id + CAS pada security_verified_at). */
export async function loloskanRetur(returId: number, raw: any, actor: GateActor): Promise<ReturGateResult> {
	const clientEventId = parseClientEventId(raw?.client_event_id);
	const h = (await directusServerJson<{ data: any }>(`/items/retur_gudang/${returId}?fields=${FIELDS}`).catch(() => null))?.data;
	if (!h) throw new GateError(404, 'TIDAK_DITEMUKAN', 'Dokumen retur tidak ditemukan.');
	const view = (status = h.status) => ({ id: h.id, nomor_retur: h.nomor_retur, status });
	if (h.security_verified_at || (await priorEvent(clientEventId))) {
		return { ok: true, hasil: 'lolos', idempoten: true, doc: view(), pesan: `Sudah diverifikasi pada ${h.security_verified_at ? tgl(h.security_verified_at) : 'sebelumnya'}${h.security_verified_by ? ` oleh ${h.security_verified_by}` : ''}.`, effects_gagal: [] };
	}
	if (['diterima', 'diterima_sebagian', 'ditolak', 'batal'].includes(h.status)) {
		throw new GateError(409, 'STATUS_BERUBAH', `Dokumen retur berstatus "${h.status}" — tidak perlu lewat gerbang.`);
	}
	const draft = h.status === 'draft';
	if (draft && raw?.tandai_berangkat !== true) {
		throw new GateError(409, 'BELUM_SIAP_GERBANG', 'Dokumen belum ditandai berangkat. Minta sopir/admin menekan Tandai Dijemput dulu, atau tekan "Tandai berangkat sekarang".');
	}

	// Checklist wajib (item dari setelan). Tidak lengkap -> arahkan ke Tahan, bukan loloskan.
	const wajib = await getReturChecklistItems();
	const cek = raw?.checklist && typeof raw.checklist === 'object' ? raw.checklist : {};
	const kurang = wajib.filter((k) => cek[k] !== true);
	if (kurang.length) {
		throw new GateError(400, 'CEK_BELUM_LENGKAP', `Centang semua pemeriksaan (${kurang.map((k) => RETUR_CHECKLIST_LABEL[k] || k).join('; ')}). Kalau ada yang tidak sesuai, tekan Tahan.`);
	}

	const now = new Date().toISOString();
	const data: Record<string, unknown> = { security_verified_at: now, security_verified_by: actor.label, qr_token_used: true };
	if (draft) {
		data.status = 'dikirim';
		data.shipped_at = h.shipped_at || now;
		data.notes = [String(h.notes || '').trim(), '[berangkat dicatat satpam di gerbang]'].filter(Boolean).join(' ');
	}
	const conds: any[] = [{ id: { _eq: returId } }, { security_verified_at: { _null: true } }, { status: { _in: ['draft', 'dikirim'] } }];
	const patch = await directusServerJson<{ data: any[] }>('/items/retur_gudang', { method: 'PATCH', body: casPatchBody(conds, data) });
	if (!Array.isArray(patch?.data) || patch.data.length === 0) {
		return { ok: true, hasil: 'lolos', idempoten: true, doc: view(), pesan: `Dokumen ${h.nomor_retur} sudah diproses petugas lain.`, effects_gagal: [] };
	}

	const catatan = typeof raw?.catatan === 'string' ? raw.catatan.slice(0, 300) : '';
	const gagal: string[] = [];
	const hasil = await Promise.all([
		runEffect('scan_log', returId, () => writeScan({
			returId, actor, stageFrom: draft ? 'draft' : 'dikirim', stageTo: 'gerbang_gudang', clientEventId, fotoId: raw?.foto_file_id ?? null,
			notes: JSON.stringify({ jalur: 'retur_masuk', checklist: cek, catatan: catatan || null, tandai_berangkat: draft })
		})),
		runEffect('notifikasi', returId, () => notifyLogistik({ title: `Retur ${h.nomor_retur} lolos gerbang`, message: `Diverifikasi ${actor.label}. Barang boleh masuk gudang untuk QC.`, priority: 'medium', actionRequired: false }))
	]);
	for (const g of hasil) if (g) gagal.push(g);
	return { ok: true, hasil: 'lolos', idempoten: false, doc: view('dikirim'), pesan: `Retur ${h.nomor_retur} diloloskan. Barang boleh masuk gudang.`, effects_gagal: gagal };
}

/** Tahan di gerbang: catat alasan (>= 10 karakter). Status dokumen TIDAK berubah; gudang diberi tahu. */
export async function tahanRetur(returId: number, raw: any, actor: GateActor): Promise<ReturGateResult> {
	const clientEventId = parseClientEventId(raw?.client_event_id);
	const alasan = String(raw?.alasan ?? '').trim();
	if (alasan.length < 10) throw new GateError(400, 'ALASAN_WAJIB', 'Tulis alasan menahan (minimal 10 karakter).');
	const h = (await directusServerJson<{ data: any }>(`/items/retur_gudang/${returId}?fields=${FIELDS}`).catch(() => null))?.data;
	if (!h) throw new GateError(404, 'TIDAK_DITEMUKAN', 'Dokumen retur tidak ditemukan.');
	const view = { id: h.id, nomor_retur: h.nomor_retur, status: h.status };
	if (await priorEvent(clientEventId)) return { ok: true, hasil: 'ditahan', idempoten: true, doc: view, pesan: `Dokumen ${h.nomor_retur} sudah dicatat ditahan.`, effects_gagal: [] };

	const stamp = `[DITAHAN gerbang ${tgl(new Date().toISOString())} oleh ${actor.nama}: ${alasan.slice(0, 200)}]`;
	await directusServerJson(`/items/retur_gudang/${returId}`, { method: 'PATCH', body: JSON.stringify({ notes: [String(h.notes || '').trim(), stamp].filter(Boolean).join(' ') }) });
	const gagal: string[] = [];
	const hasil = await Promise.all([
		runEffect('scan_log', returId, () => writeScan({ returId, actor, stageFrom: h.status, stageTo: 'ditahan_gerbang', clientEventId, fotoId: raw?.foto_file_id ?? null, notes: JSON.stringify({ jalur: 'retur_masuk', alasan }) })),
		runEffect('notifikasi', returId, () => notifyLogistik({ title: `Retur ${h.nomor_retur} DITAHAN di gerbang`, message: `${actor.label}: ${alasan.slice(0, 160)}`, priority: 'high', actionRequired: true }))
	]);
	for (const g of hasil) if (g) gagal.push(g);
	return { ok: true, hasil: 'ditahan', idempoten: false, doc: view, pesan: `Dokumen ${h.nomor_retur} ditahan. Gudang sudah diberi tahu.`, effects_gagal: gagal };
}

/** Truk retur tanpa dokumen: buat dokumen karantina (draft) supaya barang tercatat, bukan ditolak di gerbang. */
export async function catatTanpaDokumen(raw: any, actor: GateActor): Promise<ReturGateResult> {
	const clientEventId = parseClientEventId(raw?.client_event_id);
	const projectId = Number(raw?.project_id);
	if (!Number.isInteger(projectId) || projectId <= 0) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Pilih proyek asal barang.');
	const ket = String(raw?.catatan ?? '').trim();
	if (ket.length < 5) throw new GateError(400, 'ALASAN_WAJIB', 'Tulis keterangan singkat (barang apa, plat, sopir).');
	const prior = await list(`/items/scan_log?filter[client_event_id][_eq]=${encodeURIComponent(clientEventId)}&filter[ref_collection][_eq]=retur_gudang&fields=ref_id&limit=1`, 'scan_log idempoten');
	if (prior[0]?.ref_id) {
		const h = (await directusServerJson<{ data: any }>(`/items/retur_gudang/${prior[0].ref_id}?fields=id,nomor_retur,status`).catch(() => null))?.data;
		if (h) return { ok: true, hasil: 'dicatat', idempoten: true, doc: { id: h.id, nomor_retur: h.nomor_retur, status: h.status }, pesan: `Sudah dicatat sebagai ${h.nomor_retur}.`, effects_gagal: [] };
	}
	const now = new Date().toISOString();
	const doc = await createReturDocument({
		projectId, packingReturnIds: [], sumber: 'karantina', status: 'draft',
		notes: `[Dicatat satpam tanpa dokumen ${tgl(now)} oleh ${actor.nama}] ${ket.slice(0, 300)}`
	});
	await directusServerJson(`/items/retur_gudang/${doc.id}`, {
		method: 'PATCH', body: JSON.stringify({ security_verified_at: now, security_verified_by: actor.label, qr_token_used: true })
	}).catch((e) => console.error('[gerbangSj/retur] gagal menandai karantina lolos gerbang:', e instanceof Error ? e.message : e));
	const gagal: string[] = [];
	const hasil = await Promise.all([
		runEffect('scan_log', doc.id, () => writeScan({ returId: doc.id, actor, stageFrom: null, stageTo: 'gerbang_gudang', clientEventId, fotoId: raw?.foto_file_id ?? null, notes: JSON.stringify({ jalur: 'retur_masuk', tanpa_dokumen: true, catatan: ket }) })),
		runEffect('notifikasi', doc.id, () => notifyLogistik({ title: `Truk retur TANPA dokumen dicatat (${doc.nomor_retur})`, message: `${actor.label}: ${ket.slice(0, 160)}. Arahkan ke area karantina; gudang lengkapi dokumennya.`, priority: 'high', actionRequired: true }))
	]);
	for (const g of hasil) if (g) gagal.push(g);
	return { ok: true, hasil: 'dicatat', idempoten: false, doc: { id: doc.id, nomor_retur: doc.nomor_retur, status: 'draft' }, pesan: `Dicatat sebagai dokumen karantina ${doc.nomor_retur}. Arahkan truk ke area karantina.`, effects_gagal: gagal };
}
