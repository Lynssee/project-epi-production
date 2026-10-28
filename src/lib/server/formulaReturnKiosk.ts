// src/lib/server/formulaReturnKiosk.ts
// FSM-02 Fase 3 — "Formula Kembali" di Kiosk Produksi. Operator memindai QR SPK (EPI:SPK:<id>:<token>,
// sudah tercetak di lembar kerja) atau memilih dari daftar, lalu menandai formula fisik sudah kembali ke PPIC.
// Identitas pencatat SELALU dari sesi kiosk (badge+PIN) — tidak pernah anonim. Hanya mencatat; tidak mengubah status SPK
// dan tidak memblokir apa pun (Aturan #6). Skema: erp-epi scripts/migrate-fsm02-formula-return-schema.mjs.
import { directusServerJson } from '$lib/server/directus';
import { parseEpiQr } from '$lib/utils/qrParse';

export const FORMULA_WAITING_STATUSES = ['worksheet_generated', 'waiting_for_stock'] as const;
const DAY_MS = 86400000;
const NAME_CHUNK = 100;

export interface PendingFormulaItem {
	id: number;
	nomor: string;
	status: string;
	product: string;
	customer: string;
	days: number | null;
	worksheet_generated_date: string | null;
}

export type MarkOutcome =
	| { ok: true; changed: true; eventLogged: boolean }
	| { ok: true; changed: false; reason: 'already_returned'; by: string | null; at: string | null }
	| { ok: false; reason: 'not_found' | 'not_eligible' | 'disabled'; status?: string };

/** Ambil id SPK dari hasil scan (EPI:SPK:<id>:<token>, URL /scan/..., atau angka polos). null bila bukan SPK. */
export function parseSpkScan(raw: string | null | undefined): number | null {
	const text = String(raw ?? '').trim();
	if (!text) return null;
	const parsed = parseEpiQr(text);
	if (parsed) return parsed.type === 'SPK' && Number(parsed.id) > 0 ? Number(parsed.id) : null;
	return /^\d{1,9}$/.test(text) && Number(text) > 0 ? Number(text) : null;
}

export function waitDays(worksheetDate: string | null | undefined, now: Date = new Date()): number | null {
	const t = worksheetDate ? new Date(worksheetDate).getTime() : NaN;
	return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY_MS)) : null;
}

/** Saklar fitur (app_settings production.formula_return_tracking_enabled); default AKTIF bila baris belum ada/gagal dibaca. */
export async function isTrackingEnabled(): Promise<boolean> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/app_settings?filter[module][_eq]=production&filter[setting_key][_eq]=formula_return_tracking_enabled&fields=setting_value&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		return raw === undefined || raw === null || raw === '' ? true : String(raw).trim().toLowerCase() !== 'false';
	} catch (e) {
		console.error('[formulaReturnKiosk] gagal membaca saklar pelacakan formula, dianggap aktif:', e);
		return true;
	}
}

async function namesById(collection: string, field: string, ids: Array<number | null | undefined>): Promise<Map<number, string>> {
	const map = new Map<number, string>();
	const uniq = [...new Set(ids.filter((x): x is number => Number.isFinite(Number(x)) && Number(x) > 0).map(Number))];
	for (let i = 0; i < uniq.length; i += NAME_CHUNK) {
		const part = uniq.slice(i, i + NAME_CHUNK);
		const res = await directusServerJson<{ data: any[] }>(`/items/${collection}?fields=id,${field}&limit=-1&filter[id][_in]=${part.join(',')}`);
		for (const r of res?.data ?? []) map.set(Number(r.id), String(r[field] ?? ''));
	}
	return map;
}

async function toItems(rows: any[], now: Date): Promise<PendingFormulaItem[]> {
	// Relasi di-fetch terpisah (bukan nested) — Aturan #2.
	const [prod, cust] = await Promise.all([
		namesById('identitas_barang', 'nama_barang_lengkap', rows.map((r) => r.product_id)),
		namesById('master_customer', 'nama_sj_fp', rows.map((r) => r.customer_id))
	]);
	return rows.map((r) => ({
		id: Number(r.id),
		nomor: String(r.nomor ?? `SPK-${r.id}`),
		status: String(r.status ?? ''),
		product: prod.get(Number(r.product_id)) ?? '',
		customer: cust.get(Number(r.customer_id)) ?? '',
		days: waitDays(r.worksheet_generated_date, now),
		worksheet_generated_date: r.worksheet_generated_date ?? null
	}));
}

const SPK_FIELDS = 'id,nomor,status,worksheet_generated_date,product_id,customer_id,formula_returned_at,formula_returned_by';

/** Daftar SPK menunggu formula, terlama dulu. Satu query utama + 2 query nama (hanya untuk baris yang tampil). */
export async function listPendingFormula(limit = 50, now: Date = new Date()): Promise<{ items: PendingFormulaItem[]; total: number }> {
	const res = await directusServerJson<{ data: any[]; meta?: { filter_count?: number } }>(
		`/items/spk?filter[status][_in]=${FORMULA_WAITING_STATUSES.join(',')}&filter[formula_returned_at][_null]=true&filter[worksheet_generated_date][_nnull]=true` +
			`&fields=${SPK_FIELDS}&sort=worksheet_generated_date&limit=${limit}&meta=filter_count`
	);
	const rows = res?.data ?? [];
	return { items: await toItems(rows, now), total: Number(res?.meta?.filter_count ?? rows.length) };
}

/** Detail satu SPK untuk layar konfirmasi setelah scan. null bila tidak ada. */
export async function getSpkFormulaState(spkId: number, now: Date = new Date()): Promise<(PendingFormulaItem & { returned: boolean; returned_at: string | null; returned_by: string | null }) | null> {
	const res = await directusServerJson<{ data: any[] }>(`/items/spk?filter[id][_eq]=${spkId}&fields=${SPK_FIELDS}&limit=1`);
	const row = res?.data?.[0];
	if (!row) return null;
	const [item] = await toItems([row], now);
	return { ...item, returned: Boolean(row.formula_returned_at), returned_at: row.formula_returned_at ?? null, returned_by: row.formula_returned_by ?? null };
}

/**
 * Tandai formula kembali. Idempoten: update hanya bila formula_returned_at masih NULL dan status masih menunggu
 * (bentuk PATCH bersyarat Directus = { query:{filter}, data }). Tanda pertama TIDAK pernah ditimpa.
 */
export async function markFormulaReturnedKiosk(spkId: number, actor: string, via: 'scan' | 'manual', now: Date = new Date()): Promise<MarkOutcome> {
	if (!(await isTrackingEnabled())) return { ok: false, reason: 'disabled' };

	const patch = {
		formula_returned_at: now.toISOString(),
		formula_returned_by: actor,
		formula_return_method: via,
		formula_return_note: null
	};
	const upd = await directusServerJson<{ data: any[] }>('/items/spk', {
		method: 'PATCH',
		body: JSON.stringify({
			query: { filter: { _and: [{ id: { _eq: spkId } }, { formula_returned_at: { _null: true } }, { status: { _in: [...FORMULA_WAITING_STATUSES] } }] } },
			data: patch
		})
	});

	if ((upd?.data ?? []).length > 0) {
		let eventLogged = true;
		try {
			await logEvent(spkId, 'returned', actor, via, { method: via, duplicate: false });
		} catch (e) {
			eventLogged = false; // SPK sudah tertandai; log event gagal jangan membatalkan — tapi jangan diam (Aturan #1).
			console.error(`[formulaReturnKiosk] SPK ${spkId} tertandai tetapi event 'returned' gagal dicatat:`, e);
		}
		return { ok: true, changed: true, eventLogged };
	}

	// Tidak ada baris berubah → jelaskan kenapa (sudah kembali / status tidak sah / tidak ada).
	const cur = await getSpkFormulaState(spkId, now);
	if (!cur) return { ok: false, reason: 'not_found' };
	if (cur.returned) {
		await logEvent(spkId, 'returned', actor, via, { method: via, duplicate: true }).catch((e) =>
			console.error(`[formulaReturnKiosk] event duplikat SPK ${spkId} gagal dicatat:`, e)
		);
		return { ok: true, changed: false, reason: 'already_returned', by: cur.returned_by, at: cur.returned_at };
	}
	return { ok: false, reason: 'not_eligible', status: cur.status };
}

async function logEvent(spkId: number, type: string, actor: string, channel: string, payload: Record<string, unknown>) {
	await directusServerJson('/items/spk_formula_events', {
		method: 'POST',
		body: JSON.stringify({ spk_id: spkId, event_type: type, actor, channel, payload })
	});
}
