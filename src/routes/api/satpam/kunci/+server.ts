import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getPatrolControlSettings } from '$lib/server/patrolControlSettings';
import { listKeysWithHolder } from '$lib/server/keyService';
import { isKunciTerlambat } from '$lib/server/gates/securityKeyGate';

/**
 * Daftar kunci aktif beserta pemegang & batas kembali (papan kotak kunci pos satpam).
 * `terlambat` dihitung di sini (batas kembali + tenggang) — tidak disimpan, jadi tidak butuh cron.
 */
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const [items, ps] = await Promise.all([listKeysWithHolder(), getPatrolControlSettings()]);
	const now = new Date();

	const rows = items.map((k) => ({
		...k,
		terlambat: k.status === 'dipinjam' && isKunciTerlambat(k.rencana_kembali, now, ps.secKeyTenggangMenit)
	}));

	const ringkasan = {
		total: rows.length,
		tersedia: rows.filter((r) => r.status === 'tersedia').length,
		dipinjam: rows.filter((r) => r.status === 'dipinjam').length,
		izin_bawa_pulang: rows.filter((r) => r.status === 'overnight_ijin').length,
		terlambat: rows.filter((r) => r.terlambat).length
	};
	return json({ items: rows, ringkasan });
};
