import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem } from '@directus/sdk';
import { todayWib } from '$lib/utils/wibDate';

// Kategori work_order (kategori_perbaikan_id / jenis_pekerjaan_id / order_status) untuk P2H
// auto-WO dipindah ke src/routes/api/preventive/p2h/submit/+server.ts (Fase 1 B1) —
// jangan diubah tanpa menyamakan juga di sisi admin (erp-epi-1/maintenanceApi.js P2H_WO_IDS).

// Sama dengan erp-epi-1/src/lib/services/maintenanceApi.js COMPRESSOR_CATEGORY_IDS —
// dua repo tidak berbagi lib, jangan diubah tanpa menyamakan juga di sisi admin.
export const COMPRESSOR_CATEGORY_IDS = [
	'49225e15-e7c3-4d2e-86d8-f905ae450389', // Compressor Screw
	'9f97d7ad-89e6-4065-ab85-bd945c4cda70' // Compressor Piston
];

export const FORKLIFT_CATEGORY_IDS = [
	'830f2020-6d4c-4758-8c6d-d6d807e6a09f', // Forklift Electric
	'7eaf3570-c578-496a-a851-e89bd9ea8dc6'  // Forklift Diesel
];

export const VEHICLE_CATEGORY_IDS = [
	'5445ef6c-801c-438a-8c13-88314a5f2962', // Kendaraan Roda 2
	'51a0829e-99c0-4036-8418-73615c7b1220', // Kendaraan Roda 4
	'2c4c7ad2-956f-45ef-9f47-fc889eac4048', // Kendaraan Roda 6+
	'4f83bb40-9df5-484e-aae0-3225877e3571'  // MOTOR
];

export const PRODUKSI_CATEGORY_IDS = [
	'ea8b045b-dcb6-415b-843d-3035de12a1b3'  // MESIN (Mesin / Produksi)
];


export interface P2hTemplateItem {
	id: string;
	item_name: string;
	is_critical: boolean;
	wajib_foto?: boolean | number | null;
	go_criteria?: string;
	nogo_criteria?: string;
	action_if_nogo_operator?: string | null;
	action_if_nogo_mekanik?: string | null;
	sort?: number;
	input_type?: string | null;
	min_value?: number | null;
	max_value?: number | null;
	unit_of_measure?: string | null;
}

export interface P2hChecklistItem {
	template: P2hTemplateItem;
	result: 'Go' | 'No-Go';
	numeric_value?: number | null;
	text_value?: string | null;
	notes?: string;
	foto?: string | null;
}

let resultCategoriesCache: { goId: string; noGoId: string } | null = null;
let pmStatusCache: Record<string, string> | null = null;
const operatorIdCache = new Map<string, string>();

export async function getOperatorEquipment(options: { categoryIds?: string[] } = {}) {
	try {
		const filter: Record<string, any> = {};
		if (options.categoryIds?.length) filter.category_id = { _in: options.categoryIds };
		return await directus.request(
			readItems('equipment', {
				filter,
				fields: [
					'id',
					'name',
					'code',
					'category_id',
					'status_operational',
					'last_hoursmeter',
					'location_id',
					'ownership_type',
					'owner_name'
				],
				sort: ['name'],
				limit: -1
			})
		);
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getEquipmentById(equipmentId: string) {
	try {
		return await directus.request(
			readItem('equipment', equipmentId, {
				fields: [
					'id',
					'name',
					'code',
					'category_id',
					'status_operational',
					'last_hoursmeter',
					'location_id',
					'ownership_type',
					'owner_name',
					'identitas_barang_id'
				]
			})
		);
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** F6 — cari equipment dari kode QR/barcode aset (mis. hasil scan "EPI:EQUIPMENT:<code>"). */
export async function getEquipmentByCode(code: string) {
	try {
		const result = await directus.request(
			readItems('equipment', {
				filter: { code: { _eq: code } },
				fields: ['id', 'name', 'code', 'category_id', 'status_operational', 'ownership_type', 'owner_name'],
				limit: 1
			})
		);
		return (result as any[])?.[0] || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function getP2hTemplates(equipmentCategoryId: string): Promise<P2hTemplateItem[]> {
	try {
		return (await directus.request(
			readItems('p2h_template', {
				filter: { equipment_category_id: { _eq: equipmentCategoryId } },
				sort: ['sort'],
				limit: -1
			})
		)) as P2hTemplateItem[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getP2hResultCategories(): Promise<{ goId: string; noGoId: string }> {
	if (resultCategoriesCache) return resultCategoriesCache;
	const cats = (await directus.request(
		readItems('category', { filter: { group: { _eq: 'p2h_result' } }, limit: -1 })
	)) as any[];
	const go = cats.find((c) => c.name === 'Go');
	const noGo = cats.find((c) => c.name === 'No-Go');
	if (!go || !noGo) throw new Error('Kategori hasil P2H (Go/No-Go) tidak ditemukan di Directus.');
	resultCategoriesCache = { goId: go.id, noGoId: noGo.id };
	return resultCategoriesCache;
}

export async function getTodayP2hSession(equipmentId: string, date: string) {
	try {
		const result = await directus.request(
			readItems('p2h_session', {
				filter: { equipment_id: { _eq: equipmentId }, date: { _eq: date } },
				limit: 1
			})
		);
		return result.length > 0 ? result[0] : null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * F4 (Fase 4 "Export Maintenance v2" rencana) — hasil P2H per item untuk satu sesi
 * (dipakai halaman "Hasil P2H hari ini" untuk ekspor PDF). Field disimpan di p2h_log oleh
 * /api/preventive/p2h/submit; nama item & hasil di-join langsung via dot-notation Directus
 * SDK (satu request, bukan N+1 — Aturan #2 CLAUDE.md "fetching relasi dipisah" ini
 * pengecualian yang aman: relasi dangkal, bukan nested-deep multi-level).
 */
export async function getP2hLogsBySession(sessionId: string) {
	try {
		const result = await directus.request(
			readItems('p2h_log', {
				filter: { p2h_session_id: { _eq: sessionId } },
				fields: ['id', 'notes', 'numeric_value', 'text_value', { p2h_template_id: ['item_name'] }, { result: ['name'] }]
			})
		);
		return result as Array<{
			id: string;
			notes: string | null;
			numeric_value: number | null;
			text_value: string | null;
			p2h_template_id: { item_name: string } | null;
			result: { name: string } | null;
		}>;
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * G1 — checklist alat di Laporan Harian sebelumnya berupa teks bebas {name, amount}
 * yang NOL terhubung ke P2H (operator bisa menulis apa saja, tanpa validasi terhadap
 * pengecekan aktual). Fungsi ini menarik daftar unit yang ditugaskan ke proyek + status
 * P2H hari itu langsung dari p2h_session, sehingga Laporan Harian jadi LENSA (baca saja)
 * atas data P2H, bukan sumber kedua yang bisa berbeda dari kenyataan.
 */
export interface ProjectEquipmentP2hStatus {
	equipmentId: string;
	name: string;
	code: string | null;
	categoryName?: string | null;
	statusOperational?: string | null;
	lastHoursmeter?: number | null;
	hasSession: boolean;
	sessionId?: string | null;
	result: 'Go' | 'No-Go' | null;
	statusUnit?: string | null;
	keterangan?: string | null;
	hoursmeter?: number | null;
	fotoUnit?: string | null;
	operatorName: string | null;
	isLoan?: boolean;
	jamSelesaiPakai?: string | null;
	sesiTerbuka?: boolean;
}

export async function getProjectEquipmentP2hStatus(
	projectId: string | number,
	date: string
): Promise<ProjectEquipmentP2hStatus[]> {
	try {
		// 1. Ambil unit yang ditugaskan via relasi projects
		const assignedEquipmentPromise = directus.request(
			readItems('equipment', {
				filter: { projects: { project_id: { _eq: projectId } } },
				fields: ['id', 'name', 'code', 'category_id', 'status_operational', 'last_hoursmeter'],
				sort: ['name'],
				limit: -1
			})
		) as Promise<any[]>;

		// 2. Ambil unit yang sedang dipinjam aktif ke proyek via internal_loan_log
		const activeLoansPromise = directus.request(
			readItems('internal_loan_log', {
				filter: { project_id: { _eq: projectId }, status: { _eq: '8d23640e-5726-4480-a9fb-693e3ea6c8fa' } },
				fields: ['id', 'equipment_id', 'status'],
				limit: -1
			})
		).catch(() => []) as Promise<any[]>;

		const [assignedListRaw, activeLoansRaw] = await Promise.all([
			assignedEquipmentPromise,
			activeLoansPromise
		]);

		const assignedList = Array.isArray(assignedListRaw) ? assignedListRaw : (assignedListRaw as any)?.data || [];
		const activeLoans = Array.isArray(activeLoansRaw) ? activeLoansRaw : (activeLoansRaw as any)?.data || [];

		const assignedIds = new Set(assignedList.map((e: any) => e.id));
		const loanEquipmentIds = [...new Set(activeLoans.map((l: any) => l.equipment_id).filter((id: any) => id && !assignedIds.has(id)))];

		let loanEquipmentList: any[] = [];
		if (loanEquipmentIds.length > 0) {
			const loanEqRaw = await directus.request(
				readItems('equipment', {
					filter: { id: { _in: loanEquipmentIds } },
					fields: ['id', 'name', 'code', 'category_id', 'status_operational', 'last_hoursmeter'],
					limit: -1
				})
			);
			loanEquipmentList = Array.isArray(loanEqRaw) ? loanEqRaw : (loanEqRaw as any)?.data || [];
		}

		const loanSet = new Set(activeLoans.map((l: any) => l.equipment_id));
		const allEquipment = [
			...assignedList.map((e: any) => ({ ...e, isLoan: loanSet.has(e.id) })),
			...loanEquipmentList.map((e: any) => ({ ...e, isLoan: true }))
		];

		if (!allEquipment.length) return [];

		// Ambil kategori secara terpisah sesuai aturan relasi Directus
		const categoryIds = [...new Set(allEquipment.map((e: any) => e.category_id).filter(Boolean))];
		const sessionsMapPromise = getTodaySessionsMap(allEquipment.map((e: any) => e.id), date);
		const categoriesPromise = categoryIds.length
			? (directus.request(readItems('category', { filter: { id: { _in: categoryIds } }, fields: ['id', 'name'], limit: -1 })) as Promise<any[]>)
			: Promise.resolve([]);

		const [sessionsMap, categoriesRaw] = await Promise.all([
			sessionsMapPromise,
			categoriesPromise
		]);

		const categoriesList = Array.isArray(categoriesRaw) ? categoriesRaw : (categoriesRaw as any)?.data || [];
		const categoryMap = new Map(categoriesList.map((c: any) => [c.id, c.name]));

		const resultIds = [...new Set(Object.values(sessionsMap).map((s: any) => s.overall_result).filter(Boolean))];
		const operatorIds = [...new Set(Object.values(sessionsMap).map((s: any) => s.operator_id).filter(Boolean))];
		const [resultCatsRaw, operatorsRaw] = await Promise.all([
			resultIds.length
				? (directus.request(readItems('category', { filter: { id: { _in: resultIds } }, limit: -1 })) as Promise<any[]>)
				: Promise.resolve([]),
			operatorIds.length
				? (directus.request(readItems('personnel', { filter: { id: { _in: operatorIds } }, fields: ['id', 'name'], limit: -1 })) as Promise<any[]>)
				: Promise.resolve([])
		]);

		const resultCats = Array.isArray(resultCatsRaw) ? resultCatsRaw : (resultCatsRaw as any)?.data || [];
		const operators = Array.isArray(operatorsRaw) ? operatorsRaw : (operatorsRaw as any)?.data || [];

		const resultNameMap = new Map(resultCats.map((c: any) => [c.id, c.name]));
		const operatorNameMap = new Map(operators.map((p: any) => [p.id, p.name]));

		return allEquipment.map((eq: any) => {
			const session = sessionsMap[eq.id];
			return {
				equipmentId: eq.id,
				name: eq.name,
				code: eq.code || null,
				categoryName: categoryMap.get(eq.category_id) || null,
				statusOperational: eq.status_operational || null,
				lastHoursmeter: eq.last_hoursmeter != null ? Number(eq.last_hoursmeter) : null,
				hasSession: !!session,
				sessionId: session?.id || null,
				result: session ? ((resultNameMap.get(session.overall_result) as 'Go' | 'No-Go') || null) : null,
				statusUnit: session?.status_unit || null,
				keterangan: session?.keterangan_tambahan || null,
				hoursmeter: session?.hoursmeter != null ? Number(session.hoursmeter) : null,
				fotoUnit: session?.foto_unit || null,
				operatorName: session ? (operatorNameMap.get(session.operator_id) || null) : null,
				isLoan: eq.isLoan || false,
				jamSelesaiPakai: session?.jam_selesai_pakai || null,
				sesiTerbuka: !!session && !session.jam_selesai_pakai
			};
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getTodaySessionsMap(equipmentIds: string[], date: string): Promise<Record<string, any>> {
	if (!equipmentIds.length) return {};
	try {
		const chunkSize = 50;
		const sessions: any[] = [];
		for (let i = 0; i < equipmentIds.length; i += chunkSize) {
			const chunk = equipmentIds.slice(i, i + chunkSize);
			const result = (await directus.request(
				readItems('p2h_session', {
					filter: { equipment_id: { _in: chunk }, date: { _eq: date } },
					limit: -1
				})
			)) as any[];
			sessions.push(...(result || []));
		}

		const operatorIds = sessions.map(s => s.operator_id).filter(Boolean);
		if (operatorIds.length > 0) {
			const uniqueOpIds = [...new Set(operatorIds)];
			const operators = (await directus.request(
				readItems('personnel', {
					filter: { id: { _in: uniqueOpIds } },
					fields: ['id', 'name'],
					limit: -1
				})
			)) as any[];
			const opMap: Record<string, string> = {};
			for (const o of operators) opMap[o.id] = o.name;
			for (const s of sessions) {
				if (s.operator_id) {
					s.operator = { name: opMap[s.operator_id] || '-' };
				}
			}
		}

		const map: Record<string, any> = {};
		for (const s of sessions) map[s.equipment_id] = s;
		return map;
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

export async function getPmDueCountsMap(equipmentIds: string[]): Promise<Record<string, { overdue: number; total: number }>> {
	if (!equipmentIds.length) return {};
	try {
		const chunkSize = 50;
		const trackers: any[] = [];
		for (let i = 0; i < equipmentIds.length; i += chunkSize) {
			const chunk = equipmentIds.slice(i, i + chunkSize);
			const result = (await directus.request(
				readItems('pm_due_tracker', {
					filter: { equipment_id: { _in: chunk } },
					fields: ['id', 'equipment_id', 'status_id', 'due_date'],
					limit: -1
				})
			)) as any[];
			const list = Array.isArray(result) ? result : (result as any)?.data || [];
			trackers.push(...list);
		}
		const statusIds = [...new Set(trackers.map((t) => t.status_id).filter(Boolean))];
		const statuses = statusIds.length
			? ((await directus.request(readItems('category', { filter: { id: { _in: statusIds } }, fields: ['id', 'name'], limit: -1 }))) as any[])
			: [];
		const statusList = Array.isArray(statuses) ? statuses : (statuses as any)?.data || [];
		const statusMap = new Map(statusList.map((s: any) => [s.id, s.name]));
		const today = todayWib();

		const map: Record<string, { overdue: number; total: number }> = {};
		for (const t of trackers) {
			const statusName = String(statusMap.get(t.status_id) || '').toLowerCase();
			if (statusName === 'completed') continue;
			if (!map[t.equipment_id]) map[t.equipment_id] = { overdue: 0, total: 0 };
			map[t.equipment_id].total += 1;
			if (statusName === 'overdue' || (t.due_date && t.due_date < today)) map[t.equipment_id].overdue += 1;
		}
		return map;
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

async function resolvePmStatusId(name: 'Active' | 'Overdue' | 'Completed'): Promise<string> {
	if (!pmStatusCache) {
		const cats = (await directus.request(
			readItems('category', { filter: { group: { _eq: 'pm_status' } }, limit: -1 })
		)) as any[];
		const catList = Array.isArray(cats) ? cats : (cats as any)?.data || [];
		pmStatusCache = {};
		for (const c of catList) pmStatusCache[String(c.name).toLowerCase()] = c.id;
	}
	const id = pmStatusCache[name.toLowerCase()];
	if (!id) throw new Error(`Kategori status PM "${name}" tidak ditemukan di Directus.`);
	return id;
}

/**
 * project-epi mengenal user via karyawanId/karyawanName, sedangkan p2h_session.operator_id
 * menunjuk ke collection `personnel`. Fase 0 (2026-07-16) menambah field resmi
 * personnel.karyawan_id -> karyawan.id (lihat erp-epi-1/setup-personnel-karyawan-link-field.js)
 * — dipakai lebih dulu di sini karena unik & tidak ambigu. Baru per rilis ini hanya
 * sebagian personnel yang sudah ditautkan (reconcile manual oleh admin HRD masih jalan),
 * jadi fallback by-name TETAP ada untuk personnel yang belum ditautkan.
 */
export async function resolveOperatorId(karyawanName: string, karyawanId?: number | null): Promise<string> {
	const cacheKey = karyawanId != null ? `id:${karyawanId}` : `name:${karyawanName.trim().toLowerCase()}`;
	if (operatorIdCache.has(cacheKey)) return operatorIdCache.get(cacheKey)!;

	let personnelId: string | null = null;
	if (karyawanId != null) {
		const byKaryawanId = (await directus.request(
			readItems('personnel', {
				filter: { karyawan_id: { _eq: karyawanId } },
				fields: ['id'],
				limit: 1
			})
		)) as any[];
		const list = Array.isArray(byKaryawanId) ? byKaryawanId : (byKaryawanId as any)?.data || [];
		if (list[0]?.id) personnelId = list[0].id;
	}

	if (!personnelId) {
		const byName = (await directus.request(
			readItems('personnel', {
				filter: { name: { _icontains: karyawanName.trim() } },
				fields: ['id'],
				limit: 1
			})
		)) as any[];
		const list = Array.isArray(byName) ? byName : (byName as any)?.data || [];
		if (list[0]?.id) personnelId = list[0].id;
	}

	if (!personnelId) {
		throw new Error(
			`Akun "${karyawanName}" belum terdaftar sebagai personel di sistem (collection personnel). Hubungi admin.`
		);
	}
	operatorIdCache.set(cacheKey, personnelId);
	return personnelId;
}

/**
 * Fase 1 (audit B1/B6/B8, 2026-07-16): submit P2H sekarang lewat SATU request ke
 * /api/preventive/p2h/submit (server yang mengurus sesi+item+auto-WO secara atomik,
 * lihat src/routes/api/preventive/p2h/submit/+server.ts) — bukan beberapa
 * directus.request() terpisah dari klien seperti submitP2hSession lama. Kalau
 * jaringan HP putus (TypeError fetch), payload diantre ke offlineQueue dan otomatis
 * dikirim ulang saat online (lihat $lib/utils/offlineQueue.ts, pola sama dgn driver.ts).
 */
export async function submitP2hSessionAtomic(
	sessionPayload: {
		equipment_id: string;
		date: string;
		keterangan_tambahan?: string;
		foto_unit?: string;
		gps_lat?: number | null;
		gps_lng?: number | null;
		scan_method?: 'scan' | 'manual';
		hoursmeter?: number | null;
		signature: string;
	},
	checklistItems: P2hChecklistItem[]
): Promise<{ queued: true } | { session: any; workOrder: any }> {
	const { auth } = await import('$lib/firebase');
	const { enqueue } = await import('$lib/utils/offlineQueue');

	const payload = {
		...sessionPayload,
		checklist_items: checklistItems.map((item) => ({
			template_id: item.template.id,
			item_name: item.template.item_name,
			is_critical: item.template.is_critical,
			wajib_foto: item.template.wajib_foto,
			nogo_criteria: item.template.nogo_criteria,
			action_if_nogo_operator: item.template.action_if_nogo_operator,
			action_if_nogo_mekanik: item.template.action_if_nogo_mekanik,
			result: item.result,
			notes: item.notes,
			foto: item.foto || null,
			numeric_value: item.numeric_value ?? null,
			text_value: item.text_value ?? null
		}))
	};

	const url = '/api/preventive/p2h/submit';

	let idToken: string;
	try {
		const user = auth.currentUser;
		if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
		idToken = await user.getIdToken();
	} catch {
		enqueue(url, 'POST', payload);
		return { queued: true };
	}

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			throw new Error(data?.message || `Gagal (${res.status})`);
		}
		return res.json();
	} catch (err: any) {
		if (err instanceof TypeError || err.name === 'TypeError' || err.message?.toLowerCase().includes('fetch') || err.message?.toLowerCase().includes('network')) {
			// Kegagalan jaringan (bukan penolakan server) — antre untuk retry saat online.
			enqueue(url, 'POST', payload);
			return { queued: true };
		}
		throw err;
	}
}

/**
 * Menutup sesi P2H yang sudah ada (bukan submit baru) — dipakai operator di akhir
 * shift/pekerjaan untuk konfirmasi kondisi unit saat selesai dipakai. Sama pola
 * offline-queue-nya dengan submitP2hSessionAtomic: gagal jaringan -> diantre.
 */
export async function closeP2hSessionAtomic(
	sessionId: string,
	signature: string,
	catatanSelesai?: string
): Promise<{ queued: true } | { session: any }> {
	const { auth } = await import('$lib/firebase');
	const { enqueue } = await import('$lib/utils/offlineQueue');

	const payload = { session_id: sessionId, signature, catatan_selesai: catatanSelesai || null };
	const url = '/api/preventive/p2h/tutup';

	let idToken: string;
	try {
		const user = auth.currentUser;
		if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
		idToken = await user.getIdToken();
	} catch {
		enqueue(url, 'POST', payload);
		return { queued: true };
	}

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			throw new Error(data?.message || `Gagal (${res.status})`);
		}
		return res.json();
	} catch (err: any) {
		if (err instanceof TypeError || err.name === 'TypeError' || err.message?.toLowerCase().includes('fetch') || err.message?.toLowerCase().includes('network')) {
			enqueue(url, 'POST', payload);
			return { queued: true };
		}
		throw err;
	}
}

export async function getDuePmTasks(equipmentId: string) {
	try {
		const trackers = (await directus.request(
			readItems('pm_due_tracker', {
				filter: { equipment_id: { _eq: equipmentId } },
				sort: ['due_date'],
				limit: -1
			})
		)) as any[];
		const trackerList = Array.isArray(trackers) ? trackers : (trackers as any)?.data || [];
		if (!trackerList.length) return [];

		const templateIds = [...new Set(trackerList.map((t: any) => t.pm_task_template_id).filter(Boolean))];
		const statusIds = [...new Set(trackerList.map((t: any) => t.status_id).filter(Boolean))];
		const [templates, statuses] = await Promise.all([
			templateIds.length
				? directus.request(readItems('pm_task_template', { filter: { id: { _in: templateIds } }, fields: ['id', 'task_name'], limit: -1 }))
				: Promise.resolve([]),
			statusIds.length
				? directus.request(readItems('category', { filter: { id: { _in: statusIds } }, fields: ['id', 'name'], limit: -1 }))
				: Promise.resolve([])
		]);
		const templateList = Array.isArray(templates) ? templates : (templates as any)?.data || [];
		const statusList = Array.isArray(statuses) ? statuses : (statuses as any)?.data || [];
		const templateMap = new Map(templateList.map((t: any) => [t.id, t]));
		const statusMap = new Map(statusList.map((s: any) => [s.id, s]));

		return trackerList
			.map((t: any) => ({
				...t,
				template: templateMap.get(t.pm_task_template_id) || null,
				status: statusMap.get(t.status_id) || null
			}))
			.filter((t: any) => (t.status?.name || '').toLowerCase() !== 'completed');
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

// B2 Fase 4 restrukturisasi navigasi Lapangan (5 Agustus 2026): "PM Hari Ini" di quick-view
// dashboard -- lintas semua equipment operator, bukan per-unit seperti getDuePmTasks. Hanya
// due_date <= hari ini (due beneran hari ini + overdue), bukan seluruh jadwal PM mendatang.
export interface MyPmDueTask {
	id: string;
	equipmentId: string;
	equipmentName: string;
	taskName: string;
	dueDate: string;
	overdue: boolean;
}

export async function getMyPmDueTasks(equipmentIds: string[]): Promise<MyPmDueTask[]> {
	if (!equipmentIds.length) return [];
	try {
		const today = todayWib();
		const chunkSize = 50;
		const trackers: any[] = [];
		for (let i = 0; i < equipmentIds.length; i += chunkSize) {
			const chunk = equipmentIds.slice(i, i + chunkSize);
			const result = (await directus.request(
				readItems('pm_due_tracker', {
					filter: { equipment_id: { _in: chunk }, due_date: { _lte: today } },
					fields: ['id', 'equipment_id', 'due_date', 'pm_task_template_id', 'status_id'],
					sort: ['due_date'],
					limit: -1
				})
			)) as any[];
			const list = Array.isArray(result) ? result : (result as any)?.data || [];
			trackers.push(...list);
		}

		if (!trackers.length) return [];

		// Directus fetching must be separated for each relation
		const templateIds = [...new Set(trackers.map((t) => t.pm_task_template_id).filter(Boolean))];
		const eqIds = [...new Set(trackers.map((t) => t.equipment_id).filter(Boolean))];
		const statusIds = [...new Set(trackers.map((t) => t.status_id).filter(Boolean))];

		const [templates, equipments, statuses] = await Promise.all([
			templateIds.length
				? directus.request(readItems('pm_task_template', { filter: { id: { _in: templateIds } }, fields: ['id', 'task_name'], limit: -1 }))
				: Promise.resolve([]),
			eqIds.length
				? directus.request(readItems('equipment', { filter: { id: { _in: eqIds } }, fields: ['id', 'name'], limit: -1 }))
				: Promise.resolve([]),
			statusIds.length
				? directus.request(readItems('category', { filter: { id: { _in: statusIds } }, fields: ['id', 'name'], limit: -1 }))
				: Promise.resolve([])
		]);

		const templateList = Array.isArray(templates) ? templates : (templates as any)?.data || [];
		const eqList = Array.isArray(equipments) ? equipments : (equipments as any)?.data || [];
		const statusList = Array.isArray(statuses) ? statuses : (statuses as any)?.data || [];

		const templateMap = new Map(templateList.map((t: any) => [t.id, t.task_name]));
		const eqMap = new Map(eqList.map((e: any) => [e.id, e.name]));
		const statusMap = new Map(statusList.map((s: any) => [s.id, (s.name || '').toLowerCase()]));

		return trackers
			.filter((t: any) => String(statusMap.get(t.status_id) || '') !== 'completed')
			.map((t: any) => ({
				id: t.id,
				equipmentId: t.equipment_id,
				equipmentName: eqMap.get(t.equipment_id) || '',
				taskName: templateMap.get(t.pm_task_template_id) || 'Tugas PM',
				dueDate: t.due_date,
				overdue: Boolean(t.due_date && t.due_date < today)
			}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

function addDays(dateStr: string, days: number) {
	const d = new Date(dateStr + 'T00:00:00');
	d.setDate(d.getDate() + days);
	return d.toISOString().split('T')[0];
}

export async function completePmTask(
	dueTrackerId: string,
	payload: { doneDate: string; hoursmeter?: number | null }
) {
	try {
		const tracker: any = await directus.request(readItem('pm_due_tracker', dueTrackerId));
		const template: any = tracker.pm_task_template_id
			? await directus.request(readItem('pm_task_template', tracker.pm_task_template_id))
			: null;

		const completedId = await resolvePmStatusId('Completed');

		const nextDueHoursmeter =
			template?.interval_value_primary && payload.hoursmeter != null
				? Number(payload.hoursmeter) + Number(template.interval_value_primary)
				: tracker.due_hoursmeter;

		const nextDueDate = template?.interval_value_secondary
			? addDays(payload.doneDate, Number(template.interval_value_secondary))
			: tracker.due_date;

		return await directus.request(
			updateItem('pm_due_tracker', dueTrackerId, {
				status_id: completedId,
				last_done_date: payload.doneDate,
				last_done_hoursmeter: payload.hoursmeter ?? tracker.last_done_hoursmeter,
				due_date: nextDueDate,
				due_hoursmeter: nextDueHoursmeter
			})
		);
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}

export async function getEquipmentCategoriesMap(categoryIds: string[]): Promise<Record<string, string>> {
	if (!categoryIds.length) return {};
	try {
		const categories = (await directus.request(
			readItems('category', { filter: { id: { _in: categoryIds } }, limit: -1 })
		)) as any[];
		const map: Record<string, string> = {};
		for (const c of categories) {
			map[c.id] = c.name;
		}
		return map;
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

// B4 Fase 4 restrukturisasi navigasi Lapangan (5 Agustus 2026): riwayat all-time per equipment
// (WO + P2H + Tiket + PM terakhir), digabung dari 4 koleksi terpisah -- tidak ada satu koleksi
// log terpadu yang scoped per equipment_id (maintenance_activity_log itu general CRUD audit
// trail keyed per entity_type+entity_id, bukan per equipment, jadi tidak dipakai di sini).
export interface EquipmentTimelineEntry {
	type: 'wo' | 'p2h' | 'ticket' | 'pm';
	date: string | null;
	title: string;
	subtitle: string | null;
	id: string;
}

export async function getEquipmentTimeline(equipmentId: string): Promise<EquipmentTimelineEntry[]> {
	try {
		const [workOrdersRaw, p2hSessionsRaw, ticketsRaw, pmTrackersRaw] = await Promise.all([
			directus.request(
				readItems('work_order', {
					filter: { equipment_id: { _eq: equipmentId } },
					fields: ['id', 'keluhan', 'order_status', 'tanggal_rusak', 'tanggal_done'],
					sort: ['-tanggal_rusak'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('p2h_session', {
					filter: { equipment_id: { _eq: equipmentId } },
					fields: ['id', 'date', 'status_unit'],
					sort: ['-date'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('maint_tickets', {
					filter: { equipment_id: { _eq: equipmentId } },
					fields: ['id', 'masalah', 'status', 'tanggal_lapor'],
					sort: ['-tanggal_lapor'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('pm_due_tracker', {
					filter: { equipment_id: { _eq: equipmentId }, last_done_date: { _nnull: true } },
					fields: ['id', 'last_done_date', 'pm_task_template_id'],
					sort: ['-last_done_date'],
					limit: -1
				})
			) as Promise<any[]>
		]);

		const workOrders = Array.isArray(workOrdersRaw) ? workOrdersRaw : (workOrdersRaw as any)?.data || [];
		const p2hSessions = Array.isArray(p2hSessionsRaw) ? p2hSessionsRaw : (p2hSessionsRaw as any)?.data || [];
		const tickets = Array.isArray(ticketsRaw) ? ticketsRaw : (ticketsRaw as any)?.data || [];
		const pmTrackers = Array.isArray(pmTrackersRaw) ? pmTrackersRaw : (pmTrackersRaw as any)?.data || [];

		const pmTemplateIds = [...new Set(pmTrackers.map((p: any) => p.pm_task_template_id).filter(Boolean))];
		const pmTemplates = pmTemplateIds.length
			? ((await directus.request(readItems('pm_task_template', { filter: { id: { _in: pmTemplateIds } }, fields: ['id', 'task_name'], limit: -1 }))) as any[])
			: [];
		const pmTemplateList = Array.isArray(pmTemplates) ? pmTemplates : (pmTemplates as any)?.data || [];
		const pmTemplateMap = new Map(pmTemplateList.map((t: any) => [t.id, t.task_name]));

		const entries: EquipmentTimelineEntry[] = [
			...workOrders.map((w: any) => ({
				type: 'wo' as const,
				date: w.tanggal_done || w.tanggal_rusak,
				title: `WO: ${w.keluhan || '(tanpa keterangan)'}`,
				subtitle: w.tanggal_done ? 'Selesai' : 'Dalam proses',
				id: w.id
			})),
			...p2hSessions.map((s: any) => ({
				type: 'p2h' as const,
				date: s.date,
				title: 'P2H Harian',
				subtitle: s.status_unit === 'baik' ? 'Baik / Siap Digunakan' : s.status_unit === 'dilarang' ? 'Dilarang Digunakan' : s.status_unit === 'perlu_periksa' ? 'Perlu Diperiksa Maintenance' : null,
				id: s.id
			})),
			...tickets.map((t: any) => ({
				type: 'ticket' as const,
				date: t.tanggal_lapor,
				title: `Tiket: ${t.masalah || '(tanpa keterangan)'}`,
				subtitle: t.status,
				id: t.id
			})),
			...pmTrackers.map((p: any) => ({
				type: 'pm' as const,
				date: p.last_done_date,
				title: `PM: ${pmTemplateMap.get(p.pm_task_template_id) || 'Tugas PM'}`,
				subtitle: 'Selesai',
				id: p.id
			}))
		];

		return entries
			.filter((e) => e.date)
			.sort((a, b) => (a.date! < b.date! ? 1 : -1));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Fase 3 MLE (10 Agu 2026) — Quick Log HM, lewat endpoint server (butuh auth Firebase + PATCH equipment). */
export async function submitQuickHM(
	equipmentId: string,
	hoursmeter: number,
	notes?: string
): Promise<{ success: boolean; previousHM: number | null; newHM: number }> {
	const { getIdToken } = await import('./secureDirectus');
	const token = await getIdToken();
	const res = await fetch('/api/preventive/quick-hm', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ equipment_id: equipmentId, hoursmeter, notes })
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.message || `Gagal menyimpan HM (${res.status})`);
	return data;
}

export async function logActivity(entry: {
	user_name: string;
	action: string;
	entity_type: string;
	entity_id: string | number;
	summary: string;
	metadata?: Record<string, any>;
}) {
	try {
		await directus.request(createItem('maintenance_activity_log', entry));
	} catch (error) {
		console.error('Gagal mencatat activity log:', error);
	}
}
