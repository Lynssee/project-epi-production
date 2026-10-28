// src/lib/utils/fieldServiceTypes.ts
// Fase 6 / R8 v2 (Pertajam Modul Penawaran). Penanda JENIS PEKERJAAN per baris
// progress laporan harian → memungkinkan admin menghitung akurasi estimasi durasi
// PER FASE (bukan hanya per proyek). Sengaja daftar tetap & selaras dengan enum
// `service_type` di kalkulator_penawaran_items sisi admin (erp-epi) + 'lainnya'.

export const FIELD_SERVICE_TYPES = [
	{ id: 'sandblasting', label: 'Sandblasting' },
	{ id: 'painting', label: 'Painting / Pengecatan' },
	{ id: 'floor_coating', label: 'Floor Coating' },
	{ id: 'welding', label: 'Welding / Pengelasan' },
	{ id: 'sipil', label: 'Sipil / Konstruksi' },
	{ id: 'lainnya', label: 'Lainnya' }
] as const;

export type FieldServiceType = (typeof FIELD_SERVICE_TYPES)[number]['id'];

export function fieldServiceTypeLabel(id: string | null | undefined): string {
	return FIELD_SERVICE_TYPES.find((s) => s.id === id)?.label || (id || '');
}
