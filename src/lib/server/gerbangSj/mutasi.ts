// src/lib/server/gerbangSj/mutasi.ts
// RSM-13 §4.2 tahap 3b (24 Okt 2026) — gerbang untuk e-SJ Mutasi rute `via_gudang` (barang lewat gerbang pusat/workshop).
// Rute `langsung_site` TIDAK pernah muncul di sini. Perubahan status memakai CAS (dikirim -> lolos_gerbang) dan jejaknya
// ditulis ke `riwayat` dokumen — format sama dengan aksi `lolos_gerbang` di mesin mutasi erp-epi (security_verified_at + riwayat).
//
// Gerbang TIDAK bergantung pada server admin (sama seperti retur): membaca & menulis langsung ke Directus bersama.
// Kolom hanya yang sudah dipakai mesin mutasi (Aturan #1); mutasi_barang belum ada sebelum skema diterapkan -> antrean kosong + log jelas.

import { directusServerJson } from '../directus';
import { casPatchBody } from '../directusCas';
import { notifyLogistik, runEffect } from './effects';
import { parseClientEventId } from './rules';
import { GateError, SCAN_SOURCE_BY_SUMBER, type GateActor } from './types';

export const MUTASI_CHECKLIST_DEFAULT = ['jumlah_cocok', 'plat_cocok'] as const;
export const MUTASI_CHECKLIST_LABEL: Record<string, string> = {
	jumlah_cocok: 'Jumlah/jenis barang cocok dengan dokumen mutasi',
	plat_cocok: 'Plat kendaraan & sopir cocok',
	tidak_ada_barang_tambahan: 'Tidak ada barang tambahan yang tidak tercatat'
};
const FIELDS =
	'id,nomor_mutasi,jenis,status,rute,asal_tipe,asal_id,tujuan_tipe,tujuan_id,driver_name,driver_phone,vehicle_plate,shipped_at,security_verified_at,riwayat';
const TTL = 300_000;
let cl: { at: number; v: string[] } | null = null;

const unwrap = (v: any) => (v && typeof v === 'object' ? v.id : v);
const tgl = (v: string) => new Date(v).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });

async function list<T = any>(path: string, label: string): Promise<T[]> {
	try {
		return (await directusServerJson<{ data: T[] }>(path))?.data || [];
	} catch (e) {
		console.error(`[gerbangSj/mutasi] gagal baca ${label}:`, e instanceof Error ? e.message : e);
		return [];
	}
}

/** Item cek gerbang mutasi dari app_settings (logistik.gerbang_mutasi_item_wajib — daftar dipisah koma / array JSON). Cache 5 menit. */
export async function getMutasiChecklistItems(): Promise<string[]> {
	if (cl && Date.now() - cl.at < TTL) return cl.v;
	let v: string[] = [...MUTASI_CHECKLIST_DEFAULT];
	const rows = await list(
		`/items/app_settings?filter[module][_eq]=logistik&filter[setting_key][_eq]=gerbang_mutasi_item_wajib&fields=setting_value&limit=1`,
		'app_settings gerbang_mutasi_item_wajib'
	);
	const raw = rows[0]?.setting_value;
	let parsed: unknown = raw;
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch {
			parsed = raw.split(',');
		}
	}
	const clean = (Array.isArray(parsed) ? parsed : []).map((s) => String(s).trim()).filter(Boolean);
	if (clean.length) v = clean;
	cl = { at: Date.now(), v };
	return v;
}
export const resetMutasiChecklistCache = () => {
	cl = null;
};

export type MutasiGateDoc = {
	id: number;
	nomor_mutasi: string;
	jenis: string;
	status: string;
	asal: string;
	tujuan: string;
	driver_name: string | null;
	driver_phone: string | null;
	vehicle_plate: string | null;
	shipped_at: string | null;
	items: { id: number; nama: string; qty: number; unit: string }[];
};

async function namaLokasi(rows: any[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const ids = (tipe: string) => [...new Set(rows.flatMap((m) => [m.asal_tipe === tipe ? m.asal_id : null, m.tujuan_tipe === tipe ? m.tujuan_id : null]).filter((x) => x != null))];
	const [pr, ws, gd] = [ids('project'), ids('workshop'), ids('gudang')];
	const [p, w, g] = await Promise.all([
		pr.length ? list(`/items/projects?filter[id][_in]=${pr.join(',')}&fields=id,name&limit=-1`, 'projects') : [],
		ws.length ? list(`/items/workshops?filter[id][_in]=${ws.join(',')}&fields=id,name&limit=-1`, 'workshops') : [],
		gd.length ? list(`/items/gudang?filter[id][_in]=${gd.join(',')}&fields=id,nama_gudang&limit=-1`, 'gudang') : []
	]);
	for (const x of p) out.set(`project:${x.id}`, x.name);
	for (const x of w) out.set(`workshop:${x.id}`, x.name);
	for (const x of g) out.set(`gudang:${x.id}`, x.nama_gudang);
	return out;
}

async function hydrate(rows: any[]): Promise<MutasiGateDoc[]> {
	if (!rows.length) return [];
	const [items, lokasi] = await Promise.all([
		list(`/items/mutasi_barang_items?filter[mutasi_id][_in]=${rows.map((r) => r.id).join(',')}&fields=id,mutasi_id,item_id,qty,unit&limit=-1`, 'mutasi_barang_items'),
		namaLokasi(rows)
	]);
	const itemIds = [...new Set(items.map((i) => Number(i.item_id)).filter(Boolean))];
	const master = itemIds.length ? await list(`/items/identitas_barang?filter[id][_in]=${itemIds.join(',')}&fields=id,nama_barang_lengkap&limit=-1`, 'identitas_barang') : [];
	const nama = new Map(master.map((m: any) => [Number(m.id), m.nama_barang_lengkap]));
	return rows.map((h) => ({
		id: h.id,
		nomor_mutasi: h.nomor_mutasi,
		jenis: h.jenis,
		status: h.status,
		asal: lokasi.get(`${h.asal_tipe}:${h.asal_id}`) || `${h.asal_tipe} #${h.asal_id}`,
		tujuan: lokasi.get(`${h.tujuan_tipe}:${h.tujuan_id}`) || (h.tujuan_tipe === 'gudang' ? 'Gudang Pusat' : `${h.tujuan_tipe} #${h.tujuan_id}`),
		driver_name: h.driver_name ?? null,
		driver_phone: h.driver_phone ?? null,
		vehicle_plate: h.vehicle_plate ?? null,
		shipped_at: h.shipped_at ?? null,
		items: items
			.filter((i) => Number(unwrap(i.mutasi_id)) === Number(h.id))
			.map((i) => ({ id: i.id, nama: nama.get(Number(i.item_id)) || `Barang #${i.item_id}`, qty: Number(i.qty) || 0, unit: i.unit || '' }))
	}));
}

/** Antrean gerbang: mutasi rute via_gudang yang sudah berangkat dan belum lolos gerbang. */
export async function getAntrianMutasi(): Promise<{
	count: number;
	antrian: (MutasiGateDoc & { menunggu_menit: number | null })[];
	checklist: { key: string; label: string }[];
}> {
	const [heads, items] = await Promise.all([
		list(
			`/items/mutasi_barang?filter[status][_eq]=dikirim&filter[rute][_eq]=via_gudang&filter[security_verified_at][_null]=true&fields=${FIELDS}&sort=shipped_at&limit=100`,
			'mutasi_barang'
		),
		getMutasiChecklistItems()
	]);
	const docs = await hydrate(heads);
	const antrian = docs.map((d) => ({ ...d, menunggu_menit: d.shipped_at ? Math.max(0, Math.round((Date.now() - new Date(d.shipped_at).getTime()) / 60000)) : null }));
	return { count: antrian.length, antrian, checklist: items.map((key) => ({ key, label: MUTASI_CHECKLIST_LABEL[key] || key })) };
}

async function loadHeader(id: number) {
	return (await directusServerJson<{ data: any }>(`/items/mutasi_barang/${id}?fields=${FIELDS}`).catch((e) => {
		console.error(`[gerbangSj/mutasi] gagal baca mutasi ${id}:`, e instanceof Error ? e.message : e);
		return null;
	}))?.data ?? null;
}

async function priorEvent(clientEventId: string): Promise<boolean> {
	return (await list(`/items/scan_log?filter[client_event_id][_eq]=${encodeURIComponent(clientEventId)}&filter[ref_collection][_eq]=mutasi_barang&fields=id&limit=1`, 'scan_log idempoten')).length > 0;
}

async function writeScan(a: { id: number; actor: GateActor; stageFrom: string | null; stageTo: string; notes: string; clientEventId: string; fotoId?: string | null }) {
	await directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify({
			ref_collection: 'mutasi_barang', ref_id: String(a.id), actor_id: a.actor.karyawanId, actor_role: 'satpam',
			timestamp: new Date().toISOString(), foto_id: a.fotoId ?? null, notes: a.notes.slice(0, 2000),
			stage_from: a.stageFrom, stage_to: a.stageTo, source: SCAN_SOURCE_BY_SUMBER[a.actor.sumber], client_event_id: a.clientEventId
		})
	});
}

export type MutasiGateResult = {
	ok: true;
	hasil: 'lolos' | 'ditahan';
	idempoten: boolean;
	doc: { id: number; nomor_mutasi: string; status: string };
	pesan: string;
	effects_gagal: string[];
};

/** Loloskan mutasi via_gudang. Idempoten (client_event_id + CAS status). Checklist wajib dari setelan. */
export async function loloskanMutasi(id: number, raw: any, actor: GateActor): Promise<MutasiGateResult> {
	const clientEventId = parseClientEventId(raw?.client_event_id);
	const h = await loadHeader(id);
	if (!h) throw new GateError(404, 'TIDAK_DITEMUKAN', 'Dokumen mutasi tidak ditemukan.');
	const view = (status = h.status) => ({ id: h.id, nomor_mutasi: h.nomor_mutasi, status });
	if (h.rute !== 'via_gudang') throw new GateError(409, 'AKSI_TIDAK_VALID', 'Mutasi langsung site→site tidak melewati gerbang.');
	if (h.security_verified_at || h.status === 'lolos_gerbang' || (await priorEvent(clientEventId))) {
		return { ok: true, hasil: 'lolos', idempoten: true, doc: view(), pesan: `Mutasi ${h.nomor_mutasi} sudah lolos gerbang${h.security_verified_at ? ` pada ${tgl(h.security_verified_at)}` : ''}.`, effects_gagal: [] };
	}
	if (h.status !== 'dikirim') {
		throw new GateError(409, 'STATUS_BERUBAH', `Mutasi ${h.nomor_mutasi} berstatus "${h.status}" — hanya mutasi yang sudah berangkat (dikirim) yang bisa diloloskan.`);
	}
	const wajib = await getMutasiChecklistItems();
	const cek = raw?.checklist && typeof raw.checklist === 'object' ? raw.checklist : {};
	const kurang = wajib.filter((k) => cek[k] !== true);
	if (kurang.length) {
		throw new GateError(400, 'CEK_BELUM_LENGKAP', `Centang semua pemeriksaan (${kurang.map((k) => MUTASI_CHECKLIST_LABEL[k] || k).join('; ')}). Kalau ada yang tidak sesuai, tekan Tahan.`);
	}

	const now = new Date().toISOString();
	const riwayat = [...(Array.isArray(h.riwayat) ? h.riwayat : []), { keputusan: 'lolos_gerbang', oleh_id: actor.karyawanId, oleh_nama: actor.label, waktu: now, sumber: 'satpam' }];
	const conds: any[] = [{ id: { _eq: id } }, { status: { _eq: 'dikirim' } }, { security_verified_at: { _null: true } }];
	const patch = await directusServerJson<{ data: any[] }>('/items/mutasi_barang', {
		method: 'PATCH',
		body: casPatchBody(conds, { status: 'lolos_gerbang', security_verified_at: now, riwayat })
	});
	if (!Array.isArray(patch?.data) || patch.data.length === 0) {
		return { ok: true, hasil: 'lolos', idempoten: true, doc: view(), pesan: `Mutasi ${h.nomor_mutasi} sudah diproses petugas lain.`, effects_gagal: [] };
	}

	const catatan = typeof raw?.catatan === 'string' ? raw.catatan.slice(0, 300) : '';
	const hasil = await Promise.all([
		runEffect('scan_log', id, () =>
			writeScan({ id, actor, stageFrom: 'dikirim', stageTo: 'lolos_gerbang', clientEventId, fotoId: raw?.foto_file_id ?? null, notes: JSON.stringify({ jalur: 'mutasi_via_gudang', checklist: cek, catatan: catatan || null }) })
		),
		runEffect('notifikasi', id, () =>
			notifyLogistik({ title: `Mutasi ${h.nomor_mutasi} lolos gerbang`, message: `Diverifikasi ${actor.label}. Penerima dapat memindai QR dan menghitung barang.`, priority: 'medium', actionRequired: false })
		)
	]);
	return { ok: true, hasil: 'lolos', idempoten: false, doc: view('lolos_gerbang'), pesan: `Mutasi ${h.nomor_mutasi} diloloskan.`, effects_gagal: hasil.filter(Boolean) as string[] };
}

/** Tahan di gerbang: catat alasan (>= 10 karakter) di riwayat; status TIDAK berubah, admin inventory diberi tahu. */
export async function tahanMutasi(id: number, raw: any, actor: GateActor): Promise<MutasiGateResult> {
	const clientEventId = parseClientEventId(raw?.client_event_id);
	const alasan = String(raw?.alasan ?? '').trim();
	if (alasan.length < 10) throw new GateError(400, 'ALASAN_WAJIB', 'Tulis alasan menahan (minimal 10 karakter).');
	const h = await loadHeader(id);
	if (!h) throw new GateError(404, 'TIDAK_DITEMUKAN', 'Dokumen mutasi tidak ditemukan.');
	const view = { id: h.id, nomor_mutasi: h.nomor_mutasi, status: h.status };
	if (await priorEvent(clientEventId)) return { ok: true, hasil: 'ditahan', idempoten: true, doc: view, pesan: `Mutasi ${h.nomor_mutasi} sudah dicatat ditahan.`, effects_gagal: [] };
	if (h.status !== 'dikirim') throw new GateError(409, 'STATUS_BERUBAH', `Mutasi ${h.nomor_mutasi} berstatus "${h.status}" — tidak bisa ditahan dari gerbang.`);

	const riwayat = [...(Array.isArray(h.riwayat) ? h.riwayat : []), { keputusan: 'tahan_gerbang', oleh_id: actor.karyawanId, oleh_nama: actor.label, waktu: new Date().toISOString(), catatan: alasan.slice(0, 200), sumber: 'satpam' }];
	const patch = await directusServerJson<{ data: any[] }>('/items/mutasi_barang', {
		method: 'PATCH',
		body: casPatchBody([{ id: { _eq: id } }, { status: { _eq: 'dikirim' } }], { riwayat })
	});
	if (!Array.isArray(patch?.data) || patch.data.length === 0) {
		throw new GateError(409, 'STATUS_BERUBAH', `Mutasi ${h.nomor_mutasi} baru saja berubah status. Muat ulang antrean.`);
	}
	const hasil = await Promise.all([
		runEffect('scan_log', id, () => writeScan({ id, actor, stageFrom: 'dikirim', stageTo: 'ditahan_gerbang', clientEventId, fotoId: raw?.foto_file_id ?? null, notes: JSON.stringify({ jalur: 'mutasi_via_gudang', alasan }) })),
		runEffect('notifikasi', id, () =>
			notifyLogistik({ title: `Mutasi ${h.nomor_mutasi} DITAHAN di gerbang`, message: `${actor.label}: ${alasan.slice(0, 160)}`, priority: 'high', actionRequired: true })
		)
	]);
	return { ok: true, hasil: 'ditahan', idempoten: false, doc: view, pesan: `Mutasi ${h.nomor_mutasi} ditahan. Admin Inventory sudah diberi tahu.`, effects_gagal: hasil.filter(Boolean) as string[] };
}
