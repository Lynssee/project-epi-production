// Fase 2 keamanan pondasi (lanjutan) — validasi Proof of Delivery driver sebelum
// dikirim ke submitPod() (src/lib/services/driver.ts). Nama penerima wajib HANYA kalau
// status 'tiba' — sama seperti guard manual sebelumnya, sekarang lewat superRefine.
import { z } from 'zod';

export const driverPodSchema = z
	.object({
		status: z.enum(['tiba', 'gagal']),
		penerima_nama: z.string().trim().optional(),
		catatan: z.string().trim().optional(),
		lat: z.number().optional(),
		lng: z.number().optional()
	})
	.superRefine((val, ctx) => {
		if (val.status === 'tiba' && !val.penerima_nama) {
			ctx.addIssue({ code: 'custom', message: 'Nama penerima wajib diisi.', path: ['penerima_nama'] });
		}
	});

export type DriverPodInput = z.input<typeof driverPodSchema>;
