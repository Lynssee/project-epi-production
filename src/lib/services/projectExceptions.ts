// src/lib/services/projectExceptions.ts
// Klien tipis lintas-origin ke erp-epi GET /api/project/exceptions?scope=mine (PRJ-31). Pola sama disiplinKesiapan.ts:
// Bearer token Firebase, cache modul singkat (server sendiri cache 5 menit). READ-ONLY. scope=mine => ERP menentukan
// proyek dari akun yang login, bukan dari parameter.
import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';
const TTL_MS = 60_000;

export interface ExceptionItem {
	id: number;
	label: string;
	detail: string;
}
export interface ExceptionCard {
	key: string;
	title: string;
	hint: string;
	severity: 'high' | 'medium' | 'low';
	count: number;
	items: ExceptionItem[];
	action: string;
}
export interface ProjectExceptions {
	cards: ExceptionCard[];
	totalIssues: number;
	generatedAt: string;
}

let cached: { at: number; promise: Promise<ProjectExceptions> } | null = null;

export function fetchMyProjectExceptions(force = false): Promise<ProjectExceptions> {
	if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const res = await fetch(`/api/project/exceptions?scope=mine${force ? '&fresh=1' : ''}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) throw new Error(`Gagal memuat pengecualian proyek (${res.status})`);
		const j = await res.json();
		return (j?.data ?? { cards: [], totalIssues: 0, generatedAt: '' }) as ProjectExceptions;
	})().catch((err) => {
		cached = null; // jangan cache kegagalan
		throw err;
	});
	cached = { at: Date.now(), promise };
	return promise;
}

/** Kartu yang relevan untuk Leader di lapangan; akrual gaji = urusan Finance/Payroll, tidak ditampilkan. */
export const FIELD_CARD_KEYS = new Set(['tanpa_rap', 'burn_rate', 'tanpa_laporan', 'review_laporan', 'pl_terbuka_final', 'data_janggal', 'approval_menunggu']);
