// src/lib/server/gerbangSj/query.ts
// GSP-03 — satu sumber daftar antrian + detail SJ untuk kiosk, app HP, dan ERP.
// Query dipisah per relasi (Aturan #2) dan hanya memakai kolom yang ADA di skema live (Aturan #1):
// JANGAN minta `jumlah_koli` dari surat_jalan (tidak ada → Directus 403).

import { directusServerJson } from '../directus';
import { parseEpiQr } from '$lib/utils/qrParse';
import { summarizeRangkapForGate } from '../rangkap';
import { evaluateGerbangMinimum, getGerbangBlockersDetailed } from '../sjGerbangGuard';
import { normalizeChecklist } from './checklist';
import { evaluatePass, resolveKoliAcuan, type PassEvaluation } from './rules';
import { getGerbangSettings, type GerbangSettings } from './settings';
import { kategoriWajibSatpam } from './penjualan';
import { GateError, type GateBlocker, type GateWarning } from './types';

const SJ_FIELDS =
	'id,nomor_sj,status,track_stage,track_stage_at,driver,vehicle_id,delegated_driver_id,delivery_address,date_created,' +
	'approval_status,draft_status,print_count,security_checklist,security_verified_at,security_verified_by,' +
	'so_customer_id,project_id,qr_token,foto_kirim,return_status,return_deadline,pracetak_gudang,pengaju_verification';

const ids = (a: (number | string | null | undefined)[]) => [...new Set(a.filter((x) => x != null && x !== ''))];
const unwrap = (v: any) => (v && typeof v === 'object' ? v.id : v);

async function list<T = any>(path: string, label: string): Promise<T[]> {
	try {
		return (await directusServerJson<{ data: T[] }>(path))?.data || [];
	} catch (e) {
		// Aturan #1: jangan telan diam-diam.
		console.error(`[gerbangSj/query] gagal baca ${label}:`, e instanceof Error ? e.message : e);
		return [];
	}
}

type Lookups = {
	plat: Map<string, string>;
	customer: Map<string, string>;
	project: Map<string, string>;
	koliFleet: Map<string, number>;
};

async function loadLookups(sjs: any[]): Promise<Lookups> {
	const vIds = ids(sjs.map((s) => unwrap(s.vehicle_id)));
	const cIds = ids(sjs.map((s) => unwrap(s.so_customer_id)));
	const pIds = ids(sjs.map((s) => unwrap(s.project_id)));
	const sIds = ids(sjs.map((s) => s.id));
	const [veh, cust, proj, fleet] = await Promise.all([
		vIds.length ? list(`/items/fleet_kendaraan?filter[id][_in]=${vIds.join(',')}&fields=id,nomor_polisi&limit=-1`, 'fleet_kendaraan') : [],
		cIds.length ? list(`/items/so_customer?filter[id][_in]=${cIds.join(',')}&fields=id,customer_name&limit=-1`, 'so_customer') : [],
		pIds.length ? list(`/items/projects?filter[id][_in]=${pIds.join(',')}&fields=id,name&limit=-1`, 'projects') : [],
		sIds.length ? list(`/items/fleet_shipments?filter[surat_jalan_id][_in]=${sIds.join(',')}&fields=id,surat_jalan_id,jumlah_koli&sort=id&limit=-1`, 'fleet_shipments') : []
	]);
	const koliFleet = new Map<string, number>();
	for (const f of fleet) {
		const n = Number(f.jumlah_koli);
		if (Number.isFinite(n) && n > 0) koliFleet.set(String(unwrap(f.surat_jalan_id)), n); // baris terbaru (sort id) menimpa
	}
	return {
		plat: new Map(veh.map((v: any) => [String(v.id), v.nomor_polisi])),
		customer: new Map(cust.map((c: any) => [String(c.id), c.customer_name])),
		project: new Map(proj.map((p: any) => [String(p.id), p.name])),
		koliFleet
	};
}

function tujuanOf(sj: any, lk: Lookups): string | null {
	const cust = lk.customer.get(String(unwrap(sj.so_customer_id)));
	const proj = lk.project.get(String(unwrap(sj.project_id)));
	const head = [cust, proj].filter(Boolean).join(' / ');
	return [head, sj.delivery_address].filter(Boolean).join(' — ') || null;
}

function menungguMenit(sj: any): number | null {
	const since = sj.track_stage_at || sj.date_created;
	return since ? Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000)) : null;
}

export type AntrianRow = {
	id: number; nomor_sj: string; tujuan: string | null; driver: string | null; plat: string | null;
	koli_acuan: number | null; koli_sumber: 'fleet' | 'item' | null;
	menunggu_menit: number | null; terlambat: boolean;
	can_pass: boolean; ditahan: boolean; alasan_tahan: string | null; blockers: GateBlocker[];
	is_pre_print?: boolean; draft_status?: string | null;
	/** RSM-08: SJ sudah dicetak tapi gudang belum memindai muat — satpam periksa & foto muatan sendiri */
	belum_discan_muat?: boolean;
};

/** RSM-08 — SJ kategori wajib-satpam yang sudah DICETAK tetapi tidak pernah discan muat (kiosk Muat tidak dipakai). */
async function getCreatedTercetak(settings: GerbangSettings): Promise<any[]> {
	if (!(settings.createdWindowHari > 0)) return [];
	const wajib = await kategoriWajibSatpam();
	if (!wajib.size) return [];
	const sejak = new Date(Date.now() - settings.createdWindowHari * 86_400_000).toISOString();
	const rows = await list(
		`/items/surat_jalan?filter[status][_eq]=created&filter[print_count][_gt]=0&filter[date_created][_gte]=${encodeURIComponent(sejak)}` +
			`&fields=${SJ_FIELDS},type,category&sort=date_created&limit=200`,
		'surat_jalan created-tercetak'
	);
	// SJ penjualan (so_delivery) punya antrean sendiri; saring di sini (jangan _neq: baris type null ikut terbuang)
	return rows.filter((s) => s.type !== 'so_delivery' && wajib.has(String(unwrap(s.category))));
}

/**
 * Antrian satu sumber: status = needs_security_check (GSP-03 §4.1). SJ "backfill nyangkut" tetap tampil
 * dengan blocker DATA_TIDAK_KONSISTEN sampai GSP-07 dijalankan. Blocker di sini = aturan murni + cetak/
 * approval (tanpa I/O tambahan); pemeriksaan penuh (barang bermasalah, gate ERP) ada di detail/aksi.
 */
export async function getAntrian(): Promise<{ count: number; antrian: AntrianRow[] }> {
	const [menunggu, settings] = await Promise.all([
		list(`/items/surat_jalan?filter[status][_eq]=needs_security_check&fields=${SJ_FIELDS}&sort=track_stage_at,date_created&limit=200`, 'surat_jalan antrian'),
		getGerbangSettings()
	]);
	const belumMuat = await getCreatedTercetak(settings);
	const belumMuatIds = new Set(belumMuat.map((s) => s.id));
	const sjs = [...menunggu, ...belumMuat];
	if (!sjs.length) return { count: 0, antrian: [] };
	const sIds = sjs.map((s) => s.id).join(',');
	const [lk, items] = await Promise.all([
		loadLookups(sjs),
		list(`/items/surat_jalan_items?filter[surat_jalan_id][_in]=${sIds}&fields=id,surat_jalan_id,jumlah_pcs&limit=-1`, 'surat_jalan_items antrian')
	]);
	const itemsBy = new Map<string, any[]>();
	for (const it of items) {
		const k = String(unwrap(it.surat_jalan_id));
		if (!itemsBy.has(k)) itemsBy.set(k, []);
		itemsBy.get(k)!.push(it);
	}
	const antrian: AntrianRow[] = sjs.map((sj) => {
		const koli = resolveKoliAcuan(lk.koliFleet.get(String(sj.id)) ?? null, itemsBy.get(String(sj.id)) || []);
		const guard = evaluateGerbangMinimum(sj).map((b) => ({ kode: b.code as GateBlocker['kode'], pesan: b.message, siapa: b.who }));
		const ev = evaluatePass({ ...sj, koli_acuan: koli.koli_acuan }, { blockers: guard });
		const cl = normalizeChecklist(sj.security_checklist);
		const menit = menungguMenit(sj);
		const isPrePrint = sj.draft_status === 'menunggu_verifikasi' || ((Number(sj.print_count) || 0) === 0 && sj.status === 'needs_security_check');
		return {
			id: sj.id, nomor_sj: sj.nomor_sj, tujuan: tujuanOf(sj, lk), driver: sj.driver || null,
			plat: lk.plat.get(String(unwrap(sj.vehicle_id))) || null,
			...koli, menunggu_menit: menit, terlambat: menit != null && menit > settings.slaMenit,
			can_pass: ev.can_pass, ditahan: ev.ditahan,
			alasan_tahan: ev.ditahan ? ((cl?.alasan as string) ?? null) : null,
			blockers: ev.blockers,
			is_pre_print: isPrePrint,
			draft_status: sj.draft_status || null,
			belum_discan_muat: belumMuatIds.has(sj.id)
		};
	});
	return { count: antrian.length, antrian };
}

export type DetailItem = { id: number; nama_barang: string; qty: number; unit: string | null; koli: number | null; keterangan: string | null };

export type Detail = {
	sj: {
		id: number; nomor_sj: string; status: string; track_stage: string | null; driver: string | null; plat: string | null;
		tujuan: string | null; vehicle_id: number | string | null; project_id: number | string | null; project_nama: string | null; print_count: number; foto_kirim: string | null; draft_status: string | null; approval_status: string | null;
		security_verified_at: string | null; security_verified_by: string | null;
		return_status: string | null; return_deadline: string | null;
		foto_gudang_id?: string | null;
		gudang_disiapkan_oleh?: string | null;
		gudang_disiapkan_at?: string | null;
		admin_verif_oleh?: string | null;
		admin_verif_at?: string | null;
		admin_verif_foto?: string | null;
		koli_acuan: number | null; koli_sumber: 'fleet' | 'item' | null; menunggu_menit: number | null;
		/** RSM-08: status masih 'created' (belum discan muat) */
		belum_discan_muat: boolean;
	};
	items: DetailItem[];
	/** checklist sudah dinormalisasi — layar JANGAN membaca security_checklist mentah */
	checklist: ReturnType<typeof normalizeChecklist>;
	already_passed: boolean; can_pass: boolean; ditahan: boolean;
	blockers: GateBlocker[]; warnings: GateWarning[];
	rangkap: Awaited<ReturnType<typeof summarizeRangkapForGate>> | null;
	riwayat_gerbang: { waktu: string; oleh_id: number | null; catatan: string | null; tahap: string | null }[];
	/** hanya terisi bila diminta (untuk aksi) — tidak dikirim ke layar */
	_gate_check?: string;
};

export async function getDetail(sjId: number, opts: { fullGuard?: boolean } = {}): Promise<Detail> {
	const sj = (await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}?fields=${SJ_FIELDS}`).catch((e) => {
		console.error('[gerbangSj/query] gagal baca surat_jalan', sjId, e instanceof Error ? e.message : e);
		return null;
	}))?.data;
	if (!sj) throw new GateError(404, 'TIDAK_DITEMUKAN', 'Surat Jalan tidak ditemukan.');

	const [lk, itemRows, rangkap, scan] = await Promise.all([
		loadLookups([sj]),
		list(`/items/surat_jalan_items?filter[surat_jalan_id][_eq]=${sjId}&fields=id,nama_barang,qty_required,qty_delivered,jumlah_pcs,unit,keterangan&sort=id&limit=-1`, 'surat_jalan_items'),
		summarizeRangkapForGate(sjId).catch((e) => { console.error('[gerbangSj/query] rangkap gagal:', e instanceof Error ? e.message : e); return null; }),
		list(`/items/scan_log?filter[ref_collection][_eq]=surat_jalan&filter[ref_id][_eq]=${sjId}&filter[actor_role][_eq]=satpam&fields=id,timestamp,actor_id,notes,stage_to&sort=-timestamp&limit=5`, 'scan_log gerbang')
	]);
	const items: DetailItem[] = itemRows.map((it: any) => ({
		id: it.id,
		nama_barang: it.nama_barang || 'Barang tanpa nama',
		// yang benar-benar dikirim = qty_delivered (sama dgn qtySjOf di ERP), jatuh ke qty_required
		qty: Number(it.qty_delivered) || Number(it.qty_required) || 0,
		unit: it.unit || null,
		koli: it.jumlah_pcs != null ? Number(it.jumlah_pcs) : null,
		keterangan: it.keterangan || null
	}));
	const koli = resolveKoliAcuan(lk.koliFleet.get(String(sj.id)) ?? null, itemRows);

	// Guard SJH-12 penuh (cetak, barang bermasalah, gate ERP) hanya bila SJ memang menunggu gerbang.
	const extra: { blockers: GateBlocker[]; warnings: GateWarning[] } = { blockers: [], warnings: [] };
	let gateCheck: string | undefined;
	if ((sj.status === 'needs_security_check' || (sj.status === 'created' && Number(sj.print_count) >= 1)) && opts.fullGuard !== false) {
		const g = await getGerbangBlockersDetailed(sj);
		gateCheck = g.gate_check;
		extra.blockers = g.blockers.map((b) => ({ kode: (b.code === 'GATE' ? 'GATE' : b.code) as GateBlocker['kode'], pesan: b.message, siapa: b.who }));
	}
	if (rangkap && !rangkap.siap && rangkap.belum_diserahkan.length) {
		extra.warnings.push({ kode: 'RANGKAP_BELUM', pesan: `${rangkap.belum_diserahkan.length} lembar rangkap belum diserahkan ke PIC: ${rangkap.belum_diserahkan.map((r) => r.lembar).join(', ')}` });
	}
	const ev: PassEvaluation = evaluatePass({ ...sj, koli_acuan: koli.koli_acuan }, extra);

	const safeJson = (v: any) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
	const pg = safeJson(sj.pracetak_gudang);
	const pv = safeJson(sj.pengaju_verification);

	return {
		sj: {
			id: sj.id, nomor_sj: sj.nomor_sj, status: sj.status, track_stage: sj.track_stage || null, driver: sj.driver || null,
			plat: lk.plat.get(String(unwrap(sj.vehicle_id))) || null, tujuan: tujuanOf(sj, lk), vehicle_id: unwrap(sj.vehicle_id) ?? null,
			project_id: unwrap(sj.project_id) ?? null, project_nama: lk.project.get(String(unwrap(sj.project_id))) || null,
			print_count: Number(sj.print_count) || 0, foto_kirim: sj.foto_kirim || null,
			draft_status: sj.draft_status || null, approval_status: sj.approval_status || null,
			security_verified_at: sj.security_verified_at || null, security_verified_by: sj.security_verified_by || null,
			return_status: sj.return_status || null, return_deadline: sj.return_deadline || null,
			foto_gudang_id: pg?.foto_barang_file || null,
			gudang_disiapkan_oleh: pg?.by_name || null,
			gudang_disiapkan_at: pg?.at || null,
			admin_verif_oleh: pv?.verified_by_name || null,
			admin_verif_at: pv?.verified_at || null,
			admin_verif_foto: pv?.foto_verifikasi_file || null,
			...koli, menunggu_menit: menungguMenit(sj),
			belum_discan_muat: sj.status === 'created'
		},
		items,
		checklist: normalizeChecklist(sj.security_checklist),
		already_passed: ev.already_passed, can_pass: ev.can_pass, ditahan: ev.ditahan,
		blockers: ev.blockers, warnings: ev.warnings, rangkap,
		riwayat_gerbang: scan.map((s: any) => ({ waktu: s.timestamp, oleh_id: s.actor_id ?? null, catatan: s.notes ?? null, tahap: s.stage_to ?? null })),
		_gate_check: gateCheck
	};
}

/** Sama dengan getDetail tapi dibersihkan dari field internal (untuk response ke layar). */
export function publicDetail(d: Detail): Omit<Detail, '_gate_check'> {
	const { _gate_check, ...rest } = d;
	void _gate_check;
	return rest;
}

/**
 * Scan QR (EPI:SJ:<id>:<token> atau URL /scan/…) atau ketik nomor SJ → id.
 * Nomor dicocokkan persis, lalu tanpa spasi + tak peka huruf besar-kecil (nomor lama ada spasi: "075EPI-PRYIX/2026- MT").
 */
export async function findIdByCodeOrNomor(input: { code?: string; nomor?: string }): Promise<number> {
	const code = String(input.code || '').trim();
	const nomor = String(input.nomor || '').trim();
	if (code) {
		const parsed = parseEpiQr(code);
		if (!parsed || parsed.type !== 'SJ' || !('token' in parsed) || !parsed.token) {
			throw new GateError(400, 'QR_TIDAK_COCOK', 'QR ini bukan Surat Jalan. Kalau QR rusak, ketik nomor SJ.');
		}
		const row = (await directusServerJson<{ data: any }>(`/items/surat_jalan/${parsed.id}?fields=id,qr_token`).catch(() => null))?.data;
		if (!row) throw new GateError(404, 'TIDAK_DITEMUKAN', 'Surat Jalan tidak ditemukan.');
		if (!row.qr_token || row.qr_token !== parsed.token) throw new GateError(400, 'QR_TIDAK_COCOK', 'Token QR tidak cocok — QR rusak / kedaluwarsa.');
		return row.id;
	}
	if (!nomor) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Scan QR atau ketik nomor SJ.');
	const exact = await list(`/items/surat_jalan?filter[nomor_sj][_eq]=${encodeURIComponent(nomor)}&fields=id&limit=1`, 'cari nomor');
	if (exact[0]) return exact[0].id;
	// fallback: abaikan spasi & huruf besar/kecil (Directus _icontains pada potongan nomor, lalu cocokkan di server)
	const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
	const key = norm(nomor);
	const tail = nomor.split(/[\s/]+/).filter(Boolean).slice(0, 2).join('');
	const cand = await list(`/items/surat_jalan?filter[nomor_sj][_icontains]=${encodeURIComponent(nomor.split(/[\s/]/)[0] || tail)}&fields=id,nomor_sj&limit=50`, 'cari nomor (fuzzy)');
	const hit = cand.find((c: any) => norm(String(c.nomor_sj || '')) === key);
	if (!hit) throw new GateError(404, 'TIDAK_DITEMUKAN', `Nomor "${nomor}" tidak ditemukan.`);
	return hit.id;
}
