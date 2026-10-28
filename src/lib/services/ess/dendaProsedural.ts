// src/lib/services/ess/dendaProsedural.ts
// Client-side service ESS Denda Prosedural (bagian dari /ess/disiplin, tab "Catatan Prosedural").
// SELALU lewat /api/ess/disiplin/denda-prosedural/*, TIDAK PERNAH akses Directus langsung. Fase 3.

import { auth } from '$lib/firebase';

export interface DendaProseduralLog {
	id: number;
	rule_kode: string;
	tanggal_kejadian: string | null;
	periode_payroll: string | null;
	nominal: number;
	nominal_efektif: number;
	keterangan_otomatis: string | null;
	status: string;
	alasan_pembebasan: string | null;
	potongan_karyawan_id: number | null;
}

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

export async function getMyDendaProsedural(periode?: string): Promise<DendaProseduralLog[]> {
	const idToken = await getIdToken();
	const qs = periode ? `?periode=${encodeURIComponent(periode)}` : '';
	const res = await fetch(`/api/ess/disiplin/denda-prosedural${qs}`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return (await res.json()).logs;
}

export async function ajukanKlarifikasiDenda(logId: number, alasan: string): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/disiplin/denda-prosedural/${logId}/klarifikasi`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify({ alasan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}
