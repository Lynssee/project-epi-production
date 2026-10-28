// src/lib/services/ess/manpowerKasbon.ts
// Client-side service kasbon pekerja lapangan (Fase 3, R1) — SELALU lewat /api/ess/kasbon-manpower,
// tidak pernah akses Directus langsung. Dipakai Project Leader dari ProjectPayrollRecap.svelte.

import { auth } from '$lib/firebase';

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

export interface AjukanKasbonManpowerParams {
	manpowerId: number;
	manpowerNama: string;
	nominal: number;
	tenor: number;
	keterangan: string;
}

export async function ajukanKasbonManpower(params: AjukanKasbonManpowerParams): Promise<{ record: any }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/kasbon-manpower', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify(params)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
