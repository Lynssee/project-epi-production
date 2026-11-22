// src/lib/server/ess/motivasiServer.ts
// Cek-in Semangat Kerja & Sense of Belonging untuk aplikasi lapangan (Fase 3). Identitas dari login; periode/tipe divalidasi di
// server; proyek aktif (opsional) dari currentProjectResolver. Agregasi HRD k-anonim hanya ada di erp-epi — di sini hanya INPUT.
// Fetch dipisah per koleksi (CLAUDE.md #2); kegagalan baca dilog jelas (#1) dan tidak mengganggu pengguna.

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { getCurrentProjectId } from '$lib/server/currentProjectResolver';
import { loadCultureSettings } from '$lib/server/ess/budayaHarian';
import { FAKTOR_OPTIONS, computeDue, validateCheckin, isoWeekCode, monthCode, type Due } from './motivationModel';

const LOG = 'employee_motivation_log';

export interface MotivasiStatus {
	enabled: boolean;
	due: Due | null;
	faktor: { value: string; label: string }[];
}

export class MotivasiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

async function loadAnswered(karyawanId: number, today: string): Promise<Set<string>> {
	const codes = [isoWeekCode(today), monthCode(today)].filter(Boolean);
	const res = await directusServerJson<{ data: any[] }>(
		`/items/${LOG}?filter[karyawan_id][_eq]=${karyawanId}&filter[periode_kode][_in]=${codes.join(',')}&fields=tipe,periode_kode&limit=-1`
	);
	return new Set((res?.data || []).map((r) => `${r.tipe}|${r.periode_kode}`));
}

export async function getMotivasiStatus(karyawan: { id: number }): Promise<MotivasiStatus> {
	const settings = await loadCultureSettings();
	if (!settings['culture.mood_checkin_enabled']) return { enabled: false, due: null, faktor: [] };
	const today = todayJakarta();
	let answered = new Set<string>();
	try {
		answered = await loadAnswered(karyawan.id, today);
	} catch (e) {
		console.error('[motivasi] gagal baca check-in karyawan (skema fase 3 belum diterapkan?):', (e as Error)?.message);
		return { enabled: true, due: null, faktor: [] };
	}
	return { enabled: true, due: computeDue({ today, settings, answered }), faktor: FAKTOR_OPTIONS };
}

export async function submitMotivasi(karyawan: { id: number; divisi?: string | null }, input: any): Promise<{ ok: true }> {
	const status = await getMotivasiStatus(karyawan);
	const due = status.due;
	if (!due || due.tipe !== String(input?.tipe ?? '') || due.periode_kode !== String(input?.periode_kode ?? '')) {
		throw new MotivasiError('Cek-in ini sudah terisi atau belum waktunya. Muat ulang halaman.', 409);
	}
	const v = validateCheckin(input, due.tipe);
	if (!v.ok) throw new MotivasiError(v.error, 400);
	const projectId = await getCurrentProjectId(karyawan.id); // opsional; null bila belum absen / tak terhubung proyek
	await directusServerJson(`/items/${LOG}`, {
		method: 'POST',
		body: JSON.stringify({
			...v.data,
			karyawan_id: karyawan.id,
			divisi: String(karyawan.divisi ?? '').trim() || null,
			project_id: projectId ?? null,
			periode_kode: due.periode_kode
		})
	});
	return { ok: true };
}
