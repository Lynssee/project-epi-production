// Fase 2 keamanan pondasi (lanjutan) — validasi bentuk item Goods Received (konfirmasi
// Surat Jalan) sebelum dikirim ke confirmGoodsReceived() (src/lib/services/goodsReceived.ts).
// Item RAB (project_expense_id) dan item generik/non-RAB (surat_jalan_item_id) dua ruang
// ID berbeda (lihat catatan di grCondition.ts) — union, bukan satu bentuk gabungan.
import { z } from 'zod';

const grConditionSchema = z.enum(['ok', 'kurang', 'rusak']);

const grRabItemSchema = z.object({
	project_expense_id: z.coerce.number().int().positive(),
	qty_received: z.coerce.number().finite().nonnegative(),
	condition: grConditionSchema
});

const grGenericItemSchema = z.object({
	surat_jalan_item_id: z.coerce.number().int().positive(),
	qty_received: z.coerce.number().finite().nonnegative(),
	condition: grConditionSchema
});

export const grItemsSchema = z
	.array(z.union([grRabItemSchema, grGenericItemSchema]))
	.min(1, 'Konfirmasi GR harus punya minimal 1 item.');

export type GrItemInput = z.input<typeof grRabItemSchema> | z.input<typeof grGenericItemSchema>;
