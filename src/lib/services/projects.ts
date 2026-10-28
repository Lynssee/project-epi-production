import directus, { createUserDirectus, handleDirectusError } from './directus';
import { tokenize } from '../utils/searchMatch';
import { readItems, readItem, updateItem, createItem } from '@directus/sdk';
import { buildProjectSoIdList, dedupeById } from '../utils/projectSoIds';
import {
	BUDGET_APPROVED_STATUSES,
	BUDGET_PARTIAL_STATUSES,
	BUDGET_PAID_STATUSES,
} from '$lib/constants/status';

// search_blob (F3) sudah ternormalisasi (NFKC + fold homoglyph + lowercase) dan
// mencakup customer[].name — closes M4 (customer JSON tak bisa difilter server-side).
// Field mentah tetap disertakan sebagai fallback untuk record lama yang belum
// ter-backfill atau bila Directus Flow gagal mengisi search_blob.
const PROJECT_SEARCH_FIELDS = ['search_blob', 'name', 'lokasi', 'leader', 'co_leader', 'nomor_po'];

function buildProjectSearchFilter(q: string, mode: 'and' | 'or' = 'and') {
	const tokens = tokenize(q);
	const perTokenOr = tokens.map((t) => ({
		_or: PROJECT_SEARCH_FIELDS.map((f) => ({ [f]: { _icontains: t } }))
	}));
	const tokenFilter = mode === 'and' ? { _and: perTokenOr } : { _or: perTokenOr };
	if (!isNaN(Number(q.trim())) && q.trim()) {
		return { _or: [tokenFilter, { id: { _eq: Number(q.trim()) } }] };
	}
	return tokenFilter;
}

/**
 * Status priority order for sorting projects.
 * Lower index = higher priority (shown first).
 */
const STATUS_PRIORITY: string[] = [
	'on progress', 'on_progress', 'repair', // Sedang berjalan / perbaikan — paling atas
	'waiting', 'prepare', 'draft',         // Belum mulai
	'hold',                                // Ditahan
	'closed',                              // Ditutup
	'complete', 'done',                    // Selesai — paling bawah
];

function getStatusPriority(status: string | null): number {
	if (!status) return STATUS_PRIORITY.length;
	const idx = STATUS_PRIORITY.indexOf(status.toLowerCase().trim());
	return idx === -1 ? STATUS_PRIORITY.length : idx;
}

// In-Memory SWR Cache for projects to make module access instant
interface CacheEntry<T> {
	data: T;
	timestamp: number;
}
const projectsMemoryCache = new Map<string, CacheEntry<any[]>>();
const projectDetailMemoryCache = new Map<string, CacheEntry<any>>();
const PROJECTS_CACHE_TTL_MS = 45_000; // 45 detik
const DETAIL_CACHE_TTL_MS = 60_000; // 60 detik

export function invalidateProjectsCache() {
	projectsMemoryCache.clear();
	projectDetailMemoryCache.clear();
}

/**
 * Ambil daftar proyek.
 * @param leaderIdOrName - number: FK leader_id (baru), string: nama leader (legacy)
 * @param excludeClosedAndCancelled - hilangkan proyek closed/cancelled
 * @param directusToken - token per-user untuk row-level permissions (opsional)
 *
 * `options.orProjectIds` — Sistem Manpower Leader: id proyek tempat pengguna
 * memegang kursi Manpower Leader/Wakil. Di-OR-kan dengan filter leader, karena
 * orang lapangan terikat ke proyek lewat kursi itu, bukan lewat `projects.leader`.
 * Bila leader kosong tapi daftar ini terisi, filter memakai daftar ini saja.
 *
 * PERHATIAN: memanggil fungsi ini dengan leader kosong berarti "tanpa filter"
 * (semua proyek). Untuk pemanggilan yang seharusnya ter-scope, pakai
 * `getProjectsForCurrentUser()` di projectScope.ts — helper itu menutup celah
 * "tanpa data karyawan → malah lihat semua proyek".
 */
export async function getProjects(
	leaderIdOrName?: number | string | null,
	excludeClosedAndCancelled: boolean = false,
	directusToken?: string | null,
	options: { limit?: number; offset?: number; search?: string; sort?: string; filterStatus?: string; orProjectIds?: number[]; orLeaderName?: string | null; orWorkshops?: string[]; forceRefresh?: boolean } = {}
) {
	const cacheKey = JSON.stringify({
		leaderIdOrName: leaderIdOrName ?? null,
		excludeClosedAndCancelled,
		limit: options.limit ?? -1,
		offset: options.offset ?? 0,
		search: options.search ?? '',
		sort: options.sort ?? '',
		filterStatus: options.filterStatus ?? '',
		orProjectIds: options.orProjectIds ?? [],
		orLeaderName: options.orLeaderName ?? '',
		orWorkshops: options.orWorkshops ?? []
	});

	if (!options.forceRefresh) {
		const cached = projectsMemoryCache.get(cacheKey);
		if (cached && (Date.now() - cached.timestamp < PROJECTS_CACHE_TTL_MS)) {
			return cached.data;
		}
	}

	try {
		const client = directus; // Selalu gunakan admin client — filter leader sudah via query
		const filter: Record<string, any> = {};

		const statusExclude = { _nin: ['closed', 'cancel', 'cancelled'] };
		const kursiIds = Array.isArray(options.orProjectIds) ? options.orProjectIds.filter((v) => v != null) : [];
		const kursiCond = kursiIds.length > 0 ? { id: { _in: kursiIds } } : null;

		// Koordinator workshop (mis. Ciketing) terikat ke LOKASI kerja, bukan ke kursi
		// Project Leader per proyek: dia berhak atas seluruh proyek di workshop-nya.
		const workshops = Array.isArray(options.orWorkshops)
			? options.orWorkshops.map((w) => String(w).trim().toLowerCase()).filter(Boolean)
			: [];
		const workshopCond = workshops.length > 0 ? { workshop: { _in: workshops } } : null;

		// Cadangan nama leader saat filter utama memakai FK. Baris `karyawan` yang
		// terduplikasi membuat leader_id proyek lama menunjuk ke id yang berbeda dari
		// id akun yang login — tanpa ini proyek miliknya sendiri ikut hilang.
		const orNameRaw =
			typeof options.orLeaderName === 'string' ? options.orLeaderName.trim().toUpperCase() : '';
		const orNameCond = orNameRaw
			? {
					_or: [
						{ leader: { _icontains: orNameRaw } },
						{ co_leader: { _icontains: orNameRaw } }
					]
			  }
			: null;

		const extraConds = [kursiCond, workshopCond, orNameCond].filter(Boolean) as Record<string, any>[];

		/** Gabungkan kondisi leader dengan kursi lapangan / workshop / nama (bila ada). */
		const withExtras = (leaderCond: Record<string, any>) =>
			extraConds.length > 0 ? { _or: [leaderCond, ...extraConds] } : leaderCond;

		if (typeof leaderIdOrName === 'number') {
			// Filter FK — mencakup leader_id dan co_leader_id
			filter._and = [
				...(excludeClosedAndCancelled ? [{ status: statusExclude }] : []),
				withExtras({
					_or: [
						{ leader_id: { _eq: leaderIdOrName } },
						{ co_leader_id: { _eq: leaderIdOrName } }
					]
				})
			];
		} else if (typeof leaderIdOrName === 'string' && leaderIdOrName.trim()) {
			// Legacy string filter — dipertahankan selama migrasi data belum selesai
			const normalized = leaderIdOrName.trim().toUpperCase();
			filter._and = [
				...(excludeClosedAndCancelled ? [{ status: statusExclude }] : []),
				withExtras({
					_or: [
						{ leader: { _eq: normalized } },
						{ leader: { _icontains: normalized } },
						{ co_leader: { _eq: normalized } },
						{ co_leader: { _icontains: normalized } }
					]
				})
			];
		} else if (extraConds.length > 0) {
			// Tanpa kursi Project Leader sama sekali (Manpower Leader murni / koordinator workshop).
			filter._and = [
				...(excludeClosedAndCancelled ? [{ status: statusExclude }] : []),
				extraConds.length === 1 ? extraConds[0] : { _or: extraConds }
			];
		} else if (excludeClosedAndCancelled) {
			filter.status = statusExclude;
		}

		// Filter dasar (leader/status) sebelum search ditambahkan — dipakai ulang
		// bila AND antar-token nol hasil dan perlu retry dengan OR (lihat bawah).
		const baseFilterAnd = filter._and ? [...filter._and] : null;
		const baseFilterStatus = filter.status;
		const searchTokens = options.search ? tokenize(options.search) : [];

		function buildFilterWithSearch(mode: 'and' | 'or'): Record<string, any> {
			if (!options.search) return filter;
			const searchFilter = buildProjectSearchFilter(options.search as string, mode);
			if (baseFilterAnd) return { _and: [...baseFilterAnd, searchFilter] };
			if (baseFilterStatus) return { _and: [{ status: baseFilterStatus }, searchFilter] };
			return searchFilter;
		}

		let filterStatusExtra: Record<string, any> | null = null;
		if (options.filterStatus) {
			const selectedStatuses = options.filterStatus.split(',').map(s => s.trim()).filter(Boolean);
			if (selectedStatuses.length > 0) {
				const dbStatuses: string[] = [];
				for (const status of selectedStatuses) {
					if (status === 'active') {
						dbStatuses.push('waiting', 'on progress', 'on_progress', 'hold');
					} else if (status === 'on progress' || status === 'on_progress') {
						dbStatuses.push('on progress', 'on_progress');
					} else {
						dbStatuses.push(status);
					}
				}
				const uniqueStatuses = [...new Set(dbStatuses)];
				filterStatusExtra = { status: { _in: uniqueStatuses } };
			}
		}

		function buildFinalFilter(searchMode: 'and' | 'or'): Record<string, any> {
			const base = buildFilterWithSearch(searchMode);
			if (!filterStatusExtra) return base;
			if (base._and) return { _and: [...base._and, filterStatusExtra] };
			if (base.status) return { _and: [{ status: base.status }, filterStatusExtra] };
			return { _and: [base, filterStatusExtra] };
		}

		const baseQueryOptions: any = {
			fields: ['id', 'name', 'status', 'lokasi', 'leader', 'leader_id', 'co_leader', 'co_leader_id', 'description', 'jenis_project', 'nomor_po', 'so_customer_id', 'end_date', 'health_score', 'health_updated_at', 'workshop', 'fast_track', 'fast_track_at'],
			sort: options.sort ? [options.sort] : ['-date_created'],
			limit: options.limit !== undefined ? options.limit : -1
		};
		if (options.offset !== undefined) {
			baseQueryOptions.offset = options.offset;
		}

		let result = await client.request(
			readItems('projects', { ...baseQueryOptions, filter: buildFinalFilter('and') })
		);

		// AND antar-token nol hasil pada query multi-kata — coba OR sebagai
		// "Hasil terkait" (Rencana_Implementasi_Pertajam_Search_v3.pdf Q2).
		if (options.search && searchTokens.length > 1 && (!result || result.length === 0)) {
			result = await client.request(
				readItems('projects', { ...baseQueryOptions, filter: buildFinalFilter('or') })
			);
		}

		let finalProjects: any[] = [];
		if (options.sort) {
			finalProjects = result || [];
		} else {
			finalProjects = (result || []).sort((a: any, b: any) =>
				getStatusPriority(a.status) - getStatusPriority(b.status)
			);
		}

		// Simpan di cache
		projectsMemoryCache.set(cacheKey, { data: finalProjects, timestamp: Date.now() });
		return finalProjects;
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getProjectById(id: string | number, directusToken?: string | null, forceRefresh: boolean = false) {
	const cacheKey = String(id);
	if (!forceRefresh) {
		const cached = projectDetailMemoryCache.get(cacheKey);
		if (cached && (Date.now() - cached.timestamp < DETAIL_CACHE_TTL_MS)) {
			return cached.data;
		}
	}

	try {
		const client = directusToken ? createUserDirectus(directusToken) : directus;
		const result = await client.request(
			readItem('projects', id, {
				fields: ['id', 'name', 'status', 'lokasi', 'leader', 'leader_id', 'co_leader', 'co_leader_id', 'packing_list', 'description', 'jenis_project', 'progress_details', 'so_customer_id', 'timeline_planning', 'start_date', 'end_date', 'nomor_po', 'target_progress', 'total_progress', 'hse_work_types', 'hse_risk_level', 'workdays_per_week', 'workshop', 'fast_track', 'fast_track_at', 'total_area_m2']
			})
		);
		if (result) {
			projectDetailMemoryCache.set(cacheKey, { data: result, timestamp: Date.now() });
		}
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function getSoCustomerByProjectId(projectId: number | string) {
	try {
		const result = await directus.request(
			readItems('so_customer', {
				filter: {
					project_id: { _eq: Number(projectId) }
				},
				limit: 1
			})
		);
		return result && result.length > 0 ? result[0] : null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Grand PO (audit lapangan): SEMUA PO proyek -- PO utama (projects.so_customer_id) + PO saudara hasil gabung proyek
 * (so_customer.project_id = proyek). Proyek 1-PO selalu 1 elemen. Kueri saudara gagal -> console.error keras lalu
 * jatuh ke PO utama saja (dipakai untuk TAMPILAN/daftar; jangan dipakai untuk angka uang tanpa pemeriksaan tambahan).
 */
export async function getProjectSoIds(project: { id?: number | string; so_customer_id?: unknown } | null): Promise<number[]> {
	if (!project) return [];
	let siblings: any[] = [];
	if (project.id) {
		try {
			siblings = (await directus.request(
				readItems('so_customer', { filter: { project_id: { _eq: Number(project.id) } }, fields: ['id'] as any, limit: -1 })
			)) as any[];
		} catch (error) {
			console.error('[getProjectSoIds] gagal ambil PO saudara proyek', project.id, '-- pakai PO utama saja:', error);
		}
	}
	return buildProjectSoIdList(project, siblings);
}

/** Header beberapa PO sekaligus (1 kueri). */
export async function getSoCustomersByIds(ids: Array<number | string>): Promise<any[]> {
	const list = [...new Set((ids || []).map(Number).filter(Boolean))];
	if (list.length === 0) return [];
	try {
		return (await directus.request(readItems('so_customer', { filter: { id: { _in: list } }, limit: -1 }))) as any[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Baris detail (jasa dll) beberapa PO sekaligus (1 kueri, unik per id). */
export async function getSoCustomerDetailsForSos(ids: Array<number | string>): Promise<any[]> {
	const list = [...new Set((ids || []).map(Number).filter(Boolean))];
	if (list.length === 0) return [];
	try {
		const rows = (await directus.request(
			readItems('so_customer_details', { filter: { so_customer_id: { _in: list } }, limit: -1 })
		)) as any[];
		return dedupeById(rows);
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getSoCustomerById(id: number | string) {
	try {
		const result = await directus.request(
			readItem('so_customer', id)
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Fase 6 / R9 (Pertajam Modul Penawaran, erp-epi) — baseline Kurva S rencana dari
 * penawaran sumber, disimpan di so_rab.scurve_baseline oleh convertPenawaranToRab().
 * Dipakai FieldSCurve.svelte di dashboard lapangan: kurva rencana (yang
 * ditandatangani customer) vs realisasi harian. Null bila RAB lama / penawaran
 * tanpa jadwal.
 */
export async function getScurveBaselineBySoCustomer(
	soCustomerId: number | string
): Promise<{ d: string; p: number }[] | null> {
	if (!soCustomerId) return null;
	try {
		const rows = await directus.request(
			readItems('so_rab', {
				filter: {
					so_customer_id: { _eq: Number(soCustomerId) },
					scurve_baseline: { _nnull: true }
				},
				fields: ['scurve_baseline'],
				sort: ['-id'],
				limit: 1
			})
		);
		let b: any = rows && rows.length > 0 ? (rows[0] as any).scurve_baseline : null;
		if (typeof b === 'string') {
			try {
				b = JSON.parse(b);
			} catch {
				b = null;
			}
		}
		return Array.isArray(b) && b.length ? b : null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

// Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — dipakai sebagai toleransi deviasi
// Rasio Konsumsi Material (reuse, BUKAN setting baru: angka yang sama dipakai perencanaan
// RAP di app_settings module='project'). Cache in-memory 5 menit, default 20% bila gagal baca.
const PLANNING_LOSS_FACTOR_DEFAULT = 20;
let _lossFactorCache: { at: number; value: number } | null = null;
const LOSS_FACTOR_CACHE_TTL_MS = 300_000;

export async function getPlanningLossFactorPct(): Promise<number> {
	if (_lossFactorCache && Date.now() - _lossFactorCache.at < LOSS_FACTOR_CACHE_TTL_MS) {
		return _lossFactorCache.value;
	}
	let value = PLANNING_LOSS_FACTOR_DEFAULT;
	try {
		const rows = await directus.request(
			readItems('app_settings', {
				filter: { module: { _eq: 'project' }, setting_key: { _eq: 'planning.loss_factor_pct' } },
				fields: ['setting_value'],
				limit: 1
			})
		);
		const n = Number((rows as any[])?.[0]?.setting_value);
		if (Number.isFinite(n) && n > 0) value = n;
	} catch (error) {
		console.error('[projects] gagal baca app_settings planning.loss_factor_pct, pakai default:', error);
	}
	_lossFactorCache = { at: Date.now(), value };
	return value;
}

export async function getSoCustomerDetails(soCustomerId: number | string) {
	try {
		const result = await directus.request(
			readItems('so_customer_details', {
				filter: {
					so_customer_id: { _eq: Number(soCustomerId) }
				},
				limit: -1
			})
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getProjectActualMaterials(projectId: number | string) {
	try {
		const result = await directus.request(
			readItems('project_expenses', {
				filter: {
					project_id: { _eq: Number(projectId) },
					expense_type: { _in: ['supplier', 'consumable', 'safety'] }
				},
				fields: ['id', 'expense_type', 'material_name', 'material_color', 'description', 'qty', 'unit', 'qty_used', 'qty_remaining', 'reference_number', 'identitas_barang_id', 'rab_budget_id'],
				limit: -1
			})
		);
		// Map values to ensure fallback values for consumables and safety items are set
		return (result || []).map((item: any) => {
			const qty = parseFloat(item.qty) || 0;
			const qty_used = parseFloat(item.qty_used) || 0;
			// Default qty_remaining to qty - qty_used if it's not set
			const qty_remaining = item.qty_remaining !== null && item.qty_remaining !== undefined 
				? parseFloat(item.qty_remaining) 
				: (qty - qty_used);
			return {
				...item,
				material_name: item.material_name || item.description || 'Item Tanpa Nama',
				qty_used,
				qty_remaining
			};
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function updateProjectExpenseQty(expenseId: number | string, data: { qty_used: number; qty_remaining: number }) {
	try {
		const result = await directus.request(
			updateItem('project_expenses', expenseId, data)
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

// Auto-transition status proyek (waiting -> on progress -> menunggu verifikasi) berdasarkan
// overall_progress laporan harian — lihat applyAutoProjectStatusTransition di halaman Laporan.
// Status akhir "selesai"/"closed" tetap wewenang Admin lewat alur Closing/Evaluasi (BAST),
// makanya transisi otomatis ini berhenti di "menunggu verifikasi", bukan langsung final.
export async function updateProjectStatus(projectId: number | string, status: string) {
	try {
		const result = await directus.request(
			updateItem('projects', projectId, { status })
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function updateProject(projectId: number | string, data: Record<string, any>) {
	try {
		const result = await directus.request(
			updateItem('projects', projectId, data)
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function getProjectBudgetExpenses(projectId: number | string) {
	const allBudgetSources: any[] = [];
	const seenRefNumbers = new Set<string>();

	try {
		// 1. Fetch from project_expenses (direct debit / advance / PA items)
		const expFilter: Record<string, any> = {
			project_id: { _eq: Number(projectId) },
			_or: [
				{ reference_number: { _starts_with: 'PA' } },
				{ reference_number: { _starts_with: 'KB' } },
				{ reference_number: { _starts_with: 'PC' } },
				{ expense_type: { _in: ['anggaran', 'kasbon', 'kas_proyek', 'petty_cash'] } },
				{ debit_amount: { _gt: 0 } }
			]
		};

		const result = await directus.request(
			readItems('project_expenses', {
				filter: expFilter,
				fields: [
					'id',
					'expense_type',
					'material_name',
					'description',
					'qty',
					'unit',
					'unit_price',
					'expense_amount',
					'debit_amount',
					'reference_number',
					'pic',
					'expense_category'
				],
				limit: -1
			})
		);

		for (const item of (result || [])) {
			const ref = (item.reference_number || '').trim();
			if (ref) seenRefNumbers.add(ref);
			allBudgetSources.push({
				...item,
				material_name: item.material_name || item.description || (ref ? `Anggaran (${ref})` : 'Item Pengajuan')
			});
		}
	} catch (error) {
		console.warn('Error fetching project_expenses for budget:', error);
	}

	try {
		// 2. Fetch approved/paid pengajuan_anggaran for this project
		// Daftar status diambil dari $lib/constants/status — daftar hardcode sebelumnya
		// melewatkan 'Approved' (39 baris) & 'Completed' (121 baris), sehingga rekap biaya
		// proyek kekurangan 160 pengajuan.
		const paResult = await directus.request(
			readItems('pengajuan_anggaran', {
				filter: {
					project_id: { _eq: Number(projectId) },
					status: { _in: [...BUDGET_APPROVED_STATUSES, ...BUDGET_PARTIAL_STATUSES, ...BUDGET_PAID_STATUSES] }
				},
				fields: [
					'id',
					'nomor_pengajuan',
					'tujuan_pengajuan',
					'kategori',
					'nama_pengaju',
					'total_amount',
					'jumlah_disetujui',
					'status',
					'date_created'
				],
				limit: -1
			})
		);

		for (const pa of (paResult || [])) {
			const ref = (pa.nomor_pengajuan || '').trim();
			// Avoid duplicates if already listed in project_expenses
			if (ref && seenRefNumbers.has(ref)) continue;
			if (ref) seenRefNumbers.add(ref);

			const amount = Number(pa.jumlah_disetujui) > 0 ? Number(pa.jumlah_disetujui) : (Number(pa.total_amount) || 0);
			allBudgetSources.push({
				id: `pa_${pa.id}`,
				raw_pa_id: pa.id,
				expense_type: 'anggaran',
				material_name: pa.tujuan_pengajuan || pa.nomor_pengajuan || 'Pengajuan Anggaran Disetujui',
				description: pa.tujuan_pengajuan || '',
				qty: 1,
				unit: 'lot',
				unit_price: amount,
				expense_amount: amount,
				debit_amount: amount,
				reference_number: pa.nomor_pengajuan || `PA-${pa.id}`,
				pic: pa.nama_pengaju || '-',
				expense_category: pa.kategori || 'operasional'
			});
		}
	} catch (paError) {
		console.warn('Error fetching pengajuan_anggaran for budget sources:', paError);
	}

	return allBudgetSources;
}

export async function createProjectExpense(data: any) {
	try {
		const result = await directus.request(
			createItem('project_expenses', data)
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function createPurchaseInvoice(data: any) {
	try {
		const result = await directus.request(
			createItem('purchase_invoices', data)
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}
