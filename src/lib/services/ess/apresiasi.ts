// src/lib/services/ess/apresiasi.ts
// Reward Stakeholder v2 Fase 5 — client service "Apresiasi Saya", selalu lewat /api/ess/apresiasi-saya.

import { auth } from '$lib/firebase';

export interface ApresiasiItem {
	id: number;
	reference_no: string | null;
	item_nama: string;
	qty: number;
	status: string;
	status_kirim: string | null;
	nomor_resi: string | null;
	tanggal: string | null;
	program_nama: string | null;
	kategori_keperluan: string | null;
	sudah_ada_bukti: boolean;
	bisa_konfirmasi: boolean;
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export async function getApresiasiSaya(): Promise<ApresiasiItem[]> {
	const token = await getIdToken();
	const res = await fetch('/api/ess/apresiasi-saya', { headers: { Authorization: `Bearer ${token}` } });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);
	return data.data || [];
}

export async function konfirmasiTerimaApresiasi(distribusiId: number, foto: File): Promise<void> {
	const token = await getIdToken();
	const form = new FormData();
	form.append('distribusi_id', String(distribusiId));
	form.append('foto', foto);
	const res = await fetch('/api/ess/apresiasi-saya', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);
}
