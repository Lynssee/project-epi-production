import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, deleteItem, uploadFiles } from '@directus/sdk';
import { submitApprovalRequest } from './approvalApi';
import { loadManpowerSettings, getManpowerSetting } from './manpowerSettings';

export interface ManpowerAssignment {
	id?: number;
	manpower_id: any;
	project_id: any;
	jabatan: string;
	rate_tipe: string;
	rate_harian?: number | null;
	nilai_borongan?: number | null;
	tanggal_mulai?: string | null;
	tanggal_selesai?: string | null;
	status: string;
	catatan?: string;
	dibuat_oleh?: string;
	nomor_spk?: string;
	tanggal_spk?: string;
	jenis_pekerjaan?: string;
	lokasi?: string;
	ttd_manpower?: string;
	ttd_manpower_at?: string;
	ttd_nama?: string;
}

const ASSIGN_FIELDS = [
	'*',
	'manpower_id.id', 'manpower_id.nama', 'manpower_id.posisi', 'manpower_id.NIK',
	'manpower_id.no_telpon', 'manpower_id.foto', 
	'project_id.id', 'project_id.name', 'project_id.lokasi', 'project_id.nomor_po',
	'project_id.jenis_project', 'project_id.geo_lat', 'project_id.geo_lng', 'project_id.geo_radius_m',
];

/**
 * T1 (Delegasi Peran Fase 0.2, disalin dari erp-epi-1/manpowerAssignmentApi.js
 * supaya proteksi bentrok jadwal berlaku juga dari SPK yang dibuat/ditandatangani
 * lewat Dashboard Lapangan, bukan cuma dari Dashboard Admin) — cegah double-booking:
 * satu manpower tidak boleh punya dua SPK status=aktif dengan rentang tumpang tindih.
 *
 * PENGECUALIAN BORONGAN: pekerja borongan dibayar per hasil, bukan per hari, jadi wajar
 * memegang lebih dari satu SPK borongan paralel di proyek BERBEDA. Kalau kedua SPK
 * (yang baru dan yang sudah aktif) sama-sama borongan dan proyeknya berbeda, bentrok
 * tidak diblokir — hanya dicatat sebagai peringatan. Bisa dimatikan lewat setelan
 * `manpower.spk.izin_overlap_borongan` (system_settings), tanpa ubah kode.
 */
function isBorongan(v: any) {
	return String(v || '').trim().toLowerCase() === 'borongan';
}

async function cekBentrokJadwal(
	manpowerId: any,
	tanggalMulai: string | null,
	tanggalSelesai: string | null,
	excludeId: number | null = null,
	opts: { rateTipe?: string | null; projectId?: any } = {}
) {
	const mid = typeof manpowerId === 'object' ? manpowerId?.id : manpowerId;
	if (!mid || !tanggalMulai) return { conflict: false as const, isWarning: false };

	const pidBaru = typeof opts.projectId === 'object' ? opts.projectId?.id : opts.projectId;
	const rateTipeBaru = opts.rateTipe || 'harian';
	let izinOverlapBorongan = true;
	let izinOverlapHarian = true;
	let overlapMode = 'warn';

	try {
		await loadManpowerSettings();
		izinOverlapBorongan = getManpowerSetting('manpower.spk.izin_overlap_borongan') !== false;
		izinOverlapHarian = getManpowerSetting('manpower.spk.izin_overlap_harian') !== false;
		overlapMode = getManpowerSetting('manpower.spk.overlap_mode') || 'warn';
	} catch { /* setelan tak terjangkau — pakai default longgar */ }

	try {
		const rows: any[] = await directus.request(
			readItems('manpower_assignment', {
				fields: ['id', 'project_id', 'tanggal_mulai', 'tanggal_selesai', 'nomor_spk', 'rate_tipe'],
				filter: { manpower_id: { _eq: mid }, status: { _eq: 'aktif' } },
				limit: -1
			})
		);

		const s1 = new Date(tanggalMulai);
		const e1 = tanggalSelesai ? new Date(tanggalSelesai) : new Date('2099-12-31');

		for (const r of rows) {
			if (excludeId && String(r.id) === String(excludeId)) continue;
			if (!r.tanggal_mulai) continue;

			const pidLama = typeof r.project_id === 'object' ? r.project_id?.id : r.project_id;
			const rateTipeLama = r.rate_tipe || 'harian';
			const isDifferentProject = pidBaru && pidLama && String(pidBaru) !== String(pidLama);

			if (isDifferentProject) {
				if (izinOverlapBorongan && (isBorongan(rateTipeBaru) || isBorongan(rateTipeLama))) {
					continue; // borongan paralel lintas proyek — diizinkan
				}
				if (izinOverlapHarian && !isBorongan(rateTipeBaru)) {
					continue; // manpower harian paralel lintas proyek — diizinkan
				}
			}

			const s2 = new Date(r.tanggal_mulai);
			const e2 = r.tanggal_selesai ? new Date(r.tanggal_selesai) : new Date('2099-12-31');
			if (s1 <= e2 && s2 <= e1) {
				let projectName = '';
				const pid = typeof r.project_id === 'object' ? r.project_id?.id : r.project_id;
				if (pid) {
					try {
						const pData: any = await directus.request(readItem('projects', pid, { fields: ['id', 'name'] }));
						projectName = pData?.name || '';
					} catch {}
				}
				const isWarnOnly = overlapMode === 'warn';
				return { conflict: true as const, isWarning: isWarnOnly, with: { ...r, project_name: projectName } };
			}
		}
		return { conflict: false as const, isWarning: false };
	} catch {
		return { conflict: false as const, isWarning: false }; // fail-open -- jangan blokir SPK karena gagal cek
	}
}

export function generateNomorSPK() {
	const now = new Date();
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const yyyy = now.getFullYear();
	const rand = String(Math.floor(Math.random() * 900) + 100);
	return `SPK/EPI/${mm}${yyyy}/${rand}`;
}

export async function getAssignments(filters: any = {}) {
	try {
		const filterQuery: any = {};
		if (filters.manpower_id) filterQuery.manpower_id = { _eq: filters.manpower_id };
		if (filters.project_id) filterQuery.project_id = { _eq: filters.project_id };
		if (filters.status) filterQuery.status = { _eq: filters.status };

		const result = await directus.request(
			readItems('manpower_assignment', {
				fields: ASSIGN_FIELDS,
				filter: Object.keys(filterQuery).length > 0 ? filterQuery : undefined,
				sort: ['-id'],
				limit: -1
			})
		);
		return { data: result || [], success: true };
	} catch (error: any) {
		console.error('getAssignments:', error);
		return { data: [], success: false, error: error.message };
	}
}

export interface AssignmentExpiryRow {
	id: number;
	nomor_spk: string | null;
	jabatan: string | null;
	tanggal_selesai: string | null;
	status: string;
	manpower_id: any;
	project_id: any;
}

// SPK Jatuh Tempo Terpusat — penugasan manpower_assignment berstatus 'aktif' dari SEMUA proyek
// yang di-scope user, diurutkan tanggal_selesai. Sama pola dengan getContractExpiryForProjects
// (projectContract.ts) supaya kategori aging identik lintas laporan terpusat.
export async function getAssignmentExpiryForProjects(projectIds: (number | string)[]): Promise<AssignmentExpiryRow[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const result = await directus.request(
			readItems('manpower_assignment', {
				fields: [
					'id', 'nomor_spk', 'jabatan', 'tanggal_selesai', 'status',
					'manpower_id.id', 'manpower_id.nama',
					'project_id.id', 'project_id.name'
				],
				filter: { project_id: { _in: projectIds }, status: { _eq: 'aktif' } },
				sort: ['tanggal_selesai'],
				limit: -1
			})
		);
		return (result || []) as any;
	} catch (error) {
		console.error('getAssignmentExpiryForProjects:', error);
		return [];
	}
}

export interface ActiveAssignmentRange {
	id: number;
	manpower_id: number;
	project_id: number;
	tanggal_mulai: string | null;
	tanggal_selesai: string | null;
}

// Manpower Rencana vs Realisasi Terpusat — penugasan aktif (rencana headcount) lintas proyek
// yang di-scope user, dipakai untuk menghitung berapa orang SEHARUSNYA hadir per hari (dari
// rentang tanggal_mulai/tanggal_selesai SPK), dibandingkan realisasi absensi sesungguhnya.
export async function getActiveAssignmentsForProjects(projectIds: (number | string)[]): Promise<ActiveAssignmentRange[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const result = await directus.request(
			readItems('manpower_assignment', {
				fields: ['id', 'manpower_id', 'project_id', 'tanggal_mulai', 'tanggal_selesai'],
				filter: { project_id: { _in: projectIds }, status: { _eq: 'aktif' } },
				limit: -1
			})
		);
		return (result || []) as any;
	} catch (error) {
		console.error('getActiveAssignmentsForProjects:', error);
		return [];
	}
}

/**
 * Delegasi Peran Fase 1 (disalin dari erp-epi-1) — status default 'menunggu_validasi'
 * + SPK baru otomatis diajukan ke Approval Center (module_key resource.spk).
 * Kirim status: 'aktif' eksplisit untuk melewati gerbang ini (jalur internal/migrasi).
 */
export async function createAssignment(data: any) {
	// GPA-10: SPK wajib tertaut ke master pekerja (77 SPK aktif sebelumnya manpower_id=null sehingga
	// tidak bisa dipilih di rincian PA dan upah dibayar gelondongan).
	if (!data?.manpower_id) {
		return { data: null, success: false, error: 'Pilih pekerja dari daftar manpower — SPK tidak boleh dibuat tanpa data pekerja.' };
	}
	try {
		const initialStatus = data.status || 'menunggu_validasi';

		if (initialStatus === 'aktif') {
			const cek = await cekBentrokJadwal(data.manpower_id, data.tanggal_mulai, data.tanggal_selesai, null, {
				rateTipe: data.rate_tipe,
				projectId: data.project_id
			});
			if (cek.conflict && !cek.isWarning) {
				const projLabel = (cek.with as any)?.project_name
					? ` di proyek "${(cek.with as any).project_name}"`
					: ((cek.with as any)?.project_id ? ` di proyek #${typeof (cek.with as any).project_id === 'object' ? (cek.with as any).project_id?.id : (cek.with as any).project_id}` : '');
				return {
					data: null, success: false,
					error: `Manpower ini sudah punya SPK aktif #${cek.with.id} (${cek.with.nomor_spk || '-'})${projLabel} yang bentrok jadwal (${cek.with.tanggal_mulai}..${cek.with.tanggal_selesai || 'tanpa batas'}).`
				};
			}
		}

		const payload = {
			manpower_id: data.manpower_id,
			project_id: data.project_id,
			jabatan: data.jabatan || '',
			rate_tipe: data.rate_tipe || 'harian',
			rate_harian: data.rate_harian != null && data.rate_harian !== '' ? Number(data.rate_harian) : null,
			nilai_borongan: data.nilai_borongan != null && data.nilai_borongan !== '' ? Number(data.nilai_borongan) : null,
			tanggal_mulai: data.tanggal_mulai || null,
			tanggal_selesai: data.tanggal_selesai || null,
			status: initialStatus,
			catatan: data.catatan || '',
			dibuat_oleh: data.dibuat_oleh || '',
			nomor_spk: data.nomor_spk || generateNomorSPK(),
			tanggal_spk: data.tanggal_spk || new Date().toISOString().split('T')[0],
			jenis_pekerjaan: data.jenis_pekerjaan || '',
			lokasi: data.lokasi || '',
		};

		const result = await directus.request(createItem('manpower_assignment', payload));

		// fetch expanded result
		const created = await directus.request(readItems('manpower_assignment', {
			fields: ASSIGN_FIELDS,
			filter: { id: { _eq: result.id } },
			limit: 1
		}));

		if (initialStatus === 'menunggu_validasi' && (created[0] as any)?.id) {
			try {
				await submitApprovalRequest({
					moduleKey: 'resource.spk',
					sourceCollection: 'manpower_assignment',
					sourceId: (created[0] as any).id,
					title: `SPK ${payload.nomor_spk} — proyek #${data.project_id}`,
					summary: `Manpower #${data.manpower_id}, jabatan ${payload.jabatan || '-'}, periode ${payload.tanggal_mulai || '-'} s/d ${payload.tanggal_selesai || '-'}.`,
					amount: payload.rate_tipe === 'borongan' ? payload.nilai_borongan : payload.rate_harian,
					departmentKey: 'PROJECT',
					callbackUrl: '/api/project/manpower-spk/approval-callback',
					payload: { assignment_id: (created[0] as any).id },
				} as any);
			} catch (e: any) {
				console.error('[createAssignment] gagal submit approval resource.spk (SPK tetap dibuat):', e?.message || e);
			}
		}

		return {
			data: created[0], success: true,
			message: initialStatus === 'menunggu_validasi' ? 'Penugasan dibuat, menunggu validasi admin.' : 'Penugasan & SPK berhasil dibuat'
		};
	} catch (error: any) {
		console.error('createAssignment:', error);
		return { data: null, success: false, error: error.message };
	}
}

export async function updateAssignment(id: number, data: any) {
	try {
		const payload = { ...data };
		delete payload.id;
		delete payload.date_created;

		if (payload.manpower_id && typeof payload.manpower_id === 'object') payload.manpower_id = payload.manpower_id.id;
		if (payload.project_id && typeof payload.project_id === 'object') payload.project_id = payload.project_id.id;

		// T1 (Delegasi Peran Fase 0.2) — cek bentrok hanya saat penugasan sedang/sudah aktif
		// dan field yang menentukan bentrok (status/tanggal) ikut berubah.
		if (payload.status === 'aktif' || 'tanggal_mulai' in payload || 'tanggal_selesai' in payload) {
			const existingRows: any[] = await directus.request(
				readItems('manpower_assignment', {
					fields: ['id', 'manpower_id', 'project_id', 'rate_tipe', 'status', 'tanggal_mulai', 'tanggal_selesai'],
					filter: { id: { _eq: id } },
					limit: 1
				})
			);
			const existing = existingRows[0];
			const effectiveStatus = payload.status || existing?.status;
			if (existing && effectiveStatus === 'aktif') {
				const manpowerId = payload.manpower_id ?? existing.manpower_id;
				const tanggalMulai = 'tanggal_mulai' in payload ? payload.tanggal_mulai : existing.tanggal_mulai;
				const tanggalSelesai = 'tanggal_selesai' in payload ? payload.tanggal_selesai : existing.tanggal_selesai;
				const cek = await cekBentrokJadwal(manpowerId, tanggalMulai, tanggalSelesai, id, {
					rateTipe: payload.rate_tipe ?? existing.rate_tipe,
					projectId: payload.project_id ?? existing.project_id
				});
				if (cek.conflict && !cek.isWarning) {
					const projLabel = (cek.with as any)?.project_name
						? ` di proyek "${(cek.with as any).project_name}"`
						: ((cek.with as any)?.project_id ? ` di proyek #${typeof (cek.with as any).project_id === 'object' ? (cek.with as any).project_id?.id : (cek.with as any).project_id}` : '');
					return {
						data: null, success: false,
						error: `Manpower ini sudah punya SPK aktif #${cek.with.id} (${cek.with.nomor_spk || '-'})${projLabel} yang bentrok jadwal (${cek.with.tanggal_mulai}..${cek.with.tanggal_selesai || 'tanpa batas'}).`
					};
				}
			}
		}

		await directus.request(updateItem('manpower_assignment', id, payload));
		
		const updated = await directus.request(readItems('manpower_assignment', {
			fields: ASSIGN_FIELDS,
			filter: { id: { _eq: id } },
			limit: 1
		}));
		
		return { data: updated[0], success: true, message: 'Penugasan diperbarui' };
	} catch (error: any) {
		console.error('updateAssignment:', error);
		return { data: null, success: false, error: error.message };
	}
}

export async function setAssignmentStatus(id: number, status: string) {
	return updateAssignment(id, { status });
}

function dataUrlToFile(dataUrl: string, filename: string) {
	const arr = dataUrl.split(',');
	const mimeMatch = arr[0].match(/:(.*?);/);
	const mime = mimeMatch ? mimeMatch[1] : 'image/png';
	const bstr = atob(arr[1]);
	let n = bstr.length;
	const u8arr = new Uint8Array(n);
	while (n--) {
		u8arr[n] = bstr.charCodeAt(n);
	}
	return new File([u8arr], filename, { type: mime });
}

export async function signAssignment(id: number, signatureDataUrl: string, nama: string = '') {
	try {
		const file = dataUrlToFile(signatureDataUrl, `ttd-spk-${id}-${Date.now()}.png`);
		const formData = new FormData();
		formData.append('title', `TTD SPK Assignment ${id}`);
		formData.append('file', file);
		
		// Upload file to directus
		const uploadRes = await directus.request(uploadFiles(formData as any));
		const fileId = uploadRes.id;

		const res = await updateAssignment(id, {
			ttd_manpower: fileId,
			ttd_manpower_at: new Date().toISOString(),
			ttd_nama: nama,
			status: 'aktif',
		});

		// updateAssignment() bisa gagal (mis. bentrok jadwal, Fase 0.2) -- dulu diabaikan
		// diam-diam di sini dan selalu melapor success:true walau TTD gagal disimpan.
		if (!res.success) {
			return { data: null, success: false, error: res.error || 'Gagal menyimpan tanda tangan' };
		}

		return { data: res.data, success: true, message: 'SPK berhasil ditandatangani' };
	} catch (error: any) {
		console.error('signAssignment:', error);
		return { data: null, success: false, error: error.message };
	}
}

export async function deleteAssignment(id: number) {
	try {
		await directus.request(deleteItem('manpower_assignment', id));
		return { success: true, message: 'Penugasan dihapus' };
	} catch (error: any) {
		return { success: false, error: error.message };
	}
}
