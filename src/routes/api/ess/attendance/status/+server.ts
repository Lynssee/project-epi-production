import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { findTodayRecord, listActiveLokasi } from '$lib/server/ess/absensi';
import { todayJakarta } from '$lib/server/ess/time';
import {
	loadIstirahatConfig,
	getJendelaIstirahat,
	listJedaHariIni,
	listJedaHariIniRaw,
	type AbsensiIstirahatLogRow
} from '$lib/server/ess/istirahat';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const tanggal = todayJakarta();

	const [record, lokasiOptions, istirahatConfig] = await Promise.all([
		findTodayRecord(karyawan.id, tanggal),
		listActiveLokasi(),
		loadIstirahatConfig()
	]);

	// Hanya panggil query tambahan bila fitur aktif untuk akun ini — hemat call (CLAUDE.md).
	// Ambil absensi_istirahat_log 1x saja, lalu turunkan jedaTerbuka & jedaHariIni dari hasil yang sama.
	let jendelaIstirahat: { mulai: string | null; selesai: string | null } | null = null;
	let jedaTerbuka: AbsensiIstirahatLogRow | null = null;
	let jedaHariIni: Awaited<ReturnType<typeof listJedaHariIni>> = [];
	if (istirahatConfig.aktif) {
		const [jendela, rawJeda] = await Promise.all([
			getJendelaIstirahat(karyawan.id),
			record ? listJedaHariIniRaw(record.id) : Promise.resolve([])
		]);
		jendelaIstirahat = jendela;
		// rawJeda diurutkan ascending tanggal_dibuat; jedaTerbuka terbaru ada di belakang.
		for (let i = rawJeda.length - 1; i >= 0; i--) {
			if (rawJeda[i].jam_masuk == null) {
				jedaTerbuka = rawJeda[i];
				break;
			}
		}
		if (record && rawJeda.length > 0) {
			jedaHariIni = await listJedaHariIni(record.id, istirahatConfig.kategoriAktif, rawJeda);
		}
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
