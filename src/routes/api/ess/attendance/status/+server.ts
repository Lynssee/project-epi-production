import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { findTodayRecord, listActiveLokasi } from '$lib/server/ess/absensi';
import { todayJakarta } from '$lib/server/ess/time';
import { loadIstirahatConfig, getJendelaIstirahat, findJedaTerbuka, listJedaHariIni } from '$lib/server/ess/istirahat';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const tanggal = todayJakarta();

	const [record, lokasiOptions, istirahatConfig] = await Promise.all([
		findTodayRecord(karyawan.id, tanggal),
		listActiveLokasi(),
		loadIstirahatConfig()
	]);

	// Hanya panggil query tambahan bila fitur aktif untuk akun ini — hemat call (CLAUDE.md).
	let jendelaIstirahat: { mulai: string | null; selesai: string | null } | null = null;
	let jedaTerbuka = null;
	let jedaHariIni: Awaited<ReturnType<typeof listJedaHariIni>> = [];
	if (istirahatConfig.aktif) {
		[jendelaIstirahat, jedaTerbuka, jedaHariIni] = await Promise.all([
			getJendelaIstirahat(karyawan.id),
			record ? findJedaTerbuka(record.id) : Promise.resolve(null),
			record ? listJedaHariIni(record.id) : Promise.resolve([])
		]);
	}

	return json({
		record,
		lokasiOptions,
		tanggal,
		karyawan: { id: karyawan.id, nama: karyawan.nama_karyawan },
		istirahat: {
			aktif: istirahatConfig.aktif,
			kategoriAktif: istirahatConfig.kategoriAktif,
			konfig: istirahatConfig.aktif
				? {
						foto_masuk_wajib: istirahatConfig.konfig?.istirahat_foto_masuk_wajib ?? true,
						foto_keluar_wajib: istirahatConfig.konfig?.istirahat_foto_keluar_wajib ?? false,
						min_durasi_menit: istirahatConfig.konfig?.istirahat_min_durasi_menit ?? 5,
						blokir_pulang: istirahatConfig.konfig?.istirahat_blokir_pulang ?? true,
						makan_siang_menit: istirahatConfig.konfig?.istirahat_makan_siang_menit ?? 60
					}
				: null,
			jendela: jendelaIstirahat,
			jedaTerbuka,
			jedaHariIni
		}
	});
};
