// src/lib/services/sjTunggakan.ts
// Penajaman Gate SJ Fase 3 — klien tipis untuk endpoint tunggakan fisik & unggah foto SJ fisik.
// Offline Proof Buffer: bila unggah gagal karena jaringan, foto diantrekan di HP (offlineScanSjQueue) dan
// dikirim otomatis saat online (penyinkron global ScanSjQueueSync di layout).
import { getIdToken } from './secureDirectus';
import { HttpError, isRetryableError } from '$lib/utils/networkError';
import { enqueueScanSj, flushScanSjQueue, type QueuedScanSj } from '$lib/utils/offlineScanSjQueue';

export async function authedJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
	const token = await getIdToken();
	const res = await fetch(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new HttpError(body?.message || `HTTP ${res.status}`, res.status);
	return body as T;
}

/** Unggah langsung foto SJ fisik bertanda tangan lengkap -> surat_jalan.scan_sj_file (melempar bila gagal). */
export async function uploadScanSjFisik(sjId: number | string, photo: Blob): Promise<{ file_id: string }> {
	const fd = new FormData();
	fd.append('file', photo, `scan-sj-${sjId}.jpg`);
	return authedJson(`/api/lacak-sj/${encodeURIComponent(String(sjId))}/scan-fisik`, { method: 'POST', body: fd });
}

/**
 * Kirim foto SJ fisik; bila gangguan jaringan, simpan di antrean offline.
 * @returns queued=true bila tersimpan di HP (belum terkirim ke server).
 */
export async function submitScanSjFisik(
	sjId: number | string,
	photo: Blob,
	nomorSj: string | null = null
): Promise<{ queued: boolean }> {
	try {
		await uploadScanSjFisik(sjId, photo);
		return { queued: false };
	} catch (err) {
		if (!isRetryableError(err)) throw err;
		const entry: QueuedScanSj = {
			client_txn_id: `scan-sj-${sjId}-${crypto.randomUUID()}`,
			sjId, nomorSj, photoBlob: photo, createdAt: new Date().toISOString()
		};
		await enqueueScanSj(entry);
		return { queued: true };
	}
}

/** Kirim ulang seluruh antrean (dipanggil penyinkron global saat online / saat aplikasi dibuka). */
export function flushScanSjQueueNow() {
	return flushScanSjQueue((e) => uploadScanSjFisik(e.sjId, e.photoBlob).then(() => undefined));
}
