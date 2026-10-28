// src/lib/services/gaChecklist.ts
// Bacaan & submit sisi klien untuk GA Checklist field app. Submit checklist WAJIB lewat
// /api/ga-checklist/submit (token server) — scoring & finding dihitung di server supaya
// tidak bisa dimanipulasi dari klien. Lihat src/lib/server/ess/attendanceGuard.ts (reuse).

import { auth } from '$lib/firebase';
import { enqueue } from '$lib/utils/offlineQueue';

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

async function getGaChecklist(url: string) {
	const idToken = await getIdToken();
	const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface ScheduleItem {
	id: number | string;
	area_id: number;
	template_id: number;
	checklist_type: 'routine' | 'deep_check';
	status: string;
	area: { id: number; area_name: string } | null;
	existing_response: { id: number; status: string; scoring_result: number } | null;
	// R4 (rencana v2 Fase 6, 16 Sep 2026): riwayat skor 30 hari milik karyawan sendiri.
	stats_30d: { avg: number; count: number } | null;
}

export async function fetchTodaySchedule(): Promise<{ date: string; items: ScheduleItem[] }> {
	return getGaChecklist('/api/ga-checklist/schedule');
}

export interface ChecklistItemDef {
	id: number;
	category: string;
	item_name: string;
	description: string;
	is_critical: boolean;
	field_type?: 'text' | 'number' | 'checklist';
}

export async function fetchTemplateWithItems(templateId: number): Promise<{ id: number; name: string; items: ChecklistItemDef[] }> {
	const cacheKey = `ga_template_${templateId}`;
	try {
		const data = await getGaChecklist(`/api/ga-checklist/template/${templateId}`);
		if (data && typeof localStorage !== 'undefined') {
			localStorage.setItem(cacheKey, JSON.stringify(data));
		}
		return data;
	} catch (err) {
		if (typeof localStorage !== 'undefined') {
			const cached = localStorage.getItem(cacheKey);
			if (cached) {
				console.warn(`Menggunakan cache lokal untuk template ${templateId} karena gagal fetch`, err);
				return JSON.parse(cached);
			}
		}
		throw err;
	}
}

export interface CheckpointVerifyResult {
	checkpoint_id: number;
	checkpoint_name: string;
	checklist_mode?: 'presence-only' | 'checklist' | 'both';
	checklist_template_id?: number | null;
}

export async function verifyCheckpoint(code: string, areaId: number, lat?: number | null, lng?: number | null): Promise<CheckpointVerifyResult> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ga-checklist/checkpoint/verify', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, area_id: areaId, lat, lng })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface ResolveCheckpointResult {
	kind: 'ga' | 'security';
	schedule_id?: number | string;
	area_id?: number;
	template_id?: number;
	checkpoint_name: string;
	// "Barang per Ruangan via QR Patroli" (Fase 1) — field tambahan, opsional agar
	// tetap kompatibel dengan server versi lama.
	is_assigned?: boolean;
	scan_route_mode?: 'auto' | 'pilih' | 'checklist_dulu';
	room?: {
		area_id: number;
		area_name: string | null;
		zone_name: string | null;
		location_name: string | null;
		item_count: number;
	} | null;
}

/** Resolusi QR untuk tombol Scan universal — server yang menentukan konteks (GA/Security). */
export async function resolveCheckpoint(code: string): Promise<ResolveCheckpointResult> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ga-checklist/checkpoint/resolve', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ code })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/** Validasi hasil scan QR titik keamanan (rute Satpam) sebelum checklist pos dibuka. */
export async function verifySecurityCheckpoint(code: string, routeId: number): Promise<CheckpointVerifyResult> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ga-checklist/checkpoint/verify', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, route_id: routeId })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface ItemAnswer {
	item_id: number;
	answer: 'yes' | 'no' | 'na';
	notes?: string;
}

export interface SubmitChecklistParams {
	area_id: number;
	template_id: number;
	checkpoint_id: number;
	responses: ItemAnswer[];
	signature: string; // base64 data URL
	photos: Record<number, File>; // item_id -> foto
	// R2 (rencana v2 Fase 6, 16 Sep 2026): true setelah petugas mengonfirmasi tetap ingin
	// isi ulang checklist ruangan yang sama hari ini (lihat error 409 di submit/+server.ts).
	confirmResubmit?: boolean;
	/** Alasan submit tanpa cek kelengkapan ruangan wajib (Kontrol Patroli Fase 1, mode soft). */
	ruangan_cek_skip_reason?: string;
	/** Alasan tetap mengirim checklist yang belum lengkap (gate G_CLN2, mode soft). */
	gate_cln2_reason?: string;
}

export interface SubmitSecurityChecklistParams {
	route_id: number;
	template_id: number;
	checkpoint_id: number; // id dari security_checkpoint, bukan ga_checkpoints
	responses: ItemAnswer[];
	signature: string; // base64 data URL
	photos: Record<number, File>; // item_id -> foto
	/** Alasan submit tanpa cek kelengkapan ruangan wajib (Kontrol Patroli Fase 1, mode soft). */
	ruangan_cek_skip_reason?: string;
}

/**
 * Submit checklist. Jika gagal karena offline (bukan ditolak server), payload diantre
 * di localStorage dan dikirim ulang otomatis saat online. Catatan: foto tidak diikutkan
 * dalam antrian offline (File tidak bisa di-serialize ke JSON) — submit ulang manual
 * diperlukan jika gagal saat benar-benar offline dengan foto terlampir.
 */
export async function submitChecklistResponse(params: SubmitChecklistParams) {
	let idToken: string;
	try {
		idToken = await getIdToken();
	} catch {
		enqueue('/api/ga-checklist/submit', 'POST', { ...params, photos: undefined });
		return { queued: true };
	}

	const form = new FormData();
	form.set('area_id', String(params.area_id));
	form.set('template_id', String(params.template_id));
	form.set('checkpoint_id', String(params.checkpoint_id));
	form.set('responses', JSON.stringify(params.responses));
	form.set('signature', params.signature);
	if (params.confirmResubmit) form.set('confirm_resubmit', 'true');
	if (params.ruangan_cek_skip_reason) form.set('ruangan_cek_skip_reason', params.ruangan_cek_skip_reason);
	if (params.gate_cln2_reason) form.set('gate_cln2_reason', params.gate_cln2_reason);
	for (const [itemId, file] of Object.entries(params.photos)) {
		form.set(`photo_${itemId}`, file);
	}

	try {
		const res = await fetch('/api/ga-checklist/submit', {
			method: 'POST',
			headers: { Authorization: `Bearer ${idToken}` },
			body: form
		});
		if (res.status === 422) {
			const err = new Error(await parseErrorMessage(res));
			(err as any).isGateCln2 = true;
			throw err;
		}
		if (res.status === 409) {
			const err = new Error(await parseErrorMessage(res));
			(err as any).isDuplicateSubmit = true;
			throw err;
		}
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		return res.json();
	} catch (err) {
		if (err instanceof TypeError) {
			enqueue('/api/ga-checklist/submit', 'POST', { ...params, photos: undefined });
			return { queued: true };
		}
		throw err;
	}
}

/** Sama seperti submitChecklistResponse, tapi untuk checklist pos keamanan (konteks rute, bukan area). */
export async function submitSecurityChecklistResponse(params: SubmitSecurityChecklistParams) {
	let idToken: string;
	try {
		idToken = await getIdToken();
	} catch {
		enqueue('/api/ga-checklist/submit', 'POST', { ...params, photos: undefined });
		return { queued: true };
	}

	const form = new FormData();
	form.set('route_id', String(params.route_id));
	form.set('template_id', String(params.template_id));
	form.set('checkpoint_id', String(params.checkpoint_id));
	form.set('responses', JSON.stringify(params.responses));
	form.set('signature', params.signature);
	if (params.ruangan_cek_skip_reason) form.set('ruangan_cek_skip_reason', params.ruangan_cek_skip_reason);
	for (const [itemId, file] of Object.entries(params.photos)) {
		form.set(`photo_${itemId}`, file);
	}

	try {
		const res = await fetch('/api/ga-checklist/submit', {
			method: 'POST',
			headers: { Authorization: `Bearer ${idToken}` },
			body: form
		});
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		return res.json();
	} catch (err) {
		if (err instanceof TypeError) {
			enqueue('/api/ga-checklist/submit', 'POST', { ...params, photos: undefined });
			return { queued: true };
		}
		throw err;
	}
}
