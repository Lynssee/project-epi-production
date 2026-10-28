// Fase 2 keamanan pondasi — validasi laporan harian mekanik (sparepart terpakai)
// sebelum dikirim ke submitDailyActivity() (src/lib/services/maintenance.ts).
import { z } from 'zod';

export const sparepartUsageSchema = z.object({
	nama: z.string().trim().min(1),
	qty: z.coerce.number().int().positive(),
	// Fase 4 Pusat Maintenance v2 (14 Sep 2026): terisi otomatis dari stok gudang (koleksi
	// `sparepart`) — opsional karena part di luar katalog tetap boleh dicatat sebagai teks
	// bebas (tidak masuk sparepart_usage_log, hanya sparepart_ringkas).
	sparepartId: z.string().nullable().optional(),
	unitCategoryId: z.string().nullable().optional(),
	hargaSatuan: z.coerce.number().finite().nonnegative().default(0)
});

export const maintenanceActivitySchema = z.object({
	deskripsi: z.string().trim().min(1, 'Jelaskan apa yang dikerjakan hari ini.'),
	progress: z.coerce.number().int().min(0).max(100),
	kondisi: z.enum(['baik', 'rusak']),
	spareparts: z.array(sparepartUsageSchema).default([]),
	biayaSparepart: z.coerce.number().finite().nonnegative(),
	// Fase 5 Pusat Maintenance v2 (14 Sep 2026): jam kerja manual mulai/selesai per laporan.
	// null = tidak diisi (opsional — WO lama/laporan tanpa jam tetap boleh disimpan).
	durasiKerjaMenit: z.coerce.number().int().positive().nullable().optional()
});

export type MaintenanceActivityInput = z.input<typeof maintenanceActivitySchema>;
