// Fase 2 keamanan pondasi (lanjutan) — validasi log BBM driver sebelum dikirim ke
// submitFuelLog() (src/lib/services/driver.ts). UI sebelumnya pakai parseFloat() manual
// tanpa guard konsisten (liter/biaya di-cek, odometer tidak).
import { z } from 'zod';

export const driverFuelLogSchema = z.object({
	vehicle_id: z.string().trim().min(1, 'Pilih kendaraan terlebih dahulu.'),
	liter: z.coerce.number().finite().positive({ message: 'Jumlah liter tidak valid.' }),
	total_biaya: z.coerce.number().finite().positive({ message: 'Total biaya tidak valid.' }),
	odometer: z.coerce.number().finite().nonnegative().nullable(),
	catatan: z.string().trim().optional().default('')
});

export type DriverFuelLogInput = z.input<typeof driverFuelLogSchema>;
