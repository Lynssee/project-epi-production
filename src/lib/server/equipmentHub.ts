// src/lib/server/equipmentHub.ts
// SERVER-ONLY. Pemuat data Hub Equipment 360° + penjembatan stiker lama EPI:ITEM:<id> → equipment.
// Aturan #2: SETIAP relasi diambil dengan query terpisah (tanpa field bersarang). Aturan #1: kegagalan baca dicatat dengan
// prefiks [equipmentHub] dan hanya mengosongkan bagian yang gagal — tidak menjatuhkan seluruh Hub dan tidak menelan diam-diam.
// Hemat API: tiap bagian (section) dimuat on-demand saat tab dibuka; setelan fleet_settings di-cache 5 menit.

import { directusServerJson } from '$lib/server/directus';
import { resolveGateMode, type GateMode } from '$lib/server/gateDefinitionsMode';
import {
	DEFAULT_HUB_SETTINGS,
	DOC_EQ_SCAN_HUB,
	GATE_EQ_SCAN_HUB,
	HUB_SETTING_KEYS,
	buildActions,
	computeExpiry,
	normalizeHubSettings,
	redactCost,
	resolveProfileKey,
	type HubSettings
} from '$lib/server/equipmentHubCore';
import { findVehicleByEquipment, type EquipmentLite, type VehicleLite } from '$lib/server/equipmentVerify';

type Dx = <T = any>(path: string, init?: any) => Promise<T>;
const log = (msg: string, e: unknown) => console.error(`[equipmentHub] ${msg}:`, e instanceof Error ? e.message : e);
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** Baca daftar; gagal → dicatat + []. Dipakai per-koleksi agar satu kegagalan tidak mematikan seluruh bagian. */
async function rows(dx: Dx, label: string, path: string): Promise<any[]> {
	try {
		return (await dx<{ data: any[] }>(path))?.data || [];
	} catch (e) {
		log(`gagal memuat ${label}`, e);
		return [];
	}
}

// ── Setelan (cache 5 menit; bawaan di equipmentHubCore) ──────────────────────────────────────────────────────────────
let settingsCache: { at: number; value: HubSettings } | null = null;
export function clearHubSettingsCache() {
	settingsCache = null;
}

export async function loadHubSettings(dx: Dx = directusServerJson as Dx): Promise<HubSettings> {
	if (settingsCache && Date.now() - settingsCache.at < 300_000) return settingsCache.value;
	let value = DEFAULT_HUB_SETTINGS;
	try {
		const res = await dx<{ data: { key: string; value: unknown }[] }>(
			`/items/fleet_settings?${qs({ 'filter[key][_in]': HUB_SETTING_KEYS.join(','), fields: 'key,value', limit: '-1' })}`
		);
		value = normalizeHubSettings(res?.data);
	} catch (e) {
		log('gagal baca fleet_settings, pakai bawaan', e);
	}
	settingsCache = { at: Date.now(), value };
	return value;
}

/** Mode gate; gagal baca → 'shadow' (perilaku lama = bottom-sheet; tidak pernah membuat lapangan terkunci). */
export async function resolveHubGateMode(): Promise<GateMode> {
	return resolveGateMode(GATE_EQ_SCAN_HUB, DOC_EQ_SCAN_HUB).catch((e) => {
		log('gagal resolusi mode gate, pakai shadow', e);
		return 'shadow' as GateMode;
	});
}

// ── Jembatan EPI:ITEM:<id> → equipment ───────────────────────────────────────────────────────────────────────────────
export interface BridgeItem {
	id: number;
	nama_barang_lengkap: string | null;
	kode_item: string | null;
	satuan: string | null;
	id_equipment: string | null;
	nomor_polisi: string | null;
	parent_category: number | null;
}

export type BridgeResult =
	| { kind: 'equipment'; item: BridgeItem; equipment: EquipmentLite }
	| { kind: 'item'; item: BridgeItem }
	| { kind: 'not_found' };

/**
 * Stiker lama EPI:ITEM:<id> pada kendaraan/alat: cari equipment lewat (1) identitas_barang.id_equipment = equipment.code,
 * lalu (2) equipment.identitas_barang_id = id. Barang stok biasa → kind 'item' (nama & kode lengkap, bukan "Barang #id").
 */
export async function bridgeItemToEquipment(itemId: number, dx: Dx = directusServerJson as Dx): Promise<BridgeResult> {
	let item: BridgeItem | null = null;
	try {
		const res = await dx<{ data: BridgeItem }>(
			`/items/identitas_barang/${encodeURIComponent(String(itemId))}?fields=id,nama_barang_lengkap,kode_item,satuan,id_equipment,nomor_polisi,parent_category`
		);
		item = res?.data ?? null;
	} catch (e) {
		// 404 Directus = barang tidak ada; selain itu gangguan → lempar agar pemanggil bisa fail-open.
		if (/\b(404|403)\b|not.?found|forbidden/i.test(String((e as Error)?.message))) {
			log(`identitas_barang #${itemId} tidak terbaca/ada`, e);
			return { kind: 'not_found' };
		}
		throw e;
	}
	if (!item) return { kind: 'not_found' };

	const fields = 'id,name,code,category_id';
	let equipment: EquipmentLite | null = null;
	const code = item.id_equipment?.trim();
	if (code) {
		equipment = (await rows(dx, 'equipment by code', `/items/equipment?${qs({ 'filter[code][_eq]': code, fields, limit: '1' })}`))[0] ?? null;
	}
	if (!equipment) {
		equipment = (await rows(dx, 'equipment by identitas_barang_id', `/items/equipment?${qs({ 'filter[identitas_barang_id][_eq]': String(item.id), fields, limit: '1' })}`))[0] ?? null;
	}
	if (!equipment) {
		// Barang aset yang didaftarkan otomatis dari erp-epi (ensureEquipmentInEquipmentTable) memakai kode 'EQ-<id>' tanpa mengisi id_equipment.
		equipment = (await rows(dx, 'equipment by kode EQ-<id>', `/items/equipment?${qs({ 'filter[code][_eq]': `EQ-${item.id}`, fields, limit: '1' })}`))[0] ?? null;
	}
	return equipment ? { kind: 'equipment', item, equipment } : { kind: 'item', item };
}

// ── Bagian Hub ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const HUB_SECTIONS = ['summary', 'repair', 'p2h', 'purchase', 'usage', 'pelatihan'] as const;
export type HubSection = (typeof HUB_SECTIONS)[number];

const EQ_FIELDS =
	'id,code,name,brand,model_type,parent_category,category_id,status_operational,last_hoursmeter,last_odometer,current_km,stnk_expiry,tax_expiry,kir_expiry,vehicle_year,purchase_date,ownership_type,owner_name,color,identitas_barang_id';

export async function loadEquipmentRow(equipmentId: string, dx: Dx = directusServerJson as Dx): Promise<any | null> {
	const res = await dx<{ data: any }>(`/items/equipment/${encodeURIComponent(equipmentId)}?fields=${EQ_FIELDS}`);
	return res?.data ?? null;
}

export async function loadSummary(eq: any, settings: HubSettings, mode: GateMode, dx: Dx = directusServerJson as Dx, nowMs = Date.now()) {
	const eid = String(eq.id);
	const [catRows, vehicle, woAktif, lastP2h, nextPm] = await Promise.all([
		eq.category_id ? rows(dx, 'category', `/items/category?${qs({ 'filter[id][_eq]': String(eq.category_id), fields: 'id,name', limit: '1' })}`) : Promise.resolve([]),
		findVehicleByEquipment(eid, dx, eq.code).catch((e) => {
			log('gagal baca fleet_kendaraan (diperlakukan bukan kendaraan)', e);
			return null as VehicleLite | null;
		}),
		rows(dx, 'WO aktif', `/items/work_order?${qs({ 'filter[equipment_id][_eq]': eid, 'filter[tanggal_done][_null]': 'true', fields: 'id', limit: '50' })}`),
		rows(dx, 'P2H terakhir', `/items/p2h_session?${qs({ 'filter[equipment_id][_eq]': eid, fields: 'id,date,status_unit', sort: '-date', limit: '1' })}`),
		rows(dx, 'PM mendatang', `/items/pm_due_tracker?${qs({ 'filter[equipment_id][_eq]': eid, 'filter[pm_task_template_id][_nnull]': 'true', fields: 'id,due_date,pm_task_template_id', sort: 'due_date', limit: '1' })}`)
	]);
	const categoryName: string | null = catRows[0]?.name ?? null;
	const profileKey = resolveProfileKey(eq.parent_category, categoryName, settings.profiles);
	const kind = vehicle ? 'vehicle' : 'tool';
	return {
		equipment: { ...eq, category_name: categoryName },
		vehicle,
		kind,
		profile: profileKey,
		actions: buildActions(profileKey, settings.profiles, eid),
		tabs: settings.tabs,
		expiry: computeExpiry(eq, nowMs),
		counts: { woAktif: woAktif.length, woAktifPlus: woAktif.length >= 50 },
		lastP2h: lastP2h[0] ?? null,
		nextPm: nextPm[0] ?? null,
		hubOpensOnScan: mode !== 'shadow',
		gateMode: mode
	};
}

export async function loadRepair(equipmentId: string, dx: Dx = directusServerJson as Dx) {
	const eid = equipmentId;
	const [workOrders, tickets, pmRows, compRows] = await Promise.all([
		rows(dx, 'work_order', `/items/work_order?${qs({ 'filter[equipment_id][_eq]': eid, fields: 'id,keluhan,order_status,tanggal_rusak,tanggal_done', sort: '-tanggal_rusak', limit: '30' })}`),
		rows(dx, 'maint_tickets', `/items/maint_tickets?${qs({ 'filter[equipment_id][_eq]': eid, fields: 'id,masalah,status,tanggal_lapor', sort: '-tanggal_lapor', limit: '30' })}`),
		rows(dx, 'pm_due_tracker', `/items/pm_due_tracker?${qs({ 'filter[equipment_id][_eq]': eid, 'filter[pm_task_template_id][_nnull]': 'true', fields: 'id,due_date,last_done_date,pm_task_template_id', sort: 'due_date', limit: '30' })}`),
		rows(dx, 'component_unit', `/items/component_unit?${qs({ 'filter[equipment_id][_eq]': eid, 'filter[status_fisik][_in]': 'terpasang,dilepas_sementara', fields: 'id,kode_unit,serial_number,status_fisik,warranty_expiry,component_master_id', limit: '50' })}`)
	]);

	const tplIds = [...new Set(pmRows.map((p) => p.pm_task_template_id).filter(Boolean))];
	const masterIds = [...new Set(compRows.map((c) => c.component_master_id).filter(Boolean))];
	const [tpls, masters] = await Promise.all([
		tplIds.length ? rows(dx, 'pm_task_template', `/items/pm_task_template?${qs({ 'filter[id][_in]': tplIds.join(','), fields: 'id,task_name', limit: '-1' })}`) : Promise.resolve([]),
		masterIds.length ? rows(dx, 'component_master', `/items/component_master?${qs({ 'filter[id][_in]': masterIds.join(','), fields: 'id,nama,kategori,merek', limit: '-1' })}`) : Promise.resolve([])
	]);
	const tplName = new Map(tpls.map((t) => [t.id, t.task_name]));
	const master = new Map(masters.map((m) => [m.id, m]));
	return {
		workOrders,
		tickets,
		pm: pmRows.map((p) => ({ id: p.id, due_date: p.due_date, last_done_date: p.last_done_date, task_name: tplName.get(p.pm_task_template_id) || 'Tugas PM' })),
		components: compRows.map((c) => {
			const m = master.get(c.component_master_id);
			return { id: c.id, kode_unit: c.kode_unit, serial_number: c.serial_number, status_fisik: c.status_fisik, warranty_expiry: c.warranty_expiry, nama: m?.nama ?? null, kategori: m?.kategori ?? null, merek: m?.merek ?? null };
		})
	};
}

export async function loadP2h(equipmentId: string, dx: Dx = directusServerJson as Dx) {
	const sessions = await rows(dx, 'p2h_session', `/items/p2h_session?${qs({ 'filter[equipment_id][_eq]': equipmentId, fields: 'id,date,status_unit', sort: '-date', limit: '30' })}`);
	// Rincian item hanya untuk 5 sesi terbaru (hemat API) dan hanya yang bercatatan/temuan.
	const recentIds = sessions.slice(0, 5).map((s) => s.id);
	let findings: any[] = [];
	if (recentIds.length) {
		const logs = await rows(dx, 'p2h_log', `/items/p2h_log?${qs({ 'filter[p2h_session_id][_in]': recentIds.join(','), fields: 'id,p2h_session_id,p2h_template_id,result,notes,numeric_value', limit: '300' })}`);
		const tplIds = [...new Set(logs.map((l) => l.p2h_template_id).filter(Boolean))];
		const resIds = [...new Set(logs.map((l) => l.result).filter(Boolean))];
		const [tpls, ress] = await Promise.all([
			tplIds.length ? rows(dx, 'p2h_template', `/items/p2h_template?${qs({ 'filter[id][_in]': tplIds.join(','), fields: 'id,item_name', limit: '-1' })}`) : Promise.resolve([]),
			resIds.length ? rows(dx, 'category (hasil P2H)', `/items/category?${qs({ 'filter[id][_in]': resIds.join(','), fields: 'id,name', limit: '-1' })}`) : Promise.resolve([])
		]);
		const tn = new Map(tpls.map((t) => [t.id, t.item_name]));
		const rn = new Map(ress.map((r) => [r.id, String(r.name || '')]));
		findings = logs
			.map((l) => ({ sessionId: l.p2h_session_id, item: tn.get(l.p2h_template_id) || 'Item', hasil: rn.get(l.result) || '-', notes: l.notes || null, nilai: l.numeric_value ?? null }))
			// Tampilkan hanya temuan: hasil bukan "ok/go/baik" atau ada catatan.
			.filter((f) => !/^(ok|go|baik|good|normal)$/i.test(f.hasil.trim()) || !!f.notes);
	}
	return { sessions, findings };
}

/** Sparepart yang pernah dipakai pada unit ini (sparepart_usage_log → sparepart, dua query terpisah). */
export async function loadSpareparts(equipmentId: string, allowCost: boolean, dx: Dx = directusServerJson as Dx) {
	const logs = await rows(dx, 'sparepart_usage_log', `/items/sparepart_usage_log?${qs({ 'filter[equipment_id][_eq]': equipmentId, fields: 'id,tanggal,work_order_id,sparepart_id,jumlah', sort: '-tanggal', limit: '30' })}`);
	const ids = [...new Set(logs.map((l) => l.sparepart_id).filter(Boolean))];
	const parts = ids.length ? await rows(dx, 'sparepart', `/items/sparepart?${qs({ 'filter[id][_in]': ids.join(','), fields: 'id,code,name,brand,last_price', limit: '-1' })}`) : [];
	const pm = new Map(parts.map((p) => [p.id, p]));
	const list = logs.map((l) => {
		const p = pm.get(l.sparepart_id);
		return { id: l.id, tanggal: l.tanggal ?? null, workOrderId: l.work_order_id ?? null, jumlah: Number(l.jumlah) || 0, code: p?.code ?? null, name: p?.name ?? 'Sparepart', brand: p?.brand ?? null, lastPrice: Number(p?.last_price) || 0 };
	});
	return redactCost(list, allowCost);
}

export async function loadPurchase(eq: any, allowCost: boolean, dx: Dx = directusServerJson as Dx) {
	const spareparts = await loadSpareparts(String(eq.id), allowCost, dx);
	const ibId = eq.identitas_barang_id;
	if (!ibId) return { linked: false, purchases: [], receipts: [], spareparts, costVisible: allowCost };
	const [poItems, receipts] = await Promise.all([
		rows(dx, 'purchase_order_supplier_items', `/items/purchase_order_supplier_items?${qs({ 'filter[identitas_barang_id][_eq]': String(ibId), fields: 'id,po_id,item_name,quantity,unit,unit_price,total_price,received_qty', sort: '-id', limit: '30' })}`),
		rows(dx, 'stock_transactions', `/items/stock_transactions?${qs({ 'filter[item_id][_eq]': String(ibId), 'filter[transaction_type][_eq]': 'IN', fields: 'id,transaction_date,quantity,reference_no,destination_name', sort: '-transaction_date', limit: '20' })}`)
	]);
	const poIds = [...new Set(poItems.map((p) => (typeof p.po_id === 'object' ? p.po_id?.id : p.po_id)).filter(Boolean))];
	const headers = poIds.length
		? await rows(dx, 'purchase_orders_supplier', `/items/purchase_orders_supplier?${qs({ 'filter[id][_in]': poIds.join(','), fields: 'id,po_number,po_date,supplier_name,status', limit: '-1' })}`)
		: [];
	const hm = new Map(headers.map((h) => [h.id, h]));
	const purchases = poItems.map((p) => {
		const poId = typeof p.po_id === 'object' ? p.po_id?.id : p.po_id;
		const h = hm.get(poId);
		return {
			id: p.id,
			poNumber: h?.po_number || `PO #${poId ?? '-'}`,
			poDate: h?.po_date ?? null,
			supplier: h?.supplier_name || null,
			status: h?.status || null,
			itemName: p.item_name || null,
			quantity: Number(p.quantity) || 0,
			unit: p.unit || null,
			receivedQty: Number(p.received_qty) || 0,
			unitPrice: Number(p.unit_price) || 0,
			totalPrice: Number(p.total_price) || 0
		};
	});
	return { linked: true, purchases: redactCost(purchases, allowCost), receipts, spareparts, costVisible: allowCost };
}

export async function loadUsage(eq: any, vehicle: VehicleLite | null, dx: Dx = directusServerJson as Dx) {
	const eid = String(eq.id);
	const [bookings, loans] = await Promise.all([
		vehicle
			? rows(dx, 'fleet_bookings', `/items/fleet_bookings?${qs({ 'filter[vehicle_id][_eq]': String(vehicle.id), fields: 'id,kode_booking,requester_name,keperluan,tujuan,tanggal_mulai,tanggal_selesai_rencana,status', sort: '-tanggal_mulai', limit: '30' })}`)
			: Promise.resolve([]),
		rows(dx, 'internal_loan_log', `/items/internal_loan_log?${qs({ 'filter[equipment_id][_eq]': eid, fields: 'id,pic_id,project_id,start_date,end_date_planned,end_date_actual,purpose', sort: '-start_date', limit: '30' })}`)
	]);
	const picIds = [...new Set(loans.map((l) => l.pic_id).filter((x) => x != null))];
	const projIds = [...new Set(loans.map((l) => l.project_id).filter((x) => x != null))];
	const [pics, projs] = await Promise.all([
		picIds.length ? rows(dx, 'karyawan', `/items/karyawan?${qs({ 'filter[id][_in]': picIds.join(','), fields: 'id,nama_karyawan', limit: '-1' })}`) : Promise.resolve([]),
		projIds.length ? rows(dx, 'projects', `/items/projects?${qs({ 'filter[id][_in]': projIds.join(','), fields: 'id,name', limit: '-1' })}`) : Promise.resolve([])
	]);
	const pn = new Map(pics.map((p) => [String(p.id), p.nama_karyawan]));
	const jn = new Map(projs.map((p) => [String(p.id), p.name]));
	return {
		kind: vehicle ? 'vehicle' : 'tool',
		bookings,
		loans: loans.map((l) => ({ ...l, pic_name: l.pic_id != null ? pn.get(String(l.pic_id)) ?? null : null, project_name: l.project_id != null ? jn.get(String(l.project_id)) ?? null : null }))
	};
}

/**
 * Pelatihan terkait unit/alat ini (QR equipment → modul). Sumber tunggal: profil Inventory 360° — profil unit (item_id) lebih dulu,
 * lalu profil MODEL (group_id = identitas_barang.item_group_id) — kolom training_program_id. Hanya program berstatus published.
 * Tiap koleksi di-fetch terpisah (tanpa relasi bersarang). Tidak ada tautan → daftar kosong (kartu disembunyikan di klien).
 */
export async function loadPelatihan(eq: any, dx: Dx = directusServerJson as Dx) {
	const ibId = eq?.identitas_barang_id;
	if (!ibId) return { programs: [] as { id: number; judul: string; sumber: 'unit' | 'model'; wajib: boolean }[] };
	const item = (await rows(dx, 'identitas_barang grup', `/items/identitas_barang?${qs({ 'filter[id][_eq]': String(ibId), fields: 'id,item_group_id', limit: '1' })}`))[0];
	const groupId = item?.item_group_id ? String(typeof item.item_group_id === 'object' ? item.item_group_id.id : item.item_group_id) : null;
	const filter = groupId ? { _or: [{ item_id: { _eq: Number(ibId) } }, { group_id: { _eq: groupId } }] } : { item_id: { _eq: Number(ibId) } };
	const profiles = await rows(dx, 'inventory_knowledge_profile', `/items/inventory_knowledge_profile?${qs({ filter: JSON.stringify({ _and: [filter, { training_program_id: { _nnull: true } }] }), fields: 'id,item_id,group_id,training_program_id,wajib_training', limit: '10' })}`);
	if (!profiles.length) return { programs: [] };
	const pids = [...new Set(profiles.map((p) => Number(p.training_program_id)).filter(Number.isFinite))];
	const progs = await rows(dx, 'training_program', `/items/training_program?${qs({ filter: JSON.stringify({ _and: [{ id: { _in: pids } }, { status: { _eq: 'published' } }] }), fields: 'id,judul', limit: '-1' })}`);
	const pm = new Map(progs.map((p) => [Number(p.id), p]));
	const out: { id: number; judul: string; sumber: 'unit' | 'model'; wajib: boolean }[] = [];
	for (const pr of profiles) {
		const prog = pm.get(Number(pr.training_program_id));
		if (!prog || out.some((o) => o.id === prog.id)) continue;
		out.push({ id: prog.id, judul: String(prog.judul || `Program #${prog.id}`), sumber: pr.item_id ? 'unit' : 'model', wajib: pr.wajib_training === true });
	}
	return { programs: out };
}
