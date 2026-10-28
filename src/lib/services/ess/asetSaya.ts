// src/lib/services/ess/asetSaya.ts
// Client-side service ESS "Aset & Alat Saya" — selalu lewat /api/ess/aset-saya.

import { auth } from '$lib/firebase';

export interface AsetItTetap {
	id: number;
	name: string | null;
	type: string | null;
	category: string | null;
	serial_number: string | null;
	asset_tag: string | null;
	kondisi: string | null;
	lifecycle_status: string | null;
	location: string | null;
	_tertaut_resmi: boolean;
}

export interface AsetItPinjaman {
	id: number;
	tanggal_pinjam: string | null;
	tanggal_target_kembali: string | null;
	status_pinjam: string | null;
	asset_item_id: { name: string | null; asset_tag: string | null } | null;
	_tertaut_resmi: boolean;
}

export interface AsetGaFasilitas {
	id: number;
	kode: string | null;
	nama: string | null;
	kategori: string | null;
	kondisi: string | null;
	status: string | null;
	lokasi_id: { location_name: string | null } | null;
	qty: number | null;
	mode_lacak: string | null;
}

export interface AsetAlatLapangan {
	id: number;
	equipment_id: { name: string | null; code: string | null; parent_category: string | null } | null;
	start_date: string | null;
	end_date_planned: string | null;
	purpose: string | null;
	project_id: { name: string | null } | null;
}

export interface AsetSayaSummary {
	itTetap: AsetItTetap[];
	itPinjaman: AsetItPinjaman[];
	gaFasilitas: AsetGaFasilitas[];
	alatLapangan: AsetAlatLapangan[];
	totalItem: number;
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

export async function getAsetSaya(): Promise<AsetSayaSummary> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/aset-saya', {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
