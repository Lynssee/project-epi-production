// src/lib/server/ess/goldenRules.ts
// "Golden Rules EPI" saat Site Check-in pertama kali di sebuah proyek (rekomendasi Budaya & Propaganda Fase 5): 3 butir komitmen
// mutu & keselamatan, ikrar 1 ketukan, dicatat sekali per karyawan per proyek (culture_golden_pledge, ditulis server dari identitas login).
// Isi butir, aktif/nonaktif, dan wajib/tidak diatur Superadmin/HRD di /governance/budaya → Pengaturan (culture.golden_rules_*) — bukan hardcode.
// BUKAN pengganti Pakta Pra-Kegiatan (konfirmasi SOP per rute): ini ikrar singkat per proyek. Fail-soft: bila catatan ikrar tidak bisa dibaca/ditulis
// (skema Fase 5 belum diterapkan) fitur MATI (enabled:false) — tidak menampilkan ikrar yang tak bisa disimpan dan tidak pernah memblokir check-in.

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { loadCultureSettings } from '$lib/server/ess/budayaHarian';

const MAX_RULES = 5;
const MAX_LEN = 160;

/** Teks setelan (satu butir per baris, bullet boleh) → daftar butir bersih, maks. 5 butir @160 karakter. */
export function parseGoldenRules(text: unknown): string[] {
	return String(text ?? '')
		.split(/\r?\n/)
		.map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
		.filter(Boolean)
		.slice(0, MAX_RULES)
		.map((l) => l.slice(0, MAX_LEN));
}

export interface GoldenRulesStatus {
	enabled: boolean;
	wajib: boolean;
	rules: string[];
	sudahIkrar: boolean;
}

const OFF: GoldenRulesStatus = { enabled: false, wajib: false, rules: [], sudahIkrar: false };

export class GoldenRulesError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

const validProject = (v: unknown): number | null => {
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : null;
};

async function findPledge(karyawanId: number, projectId: number) {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/culture_golden_pledge?filter[karyawan_id][_eq]=${karyawanId}&filter[project_id][_eq]=${projectId}&fields=id&limit=1`
	);
	return res?.data?.[0] ?? null;
}

export async function getGoldenRulesStatus(karyawan: { id: number }, projectIdRaw: unknown): Promise<GoldenRulesStatus> {
	const projectId = validProject(projectIdRaw);
	if (!projectId) return OFF;
	const settings = await loadCultureSettings();
	if (!settings['culture.golden_rules_enabled']) return OFF;
	const rules = parseGoldenRules(settings['culture.golden_rules_teks']);
	if (!rules.length) return OFF;
	try {
		const ada = await findPledge(karyawan.id, projectId);
		return { enabled: true, wajib: !!settings['culture.golden_rules_wajib'], rules, sudahIkrar: !!ada };
	} catch (e) {
		console.error('[goldenRules] gagal membaca ikrar (skema fase 5 belum diterapkan?) — fitur dimatikan:', (e as Error)?.message);
		return OFF;
	}
}

/** Catat ikrar (idempoten). */
export async function submitGoldenPledge(karyawan: { id: number }, projectIdRaw: unknown): Promise<{ ok: true; sudah: boolean }> {
	const projectId = validProject(projectIdRaw);
	if (!projectId) throw new GoldenRulesError('project_id tidak valid.', 400);
	const st = await getGoldenRulesStatus(karyawan, projectId);
	if (!st.enabled) throw new GoldenRulesError('Golden Rules tidak aktif.', 409);
	if (st.sudahIkrar) return { ok: true, sudah: true };
	await directusServerJson('/items/culture_golden_pledge', {
		method: 'POST',
		body: JSON.stringify({ karyawan_id: karyawan.id, project_id: projectId, tanggal: todayJakarta() })
	});
	return { ok: true, sudah: false };
}
