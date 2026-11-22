// src/lib/config/rndFieldTabs.ts
// Pengelompokan 10 tab R&D lapangan (+ 2 fitur baru) menjadi 4 kelompok ringkas untuk layar HP (blueprint SOP R&D Fase 6).
// MURNI — id tab sama dengan yang dipakai halaman (app)/rnd; hanya cara menampilkannya yang dikelompokkan.

export type RndTab =
	| 'tds' | 'msds' | 'b3' | 'katalog' | 'kompat' | 'mixing' | 'retensi' | 'weathering' | 'lapor' | 'minta'
	| 'dewpoint' | 'saya';

export interface RndTabGroup {
	id: 'dokumen' | 'panduan' | 'log' | 'lapor';
	icon: string;
	label: string;
	hint: string;
	tabs: { id: RndTab; label: string }[];
}

export const RND_TAB_GROUPS: RndTabGroup[] = [
	{
		id: 'dokumen', icon: '📄', label: 'Dokumen & K3', hint: 'Cari TDS/MSDS, akses darurat B3, atau minta dokumen yang belum ada',
		tabs: [{ id: 'tds', label: 'TDS' }, { id: 'msds', label: 'MSDS' }, { id: 'b3', label: 'B3 Darurat' }, { id: 'minta', label: 'Minta Dokumen' }]
	},
	{
		id: 'panduan', icon: '🧪', label: 'Panduan & Mixing', hint: 'Hitung campuran, cek bahan boleh dicampur, dan baca profil bahan',
		tabs: [{ id: 'mixing', label: 'Kalkulator Campuran' }, { id: 'kompat', label: 'Cek Campur' }, { id: 'katalog', label: 'Katalog Bahan' }]
	},
	{
		id: 'log', icon: '📋', label: 'Log QC Lapangan', hint: 'Catat retensi sample dan weathering, dan cek cuaca layak cat (dew point)',
		tabs: [{ id: 'retensi', label: 'Retensi Sample' }, { id: 'weathering', label: 'Weathering' }, { id: 'dewpoint', label: 'Dew Point & Cuaca' }]
	},
	{
		id: 'lapor', icon: '🚨', label: 'Lapor & Lacak', hint: 'Laporkan masalah produk dan pantau tindak lanjutnya dari R&D',
		tabs: [{ id: 'lapor', label: 'Lapor Masalah' }, { id: 'saya', label: 'Status Laporan Saya' }]
	}
];

/** Kelompok yang memuat tab tertentu; jatuh ke kelompok pertama bila tak dikenal. */
export function groupOfTab(tab: string): RndTabGroup {
	return RND_TAB_GROUPS.find((g) => g.tabs.some((t) => t.id === tab)) ?? RND_TAB_GROUPS[0];
}

/** Tahap 8D dari `customer_complaints.status` → label singkat untuk pelapor lapangan. */
export const COMPLAINT_STAGE_LABEL: Record<string, string> = {
	diterima: 'D0 · Laporan diterima R&D',
	investigasi: 'D1-D2 · Sedang diinvestigasi',
	tindakan_sementara: 'D3 · Tindakan sementara',
	akar_masalah: 'D4 · Mencari akar masalah',
	solusi: 'D5-D6 · Menyusun solusi',
	verifikasi: 'D7 · Verifikasi solusi',
	tutup: 'D8 · Selesai / ditutup'
};
export const complaintStageLabel = (status: string | null | undefined) => COMPLAINT_STAGE_LABEL[String(status ?? '')] ?? (status ? String(status) : '-');

/** Status permintaan dokumen (`rnd_permintaan_dokumen.status`) → label. */
export const DOC_REQUEST_STATUS_LABEL: Record<string, string> = { baru: 'Menunggu R&D', diproses: 'Sedang diproses', selesai: 'Dokumen tersedia', ditolak: 'Ditolak' };
export const docRequestStatusLabel = (s: string | null | undefined) => DOC_REQUEST_STATUS_LABEL[String(s ?? '')] ?? (s ? String(s) : '-');
