// Fase 2 keamanan pondasi (lanjutan) — validasi kegiatan CSR sebelum dikirim ke
// submitKegiatan() (src/lib/services/csr.ts). Sebelumnya jumlah_penerima tidak
// divalidasi sama sekali (bisa negatif).
import { z } from 'zod';

export const csrKegiatanSchema = z.object({
	program_id: z.coerce.number().int().positive({ message: 'Pilih program CSR terlebih dahulu.' }),
	jenis: z.string().trim().min(1, 'Jenis kegiatan wajib diisi.'),
	jumlah_penerima: z.coerce.number().int().nonnegative(),
	catatan_lapangan: z.string().trim().optional().default(''),
	lat: z.number().nullable(),
	lng: z.number().nullable()
});

export type CsrKegiatanInput = z.input<typeof csrKegiatanSchema>;
