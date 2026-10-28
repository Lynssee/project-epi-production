// Fase 2 keamanan pondasi — validasi bentuk payload checklist GA/Security sebelum
// business-logic (ownership area/rute/checkpoint) di src/routes/api/ga-checklist/submit/+server.ts.
// Ini bukan pengganti verifikasi ownership server-side yang sudah ada di sana — hanya
// menjamin bentuk data (tipe, enum, wajib-isi) sebelum dipakai.
import { z } from 'zod';

export const itemAnswerSchema = z.object({
	item_id: z.coerce.number().int().positive(),
	answer: z.enum(['yes', 'no', 'na']),
	notes: z.string().trim().optional()
});

export const gaChecklistAnswersSchema = z.array(itemAnswerSchema).min(1, 'Checklist tidak boleh kosong.');
