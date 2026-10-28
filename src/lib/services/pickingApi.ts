// src/lib/services/pickingApi.ts
// Sisi klien untuk Fase 3 — Mobile Picking. Server counterpart: src/routes/api/picking/*.
import { auth } from '$lib/firebase';

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
	const idToken = await getIdToken();
	const res = await fetch(path, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data?.message || `Gagal (${res.status})`);
	}
	return res.json();
}

export interface ScanResult {
	projectBudgetId: number;
	itemId: number;
	namaBarang: string;
	unit: string | null;
	qtyRequired: number;
	qtyPicked: number;
	qtyRemaining: number;
	reservationId: number;
}

export function scanPickItem(code: string, projectId: number): Promise<ScanResult> {
	return postJson('/api/picking/scan', { code, projectId });
}

export function confirmPickQty(
	projectBudgetId: number,
	qty: number,
	reservationId: number
): Promise<{ ok: true; qtyPicked: number; qtyRequired: number }> {
	return postJson('/api/picking/confirm', { projectBudgetId, qty, reservationId });
}

export function verifyPick(projectBudgetId: number): Promise<{ ok: true }> {
	return postJson('/api/picking/verify', { projectBudgetId });
}

export function completePickSession(projectId: number, photoFileId: string | null): Promise<{ ok: true }> {
	return postJson('/api/picking/complete-session', { projectId, photoFileId });
}
