// src/lib/server/aiContextTemplates.ts
// SERVER-ONLY. Port TypeScript dari lib/server/aiContextTemplates.js (erp-epi-1) —
// chip saran pertanyaan per halaman, koleksi Directus `ai_context_templates` yang
// SAMA (instance dibagi kedua repo). Fase 6, implementation_plan_Modul Asisten AI v3.1.md.

import { directusServerJson } from './directus';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SUGGESTIONS = 4;

interface TemplateRow {
	page_pattern: string;
	suggestions: string[] | null;
	target_app: 'admin' | 'field' | 'both';
	sort: number | null;
}

let cache: { rows: TemplateRow[]; exp: number } | null = null;

async function loadAll(): Promise<TemplateRow[]> {
	if (cache && cache.exp > Date.now()) return cache.rows;
	try {
		const res = await directusServerJson<{ data?: TemplateRow[] }>(
			'/items/ai_context_templates?filter[is_active][_eq]=true&sort=sort&limit=-1'
		);
		const rows = res?.data || [];
		cache = { rows, exp: Date.now() + CACHE_TTL_MS };
		return rows;
	} catch (e: any) {
		console.error('[aiContextTemplates] gagal memuat (non-fatal):', e?.message);
		return [];
	}
}

function matchesPattern(pattern: string, pagePath: string): boolean {
	if (!pattern) return false;
	if (pattern === '*') return true;
	if (pattern.endsWith('/*')) {
		const prefix = pattern.slice(0, -2);
		return pagePath === prefix || pagePath.startsWith(`${prefix}/`);
	}
	return pagePath === pattern;
}

const BUILTIN_TEMPLATES: TemplateRow[] = [
	{
		page_pattern: '/marketing/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Bagaimana cara upload dan verifikasi aset DAM?',
			'Cari dokumen brosur atau price list cat',
			'Cek aset marketing yang akan kedaluwarsa',
			'Bagaimana alur persetujuan materi promosi?'
		]
	},
	{
		page_pattern: '/proyek/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek progres fisik proyek & kurva S',
			'Cek alokasi material & packing list',
			'Cek daftar manpower site proyek',
			'Cek status pengajuan anggaran proyek'
		]
	},
	{
		page_pattern: '/leader/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek status laporan harian proyek saya',
			'Cek sisa stok material di site proyek',
			'Cek status Surat Jalan pengiriman material',
			'Bagaimana cara mengajukan barang (requisition)?'
		]
	},
	{
		page_pattern: '/field-report/*',
		target_app: 'field',
		sort: 10,
		suggestions: [
			'Bagaimana format input field report harian?',
			'Cek laporan kendala cuaca atau alat rusak',
			'Cek pencapaian luas area m2 blasting/coating',
			'Cek kehadiran personil tenaga kerja hari ini'
		]
	},
	{
		page_pattern: '/inspection/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek standar kebersihan permukaan blasting (Sa 2.5)',
			'Cek toleransi ketebalan cat DFT sesuai SSPC-PA2',
			'Bagaimana cara input log inspeksi dan dew point?',
			'Cek daftar Non-Conformance Report (NCR) aktif'
		]
	},
	{
		page_pattern: '/perawatan/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek status checklist P2H alat hari ini',
			'Cari riwayat perbaikan equipment kerja',
			'Bagaimana cara membuat tiket lapor kerusakan alat?',
			'Cek jadwal Preventive Maintenance (PM)'
		]
	},
	{
		page_pattern: '/preventive/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek jadwal servis rutin alat kerja',
			'Cek hasil checklist P2H kompresor/genset',
			'Cari riwayat Work Order (WO) mesin',
			'Cek ketersediaan sparepart pemeliharaan'
		]
	},
	{
		page_pattern: '/hse/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Bagaimana SOP pembuatan JSA dan Toolbox Meeting?',
			'Cek persyaratan Izin Kerja Aman (PTW)',
			'Bagaimana alur pelaporan insiden atau near-miss?',
			'Cek standar APD untuk blasting dan spray painting'
		]
	},
	{
		page_pattern: '/jsa/*',
		target_app: 'field',
		sort: 10,
		suggestions: [
			'Cek langkah identifikasi bahaya kerja (JSA)',
			'Cek APD wajib untuk pekerjaan ketinggian / panas',
			'Bagaimana SOP mitigasi risiko semburan pasir/cat?',
			'Cek verifikasi approval JSA oleh HSE Officer'
		]
	},
	{
		page_pattern: '/toolbox/*',
		target_app: 'field',
		sort: 10,
		suggestions: [
			'Apa topik wajib briefing Toolbox Meeting K3 hari ini?',
			'Cek daftar hadir peserta toolbox meeting',
			'Cek catatan keselamatan khusus site proyek',
			'Bagaimana SOP pelaporan kondisi tidak aman (Unsafe Condition)?'
		]
	},
	{
		page_pattern: '/barang/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek stok material & sparepart di lapangan',
			'Cek status Surat Jalan penerimaan barang',
			'Bagaimana cara mencatat pemakaian material proyek?',
			'Cek daftar barang yang dipinjam antar-site'
		]
	},
	{
		page_pattern: '/packing-list/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek item yang dimuat dalam Packing List',
			'Cek status verifikasi penerimaan barang di site',
			'Cek pengembalian sisa material ke gudang pusat',
			'Cari nomor Surat Jalan (SJI) terkait'
		]
	},
	{
		page_pattern: '/anggaran/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek status Pengajuan Anggaran (PA) proyek',
			'Cek sisa pagu anggaran biaya lapangan',
			'Bagaimana cara mengajukan kasbon operasional?',
			'Cek status klaim reimbursement biaya proyek'
		]
	},
	{
		page_pattern: '/requisition/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek status pengajuan barang (Requisition/PR)',
			'Bagaimana cara membuat draf pengajuan barang?',
			'Cek riwayat permintaan material departemen saya',
			'Cek estimasi kedatangan barang yang diajukan'
		]
	},
	{
		page_pattern: '/ess/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cek rekap absensi dan jam kerja saya',
			'Cek sisa saldo cuti tahunan saya',
			'Bagaimana cara mengajukan izin / sakit?',
			'Cek status kasbon dan slip gaji saya'
		]
	},
	{
		page_pattern: '/production/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cari SPK produksi yang sedang berjalan',
			'Cek hasil inspeksi QC batch terbaru',
			'Berapa total output produksi bulan ini?',
			'Cari SPK mendesak yang mendekati deadline'
		]
	},
	{
		page_pattern: '/rnd/*',
		target_app: 'both',
		sort: 10,
		suggestions: [
			'Cari formula cat (misal EP-950 atau PU)',
			'Cari dokumen TDS / MSDS produk',
			'Bagaimana progres proyek riset NPD?',
			'Cek riwayat komplain kualitas cat alur 8D'
		]
	},
	{
		page_pattern: '*',
		target_app: 'both',
		sort: 99,
		suggestions: [
			'Cek stok sparepart / material',
			'Cari nomor Work Order (WO) atau SPK',
			'Cek status P2H alat kerja',
			'Cari dokumen TDS/MSDS atau aset Marketing DAM'
		]
	}
];

export async function getSuggestionsForPage(pagePath: string, targetApp: 'admin' | 'field'): Promise<string[]> {
	const rows = await loadAll();
	const combined = [...rows, ...BUILTIN_TEMPLATES];
	const applicable = combined
		.filter((r) => (r.target_app === targetApp || r.target_app === 'both') && matchesPattern(r.page_pattern, pagePath))
		.sort((a, b) => (a.sort || 0) - (b.sort || 0));
	const first = applicable[0];
	if (!first) return [];
	const list = Array.isArray(first.suggestions) ? first.suggestions : [];
	return list.filter((s) => typeof s === 'string' && s.trim()).slice(0, MAX_SUGGESTIONS);
}

export function invalidateContextTemplatesCache(): void {
	cache = null;
}
