// Fase 2 keamanan pondasi (lanjutan) — validasi biaya trip (BBM/tol/parkir/lain) sebelum
// dikirim ke submitTripExpense() (src/lib/services/driver.ts).
import { z } from 'zod';

export const driverTripExpenseSchema = z.object({
	jenis: z.enum(['bbm', 'tol', 'parkir', 'lain']),
	nominal: z.coerce.number().finite().positive({ message: 'Nominal tidak valid.' }),
	catatan: z.string().trim().optional()
});

export type DriverTripExpenseInput = z.input<typeof driverTripExpenseSchema>;
