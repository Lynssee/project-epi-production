// src/lib/server/paktaServer.ts
// SERVER-ONLY. I/O untuk Pakta Pra-Kegiatan: setelan (system_settings `project.pakta.`), katalog SOP/Alur yang sedang masa
// sosialisasi, konfirmasi milik karyawan, dan status keberatan. Aturan Directus: tiap koleksi diambil TERPISAH (tanpa relasi
// bersarang); kegagalan dicatat + dilaporkan (tidak ditelan). Katalog & setelan di-cache 5 menit di memori server supaya
// berpindah halaman tidak menambah beban Directus.
import { directusServerJson } from '$lib/server/directus';
import { readSettingsNamespace } from '$lib/server/fieldSettings';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import {
	PAKTA_SETTINGS_NAMESPACE,
	parsePaktaConfig,
	type PaktaConfig,
	type PaktaGateMode,
	type PaktaObjectionStatus
} from '$lib/utils/paktaPolicy';
import type { ConfirmRow, FlowRow, SopRow, UnconfirmedItem } from '$lib/utils/sopReadRequirement';
import { buildGateItems, latestGateChanges, type GateApprovalRow, type GateChange, type GateDefRow, type GateLogRow } from '$lib/utils/paktaGateChanges';

/** Gate pengunci pra-kegiatan — terdaftar di gate_definitions (script setup-pakta-prakegiatan.mjs di erp-epi), diatur di /settings/gates. */
export const PAKTA_GATE_KEY = 'G_FLD_PAKTA_PRAKEGIATAN';
export const PAKTA_GATE_DOC_TYPE = 'pakta_prakegiatan';
export const PAKTA_COLLECTION = 'pakta_persetujuan';

const TTL_MS = 300_000;

interface Cached<T> { at: number; value: T }
let configCache: Cached<PaktaConfig> | null = null;
let catalogCache: Cached<PaktaCatalog> | null = null;

export interface PaktaGateDef { gate_key: string; nama: string | null; hint: string | null; message: string | null; is_active: boolean }
export type PaktaSopRow = SopRow & { ai_summary?: string | null };
export interface PaktaCatalog { flows: FlowRow[]; sops: PaktaSopRow[]; gateDef: PaktaGateDef | null; errors: string[] }

export function clearPaktaCache(): void {
	configCache = null;
	catalogCache = null;
	clearPaktaGateCache();
}

async function loadList<T>(path: string, label: string, errors: string[]): Promise<T[]> {
	try {
		const res = await directusServerJson<{ data: T[] }>(path);
		return Array.isArray(res?.data) ? res.data : [];
	} catch (e: any) {
		console.error(`[pakta] gagal membaca ${label}:`, e?.message || e);
		errors.push(`${label}: ${e?.message || e}`);
		return [];
	}
}

export async function loadPaktaConfig(): Promise<PaktaConfig> {
	if (configCache && Date.now() - configCache.at < TTL_MS) return configCache.value;
	const r = await readSettingsNamespace(PAKTA_SETTINGS_NAMESPACE);
	const value = parsePaktaConfig(r.cfg);
	// Gagal baca setelan → JANGAN menyimpan di cache (coba lagi di permintaan berikutnya) dan jatuh ke default (enabled=false).
	if (r.ok) configCache = { at: Date.now(), value };
	return value;
}

export async function loadPaktaCatalog(): Promise<PaktaCatalog> {
	if (catalogCache && Date.now() - catalogCache.at < TTL_MS) return catalogCache.value;
	const errors: string[] = [];
	const [flows, sops, defs] = await Promise.all([
		loadList<FlowRow>(
			`/items/process_guidance_flows?filter[status][_eq]=published&filter[approval_status][_eq]=butuh_sosialisasi&filter[target_app][_in]=project-epi,both&fields=id,flow_key,title,sop_code,kategori_sop,sub_kategori,approval_status,sosialisasi_end_date,version&limit=200`,
			'process_guidance_flows',
			errors
		),
		loadList<PaktaSopRow>(
			`/items/sop_documents?filter[approval_status][_eq]=butuh_sosialisasi&fields=id,title,sop_code,department,approval_status,sosialisasi_end_date,version_seq,target_departments,ai_summary&limit=200`,
			'sop_documents',
			errors
		),
		loadList<PaktaGateDef>(
			`/items/gate_definitions?filter[gate_key][_eq]=${PAKTA_GATE_KEY}&fields=gate_key,nama,hint,message,is_active&limit=1`,
			'gate_definitions',
			errors
		)
	]);
	const value: PaktaCatalog = { flows, sops, gateDef: defs[0] ?? null, errors };
	if (errors.length === 0) catalogCache = { at: Date.now(), value };
	return value;
}

export async function loadPaktaConfirms(karyawanId: number, errors: string[]): Promise<ConfirmRow[]> {
	return loadList<ConfirmRow>(
		`/items/sop_read_confirmations?filter[karyawan_id][_eq]=${karyawanId}&fields=id,flow_key,sop_id,flow_version,sop_version_seq,confirmed_at&limit=500`,
		'sop_read_confirmations',
		errors
	);
}

/**
 * Mode efektif gate pakta. Gate belum terdaftar / dinonaktifkan → 'shadow' (fail-safe: JANGAN mengunci tanpa definisi eksplisit
 * yang bisa diatur Super Admin — aturan #11). resolveGateMode sendiri jatuh ke 'soft' bila definisi hilang, jadi dicek dulu di sini.
 */
export async function resolvePaktaMode(gateDef: PaktaGateDef | null): Promise<PaktaGateMode> {
	if (!gateDef || gateDef.is_active === false) return 'shadow';
	try {
		return await resolveGateMode(PAKTA_GATE_KEY, PAKTA_GATE_DOC_TYPE);
	} catch (e: any) {
		console.error('[pakta] gagal membaca mode gate, memakai shadow:', e?.message || e);
		return 'shadow';
	}
}

export interface ObjectionRow { doc_type: string; doc_key: string; doc_version: number | null; status: PaktaObjectionStatus | null }

/** Status keberatan terbaru per dokumen. Koleksi belum dibuat (Lead) → {} + dilaporkan, fitur lain tetap jalan. */
export async function loadPaktaObjections(karyawanId: number, errors: string[]): Promise<ObjectionRow[]> {
	return loadList<ObjectionRow>(
		`/items/${PAKTA_COLLECTION}?filter[karyawan_id][_eq]=${karyawanId}&filter[keputusan][_eq]=objection&fields=doc_type,doc_key,doc_version,status&sort=-id&limit=200`,
		PAKTA_COLLECTION,
		errors
	);
}

export const paktaItemKey = (i: Pick<UnconfirmedItem, 'type' | 'flow_key' | 'sop_id'> & { gate_key?: string | null }): string =>
	i.type === 'gate' ? `gate:${i.gate_key}` : i.type === 'flow' ? `flow:${i.flow_key}` : `sop:${i.sop_id}`;

/** Keberatan hanya berlaku untuk versi dokumen yang sama atau lebih baru (versi naik → harus ajukan ulang). Yang terbaru menang. */
export function objectionMap(rows: ObjectionRow[], items: UnconfirmedItem[]): Record<string, PaktaObjectionStatus> {
	const out: Record<string, PaktaObjectionStatus> = {};
	for (const it of items) {
		const key = paktaItemKey(it);
		const [docType, docKey] = key.split(/:(.*)/s);
		const hit = rows.find((r) => r.doc_type === docType && String(r.doc_key) === docKey && Number(r.doc_version ?? 0) >= it.version && r.status);
		if (hit?.status) out[key] = hit.status;
	}
	return out;
}

export function paktaBacaUrl(i: Pick<UnconfirmedItem, 'type' | 'flow_key' | 'sop_id'>): string {
	// (item gate tidak punya halaman baca — endpoint mengirim baca_url null)
	return i.type === 'flow' ? `/panduan/alur?alur=${encodeURIComponent(String(i.flow_key))}` : `/ess/pelatihan/sop/${i.sop_id}`;
}

/** Ringkasan singkat untuk kartu pakta (teks polos, maks 600 karakter). Alur belum punya kolom ringkasan → null. */
export function paktaRingkasan(item: Pick<UnconfirmedItem, 'type' | 'sop_id'>, sops: PaktaSopRow[]): string | null {
	if (item.type !== 'sop') return null;
	const raw = sops.find((x) => x.id === item.sop_id)?.ai_summary;
	const plain = String(raw ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	return plain ? plain.slice(0, 600) : null;
}

// ─── Pakta jenis GATE ───────────────────────────────────────────────────────────────────────────────────────────
// Perubahan aturan gate (kenaikan keketatan) di gate_override_log yang wajib dikonfirmasi pekerja di rute tertentu (rule.match.gate_keys).
// Log & definisi di-cache 5 menit; persetujuan per karyawan dibaca dari pakta_persetujuan (doc_type 'gate').

interface GateLogCache { at: number; days: number; rows: GateLogRow[] }
let gateLogCache: GateLogCache | null = null;
const gateDefCache = new Map<string, { at: number; defs: GateDefRow[] }>();

export function clearPaktaGateCache(): void {
	gateLogCache = null;
	gateDefCache.clear();
}

/** Semua gate_key yang disebut di aturan rute (untuk validasi setuju/kendala gate). */
export function allRuleGateKeys(cfg: PaktaConfig): string[] {
	return [...new Set(cfg.route_rules.flatMap((r) => r.match.gate_keys ?? []))];
}

async function loadGateLogRows(days: number, errors: string[]): Promise<GateLogRow[]> {
	if (gateLogCache && gateLogCache.days === days && Date.now() - gateLogCache.at < TTL_MS) return gateLogCache.rows;
	const since = new Date(Date.now() - days * 86_400_000).toISOString();
	const rows = await loadList<GateLogRow>(
		`/items/gate_override_log?filter[context][_eq]=mode_change&filter[date_created][_gte]=${encodeURIComponent(since)}&fields=id,date_created,context,reason&sort=-id&limit=500`,
		'gate_override_log',
		errors
	);
	if (errors.length === 0) gateLogCache = { at: Date.now(), days, rows };
	return rows;
}

async function loadGateDefs(keys: string[], errors: string[]): Promise<GateDefRow[]> {
	if (!keys.length) return [];
	const ck = [...keys].sort().join(',');
	const hit = gateDefCache.get(ck);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.defs;
	const defs = await loadList<GateDefRow>(
		`/items/gate_definitions?filter[gate_key][_in]=${keys.map(encodeURIComponent).join(',')}&fields=gate_key,nama,hint,message&limit=-1`,
		'gate_definitions',
		errors
	);
	if (defs.length || !errors.length) gateDefCache.set(ck, { at: Date.now(), defs });
	return defs;
}

/** Perubahan gate terbaru (yang memperketat) untuk gate_keys, dalam cfg.gate_change_days. Gagal baca → Map kosong + errors. */
export async function loadGateChanges(cfg: PaktaConfig, gateKeys: string[], errors: string[]): Promise<{ changes: Map<string, GateChange>; defs: GateDefRow[] }> {
	if (!gateKeys.length) return { changes: new Map(), defs: [] };
	const rows = await loadGateLogRows(cfg.gate_change_days, errors);
	const changes = latestGateChanges(rows, gateKeys, { days: cfg.gate_change_days });
	const defs = changes.size ? await loadGateDefs([...changes.keys()], errors) : [];
	return { changes, defs };
}

export async function loadGateApprovals(karyawanId: number, errors: string[]): Promise<GateApprovalRow[]> {
	return loadList<GateApprovalRow>(
		`/items/${PAKTA_COLLECTION}?filter[karyawan_id][_eq]=${karyawanId}&filter[keputusan][_eq]=approved&filter[doc_type][_eq]=gate&fields=doc_key,doc_version&sort=-id&limit=200`,
		PAKTA_COLLECTION,
		errors
	);
}

/**
 * Item pakta gate yang belum dikonfirmasi karyawan. Persetujuan TIDAK terbaca (koleksi belum ada) → [] (fail-open: item yang tak mungkin
 * disetujui tidak boleh menahan halaman) dan dilaporkan di errors.
 */
export async function loadGateItemsForUser(cfg: PaktaConfig, karyawanId: number, errors: string[]): Promise<UnconfirmedItem[]> {
	const keys = allRuleGateKeys(cfg);
	if (!keys.length) return [];
	const { changes, defs } = await loadGateChanges(cfg, keys, errors);
	if (changes.size === 0) return [];
	const approvalErrors: string[] = [];
	const approvals = await loadGateApprovals(karyawanId, approvalErrors);
	if (approvalErrors.length) {
		errors.push(...approvalErrors);
		return [];
	}
	return buildGateItems({ changes, defs, approvals });
}
