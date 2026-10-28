// src/lib/services/ess/kpiDispute.ts
// Client-side service Fase 11a (dispute window) — selalu lewat /api/ess/kpi-dispute.

import { auth } from '$lib/firebase';

export interface KpiDispute {
	id: string;
	scorecard_id: string;
	karyawan_id: string;
	alasan: string;
	status: string;
	tanggapan_hrd: string | null;
	tanggal_dibuat: string;
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

export async function getMyDisputes(): Promise<KpiDispute[]> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/kpi-dispute', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.disputes;
}

export async function submitDispute(scorecardId: string, alasan: string): Promise<KpiDispute> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/kpi-dispute', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ scorecardId, alasan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.dispute;
}
