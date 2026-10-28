// src/lib/services/materialChain.ts
// Rantai Bahan SPK v2, Fase 4.1 (2 Sep 2026) — klien tipis ke mesin materialChain.js
// di erp-epi (server-only di sana, tidak bisa diimpor langsung). Sama pola dengan
// labelPrintApi.ts/projectClosureLapangan.ts: fetch cross-origin ke admin app pakai
// Bearer token Firebase yang sama (satu project Firebase untuk kedua app). Tidak
// menghitung ulang apa pun di sini — murni pass-through + tipe.

import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';

export interface RantaiBahanOverviewRow {
	spkId: number;
	nomor: string;
	status: string;
	materialCount: number;
	shortageCount: number;
	untrackedCount: number;
	soNumber: string | null;
	customerName: string | null;
	tanggalKirim: string | null;
	hasSoReference: boolean;
	worstOpenEta: string | null;
	estimasiSelesai: string | null;
	telatHari: number | null;
}

export interface RantaiBahanOverview {
	summary: {
		spkMenunggu: number;
		materialKurang: number;
		sudahDiPo: number;
		dalamPerjalanan: number;
		tibaSebagian: number;
	};
	rows: RantaiBahanOverviewRow[];
}

async function callCrossDept(scope: string, params: Record<string, string> = {}): Promise<any | null> {
	try {
		const token = await getIdToken();
		const qs = new URLSearchParams(params).toString();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/cross-dept/${scope}${qs ? `?${qs}` : ''}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			console.warn(`[materialChain] cross-dept ${scope} gagal (${res.status})`);
			return null;
		}
		const body = await res.json();
		return body?.data ?? null;
	} catch (err) {
		console.warn(`[materialChain] cross-dept ${scope} error:`, err);
		return null;
	}
}

/** Ringkasan semua SPK terbuka (§4.3 "⏳ Menunggu Bahan" di beranda /produksi). */
export async function fetchRantaiBahanOverview(): Promise<RantaiBahanOverview | null> {
	const data = await callCrossDept('rantai-bahan-spk');
	if (!data) return null;
	return { summary: data.summary || {}, rows: data.rows || [] };
}

export interface RantaiBahanMaterialPo {
	id: number;
	poNumber: string;
	supplierName: string | null;
	status: string;
	deliveryDate: string | null;
	etaSource: 'supplier' | 'estimasi_leadtime' | 'warisan';
	receivedDate: string | null;
	paymentTerms: string | null;
	quantity: number;
	receivedQty: number;
	progressPct: number | null;
}

export interface RantaiBahanMaterial {
	itemId: number;
	itemName: string;
	satuan: string | null;
	stokAvailable: number;
	requiredQty: number;
	tracked: boolean;
	worstOpenEta: string | null;
	prList: Array<{ pengajuanId: number; status: string | null; poList: RantaiBahanMaterialPo[] }>;
}

export interface RantaiBahanSpkChain {
	spkId: number;
	nomor: string;
	status: string;
	so: { nomorSo: string; customerName: string; tanggalKirim: string } | null;
	materials: RantaiBahanMaterial[];
	risk: {
		jangkarTanggal: string | null;
		jangkarSource: 'so' | 'production_deadline' | null;
		estimasiSelesai: string | null;
		telatHari: number | null;
		hasSoReference: boolean;
	};
}

/** Rantai lengkap satu SPK (dipakai kartu "Bahan untuk SPK saya" bila perlu detail). */
export async function fetchRantaiBahanForSpk(spkId: number): Promise<RantaiBahanSpkChain | null> {
	const data = await callCrossDept('rantai-bahan-spk', { spk_id: String(spkId) });
	return data?.chain ?? null;
}
