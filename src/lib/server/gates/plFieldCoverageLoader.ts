// src/lib/server/gates/plFieldCoverageLoader.ts
// SERVER-ONLY. Rencana Gate Rasionalitas Packing List, Fase 4 (4 Nov 2026) — sisi lapangan.
// Kembar dari erp-epi/src/lib/server/gates/plCoverageGate.js::loadPlCoverageContext (tanpa bagian RAB; alur lapangan
// membandingkan baris RAB dengan dirinya sendiri sehingga kuota RAB ditegakkan di sisi admin). Rumus ada di
// $lib/shared/materialCoverageEngine.ts (salinan identik, dijaga tes kontrak lintas repo di erp-epi).
//
// Doktrin: setiap relasi di-fetch TERPISAH (CLAUDE.md aturan #2); gagal baca ⇒ dilog lalu dianggap data kosong ⇒ gate N/A
// (fail-open, tidak pernah mengunci lapangan karena gangguan Directus). Mode gate dari gate_definitions/gate_enforcement.

import { resolveGateMode, type GateMode } from '../gateDefinitionsMode';
import { resolvePklCoverageSettings } from '$lib/shared/plCoverageSettings';
import {
	resolveAreaM2,
	normalizeQtyToBase,
	findRateByProductCode,
	resolveRateStandard,
	convertBase,
	extractAreaSchedule,
	avgPlannedM2PerDay,
	resolveDailyRate
} from '$lib/shared/materialCoverageEngine';

type Dx = (path: string, init?: any) => Promise<any>;

export interface FieldCoverage {
	settings: any;
	rates: any[];
	area: { areaM2: number; source: string } | null;
	dailyRate: { rate: number; source: string } | null;
	priorByRateId: Map<string, { base: number; unit: string }>;
	siteStockByRateId: Map<string, { onHandStd: number; receivedStd: number; usedStd: number; lastMovement: string | null }>;
	fillById: Map<string, number>;
}

export const FIELD_COVERAGE_GATE_KEYS = ['G_PKL_COVERAGE_M2', 'G_PKL_TIMELINE_RUNRATE', 'G_PKL_SITE_STOCK_RECON'] as const;

// PL yang sudah lewat persetujuan = qty-nya dianggap terkomit (identik dengan COMMITTED_STATUSES di erp-epi plCoverageGate.js).
const COMMITTED_STATUSES = ['approved', 'active', 'picking', 'packed', 'dispatched', 'shipped', 'delivered', 'completed', 'needs_security_check', 'partial'];
const TTL_MS = 5 * 60 * 1000;
const cache: { settings: { v: any; at: number } | null; rates: { v: any[]; at: number } | null; defs: Map<string, { at: number; exists: boolean }> } = {
	settings: null,
	rates: null,
	defs: new Map()
};
const fresh = (e: { at: number } | null) => !!e && Date.now() - e.at < TTL_MS;
export function resetFieldCoverageCache() {
	cache.settings = null;
	cache.rates = null;
	cache.defs.clear();
}

const idOf = (v: any) => (v == null ? null : String(typeof v === 'object' ? v?.id : v));
const num = (v: any) => parseFloat(v ?? 0) || 0;

async function safe<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
	try {
		return await p;
	} catch (e: any) {
		console.warn(`[plFieldCoverageLoader] ${label} gagal:`, e?.message || e);
		return fallback;
	}
}

/**
 * Mode gate rasionalitas. Berbeda dari resolveGateMode biasa (fallback 'soft' bila definisi belum ada): gate yang BELUM
 * di-seed ke gate_definitions HARUS 'shadow' — jangan menampilkan peringatan ke lapangan sebelum Superadmin menyalakannya.
 */
export async function resolveCoverageGateMode(gateKey: string, dx: Dx): Promise<GateMode> {
	let hit = cache.defs.get(gateKey);
	if (!hit || Date.now() - hit.at >= TTL_MS) {
		const exists = await safe(
			`cek definisi ${gateKey}`,
			dx(`/items/gate_definitions?filter[gate_key][_eq]=${encodeURIComponent(gateKey)}&fields=id&limit=1`).then((r: any) => !!r?.data?.length),
			false
		);
		hit = { at: Date.now(), exists };
		cache.defs.set(gateKey, hit);
	}
	return hit.exists ? resolveGateMode(gateKey, 'PL') : 'shadow';
}

async function loadSettings(dx: Dx) {
	if (fresh(cache.settings)) return cache.settings!.v;
	const rows = await safe(
		'baca setelan pkl_coverage',
		dx(`/items/app_settings?filter[module][_eq]=project&filter[setting_key][_starts_with]=pkl_coverage.&fields=setting_key,setting_value&limit=-1`).then((r: any) => r?.data || []),
		[] as any[]
	);
	const v = resolvePklCoverageSettings(rows);
	cache.settings = { v, at: Date.now() };
	return v;
}

async function loadRates(dx: Dx) {
	if (fresh(cache.rates)) return cache.rates!.v;
	const base = await safe(
		'baca kalkulator_material_rate',
		dx(`/items/kalkulator_material_rate?filter[active][_eq]=1&fields=id,code,name,category,unit,volume_solids,density,default_consumption,default_dft&limit=-1`).then((r: any) => r?.data || []),
		[] as any[]
	);
	// max_consumption = field opsional (apply = Lead); belum ada ⇒ query ini gagal ⇒ diabaikan.
	const max = await safe(
		'baca max_consumption (opsional)',
		dx(`/items/kalkulator_material_rate?filter[active][_eq]=1&fields=id,max_consumption&limit=-1`).then((r: any) => r?.data || []),
		[] as any[]
	);
	const maxById = new Map(max.map((m: any) => [String(m.id), m.max_consumption]));
	const rates = base.map((r: any) => ({ ...r, max_consumption: maxById.get(String(r.id)) ?? null }));
	cache.rates = { v: rates, at: Date.now() };
	return rates;
}

/** Konteks coverage untuk SATU proyek. `rows` = baris pengajuan (untuk fill_weight_kg master). */
export async function loadFieldCoverage(projectId: string | number, itemIds: Array<string | number | null | undefined>, dx: Dx): Promise<FieldCoverage> {
	const pid = String(projectId);
	const [settings, rates, project, charters, otherPls] = await Promise.all([
		loadSettings(dx),
		loadRates(dx),
		safe(`baca proyek ${pid}`, dx(`/items/projects/${encodeURIComponent(pid)}?fields=id,total_area_m2,start_date,end_date,timeline_planning`).then((r: any) => r?.data || null), null as any),
		safe(`baca charter proyek ${pid}`, dx(`/items/project_charters?filter[project_id][_eq]=${encodeURIComponent(pid)}&fields=id,nilai_luasan&sort=-id&limit=10`).then((r: any) => r?.data || []), [] as any[]),
		safe(
			`baca PL proyek ${pid}`,
			dx(`/items/packing_list?filter[project_id][_eq]=${encodeURIComponent(pid)}&filter[status][_in]=${COMMITTED_STATUSES.join(',')}&fields=id&limit=-1`).then((r: any) => (r?.data || []).map((p: any) => p.id)),
			[] as any[]
		)
	]);

	const charterM2 = (charters || []).map((c: any) => c.nilai_luasan).find((v: any) => num(v) >= settings.min_trusted_area_m2) ?? null;
	const area = resolveAreaM2({ charterM2, projectM2: project?.total_area_m2 }, settings);

	const priorItems = otherPls.length
		? await safe(
				'baca item PL proyek',
				dx(`/items/packing_list_items?filter[packing_list_id][_in]=${otherPls.join(',')}&fields=id,item_id,nama_barang,qty_required,unit&limit=-1`).then((r: any) => r?.data || []),
				[] as any[]
			)
		: [];
	const ibIds = [...new Set([...itemIds.map(idOf), ...priorItems.map((i: any) => idOf(i.item_id))].filter(Boolean) as string[])];
	const fillById = new Map<string, number>();
	if (ibIds.length) {
		const ib = await safe('baca fill_weight_kg master', dx(`/items/identitas_barang?filter[id][_in]=${ibIds.join(',')}&fields=id,fill_weight_kg&limit=-1`).then((r: any) => r?.data || []), [] as any[]);
		for (const row of ib) if (num(row.fill_weight_kg) > 0) fillById.set(String(row.id), num(row.fill_weight_kg));
	}

	const priorByRateId = new Map<string, { base: number; unit: string }>();
	for (const it of priorItems) {
		const norm = normalizeQtyToBase({ qty: it.qty_required, unit: it.unit, name: it.nama_barang, fillWeightKg: fillById.get(idOf(it.item_id) || '') ?? null }, settings);
		if (!norm.resolved) continue;
		const rate = findRateByProductCode(it.nama_barang, rates);
		if (!rate) continue;
		const k = String(rate.id ?? rate.code);
		const cur = priorByRateId.get(k);
		if (!cur) priorByRateId.set(k, { base: norm.base, unit: norm.baseUnit as string });
		else if (cur.unit === norm.baseUnit) cur.base += norm.base;
	}

	// Jadwal & laju harian
	const schedule = extractAreaSchedule(project?.timeline_planning);
	const fromIso = new Date().toISOString().slice(0, 10);
	const durationDays =
		schedule.dayCount > 0
			? schedule.dayCount
			: project?.start_date && project?.end_date
				? Math.max(1, Math.round((Date.parse(project.end_date) - Date.parse(project.start_date)) / 86400000) + 1)
				: 0;
	const dailyRate = resolveDailyRate({
		planAvgM2PerDay: avgPlannedM2PerDay(schedule.planM2ByDate, fromIso, settings.max_buffer_days),
		areaM2: area?.areaM2,
		durationDays
	});

	// Saldo stok site per standar (rate)
	const siteStockByRateId = new Map<string, { onHandStd: number; receivedStd: number; usedStd: number; lastMovement: string | null }>();
	const balances = await safe(
		'baca project_stock_balance',
		dx(`/items/project_stock_balance?filter[project_id][_eq]=${encodeURIComponent(pid)}&fields=item_id,qty_on_hand,qty_received,qty_used,last_movement_date&limit=-1`).then((r: any) => r?.data || []),
		[] as any[]
	);
	if (balances.length) {
		const bIds = [...new Set(balances.map((b: any) => idOf(b.item_id)).filter(Boolean) as string[])];
		const masters = await safe('baca master barang stok site', dx(`/items/identitas_barang?filter[id][_in]=${bIds.join(',')}&fields=id,nama_barang_lengkap,satuan,fill_weight_kg&limit=-1`).then((r: any) => r?.data || []), [] as any[]);
		const mById = new Map(masters.map((m: any) => [String(m.id), m]));
		for (const b of balances) {
			const m: any = mById.get(idOf(b.item_id) || '');
			if (!m) continue;
			const rate = findRateByProductCode(m.nama_barang_lengkap, rates);
			const std = rate ? resolveRateStandard(rate, settings) : null;
			if (!rate || !std) continue;
			const toStd = (q: any) => {
				const n = normalizeQtyToBase({ qty: q, unit: m.satuan, name: m.nama_barang_lengkap, fillWeightKg: m.fill_weight_kg }, settings);
				return n.resolved ? convertBase(n.base, n.baseUnit, std.unit, std.density) : null;
			};
			const onHand = toStd(b.qty_on_hand);
			if (onHand == null) continue;
			const k = String(rate.id ?? rate.code);
			const cur = siteStockByRateId.get(k) || { onHandStd: 0, receivedStd: 0, usedStd: 0, lastMovement: null };
			cur.onHandStd += Math.max(0, onHand);
			cur.receivedStd += toStd(b.qty_received) ?? 0;
			cur.usedStd += toStd(b.qty_used) ?? 0;
			const lm = b.last_movement_date ? String(b.last_movement_date).slice(0, 10) : null;
			if (lm && (!cur.lastMovement || lm > cur.lastMovement)) cur.lastMovement = lm;
			siteStockByRateId.set(k, cur);
		}
	}

	return { settings, rates, area, dailyRate, priorByRateId, siteStockByRateId, fillById };
}
