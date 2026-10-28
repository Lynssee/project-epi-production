// Fase 2 keamanan pondasi (lanjutan) — validasi bentuk daftar item SJI sebelum dikirim
// ke serahkanSji() (src/lib/services/sjiApi.ts). Kondisi wajib-foto/saksi per mode
// (mandiri vs petugas) sudah digerbang `canSubmit` di halaman — schema ini hanya
// memformalkan bentuk `items`, bukan menduplikasi logic mode itu.
import { z } from 'zod';

export const sjiSerahkanItemSchema = z.object({
	collection: z.enum(['pengeluaran_barang', 'peminjaman_internal']),
	id: z.coerce.number().int().positive()
});

export const sjiSerahkanItemsSchema = z.array(sjiSerahkanItemSchema).min(1, 'Pilih minimal 1 item untuk diserahkan.');
