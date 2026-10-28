// src/lib/server/aiGlossary.ts
// SERVER-ONLY. Pembaca kamus istilah internal (koleksi Directus `ai_glossary`,
// DIBAGI dengan erp-epi-1 — satu sumber data, dua pembaca terpisah, sama
// seperti aiUsageLog.ts/aiChatLog.ts). Diedit dari panel IT > Saldo & Limit AI
// di dashboard admin; dashboard lapangan hanya membaca (tanpa panel sendiri).
// Fase 1 lanjutan — Rencana Implementasi Asisten Eltama v2.0 §13/§15.

import { directusServerJson } from './directus';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { text: string; exp: number } | null = null;

const FALLBACK_TEXT = `Kamus istilah internal Eltama (fallback bawaan — panel IT > Saldo & Limit AI belum diisi atau tidak terjangkau):
- SO = Sales Order (Pesanan Penjualan Pelanggan), PO = Purchase Order (Pesanan Pembelian Supplier), WO = Work Order (Perintah Kerja Perbaikan)
- SPK = Surat Perintah Kerja (Produksi Pabrik / Pelaksanaan Proyek Lapangan)
- PA = Pengajuan Anggaran (Biaya/Cash Out), PR / Requisition = Permintaan Pembelian Barang
- DAM = Digital Asset Management (Repositori Aset Desain, Brosur & Marketing)
- CRM = Customer Relationship Management (Pipeline Leads, Prospek & Penawaran)
- QC = Quality Control, QA = Quality Assurance
- RAB = Rencana Anggaran Biaya (Estimasi Proyek), RAP = Rencana Anggaran Proyek (Target Biaya Aktual)
- ITP = Inspection and Test Plan (Rencana Pengujian Mutu Coating Proyek)
- NCR = Non-Conformance Report (Laporan Ketidaksesuaian Mutu), RFI = Request for Inspection
- DFT = Dry Film Thickness (Ketebalan Cat Kering, um), WFT = Wet Film Thickness (Ketebalan Cat Basah, um)
- P2H = Pemeriksaan dan Perawatan Harian (Checklist Harian Alat/Equipment)
- PM = Preventive Maintenance (Perawatan Rutin Terjadwal), CM = Corrective Maintenance (Perbaikan Kerusakan)
- MTBF = Mean Time Between Failures (Rata-rata Hari Antar Kerusakan Alat)
- MTTR = Mean Time To Repair (Rata-rata Durasi Perbaikan Alat)
- HSE / K3 = Health, Safety, and Environment (Keselamatan & Kesehatan Kerja serta Lindungan Lingkungan)
- JSA = Job Safety Analysis (Analisis Keselamatan Pekerjaan), PTW = Permit to Work (Surat Izin Kerja Aman)
- APD = Alat Pelindung Diri, B3 = Bahan Berbahaya dan Beracun, SMK3 = Sistem Manajemen K3
- TKDN = Tingkat Komponen Dalam Negeri (Sertifikasi Kandungan Lokal Produk)
- LPSE = Layanan Pengadaan Secara Elektronik (Tender Pengadaan Pemerintah/BUMN)
- ESS = Employee Self Service (Portal Layanan Mandiri Karyawan: Cuti, Izin, Absensi, Kasbon, Slip Gaji)
- PKWT = Perjanjian Kerja Waktu Tertentu (Kontrak), PKWTT = Perjanjian Kerja Waktu Tidak Tertentu (Tetap)
- SJI = Surat Jalan Internal, GR = Goods Receipt (Bukti Penerimaan Barang), RFQ = Request for Quotation
- BAST = Berita Acara Serah Terima (Penyelesaian Pekerjaan Proyek)
- R&D / RnD = Research & Development (Riset dan Pengembangan Produk Cat & Formula)
- NPD = New Product Development (Proyek Pengembangan Produk Baru)
- RMC = Raw Material Cost (Biaya Bahan Baku Formula), BOM = Bill of Materials (Komposisi Formula)
- TDS = Technical Data Sheet (Spesifikasi Teknis Produk), MSDS = Material Safety Data Sheet (Lembar Keselamatan)
- KU = Krebs Unit (Viskositas Cat), BJ / SG = Berat Jenis / Specific Gravity (Density g/cm3)
- NV = Non-Volatile / Solid Content (% Padatan), Hegman = Kehalusan Gilingan Cat
- 8D = Eight Disciplines (Metode Investigasi & Solusi Komplain Kualitas Cat)`;

function formatGlossary(rows: Array<{ singkatan: string; arti: string; keterangan?: string }>): string {
	if (!rows.length) return '';
	const lines = rows.map((r) => `- ${r.singkatan} = ${r.arti}${r.keterangan ? ` (${r.keterangan})` : ''}`);
	return `Kamus istilah internal Eltama:\n${lines.join('\n')}`;
}

export async function getGlossaryText(): Promise<string> {
	if (cache && cache.exp > Date.now()) return cache.text;

	try {
		const res = await directusServerJson<{ data: any[] }>(
			'/items/ai_glossary?filter[aktif][_eq]=true&sort=sort,singkatan&fields=singkatan,arti,keterangan&limit=-1'
		);
		const rows = res?.data || [];
		const text = formatGlossary(rows) || FALLBACK_TEXT;
		cache = { text, exp: Date.now() + CACHE_TTL_MS };
		return text;
	} catch (e: any) {
		console.error('[aiGlossary] gagal memuat ai_glossary (pakai fallback):', e?.message);
		return FALLBACK_TEXT;
	}
}
