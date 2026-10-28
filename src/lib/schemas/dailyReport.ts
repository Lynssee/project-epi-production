// Fase 2 keamanan pondasi (rencana "Package & Fitur Addons" §5) — validasi laporan
// harian sales sebelum dikirim ke submitDailyReport() (src/lib/services/sales.ts).
import { z } from 'zod';

export const dailyReportSchema = z.object({
	totalOrder: z
		.union([z.literal(''), z.coerce.number().finite().nonnegative()])
		.transform((v) => (v === '' ? null : v)),
	ringkasan: z.string().trim().min(1, 'Isi ringkasan aktivitas hari ini.'),
	kendala: z.string().trim().optional().default('')
});

export type DailyReportInput = z.input<typeof dailyReportSchema>;
