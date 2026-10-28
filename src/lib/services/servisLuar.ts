// src/lib/services/servisLuar.ts
// Fase 6 (Pergerakan External Terpadu v2.0): sisi klien untuk scan QR SJ servis luar
// dan konfirmasi retur equipment dari bengkel. Server counterpart:
// /api/surat-jalan/servis-luar/+server.ts

import directus, { handleDirectusError } from './directus';
import { uploadFiles } from '@directus/sdk';
import { auth } from '$lib/firebase';

export interface DispatchItem {
	id: number;
	equipment_id: string | null;
	nama_barang: string | null;
	kondisi_berangkat: string | null;
}

// Gate Bengkel / Jasa Eksternal — Fase 6 (29 Agu 2026): item scope Perjanjian Kerja
// (kalau ada) untuk dicentang mekanik saat retur -- mengisi service_agreement_item.hasil_retur.
export interface ScopeItem {
	id: string;
	deskripsi: string;
	hasil_retur: 'sesuai' | 'tidak_dikerjakan' | 'bermasalah' | null;
}

export interface DispatchDetail {
	id: number;
	nomor_sj: string;
	status: string;
	return_status: string;
	work_order_id: string | null;
	bengkel_name: string;
	items: DispatchItem[];
	serviceAgreementId: string | null;
	scopeItems: ScopeItem[];
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export async function resolveServisLuarQr(code: string): Promise<DispatchDetail> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/surat-jalan/servis-luar?code=${encodeURIComponent(code)}`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body?.message || `Gagal memuat Surat Jalan (${res.status})`);
	}
	return res.json();
}

export async function uploadServisLuarPhoto(file: File): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('description', 'servis_luar:foto_terima');
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface ConfirmRetur {
	suratJalanId: number;
	items: Array<{ surat_jalan_item_id: number; kondisi_kembali: 'baik' | 'rusak' | 'hilang' }>;
	fotoTerimaFileId: string;
	gps: { lat: number | null; lng: number | null; accuracy?: number | null };
	scopeResults?: Array<{ itemId: string; hasilRetur: 'sesuai' | 'tidak_dikerjakan' | 'bermasalah' }>;
}

export async function confirmServisLuarRetur(params: ConfirmRetur): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch('/api/surat-jalan/servis-luar', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify(params)
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body?.message || `Gagal mengonfirmasi retur (${res.status})`);
	}
}
