// src/lib/services/sewaMasukGateApi.ts
// Fase 4, Rencana Pertajam Rental Order v2 — sisi klien gerbang Sewa Masuk (kita MENYEWA
// alat dari vendor, rental_in). TERPISAH TOTAL dari rentalOrderGateApi.ts (Peminjaman
// External, arah berlawanan). Server counterpart: api/sewa-masuk/gate/+server.ts.

import { auth } from '$lib/firebase';

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export interface SewaMasukGateInfo {
	sewaMasukId: number;
	vendor: string;
	project: string;
	status: string;
	/** 'kedatangan' = alat sewa baru tiba; 'retur' = alat dikembalikan ke vendor. */
	action: 'kedatangan' | 'retur';
	items: Array<{ id: number; identitas_barang_id: number | null; nama_barang: string; qty: number; satuan: string }>;
}

export async function resolveSewaMasukGate(code: string): Promise<SewaMasukGateInfo> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/sewa-masuk/gate?code=${encodeURIComponent(code)}`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `Gagal memuat data sewa masuk (${res.status})`);
	return data;
}

export async function confirmSewaMasukGate(
	code: string,
	gudangId: number | null = null,
	// Fase 6 §9.2 L5 — foto kondisi WAJIB (server menolak kalau kosong), kondisi teks opsional.
	photoIds: string[] = [],
	kondisi: string = ''
): Promise<{ success: boolean; newStatus: string; action: string }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/sewa-masuk/gate', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, gudangId, photoIds, kondisi })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `Gagal mengonfirmasi gerbang sewa masuk (${res.status})`);
	return data;
}
