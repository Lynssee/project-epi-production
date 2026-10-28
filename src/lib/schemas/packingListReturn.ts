// Fase 3 (Goods Return & Purchase Receive v3, §4, 19 Agu 2026): validasi form Return Packing
// List sebelum dikirim — sebelumnya HALAMAN INI TIDAK PUNYA validasi sama sekali (nol guard,
// lihat §1.8 dokumen). Pola sama dengan sjiKembali.ts (schema kecil + superRefine untuk aturan
// silang-field), bukan skema besar satu form karena halaman ini validasi PER-ITEM (bisa banyak
// barang dari Inventory + manual dalam satu pengajuan).
import { z } from 'zod';

export const RETURN_CONDITION_OPTIONS = [
	{ value: 'ok', label: 'OK / Layak Pakai' },
	{ value: 'bekas_layak', label: 'Bekas Layak' },
	{ value: 'rusak', label: 'Rusak' },
	{ value: 'hilang', label: 'Hilang' }
] as const;

// Fase 4 (Standarisasi Cat & Smart Swatch, 5 Okt 2026) — alasan retur terstruktur,
// khusus item yang punya material_color (cat/material berwarna). Opsional: item lama
// / non-cat tidak wajib isi ini, tetap pakai leader_notes bebas seperti sebelumnya.
export const RETURN_REASON_CODE_OPTIONS = [
	{ value: 'salah_warna', label: 'Salah Warna / ΔE Tidak Masuk' },
	{ value: 'salah_finish', label: 'Salah Finish (Gloss/Matt/dll)' },
	{ value: 'cat_menggumpal', label: 'Cat Menggumpal / Rusak Fisik' },
	{ value: 'kelebihan_volume', label: 'Kelebihan Volume / Sisa Tak Terpakai' },
	{ value: 'lainnya', label: 'Lainnya' }
] as const;

export const packingListReturnItemSchema = z
	.object({
		material_name: z.string().trim().min(1, 'Nama material wajib diisi'),
		material_color: z.string().trim().optional().default(''),
		qty_returned: z.number().positive('Qty harus lebih dari 0'),
		unit: z.string().trim().min(1, 'Satuan wajib diisi'),
		// Zod v4: pesan kustom di enum pakai { error }, bukan errorMap (v3) -- ikut pola
		// schema lain di repo ini (sjiKembali.ts dkk.) yang tidak menyertakan pesan kustom.
		condition: z.enum(['ok', 'bekas_layak', 'rusak', 'hilang']),
		leader_notes: z.string().trim().optional().default(''),
		reason_code: z.enum(['salah_warna', 'salah_finish', 'cat_menggumpal', 'kelebihan_volume', 'lainnya']).optional()
	})
	.superRefine((val, ctx) => {
		// Q1/Fase 3 item 4: catatan wajib (>=20 karakter) bila kondisi bukan "ok" — supaya
		// "bekas_layak"/"rusak"/"hilang" tidak pernah tercatat tanpa penjelasan dari lapangan.
		if (val.condition !== 'ok' && val.leader_notes.trim().length < 20) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['leader_notes'],
				message: 'Catatan kondisi wajib diisi minimal 20 karakter untuk kondisi selain OK/Layak Pakai'
			});
		}
	});

export type PackingListReturnItemInput = z.input<typeof packingListReturnItemSchema>;

/** Validasi satu item, kembalikan pesan error pertama (untuk alert) atau null bila valid. */
export function validateReturnItem(input: PackingListReturnItemInput): string | null {
	const result = packingListReturnItemSchema.safeParse(input);
	if (result.success) return null;
	return result.error.issues[0]?.message || 'Data tidak valid';
}
