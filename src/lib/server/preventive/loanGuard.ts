// src/lib/server/preventive/loanGuard.ts
// Guard untuk /api/preventive/loan-checklist/*: verifikasi Firebase token, resolve
// karyawan, lalu pastikan karyawan ini benar-benar PIC dari loan_id yang diklaim —
// loan diambil ULANG dari Directus by ID (bukan percaya objek loan yang dikirim
// klien), supaya orang tidak bisa submit checklist atas peminjaman orang lain.

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail, type ServerKaryawan } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';

export interface ServerLoan {
	id: string;
	equipment_id: string;
	project_id: number | null;
	pic_id: number | null;
	borrower_id: string | null;
	approved_by_id: string | null;
	status: string;
	kondisi_awal_id: string | null;
}

export type LoanSource = 'internal_loan_log' | 'peminjaman_internal';

// Sama dengan ALL_EQUIPMENT_CATEGORY_IDS di erp-epi-1/maintenanceApi.js dan
// $lib/services/preventive.ts (klien) — dua repo/dua sisi (server vs klien) tidak
// berbagi modul, jadi konstanta ini SENGAJA diduplikasi. Jangan diubah di satu tempat
// tanpa menyamakan di tiga tempat lain.
const ALL_EQUIPMENT_CATEGORY_IDS = [
	'49225e15-e7c3-4d2e-86d8-f905ae450389', // Compressor Screw
	'9f97d7ad-89e6-4065-ab85-bd945c4cda70', // Compressor Piston
	'830f2020-6d4c-4758-8c6d-d6d807e6a09f', // Forklift Electric
	'7eaf3570-c578-496a-a851-e89bd9ea8dc6', // Forklift Diesel
	'5445ef6c-801c-438a-8c13-88314a5f2962', // Kendaraan Roda 2
	'51a0829e-99c0-4036-8418-73615c7b1220', // Kendaraan Roda 4
	'2c4c7ad2-956f-45ef-9f47-fc889eac4048', // Kendaraan Roda 6+
	'4f83bb40-9df5-484e-aae0-3225877e3571', // MOTOR
	'ea8b045b-dcb6-415b-843d-3035de12a1b3'  // MESIN (Mesin / Produksi)
];

export interface ServerEquipmentInfo {
	id: string;
	name: string;
	code: string;
	category_id: string | null;
}

/**
 * Resolve identitas_barang.id -> equipment record — logika PERSIS sama dengan
 * ensureEquipmentInEquipmentTable() di erp-epi-1/maintenanceApi.js (code = id_equipment
 * atau EQ-{id}, dicocokkan ke equipment.code/legacy_reference). Read-only: equipment
 * record sudah pasti ada, dibuat di sisi admin saat deliverPeminjaman().
 */
export async function resolveEquipmentFromItemServer(itemId: number | string): Promise<ServerEquipmentInfo | null> {
	try {
		const ibRes = await directusServerJson<{ data: { id: number; id_equipment: string | null } }>(
			`/items/identitas_barang/${itemId}?fields=id,id_equipment`
		);
		const ib = ibRes?.data;
		if (!ib) return null;
		const code = ib.id_equipment || `EQ-${ib.id}`;
		const eqRes = await directusServerJson<{ data: ServerEquipmentInfo[] }>(
			`/items/equipment?filter[_or][0][code][_eq]=${encodeURIComponent(code)}&filter[_or][1][legacy_reference][_eq]=${encodeURIComponent(code)}&limit=1&fields=id,name,code,category_id`
		);
		return eqRes?.data?.[0] || null;
	} catch {
		return null;
	}
}

async function resolveEquipmentIdFromItem(itemId: number | string): Promise<string | null> {
	const eq = await resolveEquipmentFromItemServer(itemId);
	return eq?.id || null;
}

/**
 * Fase 3 (port BR-01 -> peminjaman_internal, 15 Sep 2026) — verifikasi kepemilikan loan
 * dari SALAH SATU dari dua sumber. Loan tetap diambil ULANG dari Directus by ID (bukan
 * percaya objek yang dikirim klien) untuk kedua sumber, konsisten dengan pola lama.
 */
export async function authenticateLoanOwner(
	event: RequestEvent,
	loanId: string,
	source: LoanSource = 'internal_loan_log'
): Promise<{ karyawan: ServerKaryawan; loan: ServerLoan }> {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) {
		throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');
	}

	if (source === 'peminjaman_internal') {
		const res = await directusServerJson<{ data: any }>(`/items/peminjaman_internal/${loanId}`);
		const row = res?.data;
		if (!row) throw error(404, 'Peminjaman tidak ditemukan.');
		if (String(row.peminjam_id) !== String(karyawan.id)) {
			throw error(403, 'Anda bukan peminjam pada peminjaman ini.');
		}
		if (row.status !== 'dipinjam' && row.status !== 'overdue') {
			throw error(409, 'Peminjaman ini sudah tidak aktif (bukan status dipinjam).');
		}
		const equipmentId = await resolveEquipmentIdFromItem(row.item_id);
		if (!equipmentId) throw error(404, 'Unit equipment untuk peminjaman ini tidak ditemukan.');
		const loan: ServerLoan = {
			id: String(row.id),
			equipment_id: equipmentId,
			project_id: null,
			pic_id: row.peminjam_id,
			borrower_id: String(row.peminjam_id),
			approved_by_id: null,
			status: row.status,
			kondisi_awal_id: null
		};
		return { karyawan, loan };
	}

	const res = await directusServerJson<{ data: ServerLoan }>(`/items/internal_loan_log/${loanId}`);
	const loan = res?.data;
	if (!loan) throw error(404, 'Peminjaman tidak ditemukan.');
	if (String(loan.pic_id) !== String(karyawan.id)) {
		throw error(403, 'Anda bukan PIC peminjaman ini.');
	}
	return { karyawan, loan };
}

export interface PeminjamanInternalLoanRow {
	id: string;
	equipment_id: string;
	equipment: { id: string; name: string; code: string };
	status: string;
	start_date: string;
	end_date_planned: string | null;
	purpose: string;
}

/**
 * Peminjaman equipment aktif (status dipinjam/overdue) milik satu karyawan dari jalur
 * peminjaman_internal — HANYA yang kategorinya termasuk equipment wajib-P2H. Dipakai
 * endpoint GET .../peminjaman-internal (server-side, karena role Directus lapangan
 * tidak diberi akses baca langsung ke peminjaman_internal — lihat pola /api/sji/*).
 */
export async function fetchMyActivePeminjamanInternal(karyawanId: number): Promise<PeminjamanInternalLoanRow[]> {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/peminjaman_internal?filter[peminjam_id][_eq]=${karyawanId}&filter[status][_in]=dipinjam,overdue&fields=id,item_id,status,tanggal_pinjam,tanggal_jatuh_tempo,keperluan&limit=-1`
	);
	const rows = res?.data || [];
	if (!rows.length) return [];

	const withEquipment = await Promise.all(
		rows.map(async (r) => ({ row: r, equipment: await resolveEquipmentFromItemServer(r.item_id) }))
	);

	return withEquipment
		.filter(({ equipment }) => !!equipment?.category_id && ALL_EQUIPMENT_CATEGORY_IDS.includes(equipment.category_id))
		.map(({ row, equipment }) => ({
			id: String(row.id),
			equipment_id: equipment!.id,
			equipment: { id: equipment!.id, name: equipment!.name, code: equipment!.code },
			status: row.status,
			start_date: row.tanggal_pinjam,
			end_date_planned: row.tanggal_jatuh_tempo,
			purpose: row.keperluan || ''
		}));
}
