// src/lib/services/manpowerLeader.ts
// Sistem Manpower Leader — sisi app lapangan.
// Dokumen: erp-epi-1/docs/rencana-manpower-leader.md
//
// Manpower Leader = posisi tertinggi DI LAPANGAN, pegangan koordinasi saat Project
// Leader tidak di lokasi. Kursinya ada di projects.manpower_leader_id /
// manpower_leader_wakil_id (M2O ke `manpower`) — TERPISAH dari projects.leader /
// leader_id yang menunjuk Project Leader (karyawan kantor).

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, updateItem } from '@directus/sdk';
import { auth } from '$lib/firebase';
import { compressPhoto } from '$lib/utils/photoCompress';
import { watermarkPhoto } from '$lib/utils/photoWatermark';

export const PERAN_LEADER = 'manpower_leader';
export const PERAN_WAKIL = 'wakil_leader';
export const PERAN_ANGGOTA = 'anggota';

export type PeranLapangan = typeof PERAN_LEADER | typeof PERAN_WAKIL | typeof PERAN_ANGGOTA;

export interface ManpowerRef {
	id: number;
	nama: string;
	posisi?: string | null;
	no_telpon?: number | string | null;
	foto?: string | null;
}

export interface ProyekDipimpin {
	id: number;
	name: string;
	lokasi?: string | null;
	status?: string | null;
	geo_lat?: number | null;
	geo_lng?: number | null;
	geo_radius_m?: number | null;
	peran: PeranLapangan;
}

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

/**
 * Petakan akun yang login ke baris `manpower`.
 *
 * Urutan pencarian:
 *   1. manpower.user_email == email akun (kunci utama — kebanyakan manpower leader
 *      bukan karyawan tetap, jadi tidak punya baris `karyawan`);
 *   2. manpower.karyawan_id == karyawanId (jalur cadangan bagi leader yang juga karyawan).
 *
 * @returns baris manpower, atau null bila akun ini bukan manpower.
 */
export async function resolveManpowerForAccount(
	email: string | null | undefined,
	karyawanId: number | null | undefined
): Promise<ManpowerRef | null> {
	const fields = ['id', 'nama', 'posisi', 'no_telpon', 'foto'];
	try {
		if (email) {
			const byEmail = await directus.request(
				readItems('manpower', {
					filter: { user_email: { _eq: email.toLowerCase() } },
					fields,
					limit: 1
				})
			);
			if (byEmail && byEmail.length > 0) return byEmail[0] as ManpowerRef;
		}
		if (karyawanId != null) {
			const byKaryawan = await directus.request(
				readItems('manpower', {
					filter: { karyawan_id: { _eq: karyawanId } },
					fields,
					limit: 1
				})
			);
			if (byKaryawan && byKaryawan.length > 0) return byKaryawan[0] as ManpowerRef;
		}
		return null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Proyek-proyek di mana manpower ini memegang kursi leader atau wakil. */
export async function getProyekDipimpin(manpowerId: number): Promise<ProyekDipimpin[]> {
	if (!manpowerId) return [];
	try {
		const rows = await directus.request(
			readItems('projects', {
				filter: {
					_or: [
						{ manpower_leader_id: { _eq: manpowerId } },
						{ manpower_leader_wakil_id: { _eq: manpowerId } }
					]
				},
				fields: [
					'id', 'name', 'lokasi', 'status',
					'geo_lat', 'geo_lng', 'geo_radius_m',
					'manpower_leader_id', 'manpower_leader_wakil_id'
				],
				limit: -1
			})
		);
		return (rows || []).map((p: any) => ({
			...p,
			peran: String(idOf(p.manpower_leader_id)) === String(manpowerId) ? PERAN_LEADER : PERAN_WAKIL
		})) as ProyekDipimpin[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Anggota regu di sebuah proyek — semua penugasan berstatus `aktif`.
 * Leader sendiri ikut dikembalikan (ditandai lewat peran_lapangan) supaya UI bisa
 * menampilkannya tapi menonaktifkan aksi terhadap dirinya sendiri.
 */
export async function getAnggotaRegu(projectId: number) {
	if (!projectId) return [];
	try {
		const rows = await directus.request(
			readItems('manpower_assignment', {
				filter: { project_id: { _eq: projectId }, status: { _eq: 'aktif' } },
				fields: [
					'id', 'jabatan', 'peran_lapangan', 'rate_tipe', 'rate_harian', 'status',
					'manpower_id.id', 'manpower_id.nama', 'manpower_id.posisi',
					'manpower_id.no_telpon', 'manpower_id.foto',
					'manpower_id.golongan_darah', 'manpower_id.riwayat_alergi',
					'manpower_id.nama_kontak_darurat', 'manpower_id.kontak_darurat_telp'
				],
				limit: -1
			})
		);
		return rows || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}


/**
 * Absenkan seorang anggota regu (absensi representatif).
 *
 * WAJIB lewat endpoint server `/api/manpower-leader/absen-regu`, TIDAK menulis
 * Directus dari sini. Alasannya: absensi memicu akrual biaya, dan aturan repo ini
 * eksplisit bahwa validasi jarak harus di server ("jangan pernah percaya validasi
 * klien" — src/lib/server/ess/geo.ts). Kalau klien yang menulis, `masuk_valid` bisa
 * dikirim `true` tanpa benar-benar berada di lokasi.
 *
 * Foto di-watermark GPS lalu dikompresi sebelum dikirim, sama seperti absensi ESS.
 */
export async function absenkanAnggota(params: {
	projectId: number;
	assignmentId: number;
	manpowerId: number;
	status: string;
	tanggal: string;
	/** Wajib untuk status berbiaya (hadir/setengah_hari); null untuk izin/sakit/alpha. */
	lat?: number | null;
	lng?: number | null;
	accuracy?: number | null;
	photoFile?: File | null;
}): Promise<{ success: boolean; message?: string; masuk_valid?: boolean; jarak_m?: number | null; error?: string }> {
	try {
		const idToken = await auth.currentUser?.getIdToken();
		if (!idToken) return { success: false, error: 'Sesi tidak ditemukan. Login ulang.' };

		const fd = new FormData();
		fd.append('project_id', String(params.projectId));
		fd.append('assignment_id', String(params.assignmentId));
		fd.append('manpower_id', String(params.manpowerId));
		fd.append('status', params.status);
		fd.append('tanggal', params.tanggal);

		// Bukti hanya dikirim untuk status berbiaya. Server yang memutuskan apakah
		// bukti itu wajib — di sini hanya menyiapkannya bila ada.
		if (params.photoFile && params.lat != null && params.lng != null) {
			const stamped = await watermarkPhoto(params.photoFile, {
				lat: params.lat,
				lng: params.lng,
				accuracy: params.accuracy ?? 0
			});
			const compressed = await compressPhoto(stamped);

			fd.append('lat', String(params.lat));
			fd.append('lng', String(params.lng));
			if (params.accuracy != null) fd.append('accuracy', String(params.accuracy));
			fd.append('foto', compressed, compressed.name || 'absen-regu.jpg');
		}

		const res = await fetch('/api/manpower-leader/absen-regu', {
			method: 'POST',
			headers: { Authorization: `Bearer ${idToken}` },
			body: fd
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) return { success: false, error: data?.message || `Gagal (${res.status})` };
		return { success: true, ...data };
	} catch (e: any) {
		return { success: false, error: e?.message || 'Gagal mengirim absensi' };
	}
}

/**
 * Nominasikan anggota regu sebagai calon leader. Lewat endpoint server (validasi kursi
 * leader + keanggotaan proyek); status selalu 'pending' sampai di-review HRD di admin.
 */
export async function nominasikanAnggota(params: {
	projectId: number;
	nomineeManpowerId: number;
	rating: number;
	tags: string[];
	catatan: string;
}): Promise<{ success: boolean; error?: string }> {
	try {
		const idToken = await auth.currentUser?.getIdToken();
		if (!idToken) return { success: false, error: 'Sesi tidak ditemukan. Login ulang.' };
		const res = await fetch('/api/manpower-leader/nominasi', {
			method: 'POST',
			headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				project_id: params.projectId,
				nominee_manpower_id: params.nomineeManpowerId,
				rating: params.rating,
				tags: params.tags,
				catatan: params.catatan
			})
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) return { success: false, error: data?.message || `Gagal (${res.status})` };
		return { success: true };
	} catch (e: any) {
		return { success: false, error: e?.message || 'Gagal mengirim nominasi' };
	}
}

async function leaderApi(path: string, init: RequestInit = {}): Promise<{ ok: boolean; data: any; error?: string }> {
	try {
		const idToken = await auth.currentUser?.getIdToken();
		if (!idToken) return { ok: false, data: null, error: 'Sesi tidak ditemukan. Login ulang.' };
		const res = await fetch(path, {
			...init,
			headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) return { ok: false, data, error: data?.message || `Gagal (${res.status})` };
		return { ok: true, data };
	} catch (e: any) {
		return { ok: false, data: null, error: e?.message || 'Gagal terhubung ke server' };
	}
}

/** Tip gaya komunikasi (DISC) per manpower_id di regu. Kosong bila belum tertaut karyawan / belum tes. */
export async function getGayaKomunikasi(projectId: number): Promise<Record<number, { profil: string; tip: string }>> {
	const r = await leaderApi(`/api/manpower-leader/gaya-komunikasi?project_id=${projectId}`);
	if (!r.ok) console.error('[manpowerLeader] gaya komunikasi gagal:', r.error);
	return r.ok ? r.data?.data || {} : {};
}

/** Check-in kesiapan kru HARI INI untuk proyek ini. */
export async function getKesiapanHariIni(projectId: number): Promise<any[]> {
	const r = await leaderApi(`/api/manpower-leader/kesiapan?project_id=${projectId}`);
	if (!r.ok) console.error('[manpowerLeader] kesiapan gagal dimuat:', r.error);
	return r.ok ? r.data?.data || [] : [];
}

export async function simpanKesiapan(projectId: number, items: any[]): Promise<{ success: boolean; error?: string; baru?: number; diperbarui?: number }> {
	const r = await leaderApi('/api/manpower-leader/kesiapan', {
		method: 'POST',
		body: JSON.stringify({ project_id: projectId, items })
	});
	return r.ok ? { success: true, ...r.data } : { success: false, error: r.error };
}

/** Antrean pengajuan lembur yang menunggu verifikasi lapis 1 di sebuah proyek. */
export async function getAntrianLembur(projectId: number) {
	if (!projectId) return [];
	try {
		const rows = await directus.request(
			readItems('overtime_request', {
				filter: {
					project_id: { _eq: projectId },
					verifikasi_leader_status: { _eq: 'menunggu' }
				},
				fields: [
					'id', 'tanggal', 'jam_diajukan', 'alasan', 'status',
					'verifikasi_leader_status', 'manpower_id.id', 'manpower_id.nama'
				],
				sort: ['-tanggal'],
				limit: -1
			})
		);
		return rows || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Verifikasi lapis 1 satu pengajuan lembur.
 * TIDAK menyentuh `status` — itu keputusan HRD. Ini saringan lapangan sebelum HRD.
 */
export async function verifikasiLembur(params: {
	requestId: number;
	verifikatorManpowerId: number;
	setuju: boolean;
	catatan?: string;
}): Promise<{ success: boolean; error?: string }> {
	const { requestId, verifikatorManpowerId, setuju, catatan = '' } = params;
	try {
		if (!requestId || !verifikatorManpowerId) return { success: false, error: 'Data tidak lengkap' };
		if (!setuju && !catatan.trim()) return { success: false, error: 'Penolakan wajib disertai alasan' };

		const row: any = await directus.request(
			readItem('overtime_request', requestId, { fields: ['id', 'manpower_id', 'status'] })
		);
		if (row?.status && row.status !== 'pending') {
			return { success: false, error: 'Pengajuan ini sudah diputuskan HRD.' };
		}
		if (!bolehVerifikasi(verifikatorManpowerId, Number(idOf(row?.manpower_id)))) {
			return { success: false, error: 'Anda tidak boleh memverifikasi lembur sendiri.' };
		}

		await directus.request(
			updateItem('overtime_request', requestId, {
				verifikasi_leader_status: setuju ? 'disetujui' : 'ditolak',
				verifikasi_leader_oleh: verifikatorManpowerId,
				verifikasi_leader_at: new Date().toISOString(),
				verifikasi_leader_catatan: catatan || ''
			})
		);
		return { success: true };
	} catch (error: any) {
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal menyimpan verifikasi lembur' };
	}
}

/** Aturan 5 — leader tidak boleh memverifikasi absensinya sendiri. */
export function bolehVerifikasi(verifikatorManpowerId: number, targetManpowerId: number): boolean {
	if (verifikatorManpowerId == null || targetManpowerId == null) return false;
	return Number(verifikatorManpowerId) !== Number(targetManpowerId);
}

/** Antrean absensi yang menunggu verifikasi lapis 1 di sebuah proyek. */
export async function getAntrianVerifikasi(projectId: number, tanggal?: string) {
	if (!projectId) return [];
	try {
		const filter: Record<string, any> = {
			project_id: { _eq: projectId },
			verifikasi_leader_status: { _eq: 'menunggu' }
		};
		if (tanggal) filter.tanggal = { _eq: tanggal };

		const rows = await directus.request(
			readItems('manpower_absensi', {
				filter,
				fields: [
					'id', 'tanggal', 'status', 'jam_masuk', 'jam_pulang', 'jam_kerja',
					'metode_catat', 'dikunci', 'masuk_valid', 'pulang_valid',
					'verifikasi_leader_status',
					'manpower_id.id', 'manpower_id.nama', 'manpower_id.posisi'
				],
				sort: ['-tanggal'],
				limit: -1
			})
		);
		return rows || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Verifikasi lapis 1 satu baris absensi.
 *
 * Batas yang ditegakkan:
 *   - baris `dikunci` (sudah masuk periode gajian) tidak boleh disentuh;
 *   - leader tidak boleh memverifikasi absensinya sendiri (aturan 5).
 *
 * CATATAN: verifikasi ini TIDAK menahan akrual biaya — akrual sudah diposting
 * saat absensi dibuat. Ini lapis kontrol sebelum payroll, bukan gerbang jurnal.
 */
export async function verifikasiAbsensi(params: {
	absensiId: number;
	verifikatorManpowerId: number;
	setuju: boolean;
	catatan?: string;
}): Promise<{ success: boolean; error?: string }> {
	const { absensiId, verifikatorManpowerId, setuju, catatan = '' } = params;
	try {
		if (!absensiId || !verifikatorManpowerId) return { success: false, error: 'Data tidak lengkap' };
		if (!setuju && !catatan.trim()) return { success: false, error: 'Penolakan wajib disertai alasan' };

		const row: any = await directus.request(
			readItem('manpower_absensi', absensiId, { fields: ['id', 'manpower_id', 'dikunci'] })
		);
		if (row?.dikunci) {
			return { success: false, error: 'Absensi ini sudah terkunci (masuk periode gajian).' };
		}
		if (!bolehVerifikasi(verifikatorManpowerId, Number(idOf(row?.manpower_id)))) {
			return { success: false, error: 'Anda tidak boleh memverifikasi absensi sendiri. Mintakan ke Project Leader.' };
		}

		await directus.request(
			updateItem('manpower_absensi', absensiId, {
				verifikasi_leader_status: setuju ? 'disetujui' : 'ditolak',
				verifikasi_leader_oleh: verifikatorManpowerId,
				verifikasi_leader_at: new Date().toISOString(),
				verifikasi_leader_catatan: catatan || ''
			})
		);
		return { success: true };
	} catch (error: any) {
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal menyimpan verifikasi' };
	}
}
