// src/lib/services/forecastMobilizationRequest.ts
// "Ajukan Pengiriman Fase X" (Fase 6, §Q5) — klien tipis lintas-origin ke erp-epi
// (requestMobilizationForStage di forecastActions.js). Pola sama persis
// projectClosureLapangan.ts/materialChain.ts: Bearer token Firebase yang sama.
// TIDAK membuat SJ/PL langsung — hanya menandai pengajuan & memberi tahu PM; gudang membuat
// draft PL/SJ setelah PM menyetujui di Inbox Kebutuhan Departemen (erp-epi).
import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';

export interface RequestMobilizationParams {
	projectId: number;
	projectName?: string;
	mobStage: string;
	mobStageLabel?: string;
	requestedByName: string;
	items?: Array<{ refName: string; qty: number; unit: string | null; refType: string }>;
}

export interface RequestMobilizationResult {
	success: boolean;
	error?: string;
	data?: { requested: number; mobStage: string; projectId: number };
}

export async function requestMobilization(params: RequestMobilizationParams): Promise<RequestMobilizationResult> {
	try {
		const token = await getIdToken();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/project/forecast/mobilization-request`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				projectId: params.projectId,
				mobStage: params.mobStage,
				requestedByName: params.requestedByName
			})
		});
		const text = await res.text();
		let parsed: any = null;
		try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
		if (!res.ok || !parsed?.success) {
			return { success: false, error: parsed?.message || `Gagal mengajukan pengiriman (${res.status})` };
		}
		return { success: true, data: parsed.data };
	} catch (err: any) {
		console.warn('[forecastMobilizationRequest] error:', err);
		return { success: false, error: err?.message || 'Gagal menghubungi server admin.' };
	}
}

/**
 * Setelah Leader mengirim Packing List yang di-prefill dari Kebutuhan Timeline, tandai baris
 * forecast-nya (admin: linked_ref_type='packing_request') supaya tidak diajukan dobel & tidak
 * muncul lagi sebagai "belum ditangani". Best-effort: kegagalan TIDAK membatalkan PL yang sudah
 * terkirim — pemanggil hanya mencatat peringatan.
 */
export async function markForecastRequested(ids: Array<string | number>, requestedByName: string): Promise<boolean> {
	if (!ids.length) return true;
	try {
		const token = await getIdToken();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/project/forecast/mark-requested`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ ids, requestedByName })
		});
		const parsed = await res.json().catch(() => null);
		if (!res.ok || !parsed?.success) {
			console.warn('[forecastMobilizationRequest] mark-requested gagal:', parsed?.message || res.status);
			return false;
		}
		return true;
	} catch (err) {
		console.warn('[forecastMobilizationRequest] mark-requested error:', err);
		return false;
	}
}
