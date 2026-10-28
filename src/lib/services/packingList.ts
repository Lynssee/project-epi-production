import directus, { handleDirectusError } from './directus';
import { readItems, readItem, updateItem, createItem, aggregate } from '@directus/sdk';
import { getIdToken } from './secureDirectus';
import { uploadEvidencePhoto } from './stockLapangan';
import { loadProjectSettings, getProjectSetting } from './projectSettings';

// F0 (Audit & Hardening Gate v2, Path A, 30 Agu 2026): pembuatan item baru / dari
// template kini lewat /api/packing-list/create-items (server) supaya gerbang gate PL
// lapangan (G_PKL_PROJECT) ditegakkan authoritative — lihat
// $lib/server/packingListCreateItems.ts. registerPackingApproval() yang lama (daftar
// approval dari klien) DIHAPUS: pendaftaran approval kini terjadi di server yang sama.

export interface PackingDisiplinInfo {
	gate_key: string;
	label: string;
	mode: 'shadow' | 'soft' | 'warn' | 'hard';
	status: 'passed' | 'failed' | 'not_applicable';
	message: string;
	project_id: number;
	fix_links: { label: string; href: string }[];
}

export interface PackingGatePrecheck {
	ok: boolean;
	blocking: string[];
	warnings: string[];
	gates: {
		gate_key: string;
		label: string;
		severity: 'WAJIB' | 'SEMI';
		status: string;
		message: string;
		affected_items?: { id: number; label: string }[];
		fix_links?: { label: string; href: string }[];
	}[];
	/** Gate disiplin proyek (P2H alat & laporan harian), semua mode termasuk shadow — untuk banner Quick-Fix. */
	disiplin: PackingDisiplinInfo[];
	/** pesan gabungan gate WAJIB yang gagal — siap ditampilkan ke user */
	blockingMessage: string;
}

/**
 * F0 (Audit & Hardening Gate v2, Path A) — pra-cek gate Packing List sisi lapangan
 * sebelum membuat item. Menembak /api/packing-list/gate-precheck. Hanya G_PKL_PROJECT
 * yang bisa memblokir; G_PKL_STOK = peringatan. Gagal panggil endpoint → dianggap
 * lolos (fail-open) supaya gangguan jaringan tidak mengunci lapangan.
 *
 * `budgetItemId` (Fase 5, Gate Transparan & Popup Benahi Data v2, 16 Sep 2026): isi bila
 * item ini adalah baris project_budgets ASLI (dari RAB), bukan draf template/manual —
 * ini yang memungkinkan G_PKL_INVENTORY_LINK menilai baris tsb (butuh no_item_needed/
 * is_manpower yang cuma ada di project_budgets asli) dan menyediakan id nyata untuk
 * tombol "Usulkan Tautan" (usul-tautan-barang butuh project_budgets.id sungguhan).
 */
export async function precheckPackingGate(
	projectId: number,
	items?: { qty?: number; identitas_barang_id?: number | null; budgetItemId?: number | null }[]
): Promise<PackingGatePrecheck> {
	const empty: PackingGatePrecheck = { ok: true, blocking: [], warnings: [], gates: [], blockingMessage: '', disiplin: [] };
	try {
		const token = await getIdToken();
		const all = items || [];
		const budgetItemIds = all
			.filter((it) => Number.isFinite(Number(it.budgetItemId)))
			.map((it) => Number(it.budgetItemId));
		const draftItems = all.filter((it) => !Number.isFinite(Number(it.budgetItemId)));
		const res = await fetch('/api/packing-list/gate-precheck', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ projectId, budgetItemIds, items: draftItems })
		});
		if (!res.ok) return empty;
		const j: any = await res.json();
		const gates = Array.isArray(j?.gates) ? j.gates : [];
		const blocking = Array.isArray(j?.blocking) ? j.blocking : [];
		const blockingMessage = gates
			.filter((g: any) => g.status === 'failed' && g.severity === 'WAJIB')
			.map((g: any) => `• ${g.label}: ${g.message}`)
			.join('\n');
		return { ok: blocking.length === 0, blocking, warnings: j?.warnings || [], gates, blockingMessage, disiplin: Array.isArray(j?.disiplin) ? j.disiplin : [] };
	} catch {
		return empty;
	}
}

export interface PackingListItem {
	material_name: string;
	material_color?: string;
	qty: number;
	unit: string;
	unit_price: number;
	description?: string;
	budget_category?: string;
}

// Template interfaces
export interface TemplateItem {
	id?: number;
	template_name: string;
	budget_category: string;
	material_name: string;
	material_color?: string;
	qty: number;
	unit: string;
	description?: string;
	pic?: string;
	date_created?: string;
}

export interface Template {
	name: string;
	item_count: number;
	total_qty: number;
	categories: string[];
	date_created: string;
}

export interface TemplateItemInput {
	budget_category: string;
	material_name: string;
	material_color?: string;
	qty: number;
	unit: string;
	description?: string;
	pic?: string;
}

export interface LoadTemplateResult {
	added: number;
	skipped: number;
	total: number;
	duplicates: string[];
}

/**
 * Buat item packing list baru ke project_budgets.
 * Leader menginput item material baru yang belum ada di RAB.
 * Menggunakan budget_category = 'packing_supplier' agar terdeteksi
 * oleh dashboard Admin ERP (yang memfilter berdasarkan prefix 'packing_').
 */
export async function createPackingListItems(
	projectId: number,
	items: PackingListItem[],
	pic: string,
	projectName?: string
) {
	try {
		await postCreatePackingItems(projectId, pic, projectName, items.map((it) => ({
			budget_category: it.budget_category,
			material_name: it.material_name,
			material_color: it.material_color,
			qty: it.qty,
			unit: it.unit,
			description: it.description,
			unit_price: (it as any).unit_price ?? 0
		})));
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}


/**
 * Submit item packing list dari template dengan qty yang sudah diisi user.
 * budget_category diambil dari template asli (bukan hardcode 'packing_supplier').
 */
export async function submitPackingFromTemplate(
	projectId: number,
	items: Array<{ item: TemplateItem; qty: number }>,
	pic: string,
	projectName?: string
): Promise<boolean> {
	try {
		await postCreatePackingItems(projectId, pic, projectName, items.map(({ item, qty }) => ({
			budget_category: item.budget_category,
			material_name: (item.material_name || item.description || '').trim(),
			material_color: item.material_color,
			qty,
			unit: item.unit,
			description: item.description || item.material_name
		})));
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

/**
 * F0 (Audit & Hardening Gate v2, Path A) — kirim item baru/template ke endpoint
 * server yang menegakkan gerbang gate PL lapangan lalu membuat project_budgets +
 * approval. Melempar Error dgn pesan gate bila G_PKL_PROJECT memblokir — pemanggil
 * menampilkannya. Idealnya form memanggil precheckPackingGate() dulu agar user tahu
 * sebelum submit; ini backstop authoritative.
 */
async function postCreatePackingItems(
	projectId: number,
	pic: string,
	projectName: string | undefined,
	items: { budget_category?: string; material_name: string; material_color?: string; qty: number; unit: string; description?: string; unit_price?: number }[]
) {
	const token = await getIdToken();
	const res = await fetch('/api/packing-list/create-items', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ projectId, pic, projectName, items })
	});
	const text = await res.text();
	let parsed: any = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
	if (!res.ok) throw new Error(parsed?.message || `Request gagal (${res.status})`);
	return parsed?.data;
}

/**
 * Ambil peta id -> kode_item untuk sekumpulan identitas_barang_id, TANPA nested-fetch
 * (field identitas_barang_id dipakai luas sebagai integer polos di project_budgets/project_expenses).
 */
export async function fetchKodeItemMap(ids: (number | null | undefined)[]): Promise<Record<number, string>> {
	const uniqueIds = [...new Set(ids.filter((id): id is number => !!id))];
	if (uniqueIds.length === 0) return {};
	try {
		const result = (await directus.request(
			readItems('identitas_barang', {
				filter: { id: { _in: uniqueIds } },
				fields: ['id', 'kode_item'],
				limit: -1
			})
		)) as any[];
		const map: Record<number, string> = {};
		for (const item of result) {
			if (item.kode_item) map[item.id] = item.kode_item;
		}
		return map;
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

/**
 * Ambil peta id -> stok_tersedia (info-only, TIDAK blokir pengajuan — Fase 2
 * Rencana Implementasi Packing List Approval Workflow, §4.4 Stock Gate).
 * stok_tersedia bertipe string di identitas_barang, wajib parseFloat.
 */
export async function checkStockAvailability(ids: (number | null | undefined)[]): Promise<Record<number, number>> {
	const uniqueIds = [...new Set(ids.filter((id): id is number => !!id))];
	if (uniqueIds.length === 0) return {};
	try {
		const result = (await directus.request(
			readItems('identitas_barang', {
				filter: { id: { _in: uniqueIds } },
				fields: ['id', 'stok_tersedia'],
				limit: -1
			})
		)) as any[];
		const map: Record<number, number> = {};
		for (const item of result) {
			map[item.id] = parseFloat(item.stok_tersedia) || 0;
		}
		return map;
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

export interface MasterCatalogItem {
	id: number;
	nama_barang_lengkap: string;
	kode_item?: string;
	satuan?: string;
	stok_tersedia?: string | number;
	kategori?: string;
}

/**
 * Cari master catalog dari identitas_barang untuk autocomplete penginputan manual.
 * Menggunakan filter _icontains dan limit 10 untuk efisiensi API.
 */
export async function searchMasterCatalog(query: string): Promise<MasterCatalogItem[]> {
	const q = query.trim();
	if (!q || q.length < 2) return [];
	try {
		const result = (await directus.request(
			readItems('identitas_barang', {
				filter: {
					nama_barang_lengkap: { _icontains: q }
				},
				fields: ['id', 'nama_barang_lengkap', 'kode_item', 'satuan', 'stok_tersedia'],
				limit: 10
			})
		)) as MasterCatalogItem[];
		return result || [];
	} catch (error) {
		console.warn('[searchMasterCatalog] Gagal mencari katalog master (fallback []):', (error as Error)?.message);
		return [];
	}
}

/**
 * §7 rekomendasi L1 — resolusi satu identitas_barang by id, dipakai saat leader memindai
 * label QR barang (EPI:ITEM:<id>) di form retur manual (menutup A1 di sumbernya: id dari
 * QR SUDAH id identitas_barang, tidak perlu pencarian nama). Satu query ringan by id.
 */
export async function getMasterCatalogItemById(id: number): Promise<MasterCatalogItem | null> {
	try {
		const result = (await directus.request(
			readItem('identitas_barang', id, {
				fields: ['id', 'nama_barang_lengkap', 'kode_item', 'satuan', 'stok_tersedia']
			})
		)) as MasterCatalogItem;
		return result || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** SO + RAP milik sebuah proyek (PRJ-12): baris RAP bisa ber-so_rab_id tanpa project_id. Gagal baca → [] (dilog). */
async function getRabIdsForProject(projectId: number): Promise<number[]> {
	try {
		const [proj, sos] = await Promise.all([
			directus.request(readItems('projects', { filter: { id: { _eq: projectId } }, fields: ['id', 'so_customer_id'], limit: 1 })),
			directus.request(readItems('so_customer', { filter: { project_id: { _eq: projectId } }, fields: ['id'], limit: -1 }))
		]);
		const soIds = new Set<number>();
		const main: any = (proj as any[])?.[0]?.so_customer_id;
		const mainId = main && typeof main === 'object' ? main.id : main;
		if (mainId) soIds.add(Number(mainId));
		for (const s of (sos as any[]) || []) if (s?.id) soIds.add(Number(s.id));
		if (soIds.size === 0) return [];
		const rabs = (await directus.request(
			readItems('so_rab', { filter: { so_customer_id: { _in: [...soIds] } }, fields: ['id'], limit: -1 })
		)) as any[];
		return (rabs || []).map((r) => Number(r.id)).filter(Boolean);
	} catch (e) {
		console.warn('[packingList] gagal membaca so_rab proyek (daftar RAP hanya memakai project_id):', e);
		return [];
	}
}

/**
 * Ambil item RAB (project_budgets) yang bisa di-request packing.
 * Filter (PRJ-12): proyek ini (project_id ATAU so_rab_id milik SO proyek), kategori BARANG saja (setelan
 * project.pl.allowed_rap_categories — jasa/man_power/operasional tidak tampil), bukan header kategori,
 * dan belum pernah diajukan: packing_status null ATAU 'draft' (RAP barang yang disiapkan, belum diminta).
 * 'partial' SENGAJA tidak ikut: itu permintaan yang sudah disetujui dan sisanya sudah antre di Gudang
 * ("Kirim Sisa") — memasukkannya ke sini akan membuat permintaan ganda.
 */
export async function getProjectBudgetItems(projectId: number) {
	try {
		await loadProjectSettings().catch(() => {});
		const configured = getProjectSetting('project.pl.allowed_rap_categories');
		const categories: string[] = Array.isArray(configured) && configured.length ? configured : ['supplier', 'consumable', 'safety', 'sewa_alat', 'material'];
		const rabIds = await getRabIdsForProject(projectId);

		const result = await directus.request(
			readItems('project_budgets', {
				filter: {
					_and: [
						{ _or: [{ project_id: { _eq: projectId } }, ...(rabIds.length ? [{ so_rab_id: { _in: rabIds } }] : [])] },
						{ budget_category: { _in: categories } },
						{ _or: [{ is_category_header: { _null: true } }, { is_category_header: { _eq: false } }] },
						{ _or: [{ packing_status: { _null: true } }, { packing_status: { _eq: 'draft' } }] }
					]
				},
				fields: [
					'id', 'project_id', 'so_rab_id', 'budget_category', 'material_name', 'material_color',
					'qty', 'unit', 'unit_price', 'description', 'pic',
					'identitas_barang_id', 'qty_sudah_dikirim', 'packing_status',
					'category_code', 'category_label', 'source_planning_ref'
				],
				sort: ['sort_order', 'id'],
				limit: -1
			})
		);
		return result || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Planning Suite Fase 8 — SEMUA baris RAP barang proyek (termasuk yang sudah diajukan/dikirim) untuk
 * monitoring kuota. Beda dengan getProjectBudgetItems yang hanya mengambil yang belum diajukan.
 * Dipanggil atas permintaan (panel dibuka), bukan otomatis.
 */
export async function getProjectQuotaRows(projectId: number) {
	try {
		await loadProjectSettings().catch(() => {});
		const configured = getProjectSetting('project.pl.allowed_rap_categories');
		const categories: string[] = Array.isArray(configured) && configured.length ? configured : ['supplier', 'consumable', 'safety', 'sewa_alat', 'material'];
		const rabIds = await getRabIdsForProject(projectId);
		const result = await directus.request(
			readItems('project_budgets', {
				filter: {
					_and: [
						{ _or: [{ project_id: { _eq: projectId } }, ...(rabIds.length ? [{ so_rab_id: { _in: rabIds } }] : [])] },
						{ budget_category: { _in: categories } },
						{ _or: [{ is_category_header: { _null: true } }, { is_category_header: { _eq: false } }] },
						{ _or: [{ is_template: { _null: true } }, { is_template: { _eq: false } }] }
					]
				},
				fields: ['id', 'budget_category', 'material_name', 'description', 'qty', 'unit', 'qty_sudah_dikirim', 'packing_status', 'identitas_barang_id', 'source_planning_ref'],
				sort: ['sort_order', 'id'],
				limit: -1
			})
		);
		return (result as any[]) || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Planning Suite Fase 8 — personil yang ditugaskan di proyek + dokumen mereka (manpower_dokumen, diverifikasi HRD).
 * Tiga query terpisah (assignment -> nama -> dokumen). `error` terisi bila ada yang gagal dibaca (tidak ditelan diam-diam).
 */
export async function getProjectPersonnelDocs(projectId: number, jenisDokumen: string[]) {
	const out = { people: [] as Array<{ manpower_id: number; nama: string; jabatan: string }>, docs: [] as any[], error: '' };
	try {
		const asg = (await directus.request(
			readItems('manpower_assignment', {
				filter: { _and: [{ project_id: { _eq: projectId } }, { status: { _in: ['aktif', 'menunggu_ttd'] } }] },
				fields: ['id', 'manpower_id', 'jabatan'],
				limit: -1
			})
		)) as any[];
		const byId = new Map<number, string>();
		for (const a of asg || []) {
			const mid = Number(a?.manpower_id && typeof a.manpower_id === 'object' ? a.manpower_id.id : a?.manpower_id);
			if (mid && !byId.has(mid)) byId.set(mid, String(a?.jabatan || ''));
		}
		const ids = [...byId.keys()];
		if (!ids.length) return out;
		const [names, docs] = await Promise.all([
			directus.request(readItems('manpower', { filter: { id: { _in: ids } }, fields: ['id', 'nama'], limit: -1 })) as Promise<any[]>,
			jenisDokumen.length
				? (directus.request(
						readItems('manpower_dokumen', {
							filter: { _and: [{ manpower_id: { _in: ids } }, { jenis_dokumen: { _in: jenisDokumen } }] },
							fields: ['id', 'manpower_id', 'jenis_dokumen', 'status_verifikasi', 'tanggal_kedaluwarsa'],
							limit: -1
						})
					) as Promise<any[]>)
				: Promise.resolve([] as any[])
		]);
		const nameOf = new Map((names || []).map((n) => [Number(n.id), String(n.nama || '')]));
		out.people = ids.map((id) => ({ manpower_id: id, nama: nameOf.get(id) || '', jabatan: byId.get(id) || '' }));
		out.docs = (docs || []).map((d) => ({ ...d, manpower_id: Number(d?.manpower_id && typeof d.manpower_id === 'object' ? d.manpower_id.id : d?.manpower_id) }));
		return out;
	} catch (error) {
		console.error('[packingList] gagal membaca dokumen personil proyek:', error);
		out.error = 'Data dokumen personil tidak dapat dimuat (hak akses/koneksi).';
		return out;
	}
}

/** Syarat Charter untuk ceklist pra-mobilisasi (hanya kolom yang dibutuhkan). Null bila Charter belum ada. */
export async function getProjectCharterRequirements(projectId: number) {
	try {
		const proj = (await directus.request(readItems('projects', { filter: { id: { _eq: projectId } }, fields: ['id', 'so_customer_id'], limit: 1 }))) as any[];
		const raw = proj?.[0]?.so_customer_id;
		const soId = raw && typeof raw === 'object' ? raw.id : raw;
		if (!soId) return null;
		const rows = (await directus.request(
			readItems('project_charters', {
				filter: { so_customer_id: { _eq: Number(soId) } },
				fields: ['id', 'status', 'syarat_mcu', 'syarat_skck', 'syarat_sertifikat', 'syarat_surat_sehat', 'ijin_barang_masuk', 'alat_loading_unloading'],
				limit: 1
			})
		)) as any[];
		return rows?.[0] ?? null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Submit pengajuan packing list — batch update packing_status = 'pending_approval'
 * pada item RAB yang dipilih oleh leader, lalu terbitkan approval request lewat
 * Universal Approval Engine (moduleKey 'packing_list.project', kondisional ke
 * '.direktur' bila di atas threshold). Lihat /api/packing-list/submit dan
 * $lib/server/packingListSubmit.ts. Gudang tidak lagi bisa memproses (Surat Jalan)
 * sampai approval selesai — lihat Rencana Implementasi Packing List Approval Workflow.
 */
export async function submitPackingRequest(
	items: { id: number; qty: number; unit_price?: number }[],
	// context tidak lagi dipakai di sini -- judul/nominal approval_requests sudah
	// dihitung server-side (packingListSubmit.ts, dari harga project_budgets asli,
	// bukan dari unit_price sisi klien). Parameter dipertahankan agar caller lama
	// tidak perlu diubah.
	_context?: { projectName?: string; requesterName?: string }
) {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/packing-list/submit', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({ items: items.map(({ id, qty }) => ({ id, qty })) })
		});
		const text = await res.text();
		let parsed: any = null;
		try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
		if (!res.ok) {
			throw new Error(parsed?.message || `Request gagal (${res.status})`);
		}
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

/**
 * Ambil item RAB yang sudah diajukan packing (packing_status != null).
 * Bisa filter by project atau ambil semua.
 */
export async function getPackingRequests(
	projectId?: number | number[],
	options: { limit?: number; offset?: number; search?: string; sort?: string; filterStatus?: string } = {}
) {
	try {
		const filter: Record<string, any> = {
			packing_status: { _nnull: true }
		};
		if (projectId !== undefined) {
			if (Array.isArray(projectId)) {
				if (projectId.length > 0) {
					filter.project_id = { _in: projectId };
				} else {
					return [];
				}
			} else {
				filter.project_id = { _eq: projectId };
			}
		}
		
		if (options.search) {
			const q = options.search.trim();
			filter._or = [
				{ material_name: { _icontains: q } },
				{ description: { _icontains: q } }
			];
		}
		
		if (options.filterStatus) {
			filter.packing_status = { _eq: options.filterStatus };
		}

		const queryOptions: any = {
			filter,
			fields: [
				'id', 'project_id', 'budget_category', 'material_name', 'material_color',
				'qty', 'unit', 'unit_price', 'description', 'pic',
				'identitas_barang_id', 'qty_sudah_dikirim', 'packing_status', 'pick_status',
				'procurement_tracking_status', // PL Tracking v2 Fase 4 — KPI "Menunggu Pengadaan"
				'category_code', 'category_label', 'date_created'
			],
			sort: options.sort ? [options.sort] : ['-date_created'],
			limit: options.limit || 50
		};
		
		if (options.offset !== undefined) {
			queryOptions.offset = options.offset;
		}

		const result = await directus.request(
			readItems('project_budgets', queryOptions)
		);
		return result || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

// Fase 3 (rencana v2 "Packing List -> Multi Surat Jalan + Pergantian Barang", 23 Sep
// 2026): jejak ganti barang oleh admin (erp-epi-1, koleksi approval_requests module_key
// 'packing_list.admin_edit') dibaca di sini untuk badge transparansi -- payload.updated[]
// berisi {id, before, after, reason_code, item_changed}. Dicocokkan client-side terhadap
// id project_budgets yang sedang ditampilkan (tidak ada filter JSON-array yang murah di
// Directus untuk ini), dibatasi 300 baris admin_edit terbaru -- cukup untuk skala saat ini.
export interface ItemChangedInfo {
	before: { material_name: string };
	after: { material_name: string };
	reason_code: string;
	edited_at: string | null;
}

export const REASON_CODE_LABEL: Record<string, string> = {
	stok_habis: 'Stok barang asli habis',
	setara_lebih_baik: 'Diganti barang setara/lebih baik',
	salah_pilih: 'Koreksi salah pilih barang',
	permintaan_leader: 'Atas permintaan leader/pemohon',
	lainnya: 'Lainnya'
};
export function reasonCodeLabel(code: string | null | undefined): string {
	return (code && REASON_CODE_LABEL[code]) || code || 'lainnya';
}

export async function fetchItemChangedTrail(itemIds: number[]): Promise<Record<number, ItemChangedInfo>> {
	if (!itemIds.length) return {};
	try {
		const rows: any[] = await directus.request(
			readItems('approval_requests', {
				filter: { module_key: { _eq: 'packing_list.admin_edit' } },
				fields: ['id', 'payload'],
				sort: ['-id'],
				limit: 300
			})
		);
		const idSet = new Set(itemIds);
		const result: Record<number, ItemChangedInfo> = {};
		for (const row of rows) {
			const updated = row?.payload?.updated || [];
			for (const u of updated) {
				if (!u?.item_changed) continue;
				const id = Number(u.id);
				if (!idSet.has(id) || result[id]) continue; // rows sudah -id -> pertama ketemu = paling baru
				result[id] = {
					before: u.before,
					after: u.after,
					reason_code: u.reason_code,
					edited_at: row?.payload?.edited_at || null
				};
			}
		}
		return result;
	} catch (e) {
		console.warn('[packingList] gagal memuat jejak perubahan barang (diabaikan):', e);
		return {};
	}
}

/**
 * Ajukan keberatan (mode soft — tidak memblokir kiriman) atas penggantian barang oleh
 * gudang. Tercatat di approval_requests, muncul di To-Do Admin sebagai informasi.
 */
export async function submitItemChangedObjection(
	budgetItemId: number,
	note: string,
	before: { material_name: string } | null,
	after: { material_name: string } | null
) {
	const authToken = await getIdToken();
	const res = await fetch('/api/packing-list/objection', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
		body: JSON.stringify({ budget_item_id: budgetItemId, note, before, after })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || data.success === false) {
		throw new Error(data.message || data.error || `Gagal mengirim keberatan (${res.status})`);
	}
	return data;
}

export interface IdentitasBarangOption {
	id: number;
	nama_barang_lengkap: string;
	satuan: string;
	stok_tersedia: string;
}

/**
 * Cari master katalog identitas_barang untuk autocomplete input material — dipakai di
 * requisition/new (Pengajuan Internal Barang) agar material tidak lagi diketik bebas.
 */
export async function searchIdentitasBarang(query: string, limit = 20): Promise<IdentitasBarangOption[]> {
	try {
		const q = query.trim();
		const result = await directus.request(
			readItems('identitas_barang', {
				filter: q ? { nama_barang_lengkap: { _icontains: q } } : {},
				fields: ['id', 'nama_barang_lengkap', 'satuan', 'stok_tersedia'],
				sort: ['nama_barang_lengkap'],
				limit
			})
		);
		return (result || []) as IdentitasBarangOption[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Hitung on-hand material tertentu di sebuah proyek: total qty_remaining
 * dari project_expenses (expense_type='supplier') yang terhubung ke identitas_barang_id.
 */
export async function getProjectMaterialOnHand(projectId: number, identitasBarangId: number): Promise<number> {
	try {
		const result = await directus.request(
			readItems('project_expenses', {
				filter: {
					project_id: { _eq: projectId },
					identitas_barang_id: { _eq: identitasBarangId },
					expense_type: { _eq: 'supplier' }
				},
				fields: ['qty_remaining'],
				limit: -1
			})
		);
		return (result || []).reduce((sum: number, row: any) => sum + (Number(row.qty_remaining) || 0), 0);
	} catch (error) {
		handleDirectusError(error);
		return 0;
	}
}

/**
 * Helper untuk memperkaya data project_expenses dengan nama material dan satuan
 * dari tabel relasi (identitas_barang & project_budgets) secara terpisah.
 * Mencegah nama material tampil '-' bila field material_name di project_expenses kosong.
 */
async function enrichExpensesWithMaterialNames(items: any[]): Promise<any[]> {
	if (!items || items.length === 0) return items;

	const missingIdentitasIds: number[] = [];
	const missingBudgetIds: number[] = [];

	for (const it of items) {
		const rawName = (it.material_name || it.description || '').trim();
		if (!rawName || rawName === '-') {
			if (it.identitas_barang_id) {
				const idVal = typeof it.identitas_barang_id === 'object' ? it.identitas_barang_id?.id : it.identitas_barang_id;
				if (idVal && typeof idVal === 'number') missingIdentitasIds.push(idVal);
			}
			if (it.rab_budget_id) {
				const idVal = typeof it.rab_budget_id === 'object' ? it.rab_budget_id?.id : it.rab_budget_id;
				if (idVal && typeof idVal === 'number') missingBudgetIds.push(idVal);
			}
		}
	}

	const uniqueIdentitasIds = [...new Set(missingIdentitasIds)];
	const uniqueBudgetIds = [...new Set(missingBudgetIds)];

	const [identitasList, budgetList] = await Promise.all([
		uniqueIdentitasIds.length > 0
			? directus.request(
					readItems('identitas_barang', {
						filter: { id: { _in: uniqueIdentitasIds } },
						fields: ['id', 'nama_barang_lengkap', 'kode_item', 'satuan'],
						limit: -1
					})
			  ).catch(() => [])
			: Promise.resolve([]),
		uniqueBudgetIds.length > 0
			? directus.request(
					readItems('project_budgets', {
						filter: { id: { _in: uniqueBudgetIds } },
						fields: ['id', 'material_name', 'description', 'unit'],
						limit: -1
					})
			  ).catch(() => [])
			: Promise.resolve([])
	]);

	const identitasMap: Record<number, any> = {};
	for (const ib of (identitasList as any[]) || []) {
		if (ib?.id) identitasMap[ib.id] = ib;
	}

	const budgetMap: Record<number, any> = {};
	for (const pb of (budgetList as any[]) || []) {
		if (pb?.id) budgetMap[pb.id] = pb;
	}

	return items.map((it) => {
		const ibId = typeof it.identitas_barang_id === 'object' ? it.identitas_barang_id?.id : it.identitas_barang_id;
		const pbId = typeof it.rab_budget_id === 'object' ? it.rab_budget_id?.id : it.rab_budget_id;
		const matchedIb = ibId ? identitasMap[ibId] : null;
		const matchedPb = pbId ? budgetMap[pbId] : null;

		let resolvedName = (it.material_name || '').trim();
		if (!resolvedName || resolvedName === '-') {
			resolvedName =
				(it.description || '').trim() ||
				matchedIb?.nama_barang_lengkap ||
				matchedPb?.material_name ||
				matchedPb?.description ||
				(it.reference_number ? `Material (${it.reference_number})` : 'Material Proyek');
		}

		let resolvedUnit = (it.unit || '').trim();
		if (!resolvedUnit || resolvedUnit === '-') {
			resolvedUnit = matchedIb?.satuan || matchedPb?.unit || 'Pcs';
		}

		return {
			...it,
			material_name: resolvedName,
			unit: resolvedUnit
		};
	});
}

/**
 * Ambil inventory proyek — data dari project_expenses yang expense_type = 'supplier'.
 * Ini adalah material yang sudah dikirim via Surat Jalan.
 */
export async function getProjectInventory(projectId: number) {
	try {
		const result = await directus.request(
			readItems('project_expenses', {
				filter: {
					project_id: { _eq: projectId },
					expense_type: { _in: ['supplier', 'consumable', 'safety', 'sewa_alat', 'equipment', 'operasional', 'lain_lain', 'jasa'] }
				},
				fields: [
					'id', 'project_id', 'expense_type', 'reference_number',
					'material_name', 'material_color', 'qty', 'unit', 'unit_price',
					'qty_used', 'qty_remaining', 'expense_amount', 'expense_date',
					'description', 'surat_jalan_id', 'identitas_barang_id', 'rab_budget_id'
				],
				sort: ['-expense_date'],
				limit: 500
			})
		);
		return await enrichExpensesWithMaterialNames((result || []) as any[]);
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface InventoriTerpadu {
	items: any[];
	/** 'saldo' = project_stock_balance (sumber tunggal); 'biaya' = cadangan project_expenses bila saldo proyek kosong */
	sumber: 'saldo' | 'biaya';
	/** true bila sistem tidak punya catatan kirim sama sekali untuk proyek ini (saldo & biaya kosong) */
	tanpaCatatanKirim: boolean;
}

/**
 * RSM-05 §4.1 — daftar "barang yang tercatat masih di proyek" untuk form retur. Sumber kebenaran kuantitas =
 * project_stock_balance (sama dengan Saldo Barang Saya / Barang Menganggur / ERP), diperkaya lewat query TERPISAH
 * (Aturan #2): identitas_barang (nama, satuan), project_expenses (harga/jenis/id biaya untuk Tutup Massal) dan
 * agregat ledger (diretur / hilang). Kunci baris = identitas_barang_id (item.id). Bentuk baris dibuat kompatibel
 * dengan bentuk project_expenses lama supaya UI tidak berubah. Jasa/operasional dikecualikan lewat setelan
 * inventory.retur.kategori_dikecualikan. Saldo kosong tapi ada catatan biaya -> cadangan lama (tidak melumpuhkan form).
 */
export async function getProjectInventoryTerpadu(projectId: number): Promise<InventoriTerpadu> {
	const expenses = (await getProjectInventory(projectId)) as any[];
	let balances: any[] = [];
	try {
		balances = (await directus.request(
			readItems('project_stock_balance' as any, {
				filter: { project_id: { _eq: projectId } } as any,
				fields: ['id', 'item_id', 'qty_received', 'qty_used', 'qty_on_hand', 'last_movement_date'] as any,
				limit: 500
			})
		)) as any[];
	} catch (e) {
		// Aturan #1: jangan ditelan diam-diam. Tanpa saldo, jatuh ke cadangan project_expenses.
		console.warn('[packingList] project_stock_balance tak terbaca untuk form retur, pakai cadangan project_expenses:', (e as any)?.message || e);
		balances = [];
	}
	const positif = balances.filter((b) => (Number(b.qty_on_hand) || 0) > 0);
	if (!positif.length) {
		return { items: expenses, sumber: 'biaya', tanpaCatatanKirim: expenses.length === 0 && balances.length === 0 };
	}

	let dikecualikan: string[] = ['jasa', 'operasional', 'man_power'];
	try {
		const { loadInventorySettings, getInventorySetting } = await import('./inventorySettings');
		await loadInventorySettings();
		const v = getInventorySetting('inventory.retur.kategori_dikecualikan');
		if (Array.isArray(v)) dikecualikan = v.map((x: unknown) => String(x).toLowerCase());
	} catch (e) {
		console.warn('[packingList] setelan kategori_dikecualikan tak terbaca, pakai default:', (e as any)?.message || e);
	}

	const itemIds = [...new Set(positif.map((b) => Number(b.item_id)).filter(Boolean))];
	const [masters, ledger] = await Promise.all([
		directus
			.request(readItems('identitas_barang' as any, { filter: { id: { _in: itemIds } } as any, fields: ['id', 'nama_barang_lengkap', 'satuan'] as any, limit: -1 }))
			.catch((e) => { console.warn('[packingList] identitas_barang tak terbaca untuk form retur:', (e as any)?.message || e); return []; }) as Promise<any[]>,
		directus
			.request(aggregate('project_stock_ledger' as any, {
				aggregate: { sum: ['quantity'] } as any,
				groupBy: ['item_id', 'transaction_type'] as any,
				query: { filter: { project_id: { _eq: projectId }, item_id: { _in: itemIds }, transaction_type: { _in: ['OUT-RETURN', 'OUT-LOSS'] } } } as any
			}))
			.catch((e) => { console.warn('[packingList] agregat ledger (diretur/hilang) tak terbaca, rincian disederhanakan:', (e as any)?.message || e); return []; }) as Promise<any[]>
	]);
	const master = new Map(masters.map((m) => [Number(m.id), m]));
	const biaya = new Map<number, any[]>();
	for (const e of expenses) {
		const k = Number(typeof e.identitas_barang_id === 'object' ? e.identitas_barang_id?.id : e.identitas_barang_id);
		if (!k) continue;
		if (!biaya.has(k)) biaya.set(k, []);
		biaya.get(k)!.push(e);
	}
	const sumLedger = (itemId: number, type: string) =>
		Math.abs((ledger as any[]).filter((r) => Number(r.item_id) === itemId && r.transaction_type === type).reduce((s, r) => s + (Number(r.sum?.quantity) || 0), 0));

	const items = positif
		.map((b) => {
			const itemId = Number(b.item_id);
			const m = master.get(itemId);
			const ex = biaya.get(itemId) || [];
			const first = ex[0];
			const sentUnitPrice = ex.reduce((s, e) => s + (Number(e.unit_price) || 0), 0) / (ex.filter((e) => Number(e.unit_price) > 0).length || 1);
			return {
				id: itemId,
				identitas_barang_id: itemId,
				material_name: m?.nama_barang_lengkap || first?.material_name || `Barang #${itemId}`,
				material_color: first?.material_color ?? null,
				description: m?.nama_barang_lengkap || first?.description || null,
				unit: m?.satuan || first?.unit || 'Pcs',
				qty: Number(b.qty_received) || 0,
				qty_used: Number(b.qty_used) || 0,
				qty_remaining: Number(b.qty_on_hand) || 0,
				unit_price: Number.isFinite(sentUnitPrice) ? sentUnitPrice : 0,
				expense_type: first?.expense_type || 'supplier',
				expense_id: first?.id ?? null,
				// rincian asal angka (RSM-05 §4.2)
				diretur: sumLedger(itemId, 'OUT-RETURN'),
				hilang: sumLedger(itemId, 'OUT-LOSS'),
				last_movement_date: b.last_movement_date ?? null,
				sumber: 'saldo'
			};
		})
		.filter((i) => !dikecualikan.includes(String(i.expense_type).toLowerCase()));
	return { items, sumber: 'saldo', tanpaCatatanKirim: false };
}

/**
 * Update pemakaian material di proyek.
 * qty_remaining otomatis dihitung: qty - qtyUsed.
 */
export async function updateMaterialUsage(expenseId: number, qtyUsed: number, totalQty: number) {
	try {
		const qtyRemaining = totalQty - qtyUsed;
		await directus.request(
			updateItem('project_expenses', expenseId, {
				qty_used: qtyUsed,
				qty_remaining: qtyRemaining < 0 ? 0 : qtyRemaining
			})
		);
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

/**
 * Ambil summary inventory untuk semua project yang punya material (supplier expenses).
 * Dipakai di halaman accordion.
 */
export async function getAllProjectsInventory(
	options: { limit?: number; offset?: number; search?: string; sort?: string; projectIds?: number[] } = {}
) {
	try {
		const filter: Record<string, any> = {
			expense_type: { _in: ['supplier', 'consumable', 'safety', 'sewa_alat', 'equipment', 'operasional', 'lain_lain', 'jasa'] }
		};

		if (options.projectIds !== undefined) {
			if (options.projectIds.length > 0) {
				filter.project_id = { _in: options.projectIds };
			} else {
				return [];
			}
		}

		if (options.search) {
			const q = options.search.trim();
			filter._or = [
				{ material_name: { _icontains: q } },
				{ description: { _icontains: q } },
				{ reference_number: { _icontains: q } }
			];
		}

		const queryOptions: any = {
			filter,
			fields: [
				'id', 'project_id', 'expense_type', 'reference_number',
				'material_name', 'material_color', 'qty', 'unit', 'unit_price',
				'qty_used', 'qty_remaining', 'expense_amount', 'expense_date',
				'description', 'surat_jalan_id', 'identitas_barang_id', 'rab_budget_id'
			],
			sort: options.sort ? [options.sort] : ['project_id', '-expense_date'],
			limit: options.limit || 50
		};

		if (options.offset !== undefined) {
			queryOptions.offset = options.offset;
		}

		const result = await directus.request(
			readItems('project_expenses', queryOptions)
		);
		return await enrichExpensesWithMaterialNames((result || []) as any[]);
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

// ============================================
// TEMPLATE MANAGEMENT FUNCTIONS
// ============================================

/**
 * Fetch semua templates dengan metadata.
 * Templates adalah items di project_budgets dengan is_template=true dan project_id=null.
 * Dikelompokkan berdasarkan template_name.
 */
export async function getPackingListTemplates(): Promise<Template[]> {
	try {
		const result = await directus.request(
			readItems('project_budgets', {
				filter: {
					_and: [
						{ is_template: { _eq: true } },
						{ project_id: { _null: true } }
					]
				},
				fields: [
					'id', 'template_name', 'budget_category', 'material_name',
					'qty', 'date_created'
				],
				sort: ['template_name', 'date_created'],
				limit: -1
			})
		);

		// Group by template_name dan hitung metadata
		const grouped: Record<string, any> = {};
		for (const item of result) {
			const name = item.template_name || 'Untitled';
			if (!grouped[name]) {
				grouped[name] = {
					name,
					item_count: 0,
					total_qty: 0,
					categories: new Set<string>(),
					date_created: item.date_created
				};
			}
			grouped[name].item_count++;
			grouped[name].total_qty += item.qty || 0;
			if (item.budget_category) {
				grouped[name].categories.add(item.budget_category);
			}
		}

		// Convert to array
		return Object.values(grouped).map((t) => ({
			name: t.name,
			item_count: t.item_count,
			total_qty: t.total_qty,
			categories: Array.from(t.categories),
			date_created: t.date_created
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Fetch items untuk template tertentu.
 */
export async function getTemplateItems(templateName: string): Promise<TemplateItem[]> {
	try {
		const nameFilter = templateName === 'Untitled'
			? { _or: [{ template_name: { _null: true } }, { template_name: { _eq: 'Untitled' } }, { template_name: { _eq: '' } }] }
			: { template_name: { _eq: templateName } };
		const result = await directus.request(
			readItems('project_budgets', {
				filter: {
					_and: [
						{ is_template: { _eq: true } },
						nameFilter
					]
				},
				fields: [
					'id', 'template_name', 'budget_category', 'material_name',
					'material_color', 'qty', 'unit', 'description', 'pic', 'date_created'
				],
				sort: ['budget_category', 'date_created'],
				limit: -1
			})
		);
		return result as TemplateItem[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Create item baru dalam template.
 */
export async function createTemplateItem(
	templateName: string,
	itemData: TemplateItemInput
): Promise<boolean> {
	try {
		await directus.request(
			createItem('project_budgets', {
				is_template: true,
				template_name: templateName,
				project_id: null,
				budget_category: itemData.budget_category,
				material_name: itemData.material_name,
				material_color: itemData.material_color || '',
				qty: itemData.qty,
				unit: itemData.unit,
				description: itemData.description || itemData.material_name,
				pic: itemData.pic || '',
				unit_price: 0,
				planned_amount: 0,
				actual_amount: 0,
				variance: 0
			})
		);
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

/**
 * Update item dalam template.
 */
export async function updateTemplateItem(
	itemId: number,
	itemData: Partial<TemplateItemInput>
): Promise<boolean> {
	try {
		const updateData: any = {};
		if (itemData.budget_category !== undefined) updateData.budget_category = itemData.budget_category;
		if (itemData.material_name !== undefined) updateData.material_name = itemData.material_name;
		if (itemData.material_color !== undefined) updateData.material_color = itemData.material_color;
		if (itemData.qty !== undefined) updateData.qty = itemData.qty;
		if (itemData.unit !== undefined) updateData.unit = itemData.unit;
		if (itemData.description !== undefined) updateData.description = itemData.description;
		if (itemData.pic !== undefined) updateData.pic = itemData.pic;

		await directus.request(
			updateItem('project_budgets', itemId, updateData)
		);
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

/**
 * Delete single item dari template.
 */
export async function deleteTemplateItem(itemId: number): Promise<boolean> {
	try {
		await directus.request(
			updateItem('project_budgets', itemId, { status: 'archived' })
		);
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

/**
 * Delete entire template (semua items dengan template_name yang sama).
 */
export async function deleteTemplate(templateName: string): Promise<boolean> {
	try {
		// Fetch all items with this template name
		const items = await getTemplateItems(templateName);

		// Delete each item
		const promises = items.map((item) =>
			item.id ? deleteTemplateItem(item.id) : Promise.resolve(false)
		);
		await Promise.all(promises);
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

/**
 * Check duplicate items sebelum load template.
 * Compare berdasarkan material_name + budget_category.
 */
export async function checkDuplicateItems(
	projectId: number,
	templateItems: TemplateItem[]
): Promise<string[]> {
	try {
		// Fetch existing project items
		const existingItems = await directus.request(
			readItems('project_budgets', {
				filter: {
					_and: [
						{ project_id: { _eq: projectId } },
						{
							_or: [
								{ is_template: { _eq: false } },
								{ is_template: { _null: true } }
							]
						}
					]
				},
				fields: ['material_name', 'budget_category', 'description'],
				limit: -1
			})
		);

		// Create set of existing keys
		const existingKeys = new Set(
			existingItems.map((item: any) => {
				const name = (item.material_name || item.description || '').toLowerCase().trim();
				return `${item.budget_category}::${name}`;
			})
		);

		// Check for duplicates
		const duplicates: string[] = [];
		for (const item of templateItems) {
			const name = (item.material_name || item.description || '').toLowerCase().trim();
			const key = `${item.budget_category}::${name}`;
			if (existingKeys.has(key)) {
				duplicates.push(item.material_name || item.description || 'Unknown');
			}
		}

		return duplicates;
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Load template items ke project.
 * 1. Fetch template items
 * 2. Check duplicates
 * 3. Create new project_budgets entries (skip duplicates)
 * 4. Return result summary
 */
export async function loadTemplateToProject(
	templateName: string,
	projectId: number,
	pic: string = 'Leader'
): Promise<LoadTemplateResult> {
	try {
		// 1. Fetch template items
		const templateItems = await getTemplateItems(templateName);
		if (templateItems.length === 0) {
			return { added: 0, skipped: 0, total: 0, duplicates: [] };
		}

		// 2. Check duplicates
		const duplicateNames = await checkDuplicateItems(projectId, templateItems);
		const duplicateSet = new Set(
			duplicateNames.map((name) => name.toLowerCase().trim())
		);

		// 3. Filter out duplicates
		const itemsToAdd = templateItems.filter((item) => {
			const name = (item.material_name || item.description || '').toLowerCase().trim();
			return !duplicateSet.has(name);
		});

		// 4. Create new project items
		const promises = itemsToAdd.map((item) =>
			directus.request(
				createItem('project_budgets', {
					project_id: projectId,
					budget_category: item.budget_category,
					material_name: (item.material_name || item.description || '').trim(),
					material_color: item.material_color || '',
					qty: item.qty,
					unit: item.unit,
					description: item.description || item.material_name,
					pic: pic,
					unit_price: 0,
					planned_amount: 0,
					actual_amount: 0,
					variance: 0,
					packing_status: null,
					qty_sudah_dikirim: 0
				})
			)
		);
		await Promise.all(promises);

		return {
			added: itemsToAdd.length,
			skipped: duplicateNames.length,
			total: templateItems.length,
			duplicates: duplicateNames
		};
	} catch (error) {
		handleDirectusError(error);
		return { added: 0, skipped: 0, total: 0, duplicates: [] };
	}
}

// ============================================
// RETURN PACKING LIST FUNCTIONS
// ============================================

export interface ReturnItem {
	material_name: string;
	material_color?: string;
	qty_returned: number;
	unit: string;
	leader_notes?: string;
	/** Fase 3 (Goods Return v3, 19 Agu 2026): kondisi wajib diisi Leader saat pengajuan —
	 *  kosakata sama dengan yang dipakai gudang (ok | bekas_layak | rusak | hilang). Gudang
	 *  tetap bisa mengoreksinya saat menerima (ProjectReturnReceiving.svelte pre-fill dari sini). */
	condition: 'ok' | 'bekas_layak' | 'rusak' | 'hilang';
	/** 4-Gate Retur Gudang v2 Fase 2 (A1): id identitas_barang. WAJIB untuk item baru —
	 *  tanpa ini retur tidak bisa masuk ledger/stok & rekonsiliasi proyek meleset. Baris
	 *  "Barang Terkirim" mengambilnya dari project_expenses.identitas_barang_id; baris manual
	 *  dari pemilih master katalog. */
	item_id?: number | null;
	packing_list_id?: number | null;
	packing_list_item_id?: number | null;
}

/**
 * Submit daftar barang yang dikembalikan dari proyek.
 * Leader mengisi barang sisa → disimpan ke koleksi packing_returns.
 * Status awal: 'return_requested' (menunggu dicek oleh Inventory).
 *
 * Fase 4 (Goods Return v3, 19 Agu 2026): sekarang mengembalikan baris yang dibuat (bukan cuma
 * boolean) -- pemanggil perlu id-nya untuk menautkan foto bukti (return_evidence_photos.return_id)
 * ke retur yang benar, urutan array SAMA PERSIS dengan `items` yang dikirim.
 */
export async function createReturnItems(
	projectId: number,
	items: ReturnItem[],
	submittedBy: string
): Promise<{ id: number }[]> {
	try {
		const now = new Date().toISOString();
		const created = await Promise.all(
			items.map((item) =>
				directus.request(
					createItem('packing_returns', {
						project_id: projectId,
						material_name: item.material_name,
						material_color: item.material_color || '',
						qty_returned: item.qty_returned,
						unit: item.unit,
						leader_notes: item.leader_notes || '',
						condition: item.condition,
						return_status: 'return_requested',
						submitted_by: submittedBy,
						date_created: now,
						// 4-Gate Retur Gudang v2 Fase 2 (A1) — hanya dikirim bila ada, kolom nullable.
						...(item.item_id != null ? { item_id: item.item_id } : {}),
						...(item.packing_list_id != null ? { packing_list_id: item.packing_list_id } : {}),
						...(item.packing_list_item_id != null ? { packing_list_item_id: item.packing_list_item_id } : {})
					})
				)
			)
		);
		return created as { id: number }[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * RSM-03 §4.2 — qty barang proyek yang SEDANG dalam proses retur (return_requested, dokumen belum
 * batal/ditolak/diterima), dipetakan per item_id. Dua query terpisah (Aturan #2); gagal-lunak: bila tak
 * terbaca, dicatat jelas dan peta kosong (server tetap menjaga lewat gate G_RTN_DOBEL).
 */
export async function fetchActiveReturByItem(projectId: number): Promise<Record<number, { qty: number; docNo: string | null }>> {
	const rows = (await directus
		.request(
			readItems('packing_returns', {
				filter: { _and: [{ project_id: { _eq: projectId } }, { return_status: { _eq: 'return_requested' } }, { item_id: { _nnull: true } }] },
				fields: ['id', 'item_id', 'qty_returned', 'retur_gudang_id'],
				limit: 500
			})
		)
		.catch((e) => {
			console.warn('[packingList] retur aktif tak terbaca untuk cek dobel:', (e as any)?.message || e);
			return [];
		})) as any[];
	if (!rows.length) return {};
	const headerIds = [...new Set(rows.map((r) => r.retur_gudang_id).filter((v) => v != null))] as number[];
	const headers = new Map<number, any>();
	if (headerIds.length) {
		const hs = (await directus
			.request(readItems('retur_gudang', { filter: { id: { _in: headerIds } }, fields: ['id', 'nomor_retur', 'status'], limit: -1 }))
			.catch((e) => {
				console.warn('[packingList] retur_gudang tak terbaca untuk cek dobel:', (e as any)?.message || e);
				return [];
			})) as any[];
		for (const h of hs) headers.set(h.id, h);
	}
	const out: Record<number, { qty: number; docNo: string | null }> = {};
	for (const r of rows) {
		const h = r.retur_gudang_id ? headers.get(r.retur_gudang_id) : null;
		if (h && ['batal', 'ditolak', 'diterima'].includes(h.status)) continue;
		const id = Number(r.item_id);
		const cur = out[id] || { qty: 0, docNo: null };
		cur.qty += Number(r.qty_returned) || 0;
		cur.docNo = cur.docNo || h?.nomor_retur || null;
		out[id] = cur;
	}
	return out;
}

export class ReturSubmitClientError extends Error {
	code: string | null;
	dobel: any[] | null;
	constructor(message: string, code: string | null, dobel: any[] | null) {
		super(message);
		this.code = code;
		this.dobel = dobel;
	}
}

/**
 * RSM-02/03 — kirim pengajuan retur lewat SATU request server (baris + dokumen), idempoten lewat
 * `clientSubmissionId` (UUID per pembukaan form). Mengganti createReturnItems + createReturnDocument
 * yang dua request terpisah dari browser. Mengembalikan nomor RTN + id baris (urut sama dengan `items`)
 * untuk menautkan foto bukti. Pesan error asli server dilempar (jangan ditelan jadi kalimat generik).
 */
export async function submitReturPengajuan(
	projectId: number,
	items: ReturnItem[],
	opts: {
		clientSubmissionId: string;
		equipmentLoanIds?: string[];
		overrideReason?: string | null;
		driverName?: string | null;
		driverPhone?: string | null;
		vehiclePlate?: string | null;
		expeditionName?: string | null;
		notes?: string | null;
	}
): Promise<{ doc: { id: number; nomor_retur: string; status: string; linked: number; linkedEquipment: number } | null; rowIds: number[]; idempotent: boolean }> {
	const token = await getIdToken();
	const res = await fetch('/api/retur-gudang', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ projectId, items, ...opts })
	});
	const text = await res.text();
	let parsed: any = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
	if (!res.ok) throw new ReturSubmitClientError(parsed?.message || `Request gagal (${res.status})`, parsed?.code ?? null, parsed?.dobel ?? null);
	return { doc: parsed?.data ?? null, rowIds: parsed?.rowIds ?? [], idempotent: !!parsed?.idempotent };
}

/**
 * RSM-01 §4.1 — leader/sopir mengonfirmasi dokumen retur berangkat (draft → dikirim) dengan foto
 * barang di kendaraan. Endpoint idempoten; pesan error asli server dilempar apa adanya.
 */
export async function konfirmasiReturBerangkat(
	docId: number,
	input: { fotoKirim: string[]; driverName?: string | null; vehiclePlate?: string | null; gps?: { lat: number; lng: number } | null }
): Promise<{ id: number; nomor_retur: string; status: string; shipped_at: string | null; already: boolean }> {
	const token = await getIdToken();
	const res = await fetch(`/api/retur-gudang/${docId}/berangkat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(input)
	});
	const text = await res.text();
	let parsed: any = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
	if (!res.ok) throw new Error(parsed?.message || `Request gagal (${res.status})`);
	return parsed?.data;
}

/**
 * 4-Gate Retur Gudang v2 Fase 2 — bungkus baris packing_returns yang baru dibuat jadi SATU
 * dokumen retur (retur_gudang) yang bisa dicetak + dipindai satpam/gudang. Server yang
 * generate nomor + QR dan validasi kepemilikan proyek (authenticateProjectLeader).
 * @returns { id, nomor_retur, qr_token, status, linked } atau null bila gagal (baris
 *          packing_returns tetap aman tersimpan — dokumen bisa dibuat menyusul oleh admin).
 *          `{ skipped: true }` bila setelan inventory.retur.penerbit_surat_jalan = 'inventory'
 *          dan pengajuan hanya berisi barang: server sengaja TIDAK membuat dokumen (bukan gagal).
 */
export async function createReturnDocument(
	projectId: number,
	packingReturnIds: number[],
	opts: {
		driverName?: string | null;
		driverPhone?: string | null;
		vehiclePlate?: string | null;
		expeditionName?: string | null;
		notes?: string | null;
		/** §7 rekomendasi L4 — alat (internal_loan_log, PK uuid) yang ikut dokumen ini. */
		equipmentLoanIds?: string[];
	} = {}
): Promise<
	| { id: number; nomor_retur: string; qr_token: string; status: string; linked: number; linkedEquipment: number; skipped?: false }
	| { skipped: true }
	| null
> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/retur-gudang', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ projectId, packingReturnIds, ...opts })
		});
		const text = await res.text();
		let parsed: any = null;
		try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
		if (!res.ok) throw new Error(parsed?.message || `Request gagal (${res.status})`);
		if (!parsed?.data && parsed?.penerbit === 'inventory') return { skipped: true };
		return parsed?.data ?? null;
	} catch (e) {
		console.error('Gagal membuat dokumen retur:', e);
		return null;
	}
}

/**
 * §7 rekomendasi L2 — badge peringatan di tab "Pengembalian": dokumen retur (retur_gudang)
 * yang DITOLAK gudang, atau alat proyek yang masih keluar melewati jatuh tempo rencana
 * (end_date_planned). Retur mandek selama ini sebagian karena tak terlihat oleh leader
 * (56% baris packing_returns lama macet di return_requested tanpa disadari) — badge ini
 * bikin itu tampak tanpa perlu buka satu-satu.
 *
 * Dua query ringan (dibatasi ke proyek leader, bukan _in seluruh proyek) — TIDAK
 * menghitung packing_returns lama (itu urusan retTotalCount yang sudah ada).
 * @param projectIds proyek yang relevan untuk user saat ini (kosong = 0, bukan semua)
 */
export async function fetchReturAlertCount(projectIds: number[]): Promise<{ rejected: number; overdueEquipment: number; total: number }> {
	if (!projectIds.length) return { rejected: 0, overdueEquipment: 0, total: 0 };
	try {
		const today = new Date().toISOString().slice(0, 10);
		const [rejectedRows, overdueRows] = await Promise.all([
			directus.request(
				readItems('retur_gudang', {
					filter: { project_id: { _in: projectIds }, status: { _eq: 'ditolak' } },
					fields: ['id'],
					limit: -1
				})
			).catch((e) => {
				// CLAUDE.md Aturan #1: 403 di sini kemungkinan besar Roles & Permissions
				// `retur_gudang` untuk peran leader belum diatur di Directus Studio
				// (langkah manual Fase 1 yang masih tertunda) — bukan salah query.
				console.warn('[packingList] retur_gudang tak terbaca (cek Roles & Permissions leader):', (e as any)?.message || e);
				return [];
			}),
			directus.request(
				readItems('internal_loan_log', {
					filter: {
						project_id: { _in: projectIds },
						end_date_actual: { _null: true },
						end_date_planned: { _lt: today }
					},
					fields: ['id'],
					limit: -1
				})
			).catch((e) => {
				console.warn('[packingList] internal_loan_log tak terbaca:', (e as any)?.message || e);
				return [];
			})
		]);
		const rejected = (rejectedRows as any[])?.length || 0;
		const overdueEquipment = (overdueRows as any[])?.length || 0;
		return { rejected, overdueEquipment, total: rejected + overdueEquipment };
	} catch (error) {
		console.warn('[packingList] fetchReturAlertCount gagal, badge disembunyikan:', error);
		return { rejected: 0, overdueEquipment: 0, total: 0 };
	}
}

/**
 * Fase 4 (Goods Return v3, §Fase 4): unggah foto bukti retur (sisi lapangan, diambil Leader
 * saat mengajukan) dan tautkan ke baris packing_returns yang baru dibuat. Best-effort per foto
 * -- dipanggil dalam Promise.allSettled oleh pemanggil supaya satu foto gagal upload tidak
 * membatalkan pengajuan retur yang datanya sudah tersimpan.
 */
export async function createReturnEvidencePhoto(params: {
	returnId: number;
	file: File | Blob;
	uploadedBy: string;
	gpsLat?: number | null;
	gpsLng?: number | null;
	gpsAccuracy?: number | null;
	capturedAt?: string;
}): Promise<boolean> {
	try {
		const fileId = await uploadEvidencePhoto(
			params.file instanceof File ? params.file : new File([params.file], 'retur.jpg', { type: 'image/jpeg' }),
			`packing_returns:${params.returnId}`
		);
		if (!fileId) return false;
		await directus.request(
			createItem('return_evidence_photos', {
				return_id: params.returnId,
				photo: fileId,
				source: 'lapangan',
				uploaded_by: params.uploadedBy,
				gps_lat: params.gpsLat ?? null,
				gps_lng: params.gpsLng ?? null,
				gps_accuracy: params.gpsAccuracy ?? null,
				captured_at: params.capturedAt || new Date().toISOString()
			})
		);
		return true;
	} catch (error) {
		console.error('Gagal mengunggah foto bukti retur:', error);
		return false;
	}
}

/**
 * Ambil daftar return packing list.
 * Bisa filter per projectId atau per submittedBy (nama leader).
 */
export async function getReturnRequests(
	projectId?: number | number[],
	submittedBy?: string,
	options: { limit?: number; offset?: number; search?: string; sort?: string; filterStatus?: string } = {}
): Promise<any[]> {
	try {
		const filter: Record<string, any> = {};
		if (projectId !== undefined) {
			if (Array.isArray(projectId)) {
				if (projectId.length > 0) {
					filter.project_id = { _in: projectId };
				} else {
					return [];
				}
			} else {
				filter.project_id = { _eq: projectId };
			}
		}
		if (submittedBy) {
			filter.submitted_by = { _icontains: submittedBy };
		}

		if (options.search) {
			const q = options.search.trim();
			filter._or = [
				{ material_name: { _icontains: q } },
				{ leader_notes: { _icontains: q } },
				{ condition_notes: { _icontains: q } }
			];
		}
		
		if (options.filterStatus) {
			filter.return_status = { _eq: options.filterStatus };
		}

		const queryOptions: any = {
			filter,
			fields: [
				'id', 'project_id', 'material_name', 'material_color',
				'qty_returned', 'unit', 'leader_notes', 'return_status',
				'submitted_by', 'date_created',
				'condition', 'condition_notes', 'checked_by', 'checked_at'
			],
			sort: options.sort ? [options.sort] : ['-date_created'],
			limit: options.limit || 50
		};

		if (options.offset !== undefined) {
			queryOptions.offset = options.offset;
		}

		const result = await directus.request(
			readItems('packing_returns', queryOptions)
		);
		return result || [];
	} catch (error) {
		try {
			handleDirectusError(error);
		} catch (e) {
			console.warn('Gagal mengambil data return (mungkin koleksi belum ada di Directus):', e);
		}
		return [];
	}
}


/**
 * PRJ-26: riwayat permintaan barang proyek (project_budgets yang pernah diajukan ke PL) untuk chip "sering diminta".
 * Satu query kecil, hanya 3 kolom; gagal baca = daftar kosong (chip default tetap tampil).
 */
export async function getRequestedItemHistory(projectId: number): Promise<Array<{ material_name: string | null; budget_category: string | null; unit: string | null }>> {
	try {
		const rows = await directus.request(
			readItems('project_budgets', {
				filter: { _and: [{ project_id: { _eq: projectId } }, { packing_status: { _nnull: true } }, { packing_status: { _neq: 'draft' } }] },
				fields: ['material_name', 'budget_category', 'unit'],
				limit: 500
			})
		);
		return (rows as any[]) || [];
	} catch (e) {
		console.warn('[packingList] gagal memuat riwayat barang proyek (chip default dipakai):', (e as Error)?.message || e);
		return [];
	}
}

/**
 * Fase 5 (Unifikasi Lifecycle Pengembalian Barang) — posisi tiap retur proyek untuk stepper lapangan.
 * Dua query terpisah (tanpa nested expansion): packing_returns proyek (yang belum selesai + 30 hari terakhir),
 * lalu header retur_gudang untuk id yang tertaut. Header gagal dibaca (mis. izin leader belum diatur) →
 * stepper tetap tampil dengan tahap dasar (Diajukan/Selesai), bukan error.
 */
export async function fetchReturTracking(projectId: number): Promise<import('$lib/utils/returLifecycle').ReturTracking[]> {
	const { buildReturTracking } = await import('$lib/utils/returLifecycle');
	const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
	const rows = (await directus
		.request(
			readItems('packing_returns', {
				filter: {
					_and: [
						{ project_id: { _eq: projectId } },
						{ _or: [{ return_status: { _neq: 'return_checked' } }, { date_created: { _gte: since } }] }
					]
				},
				fields: ['id', 'project_id', 'material_name', 'qty_returned', 'unit', 'return_status', 'date_created', 'retur_gudang_id'],
				sort: ['-date_created'],
				limit: 200
			})
		)
		.catch((e) => {
			console.warn('[packingList] packing_returns tak terbaca untuk stepper:', (e as any)?.message || e);
			return [];
		})) as any[];
	const headerIds = [...new Set(rows.map((r) => r.retur_gudang_id).filter((v) => v != null))] as number[];
	let headers = new Map<number, any>();
	if (headerIds.length) {
		const hs = (await directus
			.request(
				readItems('retur_gudang', {
					filter: { id: { _in: headerIds } },
					fields: ['id', 'nomor_retur', 'status', 'shipped_at', 'security_verified_at', 'rejection_reason', 'tanggal_pengambilan', 'driver_name', 'driver_phone', 'vehicle_plate'],
					limit: -1
				})
			)
			.catch((e) => {
				// CLAUDE.md Aturan #1: 403 = field/izin tidak cocok, bukan "kosong". Dicatat, stepper turun ke tahap dasar.
				console.warn('[packingList] retur_gudang tak terbaca untuk stepper (cek Roles & Permissions leader):', (e as any)?.message || e);
				return [];
			})) as any[];
		headers = new Map(hs.map((h) => [h.id, h]));
	}
	return buildReturTracking(rows, headers);
}
