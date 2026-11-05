import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listCatalogForKaryawan, listMyEnrollments } from '$lib/server/ess/training';
import { getPillarConfig } from '$lib/server/ess/trainingPillars';
import { getShortcutMap, pickShortcuts } from '$lib/server/ess/trainingShortcut';

// GET ?konteks=<kunci>  (mis. inspection | field_report | pengajuan)
// Kursus relevan yang belum lulus untuk halaman kerja tersebut (maks 2). Konteks tak dikenal → daftar kosong (bukan error),
// supaya halaman yang belum dipetakan admin tetap normal. Hanya baca; 2 query Directus + setelan ber-cache 5 menit.
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const konteks = (event.url.searchParams.get('konteks') || '').trim().toLowerCase();
	if (!/^[a-z0-9_-]{1,40}$/.test(konteks)) throw error(400, 'konteks tidak valid');

	const map = await getShortcutMap();
	const rule = map[konteks];
	if (!rule) return json({ konteks, items: [] });

	const [programs, enrollments, pillarConfig] = await Promise.all([
		listCatalogForKaryawan(karyawan.divisi, karyawan.divisi_id),
		listMyEnrollments(karyawan.id),
		getPillarConfig()
	]);
	return json({ konteks, items: pickShortcuts(rule, programs, enrollments, pillarConfig) });
};
