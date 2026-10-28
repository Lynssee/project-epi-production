// src/lib/services/weatherLokasi.ts
// Pusat Intelijen v2 Fase 4 (§6 L1) — klien tipis ke bmkgClient.js di erp-epi (server-only di
// sana, cross-dept scope 'cuaca-lokasi'). Sama pola dengan plTracking.ts/materialChain.ts:
// fetch cross-origin ke admin app pakai Bearer token Firebase yang sama.

import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';

export interface CuacaHarian {
	tanggal: string;
	hujan: boolean;
	maxRainMm: number;
	ringkasan: string;
}

export interface CuacaLokasi {
	projectId: number | string;
	adm4: string | null;
	lokasiLabel: string | null;
	sumber: 'BMKG';
	hariIni: CuacaHarian | null;
	forecastHarian: CuacaHarian[];
}

/** null = proyek belum diisi kode wilayah BMKG (widget wajib disembunyikan diam-diam, bukan error). */
export async function fetchCuacaLokasi(projectId: number | string): Promise<CuacaLokasi | null> {
	try {
		const token = await getIdToken();
		const res = await fetch(`/api/cross-dept/cuaca-lokasi?project_id=${encodeURIComponent(String(projectId))}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			console.warn(`[weatherLokasi] cross-dept cuaca-lokasi gagal (${res.status})`);
			return null;
		}
		const body = await res.json();
		const data = body?.data as CuacaLokasi | undefined;
		if (!data || !data.adm4) return null;
		return data;
	} catch (err) {
		console.warn('[weatherLokasi] cross-dept cuaca-lokasi error:', err);
		return null;
	}
}
