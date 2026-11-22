// Kartu Sertifikat Digital: semua sertifikat pelatihan milik karyawan login + URL verifikasi berQR.
// Identitas dari login (bukan parameter). Fetch dipisah per koleksi (CLAUDE.md #2); QR diberi hash HMAC server (secret tak pernah ke klien).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { listMyEnrollments } from '$lib/server/ess/training';
import { buildTrainingCertVerifyUrl } from '$lib/server/ess/trainingCertVerify';
import { todayJakarta } from '$lib/server/ess/time';
import { statusSertifikat, selisihHari, urutkanKartu, ringkasKartu, DEFAULT_WARN_DAYS, type KartuSertifikat } from '$lib/utils/sertifikatKartu';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const today = todayJakarta();

	const enrollments = (await listMyEnrollments(karyawan.id)).filter((e) => e.sertifikat_no && (e.status === 'Lulus' || e.sertifikat_file));

	// Ambang peringatan dari training_settings (sama dengan pengingat HRD); gagal baca = default, tapi dilog.
	let warnDays = DEFAULT_WARN_DAYS;
	try {
		const s = await directusServerJson<{ data: { cert_expiry_warning_days?: number } }>('/items/training_settings/1?fields=cert_expiry_warning_days');
		const n = Number(s?.data?.cert_expiry_warning_days);
		if (Number.isFinite(n) && n >= 0) warnDays = n;
	} catch (e) {
		console.error('[sertifikat-saya] gagal baca training_settings, memakai default:', (e as Error)?.message);
	}

	// Judul program: satu query terpisah.
	const judul = new Map<number, { judul: string; kode: string | null }>();
	const ids = [...new Set(enrollments.map((e) => e.program_id))];
	if (ids.length > 0) {
		try {
			const res = await directusServerJson<{ data: Array<{ id: number; judul: string; kode: string | null }> }>(`/items/training_program?filter[id][_in]=${ids.join(',')}&fields=id,judul,kode&limit=-1`);
			for (const p of res?.data || []) judul.set(p.id, { judul: p.judul, kode: p.kode ?? null });
		} catch (e) {
			console.error('[sertifikat-saya] gagal baca training_program:', (e as Error)?.message);
		}
	}

	const kartu: KartuSertifikat[] = enrollments.map((e) => {
		const expired = e.sertifikat_expired ? String(e.sertifikat_expired).slice(0, 10) : null;
		const sisa = expired ? selisihHari(today, expired) : null;
		return {
			enrollmentId: e.id,
			programId: e.program_id,
			judul: judul.get(e.program_id)?.judul || `Program #${e.program_id}`,
			kode: judul.get(e.program_id)?.kode ?? null,
			sertifikatNo: String(e.sertifikat_no),
			nilaiAkhir: e.nilai_akhir ?? null,
			expired,
			status: statusSertifikat(expired, today, warnDays),
			sisaHari: sisa != null && Number.isFinite(sisa) ? sisa : null,
			verifyUrl: buildTrainingCertVerifyUrl({
				enrollmentId: e.id,
				sertifikatNo: String(e.sertifikat_no),
				karyawanId: karyawan.id,
				programId: e.program_id,
				sertifikatExpired: e.sertifikat_expired ?? null
			})
		};
	});

	const urut = urutkanKartu(kartu);
	return json({ kartu: urut, ringkasan: ringkasKartu(urut), warnDays });
};
