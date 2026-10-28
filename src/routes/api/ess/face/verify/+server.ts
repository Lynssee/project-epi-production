// src/routes/api/ess/face/verify/+server.ts
// ESS HRD v3 Fase 1 — verifikasi wajah karyawan sendiri (dipanggil langsung dari
// clock-in/clock-out di server; endpoint ini dipertahankan sebagai jalur standalone
// untuk konteks lain yang akan reuse verifikasi yang sama, mis. izin jam-jaman Fase 2 —
// lihat Modul 2 dokumen: "(opsional — face verify) → submit").
//
// Fail-safe, bukan fail-closed: selalu 200 dengan { passed: false } untuk kegagalan
// wajar (belum enroll, service down, match rendah) — caller yang memutuskan lanjut
// atau tidak, tidak pernah 5xx untuk kondisi tsb.

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { verifyFace, type FaceVerifyContext } from '$lib/server/ess/faceVerify';

const VALID_CONTEXTS = new Set<FaceVerifyContext>(['clock_in', 'clock_out', 'izin', 'kasbon']);

export async function POST(event: RequestEvent) {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	const foto = form.get('foto');
	const context = String(form.get('context') || '');
	const livenessPassed = form.get('liveness_passed') === 'true' || form.get('liveness_passed') === '1';
	const lokasiAbsensiId = form.get('lokasi_absensi_id')?.toString() || null;

	if (!(foto instanceof File) || foto.size === 0) {
		throw error(400, 'Foto capture wajib diambil.');
	}
	if (!VALID_CONTEXTS.has(context as FaceVerifyContext)) {
		throw error(400, 'context tidak valid.');
	}

	const result = await verifyFace({
		karyawanId: karyawan.id,
		foto,
		context: context as FaceVerifyContext,
		livenessPassed,
		ipAddress: event.getClientAddress(),
		deviceInfo: event.request.headers.get('user-agent') || '',
		lokasiAbsensiId
	});

	return json(result);
}
