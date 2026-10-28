// src/lib/server/ess/faceVerify.ts
// Face recognition Fase 1 — memanggil microservice self-hosted InsightFace
// (services/face-verify di erp-epi-1), app yang menulis Directus, embedding tidak
// pernah keluar ke cloud pihak ketiga (keputusan #2).
//
// Fail-safe, bukan fail-closed: verifyFace() TIDAK PERNAH throw untuk kegagalan wajar
// (microservice down, wajah belum enroll, match rendah) — semua itu ditulis ke
// face_verification_log dengan passed=false, supaya caller (clock-in/out) tetap bisa
// melanjutkan alur (pola sama seperti masuk_valid=false existing), HRD yang review.

import { env } from '$env/dynamic/private';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';

const FACE_SERVICE_URL = env.FACE_SERVICE_URL || 'http://localhost:8000';

export type FaceVerifyContext = 'clock_in' | 'clock_out' | 'izin' | 'kasbon' | 'break_in' | 'break_out';

export interface FaceVerificationResult {
	verificationId: string | null;
	passed: boolean;
	matchScore: number | null;
	livenessPassed: boolean;
}

interface ActiveFaceData {
	id: string;
	face_embedding: number[];
	version: number;
}

// FITUR-8 (Biometric Attendance Enhancement): enrollment multi-angle menyimpan hingga 3 baris
// (depan/kiri/kanan) berbagi `version` yang sama — "aktif" berarti seluruh baris pada version
// TERBARU milik karyawan itu, bukan cuma 1 baris. Enrollment lama (pra-fitur ini) tetap 1 baris,
// kode di bawah tetap jalan normal untuk itu (array berisi 1 elemen).
async function getActiveFaceDataSet(karyawanId: number): Promise<ActiveFaceData[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[status][_eq]': 'active',
		fields: 'id,face_embedding,version',
		sort: '-version',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: ActiveFaceData[] }>(`/items/karyawan_face_data?${query.toString()}`);
	const rows = result?.data || [];
	if (rows.length === 0) return [];
	const latestVersion = rows[0].version;
	return rows.filter((r) => r.version === latestVersion);
}

async function getLokasiFaceThreshold(lokasiAbsensiId: string | null): Promise<number | null> {
	if (!lokasiAbsensiId) return null;
	try {
		const result = await directusServerJson<{ data: { face_match_threshold: number | null } }>(
			`/items/lokasi_absensi/${lokasiAbsensiId}?fields=face_match_threshold`
		);
		return result?.data?.face_match_threshold ?? null;
	} catch {
		return null;
	}
}

export async function verifyFace(params: {
	karyawanId: number;
	foto: File;
	context: FaceVerifyContext;
	livenessPassed: boolean;
	ipAddress: string;
	deviceInfo: string;
	lokasiAbsensiId?: string | null;
}): Promise<FaceVerificationResult> {
	const { karyawanId, foto, context, livenessPassed, ipAddress, deviceInfo, lokasiAbsensiId } = params;

	let matchScore: number | null = null;
	let matchPassed = false;

	try {
		// FITUR-8: cocokkan terhadap SEMUA foto aktif (best-of-N dari sesi enrollment multi-angle
		// terbaru — 1-3 baris), bukan cuma 1 embedding. Ambil skor tertinggi.
		const activeSet = await getActiveFaceDataSet(karyawanId);
		const fotoBytes = await foto.arrayBuffer();
		for (const active of activeSet) {
			if (!Array.isArray(active.face_embedding) || active.face_embedding.length === 0) continue;
			const form = new FormData();
			form.append('foto', new Blob([fotoBytes]), 'capture.jpg');
			form.append('reference_embedding', JSON.stringify(active.face_embedding));
			const res = await fetch(`${FACE_SERVICE_URL}/verify`, { method: 'POST', body: form });
			if (res.ok) {
				const data = await res.json();
				const score = typeof data.match_score === 'number' ? data.match_score : null;
				if (score != null && (matchScore == null || score > matchScore)) {
					matchScore = score;
					matchPassed = Boolean(data.passed);
				}
			}
		}
		// FITUR-8: override keputusan passed/gagal microservice dengan threshold per-lokasi bila
		// dikonfigurasi — microservice sendiri TIDAK diubah (threshold globalnya tetap default),
		// keputusan akhir dibuat di sini supaya per-lokasi tanpa perlu restart microservice.
		const lokasiThreshold = await getLokasiFaceThreshold(lokasiAbsensiId ?? null);
		if (lokasiThreshold != null && matchScore != null) {
			matchPassed = matchScore >= lokasiThreshold;
		}
	} catch {
		// microservice down/unreachable — fail-safe, matchScore tetap null
	}

	let fotoCaptureId: string | null = null;
	try {
		const uploadForm = new FormData();
		uploadForm.append('file', foto, `face-verify-${context}-${karyawanId}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (uploadRes.ok) {
			const uploaded = await uploadRes.json();
			fotoCaptureId = uploaded?.data?.id || null;
		}
	} catch {
		// upload gagal — log tetap ditulis tanpa foto, jangan block alur absensi
	}

	let verificationId: string | null = null;
	try {
		const logResult = await directusServerJson<{ data: { id: string } }>('/items/face_verification_log', {
			method: 'POST',
			body: JSON.stringify({
				karyawan_id: String(karyawanId),
				context,
				liveness_passed: livenessPassed,
				match_score: matchScore,
				foto_capture: fotoCaptureId,
				ip_address: ipAddress,
				device_info: { user_agent: deviceInfo }
			})
		});
		verificationId = logResult?.data?.id || null;
	} catch {
		// gagal tulis log — jangan block absensi, verificationId tetap null
	}

	return { verificationId, passed: matchPassed && livenessPassed, matchScore, livenessPassed };
}

export type FaceAngle = 'depan' | 'kiri' | 'kanan';

/**
 * FITUR-8 (Biometric Attendance Enhancement — multi-angle enrollment): terima 1-3 foto
 * (depan wajib, kiri/kanan opsional) dan simpan sebagai baris terpisah berbagi `version` yang
 * sama, supaya verifyFace() bisa best-of-N match. Backward-compatible: 1 foto = perilaku lama persis.
 */
export async function enrollFace(params: {
	karyawanId: number;
	fotos: Array<{ file: File; sudut: FaceAngle }>;
	enrolledBy: string;
	consent: boolean;
}): Promise<{ ids: string[] }> {
	const { karyawanId, fotos, enrolledBy, consent } = params;
	if (!consent) {
		throw new Error('Consent wajib disetujui sebelum enrollment wajah (UU PDP).');
	}
	if (fotos.length === 0) {
		throw new Error('Minimal 1 foto (depan) wajib diunggah.');
	}

	// Revoke seluruh baris aktif LAMA sekali di awal — baris baru dari sesi enrollment ini
	// (bisa sampai 3 baris) tidak saling merevoke satu sama lain.
	const existingQuery = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[status][_eq]': 'active',
		fields: 'id,version',
		sort: '-version',
		limit: '-1'
	});
	const existing = await directusServerJson<{ data: { id: string; version: number }[] }>(
		`/items/karyawan_face_data?${existingQuery.toString()}`
	);
	const existingRows = existing?.data || [];
	const nextVersion = (existingRows[0]?.version || 0) + 1;
	for (const row of existingRows) {
		await directusServerJson(`/items/karyawan_face_data/${row.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'revoked' })
		});
	}

	const consentAt = new Date().toISOString();
	const ids: string[] = [];
	for (const { file, sudut } of fotos) {
		const embedForm = new FormData();
		embedForm.append('foto', file, 'enroll.jpg');
		const embedRes = await fetch(`${FACE_SERVICE_URL}/enroll`, { method: 'POST', body: embedForm });
		if (!embedRes.ok) {
			const errBody = await embedRes.json().catch(() => null);
			throw new Error(errBody?.detail || `Face service enroll gagal (${sudut}): HTTP ${embedRes.status}`);
		}
		const { embedding } = await embedRes.json();

		const uploadForm = new FormData();
		uploadForm.append('file', file, `face-enroll-${karyawanId}-${sudut}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw new Error(`Gagal mengunggah foto referensi (${sudut}) ke server.`);
		const uploaded = await uploadRes.json();
		const fotoId = uploaded?.data?.id;

		const result = await directusServerJson<{ data: { id: string } }>('/items/karyawan_face_data', {
			method: 'POST',
			body: JSON.stringify({
				karyawan_id: String(karyawanId),
				face_embedding: embedding,
				foto_referensi: fotoId,
				sudut,
				enrolled_by: enrolledBy,
				consent_at: consentAt,
				status: 'active',
				version: nextVersion
			})
		});
		if (result?.data?.id) ids.push(result.data.id);
	}

	return { ids };
}
