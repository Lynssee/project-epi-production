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

const FACE_SERVICE_URL = (env.FACE_SERVICE_URL || '').trim();
const FACE_VERIFY_TIMEOUT_MS = 5_000;
const FACE_ENROLL_TIMEOUT_MS = 15_000;
const FACE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_FACE_DATA_CACHE = 500;

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

let anyEnrollmentCache: { at: number; value: boolean } | null = null;
let anyEnrollmentInflight: Promise<boolean> | null = null;
const faceDataCache = new Map<string, { at: number; value: ActiveFaceData[] }>();
const faceDataInflight = new Map<string, Promise<ActiveFaceData[]>>();

/** Untuk tes & invalidasi setelah enrollFace(). */
export function clearFaceVerifyCache(karyawanId?: number) {
	anyEnrollmentCache = null;
	anyEnrollmentInflight = null;
	if (karyawanId != null) {
		const key = String(karyawanId);
		faceDataCache.delete(key);
		faceDataInflight.delete(key);
	} else {
		faceDataCache.clear();
		faceDataInflight.clear();
	}
}

/**
 * Cek cepat (di-cache 5 menit lintas-user) apakah SUDAH ADA minimal 1 karyawan yang
 * mendaftarkan wajah di `karyawan_face_data`. Selama masih 0 baris, seluruh request
 * absensi melewati query/upload/log wajah dengan biaya 0 call Directus.
 */
export async function hasAnyActiveFaceEnrollment(): Promise<boolean> {
	const now = Date.now();
	if (anyEnrollmentCache && now - anyEnrollmentCache.at < FACE_CACHE_TTL_MS) {
		return anyEnrollmentCache.value;
	}
	if (anyEnrollmentInflight) return anyEnrollmentInflight;

	const pending = (async (): Promise<boolean> => {
		try {
			const result = await directusServerJson<{ data: { id: string }[] }>(
				'/items/karyawan_face_data?filter[status][_eq]=active&fields=id&limit=1'
			);
			const value = (result?.data?.length || 0) > 0;
			anyEnrollmentCache = { at: Date.now(), value };
			return value;
		} catch {
			return false;
		}
	})().finally(() => {
		if (anyEnrollmentInflight === pending) anyEnrollmentInflight = null;
	});

	anyEnrollmentInflight = pending;
	return pending;
}

// FITUR-8 (Biometric Attendance Enhancement): enrollment multi-angle menyimpan hingga 3 baris
// (depan/kiri/kanan) berbagi `version` yang sama — "aktif" berarti seluruh baris pada version
// TERBARU milik karyawan itu, bukan cuma 1 baris. Enrollment lama (pra-fitur ini) tetap 1 baris,
// kode di bawah tetap jalan normal untuk itu (array berisi 1 elemen).
async function getActiveFaceDataSet(karyawanId: number): Promise<ActiveFaceData[]> {
	const key = String(karyawanId);
	const now = Date.now();
	const cached = faceDataCache.get(key);
	if (cached && now - cached.at < FACE_CACHE_TTL_MS) {
		return cached.value;
	}
	const running = faceDataInflight.get(key);
	if (running) return running;

	const pending = (async (): Promise<ActiveFaceData[]> => {
		const query = new URLSearchParams({
			'filter[karyawan_id][_eq]': key,
			'filter[status][_eq]': 'active',
			fields: 'id,face_embedding,version',
			sort: '-version',
			limit: '-1'
		});
		const result = await directusServerJson<{ data: ActiveFaceData[] }>(
			`/items/karyawan_face_data?${query.toString()}`
		);
		const rows = result?.data || [];
		const latest = rows.length === 0 ? [] : rows.filter((r) => r.version === rows[0].version);
		if (faceDataCache.size >= MAX_FACE_DATA_CACHE) {
			const oldest = faceDataCache.keys().next().value;
			if (oldest !== undefined) faceDataCache.delete(oldest);
		}
		faceDataCache.set(key, { at: Date.now(), value: latest });
		return latest;
	})().finally(() => {
		if (faceDataInflight.get(key) === pending) faceDataInflight.delete(key);
	});

	faceDataInflight.set(key, pending);
	return pending;
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

export interface VerifyFaceParams {
	karyawanId: number;
	foto: File;
	context: FaceVerifyContext;
	livenessPassed: boolean;
	ipAddress: string;
	deviceInfo: string;
	lokasiAbsensiId?: string | null;
	/** Reuse ID file foto absen yang sudah terunggah agar tidak upload foto yang sama 2x. */
	existingFotoId?: string | null;
	/** Threshold lokasi yang sudah dibaca dari cache lokasi_absensi (hindari GET duplikat). */
	lokasiThreshold?: number | null;
	/**
	 * Jika true (default pada alur absensi): lewati verifikasi & penulisan face_verification_log
	 * bila karyawan belum punya enrollment wajah aktif di karyawan_face_data.
	 */
	skipWhenUnenrolled?: boolean;
}

export async function verifyFace(params: VerifyFaceParams): Promise<FaceVerificationResult> {
	const {
		karyawanId,
		foto,
		context,
		livenessPassed,
		ipAddress,
		deviceInfo,
		lokasiAbsensiId,
		existingFotoId,
		lokasiThreshold,
		skipWhenUnenrolled = false
	} = params;

	if (skipWhenUnenrolled) {
		const anyEnrolled = await hasAnyActiveFaceEnrollment();
		if (!anyEnrolled) {
			return { verificationId: null, passed: false, matchScore: null, livenessPassed };
		}
	}

	let matchScore: number | null = null;
	let matchPassed = false;
	let activeSet: ActiveFaceData[] = [];

	try {
		activeSet = await getActiveFaceDataSet(karyawanId);
		if (skipWhenUnenrolled && activeSet.length === 0) {
			return { verificationId: null, passed: false, matchScore: null, livenessPassed };
		}

		// FITUR-8: cocokkan paralel terhadap seluruh foto aktif (1-3 sudut) dengan timeout ketat.
		// Lewati panggilan microservice bila FACE_SERVICE_URL belum dikonfigurasi di env.
		const validEmbeddings = activeSet.filter(
			(active) => Array.isArray(active.face_embedding) && active.face_embedding.length > 0
		);
		if (validEmbeddings.length > 0 && FACE_SERVICE_URL) {
			const fotoBytes = await foto.arrayBuffer();
			const checks = await Promise.allSettled(
				validEmbeddings.map(async (active) => {
					const form = new FormData();
					form.append('foto', new Blob([fotoBytes]), 'capture.jpg');
					form.append('reference_embedding', JSON.stringify(active.face_embedding));
					const res = await fetch(`${FACE_SERVICE_URL}/verify`, {
						method: 'POST',
						body: form,
						signal: AbortSignal.timeout(FACE_VERIFY_TIMEOUT_MS)
					});
					if (!res.ok) return null;
					const data = await res.json();
					return {
						score: typeof data.match_score === 'number' ? data.match_score : null,
						passed: Boolean(data.passed)
					};
				})
			);
			for (const outcome of checks) {
				if (outcome.status !== 'fulfilled' || !outcome.value) continue;
				const { score, passed } = outcome.value;
				if (score != null && (matchScore == null || score > matchScore)) {
					matchScore = score;
					matchPassed = passed;
				}
			}
			// Override keputusan passed/gagal dengan threshold per-lokasi bila dikonfigurasi.
			if (matchScore != null) {
				const threshold =
					lokasiThreshold !== undefined
						? lokasiThreshold
						: await getLokasiFaceThreshold(lokasiAbsensiId ?? null);
				if (threshold != null) {
					matchPassed = matchScore >= threshold;
				}
			}
		}
	} catch {
		// microservice down/unreachable — fail-safe, matchScore tetap null
	}

	// Pakai ulang foto absen yang sudah diunggah bila tersedia (hapus upload duplikat ke Directus /files).
	let fotoCaptureId: string | null = existingFotoId ?? null;
	if (!fotoCaptureId) {
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

/**
 * Jalankan verifikasi wajah di background (non-blocking) setelah absensi tersimpan,
 * lalu tautkan verificationId ke baris absensi bila ada enrollment aktif.
 * Tidak pernah melempar error ke pemanggil.
 */
export function verifyFaceInBackground(
	params: VerifyFaceParams,
	onVerified?: (verificationId: string) => Promise<void>
): void {
	void verifyFace({ ...params, skipWhenUnenrolled: true })
		.then(async (res) => {
			if (res.verificationId && onVerified) {
				await onVerified(res.verificationId);
			}
		})
		.catch((err) => {
			console.warn('[faceVerify] background verify gagal (diabaikan):', err instanceof Error ? err.message : err);
		});
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

	const serviceUrl = FACE_SERVICE_URL || 'http://localhost:8000';
	const consentAt = new Date().toISOString();
	const ids: string[] = [];
	for (const { file, sudut } of fotos) {
		const embedForm = new FormData();
		embedForm.append('foto', file, 'enroll.jpg');
		const embedRes = await fetch(`${serviceUrl}/enroll`, {
			method: 'POST',
			body: embedForm,
			signal: AbortSignal.timeout(FACE_ENROLL_TIMEOUT_MS)
		});
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

	clearFaceVerifyCache(karyawanId);
	return { ids };
}
