// src/lib/server/gaRequestSubmit.ts
// SERVER-ONLY. Submit GA Service Request (ATK/RTK/perbaikan/kendaraan/ruangan)
// dari dashboard lapangan (project-epi) -- GA Service Request Portal, item #1
// rekomendasi "Dashboard Lapangan" di implementation_plan_panduan hrd.md.
//
// project-epi dan erp-epi-1 berbagi SATU Directus instance yang sama
// (lihat directus.ts) -- jadi submission menulis LANGSUNG ke koleksi ga_request
// + approval_requests, bukan lewat panggilan HTTP cross-app. Kembar dari
// erp-epi-1/src/lib/services/gaRequestApi.js::createGaRequest (tanpa
// integrasi Finance/analitik -- itu wewenang admin GA di erp-epi-1).

import { directusServerJson } from './directus';
import { createApprovalRequest } from './approvalSubmit';

// Sama persis SLA_HOURS di erp-epi-1/gaRequestApi.js -- jaga konsisten lintas app.
const SLA_HOURS: Record<string, number> = { kritis: 4, tinggi: 24, sedang: 72, rendah: 168 };

export const JENIS_OPTIONS = [
	{ value: 'atk', label: 'ATK' },
	{ value: 'rtk', label: 'RTK' },
	{ value: 'perbaikan', label: 'Perbaikan' },
	{ value: 'kendaraan', label: 'Kendaraan' },
	{ value: 'ruangan', label: 'Ruangan' },
	{ value: 'lainnya', label: 'Lainnya' }
];

export const PRIORITAS_OPTIONS = [
	{ value: 'rendah', label: 'Rendah' },
	{ value: 'sedang', label: 'Sedang' },
	{ value: 'tinggi', label: 'Tinggi' },
	{ value: 'kritis', label: 'Kritis' }
];

export interface CreateGaFieldRequestInput {
	requesterId: number;
	requesterName: string;
	divisi?: string | null;
	jenis: string;
	deskripsi: string;
	lokasi?: string | null;
	prioritas?: string;
	tanggalBooking?: string | null;
	jamMulai?: string | null;
	jamSelesai?: string | null;
}

export async function createGaFieldRequest({
	requesterId,
	requesterName,
	divisi = null,
	jenis,
	deskripsi,
	lokasi = null,
	prioritas = 'sedang',
	tanggalBooking = null,
	jamMulai = null,
	jamSelesai = null
}: CreateGaFieldRequestInput) {
	if (!requesterId) throw new Error('requesterId wajib diisi');
	if (!jenis) throw new Error('jenis permintaan wajib diisi');
	if (!deskripsi || !deskripsi.trim()) throw new Error('Deskripsi permintaan wajib diisi');
	if (jenis === 'ruangan' && !tanggalBooking) {
		throw new Error('Tanggal booking wajib diisi untuk permintaan ruangan');
	}

	const slaHours = SLA_HOURS[prioritas] || SLA_HOURS.sedang;
	const slaDue = new Date(Date.now() + slaHours * 3600000).toISOString();

	const created: any = await directusServerJson('/items/ga_request', {
		method: 'POST',
		body: JSON.stringify({
			jenis,
			pemohon_id: requesterId,
			divisi: divisi || null,
			deskripsi: deskripsi.trim(),
			catatan: lokasi ? `Lokasi: ${lokasi.trim()}` : null,
			prioritas,
			sla_due: slaDue,
			status: 'baru',
			tanggal_booking: jenis === 'ruangan' ? tanggalBooking : null,
			jam_mulai: jenis === 'ruangan' ? jamMulai : null,
			jam_selesai: jenis === 'ruangan' ? jamSelesai : null
		})
	});
	const data = created?.data;
	if (!data?.id) throw new Error('Gagal membuat permintaan GA');

	// Best-effort: daftarkan ke Approval Center Terpadu (module_key 'ga.request'),
	// sama persis pola gaRequestApi.js (erp-epi-1). departmentKey='HRD' (bukan 'GA')
	// -- lihat approvalSubmit.ts / catatan approval_matrix ga.request per audit 16 Agu:
	// approver GA saat ini (Yasinta Setiawati, HR Supervisor) tercatat divisi='HRD'.
	try {
		await createApprovalRequest({
			moduleKey: 'ga.request',
			sourceCollection: 'ga_request',
			sourceId: data.id,
			title: `Permintaan GA #${data.id} — ${jenis}`,
			summary: deskripsi.trim(),
			departmentKey: 'HRD',
			requesterId
		});
	} catch (e: any) {
		console.warn('[gaRequestSubmit] Gagal mengajukan approval permintaan GA:', e?.message || e);
	}

	return data;
}

/** Daftar "Permintaan Saya" (GA Service Request) milik satu karyawan.
 *  Menggunakan separated fetching untuk relasi karyawan (assigned_to & pemohon_id)
 *  agar mematuhi arsitektur Directus terpisah dan mencegah error 403.
 */
export async function listMyGaRequests(requesterId: number) {
	const res: any = await directusServerJson(
		`/items/ga_request?filter[pemohon_id][_eq]=${requesterId}&sort=-date_created&limit=150&fields=*`
	);
	const items = res?.data || [];
	if (items.length === 0) return [];

	// Kumpulkan ID karyawan untuk relasi assigned_to & pemohon_id
	const employeeIds = new Set<number>();
	for (const it of items) {
		if (it.assigned_to && typeof it.assigned_to === 'number') employeeIds.add(it.assigned_to);
		else if (it.assigned_to && typeof it.assigned_to === 'object' && it.assigned_to.id) employeeIds.add(it.assigned_to.id);

		if (it.pemohon_id && typeof it.pemohon_id === 'number') employeeIds.add(it.pemohon_id);
		else if (it.pemohon_id && typeof it.pemohon_id === 'object' && it.pemohon_id.id) employeeIds.add(it.pemohon_id.id);
	}

	const empMap = new Map<number, any>();
	if (employeeIds.size > 0) {
		try {
			const empRes: any = await directusServerJson(
				`/items/karyawan?filter[id][_in]=${Array.from(employeeIds).join(',')}&fields=id,nama_karyawan,divisi`
			);
			const emps = empRes?.data || [];
			for (const e of emps) {
				empMap.set(e.id, e);
			}
		} catch (err) {
			console.warn('[listMyGaRequests] Gagal memuat relasi karyawan:', err);
		}
	}

	return items.map((r: any) => {
		const assignedId = typeof r.assigned_to === 'object' ? r.assigned_to?.id : r.assigned_to;
		const pemohonId = typeof r.pemohon_id === 'object' ? r.pemohon_id?.id : r.pemohon_id;
		const assignedEmp = assignedId ? empMap.get(assignedId) : null;
		const pemohonEmp = pemohonId ? empMap.get(pemohonId) : null;

		let lokasi = null;
		if (r.catatan && r.catatan.includes('Lokasi:')) {
			const match = r.catatan.match(/Lokasi:\s*([^|\n]+)/i);
			if (match) lokasi = match[1].trim();
		}

		return {
			...r,
			lokasi: lokasi || r.lokasi || null,
			assigned_to: assignedEmp ? { id: assignedEmp.id, nama_karyawan: assignedEmp.nama_karyawan, divisi: assignedEmp.divisi } : (assignedId || null),
			assigned_to_nama: assignedEmp?.nama_karyawan || null,
			pemohon_nama: pemohonEmp?.nama_karyawan || null
		};
	});
}

/** Batalkan permintaan GA milik user jika status masih 'baru'. */
export async function cancelMyGaRequest(requestId: number, requesterId: number) {
	if (!requestId) throw new Error('requestId wajib diisi');
	const check: any = await directusServerJson(`/items/ga_request/${requestId}?fields=id,pemohon_id,status`);
	const row = check?.data;
	if (!row) throw new Error('Permintaan tidak ditemukan');
	const pemohon = typeof row.pemohon_id === 'object' ? row.pemohon_id?.id : row.pemohon_id;
	if (pemohon !== requesterId) {
		throw new Error('Anda tidak memiliki izin membatalkan permintaan ini');
	}
	if (row.status !== 'baru') {
		throw new Error(`Permintaan tidak dapat dibatalkan karena sudah berstatus ${row.status}`);
	}

	const updated: any = await directusServerJson(`/items/ga_request/${requestId}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'ditolak', catatan: 'Dibatalkan oleh pemohon' })
	});
	return updated?.data;
}
