import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { fetchKaryawanNames, fetchOperationalKeys } from '$lib/server/keyService';

/**
 * Rekonsiliasi kotak kunci untuk serah-terima shift: "N dari M kunci operasional ada di slotnya" + checklist per slot.
 * Kunci `disimpan_khusus` (brankas GA), `hilang`, `rusak` dan nonaktif tidak dihitung sebagai kunci operasional kotak.
 */
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);

	const keys = await fetchOperationalKeys();
	const keluar = keys.filter((k) => k.status !== 'tersedia');
	const names = await fetchKaryawanNames(keluar.map((k) => k.pemegang_id));
	const row = (k: (typeof keys)[number]) => ({
		...k,
		pemegang_nama: k.pemegang_id ? (names.get(k.pemegang_id) ?? `#${k.pemegang_id}`) : null
	});

	const belumKembali = keys.filter((k) => k.status === 'dipinjam');
	const izinBawaPulang = keys.filter((k) => k.status === 'overnight_ijin');
	return json({
		total: keys.length,
		di_slot: keys.length - keluar.length,
		belum_kembali: belumKembali.map(row),
		izin_bawa_pulang: izinBawaPulang.map(row),
		/** Checklist per slot (urut kotak → slot). Satpam mencentang kunci berstatus `tersedia` yang benar-benar ada di slotnya. */
		slots: keys.map(row),
		cocok: belumKembali.length === 0
	});
};
