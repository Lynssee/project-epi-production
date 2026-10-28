// src/lib/server/ess/absensiLemburBridge.ts
// Jembatan P3: menyambungkan persetujuan pengajuan ess_lembur ke absensi_lembur —
// satu-satunya koleksi yang benar-benar dibaca payroll (lihat payrollSync.js di erp-epi-1).
// Tanpa jembatan ini, lembur yang disetujui tidak pernah masuk slip gaji.

import { directusServerJson } from '$lib/server/directus';
import type { LemburRecord } from '$lib/server/ess/lembur';

interface AbsensiLemburRef {
	id: number;
	status: string;
}

async function findBridgeRecord(lemburId: string): Promise<AbsensiLemburRef | null> {
	const query = new URLSearchParams({
		'filter[lembur_id][_eq]': lemburId,
		fields: 'id,status',
		limit: '1'
	});
	const result = await directusServerJson<{ data: AbsensiLemburRef[] }>(
		`/items/absensi_lembur?${query.toString()}`
	);
	return result?.data?.[0] || null;
}

/**
 * Dipanggil saat ess_lembur disetujui. Idempoten — approve ulang tidak menggandakan.
 * Bila record bridge sebelumnya diarsipkan (mis. setelah reject-ulang), diaktifkan kembali
 * ke published alih-alih membuat duplikat baru.
 */
export async function syncApprovedLemburToAbsensi(target: LemburRecord): Promise<void> {
	const existing = await findBridgeRecord(target.id);

	const payload = {
		lembur_id: target.id,
		karyawan_id: Number(target.karyawan_id),
		tanggal: target.tanggal,
		jam_masuk: target.jam_mulai,
		jam_keluar: target.jam_selesai,
		durasi_jam: target.durasi_jam ?? 0,
		keterangan: target.alasan,
		status: 'published',
		lokasi: 'Proyek',
		device_info: 'ess_lembur_bridge'
	};

	if (existing) {
		if (existing.status === 'published') return; // sudah tersinkron, tidak perlu apa-apa
		await directusServerJson(`/items/absensi_lembur/${existing.id}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});
		return;
	}

	await directusServerJson('/items/absensi_lembur', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
}

/**
 * Dipanggil saat approval ess_lembur ditarik/dibatalkan (reject setelah sempat disetujui).
 * Mengarsipkan (bukan menghapus) record bridge supaya jejak audit tetap ada, tapi
 * payrollSync.js (yang hanya baca status=published) berhenti menghitungnya.
 */
export async function retractBridgeRecord(lemburId: string): Promise<void> {
	const existing = await findBridgeRecord(lemburId);
	if (!existing || existing.status === 'archived') return;

	await directusServerJson(`/items/absensi_lembur/${existing.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'archived' })
	});
}
