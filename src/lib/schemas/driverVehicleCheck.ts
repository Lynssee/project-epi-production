// Fase 2 keamanan pondasi (lanjutan) — validasi checklist P2H kendaraan sebelum dikirim
// ke submitVehicleCheck() (src/lib/services/driver.ts).
import { z } from 'zod';

// ESS Redesign — template P2H config-driven pakai key/label + status 3 nilai.
// `name` dipertahankan opsional untuk kompat data lama.
export const vehicleCheckItemSchema = z
	.object({
		key: z.string().trim().min(1).optional(),
		label: z.string().trim().min(1).optional(),
		name: z.string().trim().min(1).optional(),
		status: z.enum(['ok', 'rusak', 'tidak_ada']),
		kritis: z.boolean()
	})
	.refine((i) => !!(i.key || i.label || i.name), { message: 'Item checklist tidak punya identitas.' });

export const driverVehicleCheckSchema = z.object({
	vehicle_id: z.string().trim().min(1, 'Pilih kendaraan terlebih dahulu.'),
	items: z.array(vehicleCheckItemSchema).min(1),
	temuan: z.string().trim().optional().default(''),
	km_saat_cek: z.number().nonnegative().nullable().optional()
});

export type DriverVehicleCheckInput = z.input<typeof driverVehicleCheckSchema>;
