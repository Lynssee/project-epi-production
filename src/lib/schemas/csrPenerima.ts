// Fase 2 keamanan pondasi (lanjutan) — validasi pendaftaran penerima manfaat CSR
// sebelum dikirim ke submitPenerima() (src/lib/services/csr.ts). NIK (kalau diisi)
// divalidasi format 16-digit standar KTP Indonesia — sebelumnya nol validasi format.
import { z } from 'zod';

export const csrPenerimaSchema = z.object({
	program_id: z.coerce.number().int().positive({ message: 'Pilih program CSR terlebih dahulu.' }),
	nama: z.string().trim().min(1, 'Nama penerima wajib diisi.'),
	kategori: z.enum(['individu', 'kelompok', 'lembaga']),
	desa_wilayah: z.string().trim().optional().default(''),
	kontak: z.string().trim().optional().default(''),
	nik: z
		.string()
		.trim()
		.refine((v) => v === '' || /^\d{16}$/.test(v), 'NIK harus 16 digit angka.')
		.default(''),
	consent_pdp: z.boolean().refine((v) => v === true, 'Penerima wajib menyetujui penggunaan data pribadinya (consent PDP).')
});

export type CsrPenerimaInput = z.input<typeof csrPenerimaSchema>;
