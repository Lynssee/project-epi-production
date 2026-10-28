// src/lib/services/ess/maintenanceKpi.ts
// Client-side service ESS Maintenance KPI — selalu lewat /api/ess/maintenance-kpi.

import { auth } from '$lib/firebase';

export interface MyWorkOrder {
	id: string;
	wo_number: string;
	statusName: string;
	statusSelesai: boolean;
	keluhan: string | null;
	tanggal_rusak: string | null;
	tanggal_done: string | null;
	created_at: string | null;
}

export interface MaintenanceKpiSummary {
	linked: boolean;
	personnelName: string | null;
	periode: string | null;
	total: number;
	selesai: number;
	pct: number | null;
	openList: MyWorkOrder[];
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export async function getMyMaintenanceKpi(): Promise<MaintenanceKpiSummary> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/maintenance-kpi', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) {
		const data = await res.json().catch(() => null);
		throw new Error(data?.message || `Gagal (${res.status})`);
	}
	return res.json();
}
