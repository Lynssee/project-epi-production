// src/lib/services/projectBpjstk.ts
// Klien tipis lintas-origin ke erp-epi /api/hrd/bpjstk-proyek (BPJSTK Proyek / Jakon, Fase 4).
// Pola sama projectFulfillment.ts: Bearer token Firebase yang sama. Lapangan hanya BACA status + "Colek HRD";
// pengurusan/penerbitan sertifikat dilakukan HRD di ERP. Cache modul 60 dtk agar tidak spam request.
import { getIdToken, secureDirectusFetch } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';
const ENDPOINT = '/api/hrd/bpjstk-proyek';
const TTL_MS = 60_000;

export type BpjstkStatus = 'tidak_wajib' | 'menunggu_pengurusan' | 'proses_pembayaran' | 'aktif' | 'kedaluwarsa';

export interface ProjectBpjstk {
	id: number | string;
	bpjstk_wajib: boolean;
	bpjstk_status_efektif: BpjstkStatus;
	gate_mode: 'off' | 'shadow' | 'enforce';
	bpjstk_nomor_sertifikat: string | null;
	bpjstk_file_sertifikat: string | null;
	bpjstk_tanggal_mulai: string | null;
	bpjstk_tanggal_selesai: string | null;
}

const cache = new Map<string, { at: number; promise: Promise<ProjectBpjstk> }>();

export function fetchProjectBpjstk(projectId: number | string, force = false): Promise<ProjectBpjstk> {
	const key = String(projectId);
	const hit = cache.get(key);
	if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const res = await fetch(`${ENDPOINT}?project_id=${encodeURIComponent(key)}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) throw new Error(`Gagal memuat status BPJSTK (${res.status})`);
		return (await res.json()).data as ProjectBpjstk;
	})().catch((err) => {
		cache.delete(key); // jangan cache kegagalan
		throw err;
	});
	cache.set(key, { at: Date.now(), promise });
	return promise;
}

/** Minta HRD mempercepat sertifikat. Server membatasi 1x/hari/proyek; panggilan ulang tidak error. */
export async function colekHrdBpjstk(
	projectId: number | string,
	pesan = ''
): Promise<{ success: boolean; alreadySent?: boolean; error?: string }> {
	try {
		const token = await getIdToken();
		const res = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ action: 'colek', project_id: projectId, pesan })
		});
		const parsed: any = await res.json().catch(() => null);
		if (!res.ok) return { success: false, error: parsed?.message || `Gagal mengirim (${res.status})` };
		return { success: true, alreadySent: !!parsed?.already_sent_today };
	} catch (err: any) {
		console.warn('[projectBpjstk] colek error:', err);
		return { success: false, error: err?.message || 'Gagal menghubungi server admin.' };
	}
}

/**
 * Buka sertifikat di tab baru. window.open() dipanggil SINKRON sebelum await apa pun (anti pop-up blocker),
 * lalu tab diarahkan ke blob setelah file terunduh.
 */
export function bukaSertifikatBpjstk(fileId: string | null | undefined): Promise<void> {
	if (!fileId) return Promise.resolve();
	const win = window.open('', '_blank');
	return secureDirectusFetch(`/assets/${fileId}`, { method: 'GET' })
		.then((res) => {
			if (!res.ok) throw new Error('Gagal membuka sertifikat');
			return res.blob();
		})
		.then((blob) => {
			const url = URL.createObjectURL(blob);
			if (win) win.location.href = url;
			else window.location.href = url;
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		})
		.catch((e) => {
			win?.close();
			throw e;
		});
}
