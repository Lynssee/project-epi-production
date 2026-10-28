// src/lib/services/rentalOrderGateApi.ts
// F3/Q10 (rencana v2.0 Bab 6.3): sisi klien gerbang Peminjaman External, kedua arah.
// Server counterpart: api/rental-order/gate-retur/+server.ts.

import { auth } from '$lib/firebase';

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export interface GateReturInfo {
	rentalId: number;
	referenceNo: string;
	peminjam: string;
	rentalDirection: 'rental_out' | 'rental_in';
	/** 'kedatangan' = barang baru tiba (hanya arah rental_in); 'retur' = barang kembali/dikembalikan. */
	action: 'kedatangan' | 'retur';
	items: Array<{ id: number; nama_barang: string; qty: number; satuan: string }>;
}

export async function resolveGateRetur(code: string): Promise<GateReturInfo> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/rental-order/gate-retur?code=${encodeURIComponent(code)}`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `Gagal memuat data retur (${res.status})`);
	return data;
}

export async function confirmGateRetur(
	code: string,
	items: Array<{ id: number; kondisiKembali: string }>
): Promise<{ success: boolean; newStatus: string }> {
	const idToken = await getIdToken();
	const res = await fetch('/api/rental-order/gate-retur', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, items })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `Gagal mengonfirmasi retur (${res.status})`);
	return data;
}
