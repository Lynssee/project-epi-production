// Fase 2 keamanan pondasi (lanjutan) — validasi submission "Hasil Produksi" (Stock
// Lapangan → Output) sebelum dikirim ke submitHasilProduksi() (src/lib/services/stockLapangan.ts).
// UI sudah menggerbang lewat `canSubmit` ($derived) — schema ini lapisan kedua yang lebih
// presisi, sekaligus berlaku untuk payload yang masuk ke antrian offline (offlineStockQueue).
import { z } from 'zod';

export const stockOutputSchema = z.object({
	itemId: z.coerce.number().int().positive(),
	quantity: z.coerce.number().finite().positive(),
	notes: z.string().trim().optional().default(''),
	karyawanName: z.string().trim().min(1),
	lat: z.number().nullable(),
	lng: z.number().nullable(),
	accuracy: z.number().nullable(),
	capturedAt: z.string().min(1),
	scanMethod: z.enum(['qr_item', 'manual_search']),
	itemBatchId: z.coerce.number().int().positive().nullable(),
	gudangId: z.coerce.number().int().positive().nullable()
});

export type StockOutputInput = z.input<typeof stockOutputSchema>;
