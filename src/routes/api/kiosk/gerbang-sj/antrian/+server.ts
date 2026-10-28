// src/routes/api/kiosk/gerbang-sj/antrian/+server.ts
// GSP-01 §4.4 — PEMBUNGKUS TIPIS masa transisi: antrian = getAntrian() (satu sumber dgn app & ERP).
// Bentuk respons lama dipertahankan. Tidak ada layar yang memakainya lagi; hapus setelah GSP-11 lulus.

import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveGateActor, toKitError } from '$lib/server/gerbangSj/actor';
import { getAntrian } from '$lib/server/gerbangSj/query';

export const GET: RequestHandler = async (event) => {
	await resolveGateActor(event).catch(toKitError);
	const { count, antrian } = await getAntrian();
	// bentuk lama: siap vs belum_siap (belum dicetak) dipisah; "belum siap" = blocker BELUM_DICETAK.
	const baris = antrian.map((a) => ({
		id: a.id,
		nomor_sj: a.nomor_sj,
		status: 'needs_security_check',
		driver: a.driver,
		plat: a.plat,
		tujuan: a.tujuan,
		items: [] as { nama_barang: string; qty: number | null; unit: string | null }[],
		wait_min: a.menunggu_menit,
		overdue: a.terlambat,
		belum_siap: a.blockers.some((b) => b.kode === 'BELUM_DICETAK') ? 'Belum dicetak' : null
	}));
	const siap = baris.filter((r) => !r.belum_siap);
	const belumSiap = baris.filter((r) => r.belum_siap);
	return json({
		antrian: siap,
		count: siap.length,
		belum_siap: belumSiap,
		belum_siap_count: belumSiap.length,
		total: count,
		generated_at: new Date().toISOString()
	});
};
