// Fase 2 keamanan pondasi (lanjutan) — validasi submission Stock Opname sebelum dikirim
// ke submitOpname() / submitOpnameGudangHq() (src/lib/services/stockLapangan.ts,
// gudangAntrian.ts). physicalCount boleh 0 (stok kosong itu valid), tidak boleh negatif.
import { z } from 'zod';

export const stockOpnameSchema = z.object({
	itemId: z.coerce.number().int().positive(),
	systemStock: z.coerce.number().finite(),
	physicalCount: z.coerce.number().finite().nonnegative(),
	notes: z.string().trim().optional().default(''),
	karyawanName: z.string().trim().min(1),
	lat: z.number().nullable(),
	lng: z.number().nullable(),
	accuracy: z.number().nullable(),
	capturedAt: z.string().min(1),
	scanMethod: z.enum(['qr_item', 'manual_search']),
	gudangId: z.coerce.number().int().positive().nullable()
});

export type StockOpnameInput = z.input<typeof stockOpnameSchema>;
