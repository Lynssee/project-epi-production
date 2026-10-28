// src/routes/api/manpower-leader/absen-regu/+server.ts
// Absensi representatif oleh Manpower Leader — SATU-SATUNYA penulis untuk jalur ini.
// Dokumen: erp-epi-1/docs/rencana-manpower-leader.md
//
// Kenapa di server, bukan di halaman /regu:
//   - absensi memicu akrual biaya (project_expenses) — ini jalur uang;
//   - aturan repo ini eksplisit: "Perhitungan jarak WAJIB di server — jangan pernah
//     percaya validasi klien" (src/lib/server/ess/geo.ts);
//   - kalau klien yang menulis, siapa pun bisa mengirim masuk_valid: true tanpa
//     benar-benar berada di lokasi, dan bukti foto/GPS jadi hiasan belaka.
//
// Rumus biaya TIDAK diduplikasi di sini — dipakai bersama dari
// $lib/shared/manpowerAccrualCalc, sama dengan jalur timesheet klien.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateManpowerLeader } from '$lib/server/manpowerLeaderGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { withinRadius } from '$lib/server/ess/geo';
import { hitungBiayaHarian, pilihRate, rateKosong } from '$lib/shared/manpowerAccrualCalc';

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

const STATUS_SAH = ['hadir', 'setengah_hari', 'izin', 'sakit', 'alpha'];

/**
 * Fase 3 — ketat-nya geo-fence absensi per konteks kerja (manpower.geofence.<type>):
 *   'wajib'   → GPS + titik geofence konteks WAJIB (perilaku lama, default proyek).
 *   'longgar' → GPS tetap direkam bila ada, tapi tidak menolak bila titik belum diset.
 *   'off'     → tanpa cek lokasi sama sekali (foto tetap wajib untuk status berbiaya).
 */
async function geofenceMode(type: string): Promise<'wajib' | 'longgar' | 'off'> {
	const fallback = type === 'csr' || type === 'internal' ? 'longgar' : 'wajib';
	try {
		const r = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=manpower.geofence.${type}&limit=1&fields=setting_value`
		);
		const raw = r?.data?.[0]?.setting_value;
		if (raw == null) return fallback;
		let v: any = raw;
		if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { v = raw; } }
		return v === 'longgar' || v === 'off' ? v : 'wajib';
	} catch {
		return fallback;
	}
}

/** Jam kerja default per status — sejalan dengan halaman /regu sebelumnya. */
const JAM_KERJA: Record<string, number> = { hadir: 8, setengah_hari: 4 };

export const POST: RequestHandler = async (event) => {
	const form = await event.request.formData();

	const projectId = Number(form.get('project_id'));
	const assignmentId = Number(form.get('assignment_id'));
	const targetManpowerId = Number(form.get('manpower_id'));
	const status = String(form.get('status') || '');
	const tanggal = String(form.get('tanggal') || '');
	const lat = Number(form.get('lat'));
	const lng = Number(form.get('lng'));
	const accuracy = form.get('accuracy') != null ? Number(form.get('accuracy')) : null;
	const foto = form.get('foto');

	if (!Number.isFinite(projectId) || !Number.isFinite(assignmentId) || !Number.isFinite(targetManpowerId)) {
		throw error(400, 'project_id, assignment_id, dan manpower_id wajib diisi.');
	}
	if (!STATUS_SAH.includes(status)) throw error(400, `Status tidak dikenal: ${status}`);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw error(400, 'Tanggal tidak valid.');

	// Lapis 1 & 2: akun → manpower, dan wajib pegang kursi di proyek ini.
	const { manpower, project } = await authenticateManpowerLeader(event, projectId);

	// Aturan: leader tidak mengabsenkan dirinya sendiri lewat jalur ini — absensi
	// pribadi tetap mandiri (ESS), supaya jejaknya tidak jadi "dicatat leader" oleh diri sendiri.
	if (Number(targetManpowerId) === Number(manpower.id)) {
		throw error(400, 'Absensi Anda sendiri lewat Absensi Mandiri (ESS), bukan dari layar regu.');
	}

	// Bukti wajib HANYA untuk status yang menghasilkan biaya. Untuk izin/sakit/alpha
	// orangnya justru TIDAK ada di lokasi — tidak ada yang bisa difoto, dan biayanya
	// nol (HADIR_FACTOR), jadi mewajibkan foto hanya menambah friksi tanpa nilai bukti.
	const butuhBukti = status === 'hadir' || status === 'setengah_hari';

	// Penugasan target harus DI PROYEK INI — cegah menyeberang proyek. FASE 6 (K4):
	// selain 'aktif', pekerja baru daftar-lapangan yang masih 'menunggu_validasi'/
	// 'menunggu_ttd' juga boleh diabsen, TAPI hanya selama masa kerja sementara.
	const assignRes = await directusServerJson<{ data: any[] }>(
		`/items/manpower_assignment?filter[id][_eq]=${assignmentId}` +
			`&filter[project_id][_eq]=${projectId}&filter[manpower_id][_eq]=${targetManpowerId}` +
			`&filter[status][_in]=aktif,menunggu_validasi,menunggu_ttd` +
			`&fields=id,status,tanggal_spk,tanggal_mulai,rate_harian,rate_upah_harian,rate_lembur,rate_standby,rate_uang_makan,work_context_type,work_context_id&limit=1`
	);
	const assignment = assignRes?.data?.[0];
	if (!assignment) {
		throw error(403, 'Orang ini tidak punya penugasan aktif di proyek Anda.');
	}

	// FASE 6 (K4) — masa kerja sementara. Assignment belum 'aktif' (SPK belum disetujui):
	// absensi hanya boleh selama `manpower.masa_sementara_hari` HARI KERJA sejak
	// tanggal SPK / pendaftaran; lewat itu terkunci sampai admin menyetujui SPK.
	if (assignment.status !== 'aktif') {
		let windowHari = 3;
		try {
			const r = await directusServerJson<{ data: any[] }>(
				`/items/system_settings?filter[setting_key][_eq]=manpower.masa_sementara_hari&limit=1&fields=setting_value`
			);
			const raw = r?.data?.[0]?.setting_value;
			const n = Number(typeof raw === 'string' ? raw.replace(/["']/g, '') : raw);
			if (Number.isFinite(n) && n > 0) windowHari = n;
		} catch {
			/* pakai default 3 */
		}
		const refDate = (assignment.tanggal_spk || assignment.tanggal_mulai || tanggal).slice(0, 10);
		const workingDaysBetween = (fromISO: string, toISO: string) => {
			const a = new Date(fromISO + 'T00:00:00');
			const b = new Date(toISO + 'T00:00:00');
			if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
			let count = 0;
			for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
				const wd = d.getDay();
				if (wd !== 0 && wd !== 6) count += 1;
			}
			return count; // inklusif kedua ujung
		};
		const elapsed = workingDaysBetween(refDate, tanggal);
		if (elapsed > windowHari) {
			throw error(
				423,
				`Masa kerja sementara ${windowHari} hari kerja untuk pekerja ini sudah lewat (hari ke-${elapsed} sejak ${refDate}). ` +
					`Absensi terkunci sampai SPK-nya disetujui admin. Hubungi admin proyek untuk mempercepat validasi.`
			);
		}
	}

	const wcType = assignment.work_context_type || 'project';
	const geoMode = await geofenceMode(wcType);

	if (butuhBukti) {
		if (!(foto instanceof File) || foto.size === 0) {
			throw error(400, 'Foto bukti wajib untuk status hadir / setengah hari.');
		}
		if (geoMode !== 'off' && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
			throw error(400, 'Lokasi GPS tidak valid. Aktifkan izin lokasi dan coba lagi.');
		}
		if (geoMode === 'wajib' && (project.geo_lat == null || project.geo_lng == null)) {
			throw error(409, 'Titik geofence proyek ini belum diset. Minta admin proyek merekam lokasi dulu.');
		}
	}

	// Geofence dihitung di server dari titik proyek — verdict-nya yang disimpan.
	// Klien tidak pernah dipercaya soal ini. Mode 'off' / titik belum diset → tidak dihitung.
	const radius = Number(project.geo_radius_m || 300);
	let valid: boolean | null = null;
	let jarak: number | null = null;
	let fotoId: string | null = null;

	if (butuhBukti) {
		if (geoMode !== 'off' && project.geo_lat != null && project.geo_lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
			({ valid, jarak } = withinRadius(lat, lng, Number(project.geo_lat), Number(project.geo_lng), radius));
		}

		const fd = new FormData();
		fd.append('file', foto as File, (foto as File).name || `absen-regu-${targetManpowerId}-${tanggal}.jpg`);
		const upRes = await directusServerUpload(fd);
		if (!upRes.ok) throw error(502, 'Gagal mengunggah foto bukti.');
		fotoId = (await upRes.json())?.data?.id || null;
	}

	// Baris hari ini sudah ada? Jangan buat ganda (mencegah akrual dobel).
	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/manpower_absensi?filter[assignment_id][_eq]=${assignmentId}` +
			`&filter[tanggal][_eq]=${tanggal}&fields=id,dikunci,expense_id,payroll_id&limit=1`
	);
	const existing = existingRes?.data?.[0];
	if (existing?.dikunci) {
		throw error(409, 'Absensi tanggal ini sudah terkunci (masuk periode gajian).');
	}

	const payload: Record<string, any> = {
		assignment_id: assignmentId,
		manpower_id: targetManpowerId,
		project_id: projectId,
		// Fase 3 — warisi konteks kerja dari assignment (default project + id=project_id).
		work_context_type: wcType,
		work_context_id: idOf(assignment.work_context_id) ?? projectId,
		tanggal,
		status,
		jam_kerja: JAM_KERJA[status] ?? 0,
		foto_masuk: fotoId,
		lat_masuk: butuhBukti ? lat : null,
		lng_masuk: butuhBukti ? lng : null,
		jarak_masuk_m: jarak,
		masuk_valid: valid,
		dicatat_oleh: manpower.nama || '',
		metode_catat: 'leader',
		dicatat_oleh_manpower_id: manpower.id,
		verifikasi_leader_status: 'menunggu'
	};

	let absensiId: number;
	if (existing) {
		await directusServerJson(`/items/manpower_absensi/${existing.id}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});
		absensiId = existing.id;
	} else {
		const created = await directusServerJson<{ data: any }>('/items/manpower_absensi', {
			method: 'POST',
			body: JSON.stringify({ ...payload, jam_masuk: new Date().toISOString() })
		});
		absensiId = created?.data?.id;
	}

	await postAccrual(absensiId, assignment, status);

	return json({
		success: true,
		absensiId,
		masuk_valid: valid,
		jarak_m: jarak,
		accuracy,
		message: !butuhBukti
			? 'Tercatat & masuk antrean verifikasi'
			: valid == null
				? 'Absensi tercatat & masuk antrean verifikasi (tanpa cek radius)'
				: valid
					? 'Absensi tercatat & masuk antrean verifikasi'
					: `Absensi tercatat, tapi DI LUAR radius proyek (${jarak}m dari ${radius}m)`
	});
};

/**
 * Akrual biaya harian. Rumusnya dipakai bersama dengan jalur timesheet klien —
 * lihat $lib/shared/manpowerAccrualCalc. Best-effort: kegagalan di sini tidak
 * membatalkan absensinya (sama seperti perilaku klien).
 */
async function postAccrual(absensiId: number, assignment: any, status: string) {
	try {
		if (!absensiId) return;

		const rowRes = await directusServerJson<{ data: any[] }>(
			`/items/manpower_absensi?filter[id][_eq]=${absensiId}&limit=1` +
				`&fields=*`
		);
		const row = rowRes?.data?.[0];
		if (!row || row.payroll_id) return;

		const rate = pilihRate(assignment, row.manpower_id);
		const biaya = hitungBiayaHarian({ ...row, status }, rate);
		const existingExpenseId = idOf(row.expense_id);

		if (biaya <= 0) {
			if (rateKosong({ ...row, status }, rate)) {
				// R2-02: jangan Rp0 diam-diam — jejak server agar terlihat Admin Project.
				console.warn(`[absen-regu] rate kosong: absensi #${absensiId}, penugasan #${idOf(row.assignment_id)} — biaya Rp0`);
				await catatJejakAkrual(absensiId, 'rate_kosong', `penugasan #${idOf(row.assignment_id)} belum punya rate (harian/standby) — biaya harian Rp0. Isi rate di penugasan lalu simpan ulang.`);
			}
			if (existingExpenseId) {
				await directusServerJson(`/items/project_expenses/${existingExpenseId}`, { method: 'DELETE' });
			}
			await directusServerJson(`/items/manpower_absensi/${absensiId}`, {
				method: 'PATCH',
				body: JSON.stringify({ expense_id: null, biaya_harian: 0 })
			});
			return;
		}

		const manpowerId = idOf(row.manpower_id);
		const assignmentId = idOf(row.assignment_id);
		let manpowerNama = '';
		if (manpowerId) {
			try {
				const mpRes = await directusServerJson<{ data: { nama?: string } }>(
					`/items/manpower/${manpowerId}?fields=id,nama`
				);
				manpowerNama = mpRes?.data?.nama || '';
			} catch (e) {
				console.warn('[absen-regu] gagal ambil nama manpower:', e);
			}
		}

		const desc = manpowerNama
			? `Akrual harian ${manpowerNama} (assignment #${assignmentId}) via absensi regu`
			: `Akrual harian manpower #${manpowerId} (assignment #${assignmentId}) via absensi regu`;

		if (existingExpenseId) {
			await directusServerJson(`/items/project_expenses/${existingExpenseId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					expense_amount: biaya,
					debit_amount: biaya,
					expense_date: row.tanggal,
					description: desc,
					pic: manpowerNama || null
				})
			});
			await directusServerJson(`/items/manpower_absensi/${absensiId}`, {
				method: 'PATCH',
				body: JSON.stringify({ biaya_harian: biaya })
			});
			return;
		}

		const created = await directusServerJson<{ data: any }>('/items/project_expenses', {
			method: 'POST',
			body: JSON.stringify({
				project_id: idOf(row.project_id),
				expense_date: row.tanggal,
				expense_type: 'jasa',
				expense_category: 'Jasa',
				description: desc,
				pic: manpowerNama || null,
				expense_amount: biaya,
				debit_amount: biaya,
				source: 'manpower_accrual',
				source_type: 'manpower_accrual',
				is_accrual: true,
				manpower_id: manpowerId,
				ref_absensi_id: absensiId
			})
		});
		await directusServerJson(`/items/manpower_absensi/${absensiId}`, {
			method: 'PATCH',
			body: JSON.stringify({ expense_id: created?.data?.id, biaya_harian: biaya })
		});
	} catch (e) {
		console.error('[absen-regu] akrual gagal (absensi tetap tercatat):', e);
		await catatJejakAkrual(absensiId, 'akrual_gagal', String((e as any)?.message || e).slice(0, 500));
	}
}

/** R2-02 — jejak server untuk akrual Rp0 / gagal. Best-effort: tidak boleh menggagalkan absensi. */
async function catatJejakAkrual(absensiId: number, kind: 'rate_kosong' | 'akrual_gagal', detail: string) {
	try {
		await directusServerJson('/items/activity_log', {
			method: 'POST',
			body: JSON.stringify({
				module: 'manpower',
				collection: 'manpower_absensi',
				record_id: String(absensiId),
				action: 'update',
				activity_type: 'warning',
				description: `[${kind}] absensi #${absensiId}: ${detail}`.slice(0, 2000),
				actor_name: 'absen-regu-akrual',
				created_at: new Date().toISOString()
			})
		});
	} catch (logErr) {
		console.warn('[absen-regu] gagal mencatat jejak akrual (diabaikan):', logErr);
	}
}
