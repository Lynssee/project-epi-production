// src/lib/data/laporanSayaFallback.ts
// Bibit lokal "Laporan Saya" (lapangan) — dipakai bila koleksi Directus `report_catalog` belum ada/kosong.
// Sumber kebenaran runtime = report_catalog (diatur Superadmin di admin /settings/report-catalog).
// Hanya laporan app = lapangan | both dari katalog admin (reportCatalogSeed.js).

export interface LaporanSayaItem {
	key: string;
	title: string;
	department?: string | null;
	level?: string | null;
	source?: string | null;
	route_template?: string | null;
	required_permission?: string | null;
	hint?: string | null;
	sensitive?: boolean | null;
}

export const LAPORAN_SAYA_FALLBACK: LaporanSayaItem[] = [
	{ key: 'monitoring-laporan-harian', title: 'Monitoring Laporan Harian', department: 'project', level: 'departemen', source: 'print', route_template: '/laporan', hint: 'Kepatuhan laporan harian leader.' },
	{ key: 'project-timeline', title: 'Timeline Proyek', department: 'project', level: 'mikro', source: 'print', route_template: '/leader', hint: 'Jadwal kegiatan proyek.' },
	{ key: 'laporan-harian-pdf', title: 'Laporan Harian (PDF)', department: 'project', level: 'mikro', source: 'pdf', route_template: '/laporan', hint: 'Buka dari halaman laporan harian proyek, tombol PDF.' },
	{ key: 'surat-jalan', title: 'Surat Jalan', department: 'inventory', level: 'mikro', source: 'print', route_template: '/lacak-sj', hint: 'Buka dokumen dari halaman Lacak SJ. Cetak ulang tercatat.' }
];
