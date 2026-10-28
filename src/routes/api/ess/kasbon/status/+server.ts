import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import {
	listKasbonByKaryawan,
	getKonfigurasiKasbon,
	computeJadwalAngsuran,
	listKasbonPaymentLog,
	resolveEffectivePlafon
} from '$lib/server/ess/kasbon';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const [riwayatRaw, konfig, karyawanRes] = await Promise.all([
		listKasbonByKaryawan(karyawan.id),
		getKonfigurasiKasbon(),
		directusServerJson<{ data: { gaji_pokok: number; status_kerja: string | null; plafon_kasbon: number | null } }>(
			`/items/karyawan/${karyawan.id}?fields=gaji_pokok,status_kerja,plafon_kasbon`
		)
	]);

	// H-07 fix (samakan dengan assertKasbonEligible): plafon nyata via override plafon_kasbon >
	// tabel per status_kerja > fallback gaji_pokok x multiplier — jangan hitung ulang gaji_pokok
	// langsung di sini, karena gaji_pokok kosong untuk karyawan yang gajinya di identitas_gaji
	// terenkripsi, sehingga selalu menghasilkan plafon 0 walau override sudah diisi HRD.
	const plafon = resolveEffectivePlafon(karyawanRes?.data || {}, konfig);
	const aktif = riwayatRaw.filter((k) => ['Diajukan', 'Disetujui Atasan', 'Disetujui HRD', 'approved'].includes(k.status) && k.payment_status !== 'lunas');
	const sisaAktif = aktif.reduce((sum, k) => sum + (Number(k.nominal) - Number(k.total_paid || 0)), 0);

	// Fase 4 (T10, R5): kartu hutang pribadi — jadwal angsuran terproyeksi + riwayat potongan aktual,
	// hanya dihitung untuk kasbon yang sudah cair (status approved) agar tidak membebani setiap request.
	const riwayat = await Promise.all(
		riwayatRaw.map(async (k) => {
			if (k.status !== 'approved') return { ...k, jadwalAngsuran: [], riwayatPotongan: [] };
			const [jadwalAngsuran, riwayatPotongan] = await Promise.all([
				Promise.resolve(computeJadwalAngsuran(k)),
				listKasbonPaymentLog(k.id)
			]);
			return { ...k, jadwalAngsuran, riwayatPotongan };
		})
	);

	return json({
		riwayat,
		plafon,
		tenorMaxBulan: konfig.tenorMaxBulan,
		maxAktif: konfig.maxAktif,
		jumlahAktif: aktif.length,
		sisaAktif,
		bisaAjukanBaru: aktif.length < konfig.maxAktif
	});
};
