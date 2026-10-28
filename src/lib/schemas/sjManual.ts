// Fase 2 keamanan pondasi (lanjutan) — validasi pengajuan/revisi Surat Jalan Manual
// sebelum dikirim ke createSjManual()/resubmitSjManual() (src/lib/services/sjManualApi.ts).
import { z } from 'zod';

export const sjManualItemSchema = z.object({
	itemId: z.coerce.number().int().positive().nullable(),
	namaBarang: z.string().trim().min(1),
	qty: z.coerce.number().finite().positive(),
	satuan: z.string().trim().min(1)
});

export const sjManualPayloadSchema = z.object({
	customerName: z.string().trim().min(1),
	customerAddress: z.string().trim().min(1),
	customerPhone: z.string().trim().optional(),
	projectId: z.coerce.number().int().positive().nullable(),
	driverName: z.string().trim().optional(),
	notes: z.string().trim().optional(),
	items: z.array(sjManualItemSchema).min(1, 'Minimal 1 barang harus diisi.')
});

export type SjManualPayloadInput = z.input<typeof sjManualPayloadSchema>;
