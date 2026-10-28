// src/routes/api/procurement/pembelian-lokal-proyek/+server.ts
// Submit reimburse Beli Lokal Proyek dari dashboard lapangan — lihat catatan lengkap
// di $lib/server/pembelianLokalProyekSubmit.ts. Approval tetap terpusat di erp-epi-1.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { createPembelianLokalProyek } from '$lib/server/pembelianLokalProyekSubmit';
import { directusServerJson } from '$lib/server/directus';

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);

	const body = await event.request.json().catch(() => ({}));
	const {
		projectId, tanggalBeli, budgetCategory, deskripsi, nominal, lokasiPembelian, buktiNota,
		modeDarurat, klasifikasiDarurat, alasanDarurat, vendorId, alasanTanpaVendor
	} = body;

	try {
		const result = await createPembelianLokalProyek({
			projectId: parseInt(projectId, 10) || null as any,
			pengajuKaryawanId: karyawan?.id || null,
			tanggalBeli,
			budgetCategory,
			deskripsi,
			nominal: parseFloat(nominal),
			lokasiPembelian,
			buktiNota,
			modeDarurat: modeDarurat === true || modeDarurat === 'true',
			klasifikasiDarurat: (klasifikasiDarurat || '').trim() || null,
			alasanDarurat: (alasanDarurat || '').trim() || null,
			vendorId: parseInt(vendorId, 10) || null,
			alasanTanpaVendor: (alasanTanpaVendor || '').trim() || null
		});
		return json({ success: true, id: result.id, paguWarning: result.paguWarning });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal mengajukan pembelian lokal');
	}
}

export async function GET(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan?.id) return json({ success: true, data: [] });

	const res: any = await directusServerJson(
		`/items/pembelian_lokal_proyek?filter[pengaju_karyawan_id][_eq]=${karyawan.id}&fields=*,project_id.name&sort=-date_created&limit=20`
	).catch(() => null);
	return json({ success: true, data: res?.data || [] });
}
