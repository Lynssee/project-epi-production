// src/lib/server/manpowerAbsensiCore.ts
// Inti penulisan absensi manpower — SATU-SATUNYA tempat logika ini hidup. Dipakai dua jalur:
//   - /api/manpower-leader/absen-regu   (leader mengabsenkan regu)
//   - /api/kiosk-proyek/absen           (kru lewat kiosk, Rencana Kiosk Proyek Fase 2)
// Diekstrak dari absen-regu/+server.ts TANPA mengubah perilakunya (pesan error & kode status sama).
// Absensi memicu akrual biaya (project_expenses) — jalur uang, jadi rumus/aturannya tidak boleh
// bercabang per jalur. Geofence dihitung di SERVER; klien tidak pernah dipercaya.

import { error } from '@sveltejs/kit';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { withinRadius } from '$lib/server/ess/geo';
import { hitungBiayaHarian, pilihRate, rateKosong } from '$lib/shared/manpowerAccrualCalc';
import { mergeFlags } from '$lib/shared/kioskFlags';

export const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

export const STATUS_SAH = ['hadir', 'setengah_hari', 'izin', 'sakit', 'alpha'];
/** Jam kerja default per status — sejalan dengan halaman /regu. */
export const JAM_KERJA: Record<string, number> = { hadir: 8, setengah_hari: 4 };

export type GeoMode = 'wajib' | 'longgar' | 'off';

/**
 * Ketat-nya geo-fence per konteks kerja (system_settings manpower.geofence.<type>):
 *   'wajib'   → GPS + titik geofence konteks WAJIB (perilaku lama, default proyek).
 *   'longgar' → GPS direkam bila ada, tidak menolak bila titik belum diset.
 *   'off'     → tanpa cek lokasi (foto tetap wajib untuk status berbiaya).
 */
export async function geofenceMode(type: string): Promise<GeoMode> {
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

export function hariKerjaAntara(fromISO: string, toISO: string): number {
	const a = new Date(fromISO + 'T00:00:00');
	const b = new Date(toISO + 'T00:00:00');
	if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
	let count = 0;
	for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
		const wd = d.getDay();
		if (wd !== 0 && wd !== 6) count += 1;
	}
	return count; // inklusif kedua ujung
}

/**
 * Penugasan target harus DI PROYEK INI — cegah menyeberang proyek. Selain 'aktif', pekerja baru
 * daftar-lapangan ('menunggu_validasi'/'menunggu_ttd') juga boleh, TAPI hanya selama masa kerja sementara
 * (dicek terpisah oleh cekMasaSementara). `assignmentId` null → dicari dari (proyek, manpower), 'aktif' dulu.
 */
export async function muatPenugasan(p: { projectId: number; assignmentId: number | null; manpowerId: number }) {
	const idFilter = p.assignmentId ? `filter[id][_eq]=${p.assignmentId}&` : '';
	const res = await directusServerJson<{ data: any[] }>(
		`/items/manpower_assignment?${idFilter}filter[project_id][_eq]=${p.projectId}&filter[manpower_id][_eq]=${p.manpowerId}` +
			`&filter[status][_in]=aktif,menunggu_validasi,menunggu_ttd&sort=status` +
			`&fields=id,status,tanggal_spk,tanggal_mulai,rate_harian,rate_upah_harian,rate_lembur,rate_standby,rate_uang_makan,work_context_type,work_context_id&limit=1`
	);
	const assignment = res?.data?.[0];
	if (!assignment) throw error(403, 'Orang ini tidak punya penugasan aktif di proyek Anda.');
	return assignment;
}

/** Masa kerja sementara (K4): assignment belum 'aktif' → absensi hanya `manpower.masa_sementara_hari` hari kerja. */
export async function cekMasaSementara(assignment: any, tanggal: string): Promise<void> {
	if (assignment.status === 'aktif') return;
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
	const elapsed = hariKerjaAntara(refDate, tanggal);
	if (elapsed > windowHari) {
		throw error(
			423,
			`Masa kerja sementara ${windowHari} hari kerja untuk pekerja ini sudah lewat (hari ke-${elapsed} sejak ${refDate}). ` +
				`Absensi terkunci sampai SPK-nya disetujui admin. Hubungi admin proyek untuk mempercepat validasi.`
		);
	}
}

export interface ProyekGeo {
	geo_lat?: number | null;
	geo_lng?: number | null;
	geo_radius_m?: number | null;
}

/** Validasi bukti (foto + GPS + titik geofence). Lempar 400/409 dengan pesan yang sama seperti absen-regu. */
export function validasiBukti(p: { geoMode: GeoMode; project: ProyekGeo; lat: number; lng: number; foto: unknown }): void {
	if (!(p.foto instanceof File) || p.foto.size === 0) {
		throw error(400, 'Foto bukti wajib untuk status hadir / setengah hari.');
	}
	if (p.geoMode !== 'off' && (!Number.isFinite(p.lat) || !Number.isFinite(p.lng))) {
		throw error(400, 'Lokasi GPS tidak valid. Aktifkan izin lokasi dan coba lagi.');
	}
	if (p.geoMode === 'wajib' && (p.project.geo_lat == null || p.project.geo_lng == null)) {
		throw error(409, 'Titik geofence proyek ini belum diset. Minta admin proyek merekam lokasi dulu.');
	}
}

/** Verdict geofence dihitung di server dari titik proyek. Mode 'off' / titik belum diset → valid=null. */
export function hitungLokasi(p: { geoMode: GeoMode; project: ProyekGeo; lat: number; lng: number }) {
	const radius = Number(p.project.geo_radius_m || 300);
	let valid: boolean | null = null;
	let jarak: number | null = null;
	if (p.geoMode !== 'off' && p.project.geo_lat != null && p.project.geo_lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
		({ valid, jarak } = withinRadius(p.lat, p.lng, Number(p.project.geo_lat), Number(p.project.geo_lng), radius));
	}
	return { valid, jarak, radius };
}

/** Unggah foto bukti ke Directus. `title` (opsional) menandai foto untuk deteksi pemakaian ulang. */
export async function unggahFoto(foto: File, namaDefault: string, title?: string): Promise<string | null> {
	const fd = new FormData();
	if (title) fd.append('title', title); // field non-file HARUS sebelum file di multipart Directus
	fd.append('file', foto, foto.name || namaDefault);
	const upRes = await directusServerUpload(fd);
	if (!upRes.ok) throw error(502, 'Gagal mengunggah foto bukti.');
	return (await upRes.json())?.data?.id || null;
}

export interface Pencatat {
	metode: 'leader' | 'kiosk_rekan' | 'kiosk_mandiri';
	nama: string;
	/** Hanya terisi untuk leader / HP pribadi; kiosk bersama = null. */
	manpowerId: number | null;
}

export interface AbsenMasukInput {
	projectId: number;
	project: ProyekGeo;
	assignmentId: number | null;
	targetManpowerId: number;
	status: string;
	tanggal: string;
	lat: number;
	lng: number;
	accuracy: number | null;
	foto: unknown;
	pencatat: Pencatat;
	/** 'overwrite' = perilaku absen-regu; 'idempotent' = kiosk (tidak menimpa absen sah, ulang = no-op). */
	existingPolicy?: 'overwrite' | 'idempotent';
	/** Penanda anomali kiosk yang ditulis ke verifikasi_leader_catatan. */
	flags?: string[];
	fotoTitle?: string;
	/** Dipanggil setelah penugasan valid & sebelum unggah foto (mis. gate batas absen-rekan). */
	sebelumTulis?: (ctx: { assignment: any; existing: any | null }) => Promise<void> | void;
}

export interface AbsenResult {
	absensiId: number;
	masuk_valid: boolean | null;
	jarak_m: number | null;
	accuracy: number | null;
	radius: number;
	butuhBukti: boolean;
	sudahAda: boolean;
	message: string;
}

export async function catatAbsenMasuk(i: AbsenMasukInput): Promise<AbsenResult> {
	if (!STATUS_SAH.includes(i.status)) throw error(400, `Status tidak dikenal: ${i.status}`);

	// Bukti wajib HANYA untuk status berbiaya. Izin/sakit/alpha: orangnya tidak ada di lokasi & biaya nol.
	const butuhBukti = i.status === 'hadir' || i.status === 'setengah_hari';

	const assignment = await muatPenugasan({ projectId: i.projectId, assignmentId: i.assignmentId, manpowerId: i.targetManpowerId });
	await cekMasaSementara(assignment, i.tanggal);

	const wcType = assignment.work_context_type || 'project';
	const geoMode = await geofenceMode(wcType);
	if (butuhBukti) validasiBukti({ geoMode, project: i.project, lat: i.lat, lng: i.lng, foto: i.foto });

	// Baris hari ini sudah ada? Jangan buat ganda (mencegah akrual dobel). Dicek SEBELUM unggah foto.
	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/manpower_absensi?filter[assignment_id][_eq]=${assignment.id}` +
			`&filter[tanggal][_eq]=${i.tanggal}&fields=id,status,dikunci,expense_id,payroll_id,verifikasi_leader_status&limit=1`
	);
	const existing = existingRes?.data?.[0] || null;
	if (existing?.dikunci) throw error(409, 'Absensi tanggal ini sudah terkunci (masuk periode gajian).');

	const radius = Number(i.project.geo_radius_m || 300);
	if (existing && i.existingPolicy === 'idempotent') {
		if (existing.status === 'hadir' || existing.status === 'setengah_hari') {
			if (existing.verifikasi_leader_status !== 'ditolak') {
				return { absensiId: existing.id, masuk_valid: null, jarak_m: null, accuracy: i.accuracy, radius, butuhBukti, sudahAda: true, message: 'Absen masuk hari ini sudah tercatat.' };
			}
			// ditolak leader → boleh absen ulang (jatuh ke penulisan di bawah)
		} else if (existing.status) {
			throw error(409, `Hari ini sudah dicatat leader sebagai "${existing.status}". Hubungi leader bila keliru.`);
		}
	}

	if (i.sebelumTulis) await i.sebelumTulis({ assignment, existing });

	let valid: boolean | null = null;
	let jarak: number | null = null;
	let fotoId: string | null = null;
	if (butuhBukti) {
		({ valid, jarak } = hitungLokasi({ geoMode, project: i.project, lat: i.lat, lng: i.lng }));
		fotoId = await unggahFoto(i.foto as File, `absen-regu-${i.targetManpowerId}-${i.tanggal}.jpg`, i.fotoTitle);
	}

	const kiosk = i.pencatat.metode !== 'leader';
	const payload: Record<string, any> = {
		assignment_id: assignment.id,
		manpower_id: i.targetManpowerId,
		project_id: i.projectId,
		// Fase 3 — warisi konteks kerja dari assignment (default project + id=project_id).
		work_context_type: wcType,
		work_context_id: idOf(assignment.work_context_id) ?? i.projectId,
		tanggal: i.tanggal,
		status: i.status,
		jam_kerja: JAM_KERJA[i.status] ?? 0,
		foto_masuk: fotoId,
		lat_masuk: butuhBukti ? i.lat : null,
		lng_masuk: butuhBukti ? i.lng : null,
		jarak_masuk_m: jarak,
		masuk_valid: valid,
		dicatat_oleh: i.pencatat.nama,
		metode_catat: i.pencatat.metode,
		dicatat_oleh_manpower_id: i.pencatat.manpowerId,
		verifikasi_leader_status: 'menunggu'
	};
	if (kiosk) {
		// Baris ditolak yang diabsen ulang: bersihkan jejak keputusan lama; penanda baru ditulis bersih.
		payload.verifikasi_leader_oleh = null;
		payload.verifikasi_leader_at = null;
		payload.verifikasi_leader_catatan = mergeFlags('', i.flags || []);
	}

	let absensiId: number;
	if (existing) {
		await directusServerJson(`/items/manpower_absensi/${existing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
		absensiId = existing.id;
	} else {
		const created = await directusServerJson<{ data: any }>('/items/manpower_absensi', {
			method: 'POST',
			body: JSON.stringify({ ...payload, jam_masuk: new Date().toISOString() })
		});
		absensiId = created?.data?.id;
	}

	await postAccrual(absensiId, assignment, i.status);

	return {
		absensiId,
		masuk_valid: valid,
		jarak_m: jarak,
		accuracy: i.accuracy,
		radius,
		butuhBukti,
		sudahAda: false,
		message: !butuhBukti
			? 'Tercatat & masuk antrean verifikasi'
			: valid == null
				? 'Absensi tercatat & masuk antrean verifikasi (tanpa cek radius)'
				: valid
					? 'Absensi tercatat & masuk antrean verifikasi'
					: `Absensi tercatat, tapi DI LUAR radius proyek (${jarak}m dari ${radius}m)`
	};
}

export interface AbsenPulangInput {
	projectId: number;
	project: ProyekGeo;
	targetManpowerId: number;
	tanggal: string;
	lat: number;
	lng: number;
	accuracy: number | null;
	foto: unknown;
	flags?: string[];
	fotoTitle?: string;
	/** Dipanggil setelah penugasan valid & baris hadir ditemukan serta BELUM pulang, sebelum foto diunggah.
	 *  Pengiriman ulang (respons sebelumnya hilang) berhenti sebelum ini, jadi gerbang tidak memukul percobaan kedua. */
	sebelumTulis?: () => Promise<void> | void;
}

/** Absen pulang: melengkapi baris hadir hari ini (jam/foto/lokasi pulang). Tidak menyentuh akrual biaya. */
export async function catatAbsenPulang(i: AbsenPulangInput): Promise<AbsenResult> {
	const assignment = await muatPenugasan({ projectId: i.projectId, assignmentId: null, manpowerId: i.targetManpowerId });
	const geoMode = await geofenceMode(assignment.work_context_type || 'project');
	validasiBukti({ geoMode, project: i.project, lat: i.lat, lng: i.lng, foto: i.foto });

	const res = await directusServerJson<{ data: any[] }>(
		`/items/manpower_absensi?filter[assignment_id][_eq]=${assignment.id}&filter[tanggal][_eq]=${i.tanggal}` +
			`&fields=id,status,dikunci,jam_pulang,verifikasi_leader_status,verifikasi_leader_catatan&limit=1`
	);
	const row = res?.data?.[0];
	const radius = Number(i.project.geo_radius_m || 300);
	if (!row || (row.status !== 'hadir' && row.status !== 'setengah_hari')) {
		throw error(409, 'Belum ada absen masuk hari ini. Absen HADIR dulu sebelum PULANG.');
	}
	if (row.dikunci) throw error(409, 'Absensi tanggal ini sudah terkunci (masuk periode gajian).');
	if (row.jam_pulang) {
		return { absensiId: row.id, masuk_valid: null, jarak_m: null, accuracy: i.accuracy, radius, butuhBukti: true, sudahAda: true, message: 'Absen pulang hari ini sudah tercatat.' };
	}

	if (i.sebelumTulis) await i.sebelumTulis();

	const { valid, jarak } = hitungLokasi({ geoMode, project: i.project, lat: i.lat, lng: i.lng });
	const fotoId = await unggahFoto(i.foto as File, `pulang-${i.targetManpowerId}-${i.tanggal}.jpg`, i.fotoTitle);

	const patch: Record<string, any> = {
		jam_pulang: new Date().toISOString(),
		foto_pulang: fotoId,
		lat_pulang: i.lat,
		lng_pulang: i.lng,
		jarak_pulang_m: jarak,
		pulang_valid: valid
	};
	if (i.flags?.length) patch.verifikasi_leader_catatan = mergeFlags(row.verifikasi_leader_catatan, i.flags);
	// Sudah disetujui lalu pulang tercatat belakangan → kembali ke antrean supaya pulangnya ikut dilihat.
	if (row.verifikasi_leader_status === 'disetujui') patch.verifikasi_leader_status = 'menunggu';
	await directusServerJson(`/items/manpower_absensi/${row.id}`, { method: 'PATCH', body: JSON.stringify(patch) });

	return {
		absensiId: row.id,
		masuk_valid: valid,
		jarak_m: jarak,
		accuracy: i.accuracy,
		radius,
		butuhBukti: true,
		sudahAda: false,
		message: valid === false ? `Pulang tercatat, tapi DI LUAR radius proyek (${jarak}m dari ${radius}m)` : 'Pulang tercatat'
	};
}

/**
 * Akrual biaya harian. Rumusnya dipakai bersama dengan jalur timesheet klien — lihat
 * $lib/shared/manpowerAccrualCalc. Best-effort: kegagalan di sini tidak membatalkan absensinya.
 */
export async function postAccrual(absensiId: number, assignment: any, status: string) {
	try {
		if (!absensiId) return;

		const rowRes = await directusServerJson<{ data: any[] }>(
			`/items/manpower_absensi?filter[id][_eq]=${absensiId}&limit=1&fields=*`
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
				const mpRes = await directusServerJson<{ data: { nama?: string } }>(`/items/manpower/${manpowerId}?fields=id,nama`);
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
				body: JSON.stringify({ expense_amount: biaya, debit_amount: biaya, expense_date: row.tanggal, description: desc, pic: manpowerNama || null })
			});
			await directusServerJson(`/items/manpower_absensi/${absensiId}`, { method: 'PATCH', body: JSON.stringify({ biaya_harian: biaya }) });
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
export async function catatJejakAkrual(absensiId: number, kind: 'rate_kosong' | 'akrual_gagal', detail: string) {
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
