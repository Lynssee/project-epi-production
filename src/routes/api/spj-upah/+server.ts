// src/routes/api/spj-upah/+server.ts
// GPM-C09 — GET: daftar PA upah yang diterima koordinator (leader) ini + status bukti pembagian per pekerja.
// Identitas dari token (manpower.user_email). Akun belum tertaut ke manpower → 403 dengan arahan.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveManpowerByEmail } from '$lib/server/manpowerLeaderGuard';
import { todayJakarta } from '$lib/server/ess/time';
import { bacaSetelan, muatDetailPA, muatPAKoordinator, ringkasPA } from '$lib/server/spjUpah';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const manpower = await resolveManpowerByEmail(user.email);
	if (!manpower) {
		throw error(403, 'Akun ini belum tertaut ke data manpower. Minta HRD mengisi "Email akun" pada data Anda.');
	}
	const hariIni = todayJakarta();
	try {
		const [pas, setelan] = await Promise.all([muatPAKoordinator(manpower.id, hariIni), bacaSetelan()]);
		const { rincian, distribusi, nama } = await muatDetailPA(pas.map((p) => Number(p.id)));
		const daftar = pas.map((pa) =>
			ringkasPA({
				pa,
				rincian: rincian.filter((r) => Number(r.pengajuan_anggaran_id?.id ?? r.pengajuan_anggaran_id) === Number(pa.id)),
				distribusi: distribusi.filter((d) => Number(d.pengajuan_anggaran_id?.id ?? d.pengajuan_anggaran_id) === Number(pa.id)),
				nama, hariIni, batasHari: setelan.batasHari, toleransi: setelan.toleransi
			})
		);
		return json({ koordinator: { id: manpower.id, nama: manpower.nama }, batas_hari: setelan.batasHari, pengajuan: daftar });
	} catch (e) {
		console.error('[spj-upah] gagal memuat daftar untuk manpower', manpower.id, (e as any)?.message || e);
		throw error(502, 'Gagal memuat daftar SPJ upah. Coba lagi beberapa saat.');
	}
};
