// src/lib/services/h1ReportGate.ts
// Klien tipis lintas-origin ke erp-epi untuk halaman Toolbox Meeting (Fase 2,
// rencana_mom_briefing_per_proyek.md, 13 Okt 2026). Pola sama disiplinKesiapan.ts /
// projectExceptions.ts: Bearer token Firebase yang sama.
//   - fetchH1Gate: GET-style (POST /api/laporan/gate-snapshot) status gate G10_HARIAN,
//     cache modul singkat per proyek, READ-ONLY, fail-open.
//   - postToolboxEskalasi: POST /api/project/toolbox-eskalasi, kendala kritis saat briefing
//     pagi (Fase 2 poin A.4 "Fast Issue Escalation") -> WA darurat ke GM/Direktur (app code
//     langsung, bukan webhook n8n -- lihat catatan arsitektur notificationHub.js di erp-epi).
import { getIdToken } from './secureDirectus';

export const ADMIN_APP_ORIGIN = '';
const TTL_MS = 60_000;

export interface H1Gate {
	status: 'passed' | 'failed' | 'not_applicable';
	missingDates: string[];
}

const cache = new Map<string, { at: number; promise: Promise<H1Gate> }>();

export function fetchH1Gate(projectId: string | number, force = false): Promise<H1Gate> {
	const key = String(projectId);
	const hit = cache.get(key);
	if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const res = await fetch('/api/laporan/gate-snapshot', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ project_ids: [projectId] })
		});
		if (!res.ok) throw new Error(`Gagal memeriksa laporan H-1 (${res.status})`);
		const j = await res.json();
		const g = j?.available ? j?.projects?.[String(projectId)] : null;
		return { status: g?.status || 'not_applicable', missingDates: g?.missingDates || [] } as H1Gate;
	})().catch((err) => {
		cache.delete(key);
		throw err;
	});
	cache.set(key, { at: Date.now(), promise });
	return promise;
}

/** Eskalasi kendala kritis (genset rusak, APD kurang, dll) yang ditemukan saat Toolbox
 * Meeting pagi -> WA darurat ke GM/Direktur. Best-effort di sisi pemanggil: kegagalan
 * jaringan di sini TIDAK BOLEH menggagalkan penyimpanan toolbox meeting itu sendiri. */
export async function postToolboxEskalasi(projectId: string | number, catatan: string): Promise<{ ok: boolean; waTerkirim: boolean; error?: string }> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/project/toolbox-eskalasi', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ project_id: projectId, catatan })
		});
		const j = await res.json().catch(() => ({}));
		if (!res.ok) return { ok: false, waTerkirim: false, error: j?.message || `HTTP ${res.status}` };
		return { ok: true, waTerkirim: !!j?.wa_terkirim };
	} catch (e: any) {
		return { ok: false, waTerkirim: false, error: e?.message || 'Gagal mengirim eskalasi' };
	}
}
