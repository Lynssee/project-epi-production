// src/routes/api/site-checkin/auto-checkout/+server.ts
// POST: dipanggil SETELAH laporan harian tersimpan sukses (reports.ts::submitReport).
// Menutup check-in aktif karyawan secara otomatis — fail-safe menyeluruh: tidak ada
// check-in aktif, atau kegagalan apa pun di sini, TIDAK PERNAH direpresentasikan sebagai
// error ke caller (selalu 200 { closed: boolean }) supaya caller tidak perlu try/catch
// rumit di jalur penyimpanan laporan (lihat implementation plan v3 §5 Fase 4).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { findActiveCheckin, closeCheckin } from '$lib/server/siteCheckin';
import { directusServerJson } from '$lib/server/directus';

/** SV-14: ringkasan laporan harian (general_notes) dipakai sebagai kegiatan project_visit_leader
 *  saat checkout auto_report — sebelumnya bridge itu selalu kosong karena hanya jalan untuk
 *  method 'manual'. Fail-soft: gagal ambil laporan tidak menggagalkan checkout. */
async function ambilRingkasanLaporan(reportId: number | null): Promise<string | null> {
	if (!reportId) return null;
	try {
		const res = await directusServerJson<{ data: { general_notes: string | null } }>(
			`/items/reports/${reportId}?fields=general_notes`
		);
		return res?.data?.general_notes || null;
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async (event) => {
	try {
		const { karyawan } = await authenticateEss(event);
		const body = await event.request.json().catch(() => ({}));
		const reportId = body?.reportId != null ? Number(body.reportId) : null;
		const projectId = body?.projectId != null ? Number(body.projectId) : null;

		const active = await findActiveCheckin(String(karyawan.id));
		if (!active) {
			return json({ closed: false, reason: 'tidak_ada_checkin_aktif' });
		}

		// Paket 10 Site Visit Release §2.3 (SVR-29) — laporan harian proyek A TIDAK BOLEH
		// menutup kunjungan aktif di proyek B (mis. leader sedang di lokasi lain saat mengirim
		// laporan proyek sebelumnya). Hanya tutup bila kunjungan aktif memang proyek yang sama.
		if (projectId != null && (active.tipe_checkin !== 'proyek' || Number(active.referensi_id) !== projectId)) {
			return json({ closed: false, reason: 'proyek_berbeda' });
		}

		const kegiatan = await ambilRingkasanLaporan(reportId);

		const record = await closeCheckin({
			checkinId: active.id,
			karyawanId: String(karyawan.id),
			karyawanNama: karyawan.nama_karyawan,
			method: 'auto_report',
			lat: null,
			lng: null,
			akurasi: null,
			foto: null,
			reportId,
			kegiatan
		});
		return json({ closed: true, record });
	} catch (e) {
		// Fail-safe mutlak — jalur laporan harian tidak boleh terganggu oleh ini.
		return json({ closed: false, reason: e instanceof Error ? e.message : 'error' });
	}
};
