// Fase 2 keamanan pondasi (lanjutan) — validasi submission Barang Masuk (mode manual,
// BUKAN Goods Received/GR — lihat goodsReceived.ts untuk itu) sebelum dikirim ke
// submitPenerimaan() (src/lib/services/stockLapangan.ts).
import { z } from 'zod';

export const stockPenerimaanSchema = z.object({
	itemId: z.coerce.number().int().positive(),
	quantity: z.coerce.number().finite().positive(),
	notes: z.string().trim().optional().default(''),
	karyawanName: z.string().trim().min(1),
	lat: z.number().nullable(),
	lng: z.number().nullable(),
	accuracy: z.number().nullable(),
	capturedAt: z.string().min(1),
	scanMethod: z.enum(['qr_item', 'manual_search']),
	lotNumber: z.string().trim().optional(),
	expiryDate: z.string().trim().nullable().optional(),
	gudangId: z.coerce.number().int().positive().nullable()
});

export type StockPenerimaanInput = z.input<typeof stockPenerimaanSchema>;
