import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, deleteItems } from '@directus/sdk';
import type { ServiceType } from '$lib/utils/quotationCalc';
import { auth } from '$lib/firebase';

// Fase 2c (Maksimalisasi Notifikasi Sales): best-effort, tidak pernah melempar error.
async function notifySales(eventCode: string, message: string, opts: { sourceCollection?: string; sourceId?: number | string } = {}): Promise<void> {
	try {
		const user = auth.currentUser;
		if (!user) return;
		const idToken = await user.getIdToken();
		await fetch('/api/sales/notify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
			body: JSON.stringify({ eventCode, message, ...opts })
		});
	} catch (e) {
		console.warn('[kalkulatorPenawaran] gagal kirim notifikasi (diabaikan):', e);
	}
}

// Port dari erp-epi-1/src/lib/services/quotationCalcApi.js — kolom & konvensi HARUS
// tetap sama (nomor_penawaran format PNW/YYYY/NNNN, dst) supaya data project-epi dan
// erp-epi-1 saling terbaca. Lihat docs/sales-field-report-data-contract.md.
//
// Catatan: field `komisi_amount` dipakai di rumus totals desktop tapi TIDAK ada di
// skema Directus kalkulator_penawaran — sengaja tidak diimplementasikan di sini juga
// (selalu 0), supaya tidak ada field yang "terlihat tersimpan" padahal tidak.

const COL_MATERIAL = 'kalkulator_material_rate';
const COL_RESOURCE = 'kalkulator_resource_rate';
const COL_HEADER = 'kalkulator_penawaran';
const COL_ITEMS = 'kalkulator_penawaran_items';

export interface MaterialRate {
	id: string;
	name: string;
	category: 'abrasive' | 'paint' | 'coating' | 'thinner' | 'consumable';
	unit: string;
	unit_price: number;
	volume_solids: number | null;
	default_dft: number | null;
	default_consumption: number | null;
}

export interface ResourceRate {
	id: string;
	name: string;
	type: 'labor' | 'equipment' | 'consumable' | 'prep';
	unit: string;
	rate: number;
	default_productivity: number | null;
}

export async function getAllRates(): Promise<{ materials: MaterialRate[]; resources: ResourceRate[] }> {
	try {
		const [materials, resources] = await Promise.all([
			directus.request(
				readItems(COL_MATERIAL, {
					filter: { active: { _eq: true } },
					fields: ['id', 'name', 'category', 'unit', 'unit_price', 'volume_solids', 'default_dft', 'default_consumption'],
					sort: ['sort', 'name'],
					limit: -1
				})
			) as Promise<MaterialRate[]>,
			directus.request(
				readItems(COL_RESOURCE, {
					filter: { active: { _eq: true } },
					fields: ['id', 'name', 'type', 'unit', 'rate', 'default_productivity'],
					sort: ['sort', 'name'],
					limit: -1
				})
			) as Promise<ResourceRate[]>
		]);
		return { materials, resources };
	} catch (error) {
		handleDirectusError(error);
		return { materials: [], resources: [] };
	}
}

export async function fetchKalkulatorConfig(): Promise<Record<string, any>> {
	try {
		const rows = (await directus.request(
			readItems('kalkulator_config', { fields: ['key', 'value_json'], limit: -1 })
		)) as any[];
		const cfg: Record<string, any> = {};
		for (const row of rows) if (row.key) cfg[row.key] = row.value_json;
		return cfg;
	} catch {
		return {};
	}
}

export async function generateNomorPenawaran(): Promise<string> {
	try {
		const year = new Date().getFullYear();
		const result = (await directus.request(
			readItems(COL_HEADER, { sort: ['-id'], limit: 1, fields: ['nomor_penawaran'] })
		)) as any[];
		let next = 1;
		const last = result[0]?.nomor_penawaran;
		const m = last && last.match(/PNW\/(\d{4})\/(\d+)/);
		if (m && parseInt(m[1]) === year) next = parseInt(m[2]) + 1;
		return `PNW/${year}/${String(next).padStart(4, '0')}`;
	} catch {
		return `PNW/${new Date().getFullYear()}/0001`;
	}
}

export interface ManpowerRow {
	role: string;
	count: number;
	dailyWage: number;
}

export interface QuotationItem {
	key?: string;
	id?: string;
	service_type: ServiceType | 'global_manpower';
	object_name: string;
	description?: string;
	area: number;
	unit: string;
	qty: number;
	inputs: Record<string, any>;
	material_cost?: number;
	labor_cost?: number;
	equipment_cost?: number;
	consumable_cost?: number;
	subtotal?: number;
}

export interface QuotationHeader {
	id?: string;
	nomor_penawaran: string;
	tanggal: string;
	status: 'draft' | 'final' | 'sent' | 'accepted' | 'rejected' | 'archived';
	/** Lead CRM terkait (prospects.id) — auto-terisi bila dibuat dari detail prospek. */
	prospect_id?: number | null;
	/** Diisi bridge: id record CRM `quotations` yang di-sync dari penawaran ini (readonly). */
	bridged_quotation_id?: number | null;
	/** Lifecycle Customer -> PO -> Komisi v2, Fase 6 (L4): SO (so_customer.id) yang
	 *  menjadi hasil deal dari penawaran ini. Ditaut manual lewat tombol "Tautkan ke SO"
	 *  -- memperbaiki adopsi hulu yang sebelumnya 0/10 (§3.1 rencana). */
	linked_so_id?: number | null;
	/** Fase 4 (Quick Estimasi Survey & Omnichannel) — sales_survey.id asal penawaran ini,
	 *  bila dibuat dari tombol "Buat Penawaran dari Hasil Survey". Dipakai gate
	 *  G_QUICK_ESTIMATION_FLOOR (grand_total vs estimasi_kasar_min survey). */
	survey_id?: number | null;
	customer_id: number | null;
	kode_customer: string;
	customer_name: string;
	project_name: string;
	lokasi: string;
	valid_until: string;
	prepared_by: string;
	payment_terms: string;
	mobilisasi_amount: number;
	scaffolding_amount: number;
	safety_amount: number;
	overhead_pct: number;
	margin_pct: number;
	discount_amount: number;
	ppn_enabled: boolean;
	ppn_pct: number;
	total_area: number;
	direct_total: number;
	grand_total: number;
	notes: string;
	terms: string;
	// Estimasi jadwal pekerjaan (opsional — null di penawaran lama)
	schedule_enabled?: boolean;
	schedule_start_date?: string | null;
	working_days_per_week?: number;
	mob_days?: number;
	demob_days?: number;
	// Snapshot harga master saat penawaran pertama kali disimpan (readonly, auto).
	rates_snapshot?: any;
}

const HEADER_FIELDS = [
	'id', 'nomor_penawaran', 'tanggal', 'status', 'prospect_id', 'bridged_quotation_id', 'linked_so_id',
	'survey_id', 'customer_id', 'kode_customer', 'customer_name',
	'project_name', 'lokasi', 'valid_until', 'prepared_by', 'payment_terms', 'mobilisasi_amount',
	'scaffolding_amount', 'safety_amount', 'overhead_pct', 'margin_pct', 'discount_amount',
	'ppn_enabled', 'ppn_pct', 'total_area', 'direct_total', 'grand_total', 'notes', 'terms',
	'schedule_enabled', 'schedule_start_date', 'working_days_per_week', 'mob_days', 'demob_days',
	'rates_snapshot'
];

const ITEM_FIELDS = [
	'id', 'penawaran_id', 'sort', 'service_type', 'object_name', 'description', 'area', 'unit', 'qty',
	'inputs', 'material_cost', 'labor_cost', 'equipment_cost', 'consumable_cost', 'subtotal'
];

export async function listMyPenawaran(preparedBy?: string | null): Promise<QuotationHeader[]> {
	try {
		const filter: any = {};
		if (preparedBy) filter.prepared_by = { _eq: preparedBy };
		return (await directus.request(
			readItems(COL_HEADER, {
				filter,
				fields: HEADER_FIELDS,
				sort: ['-id'],
				limit: 100
			})
		)) as QuotationHeader[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getPenawaranById(id: string): Promise<{ header: QuotationHeader; items: QuotationItem[] } | null> {
	try {
		const header = (await directus.request(readItem(COL_HEADER, id, { fields: HEADER_FIELDS }))) as QuotationHeader;
		const items = (await directus.request(
			readItems(COL_ITEMS, {
				filter: { penawaran_id: { _eq: id } },
				fields: ITEM_FIELDS,
				sort: ['sort'],
				limit: -1
			})
		)) as any[];
		return {
			header,
			items: items.map((it) => ({
				...it,
				inputs: typeof it.inputs === 'string' ? JSON.parse(it.inputs || '{}') : it.inputs || {}
			}))
		};
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Lifecycle Customer -> PO -> Komisi v2, Fase 6 (L4) — cari SO by nomor untuk tombol
 * "Tautkan ke SO" di editor penawaran. Read-only, tidak menulis apa pun.
 */
export async function searchSoByNomor(nomorSo: string): Promise<{ id: number; nomor_so: string; customer_name: string } | null> {
	const q = (nomorSo || '').trim();
	if (!q) return null;
	try {
		const found = (await directus.request(
			readItems('so_customer', {
				filter: { nomor_so: { _eq: q } },
				fields: ['id', 'nomor_so', 'customer_name'],
				limit: 1
			})
		)) as any[];
		return found[0] || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Lookup SO by id -- dipakai menampilkan nomor_so dari linked_so_id yang tersimpan. */
export async function getSoById(soId: number): Promise<{ id: number; nomor_so: string; customer_name: string } | null> {
	try {
		const found = (await directus.request(readItem('so_customer', soId, { fields: ['id', 'nomor_so', 'customer_name'] }))) as any;
		return found || null;
	} catch (error) {
		return null;
	}
}

/**
 * Lifecycle Customer -> PO -> Komisi v2, Fase 6 (L4) — tautkan penawaran ini ke SO hasil
 * deal. Manual (bukan otomatis) karena tidak ada relasi eksplisit penawaran->SO di
 * proses submit SO saat ini -- sales yang tahu penawaran mana yang jadi SO mana.
 */
export async function linkPenawaranToSo(penawaranId: string, soId: number): Promise<void> {
	try {
		await directus.request(updateItem(COL_HEADER, penawaranId, { linked_so_id: soId }));
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}

/**
 * Fase 4 (Quick Estimasi Survey & Omnichannel) — audit trail utk gate G_QUICK_ESTIMATION_FLOOR
 * saat penawaran difinalkan langsung dari project-epi (jalur ini tidak lewat write-guard
 * proxy erp-epi). Best-effort, tidak pernah menggagalkan simpan penawaran.
 */
export async function logQuickEstimationFloorWarning(params: {
	recordId: string | number;
	method: 'POST' | 'PATCH';
	grandTotal: number;
	floorMin: number;
	userEmail?: string | null;
}): Promise<void> {
	try {
		await directus.request(
			createItem('gate_audit_log', {
				gate: 'G_QUICK_ESTIMATION_FLOOR',
				collection: 'items/kalkulator_penawaran',
				method: params.method,
				record_id: String(params.recordId),
				decision: 'warn',
				reason: `Penawaran final Rp${Math.round(params.grandTotal).toLocaleString('id-ID')} di bawah estimasi kasar survey Rp${Math.round(params.floorMin).toLocaleString('id-ID')}.`,
				user_email: params.userEmail || null
			})
		);
	} catch (err) {
		console.warn('[kalkulatorPenawaran] gagal mencatat audit G_QUICK_ESTIMATION_FLOOR (diabaikan):', err);
	}
}

async function deleteAllItems(penawaranId: string) {
	const rows = (await directus.request(
		readItems(COL_ITEMS, { filter: { penawaran_id: { _eq: penawaranId } }, fields: ['id'], limit: -1 })
	)) as any[];
	const ids = rows.map((r) => r.id);
	if (ids.length) await directus.request(deleteItems(COL_ITEMS, ids));
}

// ── BRIDGE KE CRM (CRM Sharpening Fase 3) ────────────────────────────
// Penawaran lapangan yang punya prospect_id di-mirror ke koleksi CRM `quotations`
// supaya muncul di pipeline admin. Best-effort — tidak pernah menggagalkan simpan.

const CRM_QUOTATIONS = 'quotations';
const CRM_PROSPECTS = 'prospects';

/** status penawaran lapangan → quote_status CRM. */
function mapQuoteStatus(s: QuotationHeader['status']): string {
	switch (s) {
		case 'final':
		case 'sent':
			return 'sent';
		case 'accepted':
			return 'accepted';
		case 'rejected':
			return 'rejected';
		case 'archived':
			return 'expired';
		default:
			return 'draft';
	}
}

async function bridgePenawaranToCrm(
	penawaranId: string,
	header: QuotationHeader,
	items: QuotationItem[]
): Promise<void> {
	try {
		const prospectId = Number(header.prospect_id);
		if (!prospectId) return;

		const lineItems = items
			.filter((it) => it.service_type !== 'global_manpower')
			.map((it) => ({
				description: it.object_name || it.description || String(it.service_type),
				qty: 1,
				price: Number(it.subtotal) || 0
			}));
		const globalLabor = items.find((it) => it.service_type === 'global_manpower');
		if (globalLabor && Number(globalLabor.subtotal) > 0) {
			lineItems.push({ description: 'Tenaga Kerja (Global Manpower)', qty: 1, price: Number(globalLabor.subtotal) });
		}

		const qPayload: Record<string, any> = {
			quotation_number: header.nomor_penawaran || null,
			prospect_id: prospectId,
			customer_id: header.customer_id || null,
			amount: Number(header.grand_total) || 0,
			valid_until: header.valid_until || null,
			quote_status: mapQuoteStatus(header.status),
			items: lineItems,
			terms: header.terms || null,
			notes: `Bridge dari penawaran lapangan ${header.nomor_penawaran || ''}${header.project_name ? ` — ${header.project_name}` : ''}`.trim()
		};

		let crmId = Number(header.bridged_quotation_id) || null;
		if (!crmId && header.nomor_penawaran) {
			const found = (await directus.request(
				readItems(CRM_QUOTATIONS, {
					filter: { quotation_number: { _eq: header.nomor_penawaran } },
					fields: ['id'],
					limit: 1
				})
			)) as any[];
			if (found[0]?.id) crmId = Number(found[0].id);
		}

		if (crmId) {
			await directus.request(updateItem(CRM_QUOTATIONS, crmId, qPayload));
		} else {
			const created: any = await directus.request(createItem(CRM_QUOTATIONS, { status: 'published', ...qPayload }));
			crmId = Number(created?.id) || null;
			if (crmId) {
				await directus.request(updateItem(COL_HEADER, penawaranId, { bridged_quotation_id: crmId }));
			}
		}

		// Nudge stage pipeline — forward-only & konservatif. Perpindahan ke won/lost
		// tetap keputusan admin (suggest-only, Fase 3).
		if (header.status === 'final' || header.status === 'sent') {
			const prospect = (await directus.request(
				readItem(CRM_PROSPECTS, prospectId, { fields: ['id', 'stage'] })
			)) as any;
			if (prospect && (prospect.stage === 'new' || prospect.stage === 'qualified')) {
				await directus.request(updateItem(CRM_PROSPECTS, prospectId, { stage: 'proposal' }));
			}
		}
	} catch (e) {
		console.warn('[kalkulatorPenawaran] bridgePenawaranToCrm gagal (diabaikan):', e);
	}
}

/**
 * Simpan header + item sekaligus. Item lama dihapus & ditulis ulang (sama seperti
 * erp-epi-1 syncPenawaranItems) — sederhana & konsisten dengan struktur JSON `inputs`.
 */
export async function savePenawaranFull(
	header: QuotationHeader,
	items: QuotationItem[],
	ratesSnapshot?: unknown
): Promise<{ id: string }> {
	const isNew = !header.id;
	let headerId = header.id;

	const payload: any = { ...header };
	delete payload.id;
	// bridged_quotation_id hanya ditulis oleh bridge (readonly di UI) — jangan sampai
	// editor menimpanya jadi null saat menyimpan ulang.
	delete payload.bridged_quotation_id;

	// rates_snapshot diisi SEKALI saat penawaran pertama kali dibuat — tidak pernah
	// ditimpa saat update, dan tidak boleh diedit user (spec §6 catatan penting).
	if (isNew && ratesSnapshot && !payload.rates_snapshot) {
		payload.rates_snapshot = ratesSnapshot;
	} else {
		delete payload.rates_snapshot;
	}

	if (isNew) {
		const created: any = await directus.request(createItem(COL_HEADER, payload));
		headerId = created.id;
	} else {
		await directus.request(updateItem(COL_HEADER, headerId!, payload));
	}

	if (isNew) {
		notifySales('QUOTATION_CREATED', `${header.prepared_by || 'Sales'} membuat penawaran baru ${header.nomor_penawaran || ''} untuk ${header.customer_name || 'customer'}.`, {
			sourceCollection: 'kalkulator_penawaran',
			sourceId: headerId
		});
	}

	await deleteAllItems(headerId!);
	if (items.length) {
		const itemPayload = items.map((it, idx) => ({
			penawaran_id: headerId,
			service_type: it.service_type,
			object_name: it.object_name || '',
			description: it.description || '',
			area: Number(it.area) || 0,
			unit: it.unit || 'm²',
			qty: Number(it.qty) || 1,
			inputs: it.inputs || {},
			material_cost: Number(it.material_cost) || 0,
			labor_cost: Number(it.labor_cost) || 0,
			equipment_cost: Number(it.equipment_cost) || 0,
			consumable_cost: Number(it.consumable_cost) || 0,
			subtotal: Number(it.subtotal) || 0,
			sort: idx
		}));
		await directus.request(createItem(COL_ITEMS, itemPayload as any));
	}

	// Fase 3: mirror ke CRM quotations bila terhubung ke lead pipeline.
	if (header.prospect_id) {
		await bridgePenawaranToCrm(headerId!, { ...header, id: headerId! }, items);
	}

	return { id: headerId! };
}

export async function updatePenawaranStatus(id: string, status: QuotationHeader['status']): Promise<void> {
	await directus.request(updateItem(COL_HEADER, id, { status }));
}
