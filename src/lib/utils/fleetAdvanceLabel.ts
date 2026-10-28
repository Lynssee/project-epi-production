// Peminjaman 06 Fase 2 — label & petunjuk status uang muka untuk peminjam (pengguna awam di HP).
// Uang muka kini satu jalur: Petty Cash (Finance → Petty Cash → Pengajuan Masuk). Status booking.advance_status:
//   diajukan → menunggu booking disetujui · menunggu_kasir → menunggu pencairan kasir · dicairkan → sudah cair
//   settled → LPJ selesai · ditolak / dibatalkan. 'disetujui' = nilai LAMA (jalur fleet.cash_advance) — tetap dikenali.

export interface LabelUangMuka {
	label: string;
	hint: string;
}

const PETA: Record<string, LabelUangMuka> = {
	diajukan: {
		label: 'Menunggu booking disetujui',
		hint: 'Uang muka diproses otomatis setelah peminjaman Anda disetujui. Tidak perlu mengajukan lagi.'
	},
	menunggu_kasir: {
		label: 'Menunggu pencairan kasir',
		hint: 'Peminjaman sudah disetujui. Ambil uang muka ke Kasir Kas Kecil.'
	},
	dicairkan: {
		label: 'Sudah dicairkan',
		hint: 'Simpan semua struk (BBM, tol, parkir) untuk LPJ Kas Kecil. Jangan diajukan lewat Biaya Lapangan.'
	},
	settled: {
		label: 'Selesai',
		hint: 'LPJ sudah diverifikasi kasir.'
	},
	ditolak: {
		label: 'Ditolak',
		hint: 'Pengajuan uang muka ditolak. Hubungi Finance bila perlu.'
	},
	dibatalkan: {
		label: 'Dibatalkan',
		hint: 'Peminjaman dibatalkan. Bila uang sudah Anda terima, kembalikan ke kasir.'
	},
	// nilai lama jalur fleet.cash_advance
	disetujui: {
		label: 'Disetujui — menunggu pencairan',
		hint: 'Ambil uang muka ke Finance.'
	}
};

export function labelUangMuka(status: string | null | undefined): LabelUangMuka {
	return PETA[String(status ?? '')] ?? { label: '—', hint: '' };
}
