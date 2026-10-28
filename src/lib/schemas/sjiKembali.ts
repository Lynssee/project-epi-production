// Fase 2 keamanan pondasi (lanjutan) — validasi konfirmasi pengembalian Peminjaman SJI
// sebelum dikirim ke kembalikanPeminjaman() (src/lib/services/sjiApi.ts). Sebelumnya
// handleSubmit di halaman ini TIDAK punya validasi sama sekali (nol guard).
import { z } from 'zod';

export const sjiKembaliSchema = z.object({
	kondisi_kembali: z.enum(['baik', 'rusak', 'hilang']),
	catatan_pengecekan: z.string().trim().optional().default(''),
	lat: z.number().nullable(),
	lng: z.number().nullable()
});

export type SjiKembaliInput = z.input<typeof sjiKembaliSchema>;
