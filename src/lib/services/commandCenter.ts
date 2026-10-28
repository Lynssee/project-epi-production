// src/lib/services/commandCenter.ts
// Fase 3 — Command Center lapangan. Baca langsung koleksi Directus yang sama
// dipakai admin (erp-epi-1): command_center_config, command_center_widgets,
// department, department_alias, department_health_scores, automation_alerts.
// TIDAK memanggil endpoint erp-epi-1 lintas-origin — konsisten dengan pola
// project-epi existing (inventorySettings.ts: kedua dashboard baca kunci sama
// dari Directus, bukan HTTP call antar app).

import { secureDirectusJson } from './secureDirectus';

export interface CcWidget {
	id: string;
	widget_key: string;
	label: string;
	widget_type: 'counter' | 'progress' | 'status_light' | 'trend' | 'list' | 'quick_action';
	value: number | string | null;
	status: 'ok' | 'warning' | 'danger';
	link_url: string | null;
	source: 'cache' | 'live' | 'n/a';
}

export interface CcSnapshot {
	active: boolean;
	department: { id: number; nama_department: string } | null;
	health_score: number | null;
	trend: string | null;
	widgets: CcWidget[];
	generated_at: string;
}

const CACHE_KEY = 'epi_command_center_v1';
const CACHE_TTL_MS = 15 * 60_000;

function buildFilterQs(filters: Record<string, Record<string, any>> | null | undefined): string {
	if (!filters) return '';
	const parts: string[] = [];
	for (const [field, cond] of Object.entries(filters)) {
		for (const [op, val] of Object.entries(cond)) {
			parts.push(`filter[${encodeURIComponent(field)}][${op}]=${encodeURIComponent(val === true ? 'true' : val)}`);
		}
	}
	return parts.join('&');
}

async function liveAggregate(widget: any): Promise<number | null> {
	const { data_collection, data_aggregate, aggregate_field, data_filter } = widget;
	if (!data_collection || !data_aggregate) return null;
	const aggField = aggregate_field || 'id';
	const filterQs = buildFilterQs(data_filter);
	const qs = [`aggregate[${data_aggregate}]=${aggField}`, filterQs].filter(Boolean).join('&');
	try {
		const res = await secureDirectusJson<any>(`/items/${data_collection}?${qs}`);
		const row = res?.data?.[0];
		if (!row) return 0;
		const raw = data_aggregate === 'count' ? row.count : row[data_aggregate]?.[aggField];
		return Number(raw) || 0;
	} catch {
		return null;
	}
}

function statusFor(value: number | null, direction: string, warning: number | null, danger: number | null): 'ok' | 'warning' | 'danger' {
	if (value == null || (warning == null && danger == null)) return 'ok';
	const worse = direction === 'below' ? (a: number, b: number) => a <= b : (a: number, b: number) => a >= b;
	if (danger != null && worse(value, danger)) return 'danger';
	if (warning != null && worse(value, warning)) return 'warning';
	return 'ok';
}

/** Resolusi karyawan.divisi (teks bebas) -> department.id kanonik lewat department_alias, fallback nama_department. */
async function resolveDepartmentId(divisi: string | null): Promise<{ id: number; nama_department: string } | null> {
	if (!divisi) return null;

	const aliasRes = await secureDirectusJson<any>(
		`/items/department_alias?filter[alias][_eq]=${encodeURIComponent(divisi)}&filter[is_active][_eq]=true&fields=department_id.id,department_id.nama_department&limit=1`
	).catch(() => null);
	const aliasHit = aliasRes?.data?.[0]?.department_id;
	if (aliasHit?.id) return { id: aliasHit.id, nama_department: aliasHit.nama_department };

	const directRes = await secureDirectusJson<any>(
		`/items/department?filter[nama_department][_icontains]=${encodeURIComponent(divisi)}&filter[is_active][_eq]=true&fields=id,nama_department&limit=1`
	).catch(() => null);
	const directHit = directRes?.data?.[0];
	return directHit ? { id: directHit.id, nama_department: directHit.nama_department } : null;
}

function readCache(): CcSnapshot | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return parsed?.data || null;
	} catch {
		return null;
	}
}

function writeCache(data: CcSnapshot) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
	} catch {
		/* storage penuh/diblokir — abaikan, bukan fatal */
	}
}

function isCacheFresh(): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return false;
		const parsed = JSON.parse(raw);
		return Date.now() - (parsed?.savedAt || 0) < CACHE_TTL_MS;
	} catch {
		return false;
	}
}

/**
 * Ambil snapshot Command Center untuk 1 departemen (karyawan.divisi user login).
 * Read-through cache: fetch dulu; kalau gagal (sinyal lemah), fallback ke cache
 * localStorage terakhir walau sudah lewat TTL, ditandai lewat field `stale`.
 */
export async function getFieldCommandCenterSnapshot(
	divisi: string | null
): Promise<{ snapshot: CcSnapshot | null; stale: boolean; error: string | null }> {
	try {
		const configRes = await secureDirectusJson<any>(`/items/command_center_config`);
		const config = configRes?.data;
		if (!config?.is_active) {
			return { snapshot: { active: false, department: null, health_score: null, trend: null, widgets: [], generated_at: new Date().toISOString() }, stale: false, error: null };
		}

		const department = await resolveDepartmentId(divisi);

		const widgetsRes = await secureDirectusJson<any>(
			`/items/command_center_widgets?filter[is_active][_eq]=true&filter[show_on_lapangan][_eq]=true&sort=sort_order&limit=-1&fields=*,department`
		);
		const allWidgets = (widgetsRes?.data || []).filter(
			(w: any) => department && (w.department === department.id || w.department == null)
		);

		let cache: any = null;
		if (department) {
			const cacheRes = await secureDirectusJson<any>(
				`/items/department_health_scores?filter[department_id][_eq]=${department.id}&sort=-created_at&limit=1&fields=kpi_scores,health_score,trend,created_at`
			).catch(() => null);
			const row = cacheRes?.data?.[0];
			if (row) {
				const fresh = row.created_at && Date.now() - new Date(row.created_at).getTime() < (config.default_refresh_minutes || 15) * 60_000;
				cache = { ...row, isFresh: fresh };
			}
		}

		const widgets: CcWidget[] = [];
		for (const w of allWidgets) {
			if (w.widget_type === 'quick_action') {
				widgets.push({
					id: w.id,
					widget_key: w.widget_key,
					label: w.label,
					widget_type: 'quick_action',
					value: null,
					status: 'ok',
					link_url: w.link_url || null,
					source: 'n/a'
				});
				continue;
			}

			let value: number | null = null;
			let source: 'cache' | 'live' = 'live';
			if (w.refresh_mode === 'cache' && cache?.isFresh && cache.kpi_scores && w.widget_key in cache.kpi_scores) {
				value = cache.kpi_scores[w.widget_key];
				source = 'cache';
			} else {
				value = await liveAggregate(w);
			}

			widgets.push({
				id: w.id,
				widget_key: w.widget_key,
				label: w.label,
				widget_type: w.widget_type,
				value,
				status: statusFor(value, w.threshold_direction, w.threshold_warning, w.threshold_danger),
				link_url: w.link_url || null,
				source
			});
		}

		const snapshot: CcSnapshot = {
			active: true,
			department,
			health_score: cache?.health_score ?? null,
			trend: cache?.trend ?? null,
			widgets,
			generated_at: new Date().toISOString()
		};

		writeCache(snapshot);
		return { snapshot, stale: false, error: null };
	} catch (e: any) {
		const cached = readCache();
		if (cached) {
			return { snapshot: cached, stale: true, error: e?.message || 'Gagal memuat data terbaru' };
		}
		return { snapshot: null, stale: false, error: e?.message || 'Gagal memuat Command Center' };
	}
}
