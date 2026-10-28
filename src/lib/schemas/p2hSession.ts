// Fase 2 keamanan pondasi (lanjutan) — validasi jawaban ceklist P2H sebelum dikirim ke
// submitP2hSessionAtomic() (src/lib/services/preventive.ts). UI sudah menggerbang lewat
// `canSubmit` ($derived) + cek foto-wajib per item — schema ini memformalkan bentuk
// jawaban (enum Go/No-Go, tipe numeric/text) sebagai lapisan kedua.
import { z } from 'zod';

export const p2hAnswerSchema = z.object({
	result: z.enum(['Go', 'No-Go']),
	notes: z.string().trim().optional().default(''),
	foto: z.string().trim().nullable().optional(),
	numeric_value: z.coerce.number().finite().nullable().optional(),
	text_value: z.string().trim().nullable().optional()
});

export const p2hSessionSchema = z.object({
	equipment_id: z.string().min(1),
	date: z.string().min(1),
	keterangan_tambahan: z.string().trim().optional(),
	foto_unit: z.string().trim().optional(),
	gps_lat: z.number().nullable(),
	gps_lng: z.number().nullable(),
	hoursmeter: z.coerce.number().finite().nonnegative().nullable(),
	signature: z.string().min(1, 'Tanda tangan wajib diisi.')
});

export type P2hAnswerInput = z.input<typeof p2hAnswerSchema>;
