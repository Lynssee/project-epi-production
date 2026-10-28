// src/lib/services/grandPoLapangan.ts
// Grand PO Fase 5 — klien tipis untuk /api/proyek/[id]/grand-po (read-only, tanpa Rupiah).
import { getIdToken } from './secureDirectus';
import type { AnggotaPaket, BarisMaterial, BarisRekon, PilihanProduk, RingkasSj } from '$lib/utils/grandPoLapangan';

export interface PaketLapangan {
	grand_po_id: number;
	nama: string;
	nomor_gpo: string | null;
	anggota: AnggotaPaket[];
}
export interface MaterialLapangan {
	so_id: number;
	nomor_po: string;
	memasok_belum_ditentukan: boolean;
	items: BarisMaterial[];
	surat_jalan: RingkasSj[];
	estimasi_tiba: string;
}
export interface RekonLapangan {
	baris: BarisRekon[];
	tanpa_produk: number;
	satuan_beda: number;
	toleransi_pct: number;
}
export interface GrandPoLapangan {
	paket: PaketLapangan[];
	material: MaterialLapangan[];
	rekonsiliasi: RekonLapangan | null;
	pilihan_produk: PilihanProduk[];
	warnings: string[];
}

/**
 * Ambil paket Grand PO + material untuk satu proyek.
 * 403 (bukan pemegang proyek) → null: kartu disembunyikan, bukan error. Error lain dilempar agar terlihat.
 */
export async function fetchGrandPoLapangan(projectId: number): Promise<GrandPoLapangan | null> {
	const token = await getIdToken();
	const res = await fetch(`/api/proyek/${projectId}/grand-po`, { headers: { Authorization: `Bearer ${token}` } });
	if (res.status === 403) return null;
	const body = await res.json().catch(() => null);
	if (!res.ok || !body) throw new Error(body?.error || `Gagal memuat Paket Grand PO (HTTP ${res.status})`);
	return body as GrandPoLapangan;
}

export interface HitMaterialCustomerDto {
	material_name: string;
	produk_po: string;
	unit: string;
}

/**
 * Hint shadow untuk PL proyek: barang yang juga ada di PO material customer. Gagal → [] (hint tidak boleh mengunci
 * pengajuan), tapi kegagalan dicatat di console — tidak disembunyikan.
 */
export async function fetchCustomerMaterialHint(projectId: number, names: string[]): Promise<HitMaterialCustomerDto[]> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/packing-list/customer-material-hint', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ projectId, names })
		});
		if (!res.ok) {
			console.warn('[fetchCustomerMaterialHint] HTTP', res.status);
			return [];
		}
		const j = await res.json();
		return Array.isArray(j?.hits) ? j.hits : [];
	} catch (e) {
		console.warn('[fetchCustomerMaterialHint] gagal:', e);
		return [];
	}
}
