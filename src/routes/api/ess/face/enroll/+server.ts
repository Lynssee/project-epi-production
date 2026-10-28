// src/routes/api/ess/face/enroll/+server.ts
// ESS HRD v3 Fase 1 — admin/HRD mendaftarkan wajah karyawan (consent UU PDP wajib).
// Digerbangi permission 'admin_panel' (belum ada FeatureKey khusus HRD enrollment —
// lihat src/lib/constants/permissions.ts; tambah key baru bila lingkup diperluas nanti).

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { enrollFace } from '$lib/server/ess/faceVerify';

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);

	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId);
	if (!hasAnyPermission(permissions, 'admin_panel')) {
		throw error(403, 'Tidak punya izin mendaftarkan wajah karyawan.');
	}

	const form = await event.request.formData();
	const karyawanId = Number(form.get('karyawan_id'));
	const consent = form.get('consent') === 'true' || form.get('consent') === '1';

	// FITUR-8 (multi-angle enrollment): 'foto' (depan, wajib) + opsional 'foto_kiri'/'foto_kanan'.
	// Backward-compatible — request lama yang cuma kirim 'foto' tetap jalan (1 baris tersimpan).
	const fotoDepan = form.get('foto');
	const fotoKiri = form.get('foto_kiri');
	const fotoKanan = form.get('foto_kanan');

	if (!Number.isFinite(karyawanId) || karyawanId <= 0) {
		throw error(400, 'karyawan_id tidak valid.');
	}
	if (!(fotoDepan instanceof File) || fotoDepan.size === 0) {
		throw error(400, 'Foto referensi wajah (depan) wajib diunggah.');
	}
	if (!consent) {
		throw error(400, 'Consent karyawan wajib disetujui sebelum enrollment wajah (UU PDP).');
	}

	const fotos: Array<{ file: File; sudut: 'depan' | 'kiri' | 'kanan' }> = [{ file: fotoDepan, sudut: 'depan' }];
	if (fotoKiri instanceof File && fotoKiri.size > 0) fotos.push({ file: fotoKiri, sudut: 'kiri' });
	if (fotoKanan instanceof File && fotoKanan.size > 0) fotos.push({ file: fotoKanan, sudut: 'kanan' });

	try {
		const result = await enrollFace({ karyawanId, fotos, enrolledBy: user.localId, consent });
		return json({ ids: result.ids });
	} catch (e: any) {
		throw error(502, e?.message || 'Gagal mendaftarkan wajah.');
	}
}
