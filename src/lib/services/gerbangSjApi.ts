// src/lib/services/gerbangSjApi.ts
// GSP-09 — klien tipis ke /api/gerbang-sj/* (satu pintu server). Tidak ada tulis langsung ke Directus.
// `getHeaders` dipasok layar: app HP → Bearer Firebase; kiosk → kosong (cookie sesi ikut otomatis).

import { TEKS } from '$lib/data/gerbangSjTeks';

export type GBlocker = { kode: string; pesan: string; siapa: string | null };
export type GWarning = { kode: string; pesan: string };

export type GAntrianRow = {
	id: number; nomor_sj: string; tujuan: string | null; driver: string | null; plat: string | null;
	koli_acuan: number | null; koli_sumber: 'fleet' | 'item' | null; menunggu_menit: number | null; terlambat: boolean;
	can_pass: boolean; ditahan: boolean; alasan_tahan: string | null; blockers: GBlocker[];
	is_pre_print?: boolean; draft_status?: string | null;
	belum_discan_muat?: boolean;
};
export type GItem = { id: number; nama_barang: string; qty: number; unit: string | null; koli: number | null; keterangan: string | null };
export type GDetail = {
	sj: {
		id: number; nomor_sj: string; status: string; driver: string | null; plat: string | null; tujuan: string | null;
		koli_acuan: number | null; koli_sumber: 'fleet' | 'item' | null; menunggu_menit: number | null;
		security_verified_by: string | null; return_status: string | null; return_deadline: string | null;
		draft_status?: string | null; print_count?: number;
		foto_gudang_id?: string | null;
		gudang_disiapkan_oleh?: string | null;
		gudang_disiapkan_at?: string | null;
		admin_verif_oleh?: string | null;
		admin_verif_at?: string | null;
		admin_verif_foto?: string | null;
	};
	items: GItem[];
	checklist: { hasil?: string; alasan?: string | null; oleh_nama?: string | null; waktu?: string | null; kategori?: string | null } | null;
	already_passed: boolean; can_pass: boolean; ditahan: boolean;
	blockers: GBlocker[]; warnings: GWarning[];
	riwayat_gerbang: { waktu: string; oleh_id: number | null; catatan: string | null; tahap: string | null }[];
};
export type GHasil = { ok: true; hasil: 'lolos' | 'ditahan'; idempoten: boolean; pesan: string; effects_gagal: string[] };

// RSM-04 — gerbang MASUK retur dari proyek (dokumen RTN)
export type GReturDoc = {
	id: number; nomor_retur: string; status: string; sumber: string | null; project_id: number | null; proyek: string | null;
	driver_name: string | null; driver_phone: string | null; vehicle_plate: string | null; shipped_at: string | null;
	security_verified_at: string | null; security_verified_by: string | null;
	items: { id: number; material_name: string; qty_returned: number; unit: string }[]; alat: number;
	menunggu_menit?: number | null;
};
export type GReturCek = { key: string; label: string };
export type GReturHasil = { ok: true; hasil: 'lolos' | 'ditahan' | 'dicatat'; idempoten: boolean; doc: { id: number; nomor_retur: string; status: string }; pesan: string; effects_gagal: string[] };

// RSM-13 — e-SJ Mutasi rute via_gudang di gerbang
export type GMutasiDoc = {
	id: number; nomor_mutasi: string; jenis: string; status: string; asal: string; tujuan: string;
	driver_name: string | null; driver_phone: string | null; vehicle_plate: string | null; shipped_at: string | null;
	items: { id: number; nama: string; qty: number; unit: string }[];
	menunggu_menit?: number | null;
};
export type GMutasiHasil = { ok: true; hasil: 'lolos' | 'ditahan'; idempoten: boolean; doc: { id: number; nomor_mutasi: string; status: string }; pesan: string; effects_gagal: string[] };

export type GPenjualanRow = {
	id: number; nomor_sj: string; customer: string | null; tujuan: string | null; driver: string | null; plat: string | null;
	dibuat: string; menunggu_menit: number | null;
	ditahan: boolean; alasan_tahan: string | null;
};

// WSK-35 4b — SJ Keluar Workshop (Ciketing & Balaraja) di gerbang: /api/gerbang-workshop/*
export type GWsKey = 'ciketing' | 'balaraja';
export type GWsAntrianRow = {
	workshop: GWsKey; label: string; header_id: number; no_sj: string; tujuan: string | null; jumlah_item: number;
	approval: 'approved' | 'menunggu' | 'rejected'; siap_gudang: boolean; dibuat: string | null; menunggu_menit: number | null;
	can_pass: boolean; ditahan: boolean; alasan_tahan: string | null;
};
export type GWsDetail = {
	workshop: GWsKey; label: string; header_id: number; no_sj: string; tanggal: string | null; tujuan: string | null; project_nama: string | null;
	items: { nama_barang: string; no_part: string | null; qty: number; satuan: string | null; luasan_m2: number | null }[];
	approval: 'approved' | 'menunggu' | 'rejected'; approval_oleh: string | null; catatan_finance: string | null;
	siap_gudang: { oleh: string | null; waktu: string | null } | null;
	sudah_lolos: boolean; lolos_oleh: string | null; lolos_waktu: string | null;
	ditahan: { alasan: string | null; oleh: string | null; waktu: string | null } | null;
	blockers: GBlocker[]; warnings: GWarning[]; can_pass: boolean;
};

export class GerbangApiError extends Error {
	constructor(public kode: string, message: string, public status: number, public blockers: GBlocker[] = []) {
		super(message);
		this.name = 'GerbangApiError';
	}
}

export type GerbangApi = ReturnType<typeof createGerbangApi>;

const WS_BASE = '/api/gerbang-workshop';

export function createGerbangApi(getHeaders: () => Promise<Record<string, string>>, base = '/api/gerbang-sj') {
	async function call<T>(path: string, init: { method?: string; json?: unknown; form?: FormData; base?: string } = {}): Promise<T> {
		let res: Response;
		try {
			const headers = await getHeaders();
			res = await fetch(`${init.base ?? base}${path}`, {
				method: init.method || (init.json || init.form ? 'POST' : 'GET'),
				headers: { ...headers, ...(init.json ? { 'Content-Type': 'application/json' } : {}) },
				body: init.form ?? (init.json ? JSON.stringify(init.json) : undefined)
			});
		} catch (e) {
			if (e instanceof GerbangApiError) throw e;
			// jaringan putus → tidak ada data setengah tersimpan (server belum menerima apa pun)
			throw new GerbangApiError('SERVER_LAPANGAN_TIDAK_TERJANGKAU', e instanceof Error && e.message.includes('login') ? e.message : TEKS.tidakTerhubung, 0);
		}
		const body = await res.json().catch(() => null);
		if (!res.ok || !body?.ok) {
			throw new GerbangApiError(body?.kode || 'INPUT_TIDAK_VALID', body?.pesan || body?.message || `Gagal (${res.status})`, res.status, body?.blockers || []);
		}
		return body as T;
	}
	return {
		antrian: () => call<{ aktor: { nama: string; sumber: string }; count: number; antrian: GAntrianRow[] }>('/antrian'),
		cari: (q: { code?: string; nomor?: string }) => call<GDetail & { ok: true }>('/cari', { json: q }),
		detail: (id: number) => call<GDetail & { ok: true }>(`/${id}`),
		foto: async (id: number, file: File) => {
			const form = new FormData();
			form.append('foto', file);
			return (await call<{ file_id: string }>(`/${id}/foto`, { form })).file_id;
		},
		loloskan: (id: number, body: Record<string, unknown>) => call<GHasil>(`/${id}/loloskan`, { json: body }),
		// SJ-09 opsi C: SJ penjualan — hanya mencatat lolos gerbang, status SJ tidak berubah
		// RSM-04: retur masuk (hanya dokumen RTN berstatus dikirim yang bisa diloloskan)
		antrianRetur: () => call<{ count: number; antrian: GReturDoc[]; checklist: GReturCek[] }>('/antrian-retur'),
		cariRetur: (q: string) => call<{ doc: GReturDoc; perlu_tandai_berangkat: boolean; sudah_diverifikasi: boolean; pesan: string | null; checklist: GReturCek[] }>(`/cari-retur?q=${encodeURIComponent(q)}`),
		loloskanRetur: (id: number, body: Record<string, unknown>) => call<GReturHasil>(`/${id}/loloskan-retur`, { json: body }),
		tahanRetur: (id: number, body: Record<string, unknown>) => call<GReturHasil>(`/${id}/tahan-retur`, { json: body }),
		catatReturTanpaDokumen: (body: Record<string, unknown>) => call<GReturHasil>('/retur-tanpa-dokumen', { json: body }),
		antrianMutasi: () => call<{ count: number; antrian: GMutasiDoc[]; checklist: GReturCek[] }>('/antrian-mutasi'),
		loloskanMutasi: (id: number, body: Record<string, unknown>) => call<GMutasiHasil>(`/${id}/loloskan-mutasi`, { json: body }),
		tahanMutasi: (id: number, body: Record<string, unknown>) => call<GMutasiHasil>(`/${id}/tahan-mutasi`, { json: body }),
		antrianPenjualan: () => call<{ aktif: boolean; count: number; antrian: GPenjualanRow[] }>('/antrian-penjualan'),
		loloskanPenjualan: (id: number, body: Record<string, unknown>) => call<GHasil>(`/${id}/loloskan-penjualan`, { json: body }),
		tahanPenjualan: (id: number, body: Record<string, unknown>) => call<GHasil>(`/${id}/tahan-penjualan`, { json: body }),
		tahan: (id: number, body: Record<string, unknown>) => call<GHasil>(`/${id}/tahan`, { json: body }),
		// WSK-35 4b — SJ Keluar Workshop (Ciketing & Balaraja)
		workshop: {
			antrian: () => call<{ aktor: { nama: string; sumber: string }; count: number; antrian: GWsAntrianRow[] }>('/antrian', { base: WS_BASE }),
			cari: (q: { code?: string; nomor?: string }) => call<{ detail: GWsDetail }>('/cari', { json: q, base: WS_BASE }),
			detail: (ws: GWsKey, id: number) => call<{ detail: GWsDetail }>(`/${ws}/${id}`, { base: WS_BASE }),
			loloskan: (ws: GWsKey, id: number, body: Record<string, unknown>) => call<GHasil>(`/${ws}/${id}/loloskan`, { json: body, base: WS_BASE }),
			tahan: (ws: GWsKey, id: number, body: Record<string, unknown>) => call<GHasil>(`/${ws}/${id}/tahan`, { json: body, base: WS_BASE })
		}
	};
}
