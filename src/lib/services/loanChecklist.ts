import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, uploadFiles } from '@directus/sdk';
import { todayWib } from '$lib/utils/wibDate';

// Port dari erp-epi-1/src/lib/services/equipmentLoanApi.js + loanChecklistApi.js —
// dua repo tidak berbagi lib, jadi logic loan-checklist di-reimplement di sini
// memakai konvensi Directus SDK milik project-epi (lihat maintenance.ts). Penulisan
// (submitLoanChecklist) dipindah ke /api/preventive/loan-checklist/submit — lihat
// fungsi di bawah.

export const LOAN_STATUS = {
	DIAJUKAN: '01e8fc3e-7812-48d9-9342-96c021de316b',
	DISETUJUI: '557e5cd2-1e16-438d-95a9-fbe9b38f08a1',
	AKTIF: '8d23640e-5726-4480-a9fb-693e3ea6c8fa',
	DIKEMBALIKAN: 'ab75b88f-1191-47bd-9725-903da4a1c3f3'
};

export interface LoanChecklistItem {
	label: string;
	is_critical?: boolean;
	status: 'ok' | 'tidak' | 'na' | null;
	catatan?: string;
}

export type LoanSource = 'internal_loan_log' | 'peminjaman_internal';

export interface LoanRow {
	id: string;
	equipment_id: string;
	project_id: number | null;
	pic_id: number | null;
	borrower_id: string | null;
	approved_by_id: string | null;
	status: string;
	checklist_policy: boolean;
	kondisi_awal_id: string | null;
	kondisi_akhir_id: string | null;
	start_date: string;
	end_date_planned: string | null;
	purpose: string;
	equipment?: { id: string; name: string; code: string; ownership_type?: string; owner_name?: string | null } | null;
	ownership_type?: string;
	owner_name?: string | null;
	/** Fase 3 (15 Sep 2026) — default 'internal_loan_log' (BR-01, legacy) bila tidak diisi. */
	source?: LoanSource;
}

// ==========================================
// TUGAS PEMINJAM — "Alat Pinjaman Saya"
// ==========================================

// ==========================================
// AUDIT FASE 0 — registrasi penempatan (GA/maintenance jalan ke lapangan)
// ==========================================

/** Peta equipment_id -> loan AKTIF (kalau ada) untuk daftar unit yang perlu diaudit. */
export async function fetchActiveLoanMapForEquipment(equipmentIds: string[]): Promise<Record<string, LoanRow>> {
	if (!equipmentIds.length) return {};
	try {
		const rows = (await directus.request(
			readItems('internal_loan_log', {
				filter: { equipment_id: { _in: equipmentIds }, status: { _eq: LOAN_STATUS.AKTIF } },
				fields: ['*', 'project_id.id', 'project_id.name', 'pic_id.id', 'pic_id.nama_karyawan'],
				limit: -1
			})
		)) as any[];
		const map: Record<string, LoanRow> = {};
		for (const r of rows) {
			const eqId = typeof r.equipment_id === 'object' ? r.equipment_id?.id : r.equipment_id;
			if (eqId) map[eqId] = r;
		}
		return map;
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

/**
 * Registrasi cepat hasil audit fisik Fase 0: catat compressor X sedang di proyek Y,
 * PIC Z. Ditulis langsung (bukan lewat endpoint atomik) karena ini satu baris admin
 * entry, bukan alur lapangan multi-langkah seperti P2H/checklist peminjaman.
 */
export async function registerCompressorPlacement(params: {
	equipmentId: string;
	projectId: number;
	picId: number;
	catatan?: string;
}): Promise<LoanRow> {
	const today = todayWib();
	return (await directus.request(
		createItem('internal_loan_log', {
			equipment_id: params.equipmentId,
			project_id: params.projectId,
			pic_id: params.picId,
			status: LOAN_STATUS.AKTIF,
			requested_date: today,
			start_date: today,
			checklist_policy: true,
			source: 'manual',
			purpose: params.catatan || 'Registrasi audit fisik Fase 0 (PM Compressor)'
		})
	)) as LoanRow;
}

/**
 * Fase 8 (Revamp Project Management v2 tambahan, 3 Agu 2026): loan yang dibuat otomatis dari
 * pengiriman SJ packing list (erp-epi-1::syncEquipmentInventoryFromDelivery) tapi masih status
 * 'Diajukan' — belum aktif karena PIC belum mengisi checklist serah-terima. Ditampilkan terpisah
 * & menonjol di "Alat Pinjaman Saya" karena ini yang digate wajib sebelum Goods Received proyek
 * bisa dikonfirmasi (lihat project-epi::assertEquipmentChecklistGate).
 */
export async function fetchLoansAwaitingSerahTerima(karyawanId: number): Promise<LoanRow[]> {
	try {
		const rows = (await directus.request(
			readItems('internal_loan_log', {
				filter: { pic_id: { _eq: karyawanId }, status: { _eq: LOAN_STATUS.DIAJUKAN } },
				fields: ['*', 'equipment_id.id', 'equipment_id.name', 'equipment_id.code', 'project_id.id', 'project_id.name'],
				sort: ['-start_date'],
				limit: -1
			})
		)) as any[];

		return rows.map((r) => ({
			...r,
			equipment: r.equipment_id && typeof r.equipment_id === 'object' ? r.equipment_id : null,
			equipment_id: r.equipment_id?.id || r.equipment_id
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * §7 rekomendasi L4 — alat proyek yang masih tercatat keluar (belum end_date_actual),
 * dipakai form retur (/packing-list/return) untuk menawarkan "ikut sertakan dalam
 * dokumen retur ini" bersama material. Filter end_date_actual (bukan status AKTIF)
 * supaya konsisten dengan agregator erp-epi (assetReconciliation.js, returGudangApi).
 */
export async function fetchActiveLoansForProject(projectId: number): Promise<LoanRow[]> {
	if (!projectId) return [];
	try {
		const rows = (await directus.request(
			readItems('internal_loan_log', {
				filter: { project_id: { _eq: projectId }, end_date_actual: { _null: true } },
				fields: [
					'id',
					'equipment_id.id',
					'equipment_id.name',
					'equipment_id.code',
					'equipment_id.ownership_type',
					'equipment_id.owner_name',
					'ownership_type',
					'owner_name',
					'start_date',
					'end_date_planned',
					'purpose'
				],
				sort: ['-start_date'],
				limit: -1
			})
		)) as any[];

		return rows.map((r) => ({
			...r,
			equipment: r.equipment_id && typeof r.equipment_id === 'object' ? r.equipment_id : null,
			equipment_id: r.equipment_id?.id || r.equipment_id,
			ownership_type: r.ownership_type || r.equipment_id?.ownership_type || 'eltama',
			owner_name: r.owner_name || r.equipment_id?.owner_name || null
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function fetchActiveLoansForKaryawan(karyawanId: number): Promise<LoanRow[]> {
	try {
		const rows = (await directus.request(
			readItems('internal_loan_log', {
				filter: { pic_id: { _eq: karyawanId }, status: { _eq: LOAN_STATUS.AKTIF } },
				fields: ['*', 'equipment_id.id', 'equipment_id.name', 'equipment_id.code', 'equipment_id.ownership_type', 'equipment_id.owner_name'],
				sort: ['-start_date'],
				limit: -1
			})
		)) as any[];

		return rows.map((r) => ({
			...r,
			equipment: r.equipment_id && typeof r.equipment_id === 'object' ? r.equipment_id : null,
			equipment_id: r.equipment_id?.id || r.equipment_id,
			ownership_type: r.ownership_type || r.equipment_id?.ownership_type || 'eltama',
			owner_name: r.owner_name || r.equipment_id?.owner_name || null
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

// ==========================================
// FASE 3 (port BR-01 -> peminjaman_internal, 15 Sep 2026)
// ==========================================

/**
 * Detail satu peminjaman_internal untuk layar checklist harian — server-side (GET
 * .../peminjaman-internal/[id]), sama alasan dengan fetchActivePeminjamanInternalForKaryawan.
 */
export async function fetchPeminjamanInternalDetail(
	loanId: string
): Promise<{ id: string; equipment_id: string; equipment: { id: string; name: string; code: string }; status: string } | null> {
	try {
		const { auth } = await import('$lib/firebase');
		const user = auth.currentUser;
		if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
		const idToken = await user.getIdToken();
		const res = await fetch(`/api/preventive/loan-checklist/peminjaman-internal/${loanId}`, {
			headers: { Authorization: `Bearer ${idToken}` }
		});
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			throw new Error(data?.message || `Gagal memuat peminjaman (${res.status})`);
		}
		const body = await res.json();
		return body?.data || null;
	} catch (error) {
		console.warn('[loanChecklist] fetchPeminjamanInternalDetail error:', error);
		throw error;
	}
}

/**
 * Peminjaman equipment aktif (status dipinjam/overdue) dari jalur peminjaman_internal
 * (erp-epi-1), hanya yang kategorinya termasuk equipment wajib-P2H (kompresor/alat
 * berat/kendaraan/mesin produksi). Melengkapi fetchActiveLoansForKaryawan() (BR-01,
 * legacy) di halaman "Alat Pinjaman Saya" — dua sumber, satu daftar.
 *
 * Server-side (GET /api/preventive/loan-checklist/peminjaman-internal), BUKAN
 * directus.request() langsung: role Directus lapangan tidak diberi akses baca langsung
 * ke peminjaman_internal (koleksi itu hanya pernah disentuh lewat endpoint /api/sji/* di
 * project-epi — lihat loanGuard.ts). Karyawan ditentukan dari token, bukan dari parameter,
 * supaya tidak bisa diminta atas nama orang lain.
 */
export async function fetchActivePeminjamanInternalForKaryawan(): Promise<LoanRow[]> {
	try {
		const { auth } = await import('$lib/firebase');
		const user = auth.currentUser;
		if (!user) return [];
		const idToken = await user.getIdToken();
		const res = await fetch('/api/preventive/loan-checklist/peminjaman-internal', {
			headers: { Authorization: `Bearer ${idToken}` }
		});
		if (!res.ok) return [];
		const body = await res.json();
		const rows: any[] = body?.data || [];
		return rows.map((row) => ({
			id: row.id,
			equipment_id: row.equipment_id,
			project_id: null,
			pic_id: null,
			borrower_id: null,
			approved_by_id: null,
			status: row.status,
			checklist_policy: true,
			kondisi_awal_id: null,
			kondisi_akhir_id: null,
			start_date: row.start_date,
			end_date_planned: row.end_date_planned,
			purpose: row.purpose || '',
			equipment: row.equipment,
			source: 'peminjaman_internal' as const
		}));
	} catch (error) {
		console.warn('[loanChecklist] fetchActivePeminjamanInternalForKaryawan error:', error);
		return [];
	}
}

export async function hasTodayDailyChecklist(loanId: string, source: LoanSource = 'internal_loan_log'): Promise<boolean> {
	const fkField = source === 'peminjaman_internal' ? 'peminjaman_internal_id' : 'loan_id';
	try {
		const today = todayWib();
		const rows = (await directus.request(
			readItems('equipment_loan_checklist', {
				filter: { [fkField]: { _eq: loanId }, jenis: { _eq: 'harian' }, tanggal: { _eq: today } },
				fields: ['id'],
				limit: 1
			})
		)) as any[];
		return rows.length > 0;
	} catch (error) {
		console.warn('[loanChecklist] hasTodayDailyChecklist error:', error);
		return false;
	}
}

// ==========================================
// TEMPLATE RESOLUTION
// ==========================================

const GENERIC_CHECKLIST_ITEMS: LoanChecklistItem[] = [
	{ label: 'Kondisi fisik alat (tidak retak/penyok/berkarat)', status: null },
	{ label: 'Kelengkapan aksesoris/sparepart', status: null },
	{ label: 'Alat berfungsi normal saat dites', status: null },
	{ label: 'Kebersihan alat', status: null }
];

export async function resolveChecklistTemplate(equipmentId: string): Promise<{ template_ref: string; items: LoanChecklistItem[] }> {
	try {
		const eq = (await directus.request(readItem('equipment', equipmentId, { fields: ['id', 'category_id'] }))) as any;
		if (eq?.category_id) {
			const templates = (await directus.request(
				readItems('p2h_template', {
					filter: { equipment_category_id: { _eq: eq.category_id } },
					sort: ['sort', 'item_name'],
					limit: -1
				})
			)) as any[];
			if (templates.length > 0) {
				return {
					template_ref: `p2h:${eq.category_id}`,
					items: templates.map((t) => ({ label: t.item_name, is_critical: !!t.is_critical, status: null, catatan: '' }))
				};
			}
		}
	} catch (error) {
		console.warn('[loanChecklist] resolveChecklistTemplate fallback to generic:', error);
	}
	return { template_ref: 'generik', items: GENERIC_CHECKLIST_ITEMS.map((i) => ({ ...i })) };
}

// ==========================================
// UPLOAD
// ==========================================

export async function uploadChecklistPhoto(file: File): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('description', 'equipment_loan_checklist:foto');
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * §7 rekomendasi L3 — hasil checklist TERAKHIR untuk satu pinjaman (default jenis
 * 'harian'/P2H), dipakai sebagai ACUAN KONDISI saat leader mengisi checklist 'kembali'
 * (mencegah sengketa "alat sudah rusak dari awal" vs "rusak pas dipakai proyek").
 * Read-only, tidak memengaruhi pengisian checklist baru.
 */
export async function fetchLastChecklist(
	loanId: string,
	jenis: 'serah_terima' | 'harian' | 'kembali' = 'harian'
): Promise<{ tanggal: string; items: LoanChecklistItem[]; foto?: string[] } | null> {
	try {
		const rows = (await directus.request(
			readItems('equipment_loan_checklist', {
				filter: { loan_id: { _eq: loanId }, jenis: { _eq: jenis } },
				fields: ['tanggal', 'items', 'foto', 'date_created'],
				sort: ['-date_created'],
				limit: 1
			})
		)) as any[];
		const row = rows?.[0];
		if (!row) return null;
		return { tanggal: row.tanggal || row.date_created, items: row.items || [], foto: row.foto || [] };
	} catch (error) {
		console.warn('[loanChecklist] fetchLastChecklist gagal, dilewati (bukan blocking):', error);
		return null;
	}
}

// ==========================================
// SUBMIT CHECKLIST (serah_terima / harian / kembali)
// ==========================================

export interface SubmitChecklistParams {
	loan: LoanRow;
	jenis: 'serah_terima' | 'harian' | 'kembali';
	items: LoanChecklistItem[];
	foto?: string[];
	gps_lat?: number | null;
	gps_lng?: number | null;
	signature: string;
	pelaporName?: string;
}

/**
 * Fase 1 (audit B1/B6, 2026-07-17): submit lewat SATU request ke
 * /api/preventive/loan-checklist/submit (server yang mengurus checklist+BAST+update
 * status loan+auto-tiket secara atomik, dengan verifikasi PIC ownership) — bukan
 * beberapa directus.request() terpisah dari klien. Kalau jaringan HP putus, payload
 * diantre ke offlineQueue dan otomatis dikirim ulang saat online (sama seperti P2H).
 */
export async function submitLoanChecklist(
	params: SubmitChecklistParams
): Promise<{ queued: true } | { checklist: any; ticketCreated: boolean }> {
	const { auth } = await import('$lib/firebase');
	const { enqueue } = await import('$lib/utils/offlineQueue');

	const payload = {
		loan_id: params.loan.id,
		source: params.loan.source || 'internal_loan_log',
		jenis: params.jenis,
		items: params.items,
		foto: params.foto || [],
		gps_lat: params.gps_lat ?? null,
		gps_lng: params.gps_lng ?? null,
		signature: params.signature,
		pelaporName: params.pelaporName
	};
	const url = '/api/preventive/loan-checklist/submit';

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
	} catch (err) {
		if (err instanceof TypeError) {
			enqueue(url, 'POST', payload);
			return { queued: true };
		}
		throw err;
	}
}
