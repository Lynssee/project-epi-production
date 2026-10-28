import directus from './directus';
import { readItems } from '@directus/sdk';

// ── Widget Utilization & Alert Sertifikasi (Fase 5, Manpower v2) ────────
// Ditaruh di halaman /manpower (bukan Command Center generik — Command
// Center di app ini berbasis snapshot per-divisi/departemen, sedangkan
// manpower berbasis proyek; memaksakannya ke situ butuh mengubah model
// snapshot bersama, risikonya tidak sepadan untuk satu widget kecil).

export interface ManpowerWidgetData {
	activeCount: number;
	certExpiringCount: number;
}

/** Hitung ringkasan untuk sekumpulan manpower id (biasanya milik proyek PL). */
export async function getManpowerWidgetData(manpowerIds: number[]): Promise<ManpowerWidgetData> {
	if (!manpowerIds || manpowerIds.length === 0) return { activeCount: 0, certExpiringCount: 0 };
	try {
		const in30 = new Date();
		in30.setDate(in30.getDate() + 30);
		const rows = (await directus.request(
			readItems('manpower_dokumen', {
				fields: ['id', 'manpower_id', 'tanggal_kedaluwarsa'],
				filter: {
					manpower_id: { _in: manpowerIds },
					tanggal_kedaluwarsa: { _nnull: true, _lte: in30.toISOString().split('T')[0] }
				},
				limit: -1
			})
		)) as any[];
		return { activeCount: manpowerIds.length, certExpiringCount: (rows || []).length };
	} catch (e) {
		console.warn('getManpowerWidgetData gagal:', (e as any)?.message);
		return { activeCount: manpowerIds.length, certExpiringCount: 0 };
	}
}
