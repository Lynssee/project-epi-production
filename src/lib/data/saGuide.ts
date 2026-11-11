// src/lib/data/saGuide.ts
// Panduan singkat standar kebersihan permukaan hasil blasting (ISO 8501-1 / SSPC) untuk form inspeksi lapangan.
// Isi = RINGKASAN kriteria dalam kata-kata sendiri sebagai pengingat cepat — BUKAN pengganti standar. Foto acuan resmi
// ISO 8501-1 / SSPC-VIS 1 berhak cipta berlisensi, sehingga tidak disematkan: bandingkan permukaan dengan kartu/buku
// acuan resmi yang tersedia di lokasi.

export interface SaGrade {
	/** Cocok dengan pilihan standar_sa di setelan (case-insensitive). */
	grade: string;
	nama: string;
	sspc: string;
	kriteria: string;
	sisa: string;
	umumUntuk: string;
}

export const SA_GRADES: SaGrade[] = [
	{
		grade: 'Sa 1', nama: 'Light blast cleaning', sspc: 'SSPC-SP 7 (Brush-off)',
		kriteria: 'Karat longgar, mill scale longgar, cat lepas, dan kotoran terlihat hilang.',
		sisa: 'Mill scale / karat / cat yang menempel kuat masih boleh tersisa.',
		umumUntuk: 'Pembersihan ringan; jarang untuk sistem epoxy/zinc.'
	},
	{
		grade: 'Sa 2', nama: 'Thorough blast cleaning', sspc: 'SSPC-SP 6 (Commercial)',
		kriteria: 'Hampir seluruh mill scale, karat, dan cat lama terangkat; permukaan bebas minyak, gemuk, dan kotoran.',
        sisa: 'Sisa tersebar hanya berupa bayangan/bintik/garis halus, maksimal sekitar sepertiga luas tiap area.',
		umumUntuk: 'Cat sistem standar di lingkungan ringan–sedang.'
	},
	{
		grade: 'Sa 2.5', nama: 'Very thorough blast cleaning', sspc: 'SSPC-SP 10 (Near-white)',
		kriteria: 'Mill scale, karat, dan cat lama hilang; permukaan bebas minyak, gemuk, dan kotoran.',
		sisa: 'Sisa hanya bayangan halus/bintik/garis, maksimal sekitar 5% tiap area.',
		umumUntuk: 'Standar umum epoxy/zinc-rich, lingkungan industri & marine.'
	},
	{
		grade: 'Sa 3', nama: 'Blast cleaning to visually clean steel', sspc: 'SSPC-SP 5 (White metal)',
		kriteria: 'Semua mill scale, karat, dan cat lama hilang total.',
		sisa: 'Tidak boleh ada sisa; warna logam seragam abu-abu keputihan.',
		umumUntuk: 'Lining tangki, rendaman, atau lingkungan sangat korosif.'
	}
];

export const KARAT_AWAL = [
	{ kode: 'A', arti: 'Mill scale utuh menutup baja, hampir tanpa karat.' },
	{ kode: 'B', arti: 'Mill scale mulai terkelupas, sudah ada karat.' },
	{ kode: 'C', arti: 'Mill scale sudah habis berkarat atau mudah dikerik; sedikit pitting terlihat.' },
	{ kode: 'D', arti: 'Mill scale habis, karat berat dengan pitting jelas.' }
];

export const CEK_SEBELUM_CAT = [
	'Bandingkan langsung dengan kartu/buku acuan ISO 8501-1 atau SSPC-VIS 1 di lokasi (pencahayaan cukup, jarak tangan).',
	'Debu hasil blasting dibersihkan (cek rating debu ISO 8502-3), permukaan bebas minyak dan garam larut.',
	'Ukur profil permukaan (replica tape / gauge) dan catat di kolom Surface Profile.',
	'Cat primer harus segera diaplikasikan; jangan menunggu permukaan berkarat kembali (flash rust).',
	'Hasil di bawah target Sa: ulangi blasting area itu dan foto sebelum/sesudah.'
];

export function findSaGrade(label: string | null | undefined): SaGrade | null {
	const t = String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
	if (!t) return null;
	return SA_GRADES.find((g) => g.grade.toLowerCase() === t) || null;
}
