// src/lib/services/hse.ts
// Modul HSE (Health, Safety & Environment) — Fase 1: Insiden & Near-Miss.
// Pola sama dengan security.ts: direct createItem/readItems via @directus/sdk untuk
// pelaporan lapangan cepat (foto + GPS), notifikasi ke leader area via app_notifications.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem, uploadFiles } from '@directus/sdk';
import { getIdToken } from './secureDirectus';

export async function uploadHseFoto(file: File, description: string): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('description', description);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface HseIncident {
	id: number;
	tipe: string;
	severity: string | null;
	kategori_bahaya: string | null;
	lokasi: string | null;
	kronologi: string | null;
	tindakan_segera: string | null;
	status: string;
	date_created: string;
	mitra_terlibat_id?: number | null;
}

// Modul Kemitraan v2.0 Bab 07.6 — "Penandaan Insiden Melibatkan Mitra". Field murah
// dipasang di erp-epi-1 (master_supplier FK) sekarang dipakai di sini. Skor K3
// otomatis TIDAK diaktifkan sampai ambang data terpenuhi (Fase 4, hse_incident >=30
// baris dgn penanda mitra) — field ini baru mulai mengumpulkan data sejak hari ini.
export interface MitraOption {
	id: number;
	nama: string;
}

export async function fetchMitraOptionsForHse(): Promise<MitraOption[]> {
	try {
		return (await directus.request(
			readItems('master_supplier', {
				filter: {
					status: { _eq: 'aktif' },
					is_duplicate_of: { _null: true },
					tipe_mitra: { _in: ['subkontraktor', 'mandor_borongan'] }
				},
				fields: ['id', 'nama'],
				sort: ['nama'],
				limit: -1
			})
		)) as unknown as MitraOption[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

async function notifyHseReport(incident: Record<string, any>) {
	const isBerat = incident.tipe === 'insiden' || incident.severity === 'critical';
	const notification = {
		type: isBerat ? 'hse_incident_berat' : 'hse_near_miss',
		title: isBerat ? `🚨 Insiden HSE — ${incident.kategori_bahaya || 'K3'}` : `⚠️ Near-Miss/Kondisi Tidak Aman — ${incident.kategori_bahaya || '-'}`,
		message: `${incident.lokasi ? 'Lokasi: ' + incident.lokasi + '. ' : ''}${incident.kronologi || ''}`.trim() || 'Laporan HSE baru.',
		priority: isBerat ? 'high' : 'medium',
		department: 'hse',
		read: false,
		action_required: true,
		action_url: '/hse?tab=incidents',
		created_at: new Date().toISOString()
	};
	try {
		await directus.request(createItem('app_notifications', notification));
	} catch (err) {
		console.warn('Gagal mengirim notifikasi HSE:', err);
	}
}

async function notifyHseIncidentCriticalWa(sourceId: number, payload: Record<string, any>) {
	const isBerat = payload.tipe === 'insiden' || payload.severity === 'critical';
	if (!isBerat) return;
	try {
		const token = await getIdToken();
		const message = `${payload.lokasi ? 'Lokasi: ' + payload.lokasi + '. ' : ''}${payload.kronologi || ''}`.trim() || 'Insiden HSE kritis.';
		await fetch('/api/hse/incident-notify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ sourceId, message })
		});
	} catch (err) {
		console.warn('Gagal mengirim eskalasi WA insiden HSE:', err);
	}
}

export async function submitHseIncident(payload: Record<string, any>) {
	const saved: any = await directus.request(
		createItem('hse_incident', { status: 'baru', ...payload })
	);
	await notifyHseReport(payload);
	await notifyHseIncidentCriticalWa(saved?.id, payload);
	return saved;
}

export interface HseB3 {
	id: number;
	nama_bahan: string;
	no_cas: string | null;
	kelas_ghs: string[] | null;
	piktogram_ghs: string[] | null;
	lokasi_simpan: string | null;
	apd_wajib: string | null;
	msds_document_id: { id: string; product_name: string; msds_url: string | null } | null;
}

export async function searchB3(query: string): Promise<HseB3[]> {
	try {
		return (await directus.request(
			readItems('hse_b3_register', {
				filter: {
					status: { _eq: 'aktif' },
					...(query.trim() ? { nama_bahan: { _icontains: query } } : {})
				},
				fields: [
					'id', 'nama_bahan', 'no_cas', 'kelas_ghs', 'piktogram_ghs',
					'lokasi_simpan', 'apd_wajib', 'msds_document_id.id',
					'msds_document_id.product_name', 'msds_document_id.msds_url'
				],
				sort: ['nama_bahan'],
				limit: 30
			})
		)) as unknown as HseB3[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchMyHseReports(pelaporId: number): Promise<HseIncident[]> {
	if (!pelaporId) return [];
	try {
		return (await directus.request(
			readItems('hse_incident', {
				filter: { pelapor_id: { _eq: pelaporId } },
				fields: ['id', 'tipe', 'severity', 'kategori_bahaya', 'lokasi', 'kronologi', 'tindakan_segera', 'status', 'date_created', 'mitra_terlibat_id'],
				sort: ['-date_created'],
				limit: 50
			})
		)) as HseIncident[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

// ---------------------------------------------------------------------------
// Fase 3: APD, Inspeksi & Izin Kerja (PTW)
// ---------------------------------------------------------------------------

export interface HseApdDistribution {
	id: number;
	apd_id: { id: number; nama_apd: string; kategori: string } | null;
	qty: number;
	tanggal_terbit: string | null;
	tanggal_kedaluwarsa: string | null;
	ttd_terima: boolean;
	status: string;
}

export async function fetchMyApdDistribution(karyawanId: number): Promise<HseApdDistribution[]> {
	if (!karyawanId) return [];
	try {
		return (await directus.request(
			readItems('hse_apd_distribution', {
				filter: { karyawan_id: { _eq: karyawanId } },
				fields: ['id', 'apd_id.id', 'apd_id.nama_apd', 'apd_id.kategori', 'qty', 'tanggal_terbit', 'tanggal_kedaluwarsa', 'ttd_terima', 'status'],
				sort: ['-date_created'],
				limit: 50
			})
		)) as unknown as HseApdDistribution[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function confirmApdReceipt(id: number) {
	return directus.request(
		updateItem('hse_apd_distribution', id, { ttd_terima: true, ttd_waktu: new Date().toISOString() })
	);
}

export interface HseInspectionTemplate {
	id: number;
	nama_template: string;
	kategori: string;
	items: { item: string }[];
}

export async function fetchActiveInspectionTemplates(): Promise<HseInspectionTemplate[]> {
	try {
		return (await directus.request(
			readItems('hse_inspection_template', {
				filter: { status: { _eq: 'aktif' } },
				fields: ['id', 'nama_template', 'kategori', 'items'],
				sort: ['nama_template'],
				limit: -1
			})
		)) as unknown as HseInspectionTemplate[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function submitInspection(payload: {
	template_id: number;
	lokasi: string;
	inspektur_id: number;
	hasil_items: { item: string; status: 'ok' | 'tidak_ok'; catatan?: string }[];
	temuan?: string;
}) {
	const okCount = payload.hasil_items.filter((i) => i.status === 'ok').length;
	const skor = payload.hasil_items.length ? Math.round((okCount / payload.hasil_items.length) * 100) : null;
	return directus.request(
		createItem('hse_inspection', {
			...payload,
			skor,
			tanggal: new Date().toISOString().slice(0, 10),
			status: 'selesai'
		})
	);
}

export interface HsePermit {
	id: number;
	tipe: string;
	lokasi: string;
	deskripsi_pekerjaan: string | null;
	tanggal_mulai: string;
	tanggal_selesai: string;
	status: string;
	catatan_approval: string | null;
}

export async function fetchMyPermits(pemohonId: number): Promise<HsePermit[]> {
	if (!pemohonId) return [];
	try {
		return (await directus.request(
			readItems('hse_permit', {
				filter: { pemohon_id: { _eq: pemohonId } },
				fields: ['id', 'tipe', 'lokasi', 'deskripsi_pekerjaan', 'tanggal_mulai', 'tanggal_selesai', 'status', 'catatan_approval'],
				sort: ['-date_created'],
				limit: 50
			})
		)) as unknown as HsePermit[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

async function notifyPermitRequest(permit: Record<string, any>) {
	try {
		await directus.request(
			createItem('app_notifications', {
				type: 'hse_permit_baru',
				title: '📋 Izin Kerja Baru Menunggu Persetujuan',
				message: `${permit.tipe} di ${permit.lokasi || '-'}: ${permit.deskripsi_pekerjaan || '-'}`,
				priority: 'medium',
				department: 'hse',
				read: false,
				action_required: true,
				action_url: '/hse?tab=permit',
				created_at: new Date().toISOString()
			})
		);
	} catch (err) {
		console.warn('Gagal mengirim notifikasi izin kerja:', err);
	}
}

// ---------------------------------------------------------------------------
// Fase 4: Status Training K3 & MCU (read-only untuk karyawan)
// ---------------------------------------------------------------------------

export interface HseTrainingRecord {
	id: number;
	matrix_id: { nama_training: string; kategori: string } | null;
	tanggal_selesai: string | null;
	tanggal_kedaluwarsa: string | null;
	status: string;
}

export async function fetchMyTrainingStatus(karyawanId: number): Promise<HseTrainingRecord[]> {
	if (!karyawanId) return [];
	try {
		return (await directus.request(
			readItems('hse_training_record', {
				filter: { karyawan_id: { _eq: karyawanId } },
				fields: ['id', 'matrix_id.nama_training', 'matrix_id.kategori', 'tanggal_selesai', 'tanggal_kedaluwarsa', 'status'],
				sort: ['-tanggal_selesai'],
				limit: 50
			})
		)) as unknown as HseTrainingRecord[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

// Hanya field status (bukan catatan medis) — data kesehatan sensitif tidak
// ditampilkan di app lapangan (risiko HP hilang/dipinjam). Detail lengkap hanya
// di dashboard admin dengan RBAC hse.mcu.view.
export interface HseMcuStatus {
	id: number;
	tipe: string;
	tanggal: string;
	hasil: string;
	tanggal_jatuh_tempo_berikutnya: string | null;
}

export async function fetchMyMcuStatus(karyawanId: number): Promise<HseMcuStatus[]> {
	if (!karyawanId) return [];
	try {
		return (await directus.request(
			readItems('hse_mcu', {
				filter: { karyawan_id: { _eq: karyawanId } },
				fields: ['id', 'tipe', 'tanggal', 'hasil', 'tanggal_jatuh_tempo_berikutnya'],
				sort: ['-tanggal'],
				limit: 20
			})
		)) as unknown as HseMcuStatus[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function submitPermit(payload: {
	tipe: string;
	lokasi: string;
	pemohon_id: number;
	deskripsi_pekerjaan?: string;
	tanggal_mulai: string;
	tanggal_selesai: string;
	apd_wajib?: string;
	gas_test_required?: boolean;
}) {
	const saved = await directus.request(createItem('hse_permit', { ...payload, status: 'diajukan' }));
	await notifyPermitRequest(payload);
	return saved;
}

// ---------------------------------------------------------------------------
// Fase 1 rencana JSA & Administrasi HSE v2.0: Kartu Kelengkapan HSE per proyek.
// DIHITUNG saat dibaca, tidak disimpan (P3 — skor turunan yang disimpan pasti
// basi). jsaBerlaku dikembalikan null (bukan false) karena jsa_project belum
// ada — menyusul Fase 3. Cermin dari getProjectHseCompleteness di admin
// (erp-epi-1/src/lib/services/hseApi.js) — TIDAK disalin sebagai service yang
// sama karena dua repo memakai pola auth berbeda (T7).
// ---------------------------------------------------------------------------

export interface ProjectHseCompleteness {
	ptwAktif: boolean;
	toolboxHariIni: boolean;
	insidenBelumSelesai: number;
	jsaBerlaku: boolean;
}

// ---------------------------------------------------------------------------
// Fase 4 rencana JSA & Administrasi HSE v2.0: Kartu Observasi Keselamatan (SOC).
// Satu-satunya leading indicator yang murni baru (Bab 4.1) — mencakup tindakan
// AMAN (apresiasi, R5) selain tindakan/kondisi tidak aman, bukan hanya pelanggaran.
// ---------------------------------------------------------------------------

export interface SafetyObservation {
	id: number;
	project_id: number | null;
	tanggal: string;
	kategori: string;
	lokasi: string | null;
	deskripsi: string;
	foto: string | null;
	gps_lat: number | null;
	gps_lng: number | null;
	pelapor: string;
	pelapor_id: number | null;
	tindak_lanjut: string | null;
	status: string;
	date_created: string;
}

export async function submitSafetyObservation(payload: {
	project_id?: number | string | null;
	kategori: string;
	lokasi?: string;
	deskripsi: string;
	foto?: string | null;
	gps_lat?: number | null;
	gps_lng?: number | null;
	pelapor: string;
	pelapor_id?: number | null;
}) {
	return directus.request(
		createItem('safety_observation', {
			...payload,
			tanggal: new Date().toISOString().slice(0, 10),
			status: 'baru'
		})
	);
}

export async function fetchMySafetyObservations(pelapor: string): Promise<SafetyObservation[]> {
	if (!pelapor) return [];
	try {
		return (await directus.request(
			readItems('safety_observation', {
				filter: { pelapor: { _eq: pelapor } },
				sort: ['-date_created'],
				limit: 50
			})
		)) as unknown as SafetyObservation[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

// ---------------------------------------------------------------------------
// Fase 4: project_hse_doc — pengganti 4 collection v1.0 (induksi/ERP/method
// statement/checklist), satu collection dengan tipe+payload JSON (Bab 4.1/4.2).
// ---------------------------------------------------------------------------

export interface ProjectHseDoc {
	id: number;
	project_id: number;
	tipe: string;
	judul: string;
	payload: Record<string, any>;
	file: string | null;
	status: string;
	berlaku_sampai: string | null;
	dibuat_oleh: string | null;
	date_created: string;
}

export async function listProjectHseDocs(projectId: number | string): Promise<ProjectHseDoc[]> {
	try {
		return (await directus.request(
			readItems('project_hse_doc', {
				filter: { project_id: { _eq: projectId as any } },
				sort: ['-date_created'],
				limit: -1
			})
		)) as unknown as ProjectHseDoc[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function createProjectHseDoc(payload: {
	project_id: number | string;
	tipe: string;
	judul: string;
	payload: Record<string, any>;
	file?: string | null;
	berlaku_sampai?: string | null;
	dibuat_oleh: string;
}) {
	return directus.request(
		createItem('project_hse_doc', { ...payload, status: 'aktif' })
	);
}

export async function getProjectHseCompleteness(projectId: number | string): Promise<ProjectHseCompleteness> {
	const today = new Date().toISOString().slice(0, 10);
	try {
		const [permits, toolbox, openIncidents, jsaAktif] = await Promise.all([
			directus.request(
				readItems('hse_permit', {
					filter: {
						project_id: { _eq: projectId as any },
						status: { _eq: 'disetujui' },
						tanggal_mulai: { _lte: today },
						tanggal_selesai: { _gte: today }
					},
					fields: ['id'],
					limit: 1
				})
			),
			directus.request(
				readItems('toolbox_meeting', {
					filter: { project_id: { _eq: projectId as any }, tanggal: { _eq: today } },
					fields: ['id'],
					limit: 1
				})
			),
			directus.request(
				readItems('hse_incident', {
					filter: { project_id: { _eq: projectId as any }, status: { _neq: 'closed' } },
					fields: ['id'],
					limit: -1
				})
			),
			directus.request(
				readItems('jsa_project', {
					filter: {
						project_id: { _eq: projectId as any },
						status: { _eq: 'disetujui' },
						berlaku_dari: { _lte: today },
						berlaku_sampai: { _gte: today }
					},
					fields: ['id'],
					limit: 1
				})
			)
		]);
		return {
			ptwAktif: (permits as any[]).length > 0,
			toolboxHariIni: (toolbox as any[]).length > 0,
			insidenBelumSelesai: (openIncidents as any[]).length,
			jsaBerlaku: (jsaAktif as any[]).length > 0
		};
	} catch (err) {
		handleDirectusError(err);
		return { ptwAktif: false, toolboxHariIni: false, insidenBelumSelesai: 0, jsaBerlaku: null };
	}
}

/**
 * Versi batched dari getProjectHseCompleteness() -- Fase 4 audit performa 29 Sep 2026.
 * Sebelumnya getBatchedHseCompleteness() di projectSummary.ts memanggil fungsi di atas
 * secara paralel PER project (10 project/halaman x 4 query = sampai 40 HTTP call).
 * Di sini 4 collection yang sama di-query SEKALI dengan filter `_in`, dikelompokkan per
 * project di memori -- logika filter tanggal/status IDENTIK, hanya cara pengambilannya
 * yang berubah dari per-project ke batched.
 */
export async function getBatchedProjectHseCompleteness(
	projectIds: (number | string)[]
): Promise<Map<number, ProjectHseCompleteness>> {
	const map = new Map<number, ProjectHseCompleteness>();
	if (projectIds.length === 0) return map;
	const ids = projectIds.map((id) => id as any);
	const today = new Date().toISOString().slice(0, 10);
	const pidOf = (row: any) => Number(typeof row.project_id === 'object' ? row.project_id?.id : row.project_id);

	try {
		const [permits, toolbox, openIncidents, jsaAktif] = await Promise.all([
			directus.request(
				readItems('hse_permit', {
					filter: {
						project_id: { _in: ids },
						status: { _eq: 'disetujui' },
						tanggal_mulai: { _lte: today },
						tanggal_selesai: { _gte: today }
					},
					fields: ['project_id'],
					limit: -1
				})
			),
			directus.request(
				readItems('toolbox_meeting', {
					filter: { project_id: { _in: ids }, tanggal: { _eq: today } },
					fields: ['project_id'],
					limit: -1
				})
			),
			directus.request(
				readItems('hse_incident', {
					filter: { project_id: { _in: ids }, status: { _neq: 'closed' } },
					fields: ['project_id'],
					limit: -1
				})
			),
			directus.request(
				readItems('jsa_project', {
					filter: {
						project_id: { _in: ids },
						status: { _eq: 'disetujui' },
						berlaku_dari: { _lte: today },
						berlaku_sampai: { _gte: today }
					},
					fields: ['project_id'],
					limit: -1
				})
			)
		]);

		const permitProjects = new Set((permits as any[]).map(pidOf));
		const toolboxProjects = new Set((toolbox as any[]).map(pidOf));
		const jsaProjects = new Set((jsaAktif as any[]).map(pidOf));
		const incidentCounts = new Map<number, number>();
		for (const inc of openIncidents as any[]) {
			const pid = pidOf(inc);
			incidentCounts.set(pid, (incidentCounts.get(pid) ?? 0) + 1);
		}

		for (const rawId of projectIds) {
			const pid = Number(rawId);
			map.set(pid, {
				ptwAktif: permitProjects.has(pid),
				toolboxHariIni: toolboxProjects.has(pid),
				insidenBelumSelesai: incidentCounts.get(pid) ?? 0,
				jsaBerlaku: jsaProjects.has(pid)
			});
		}
	} catch (err) {
		handleDirectusError(err);
		for (const rawId of projectIds) {
			map.set(Number(rawId), { ptwAktif: false, toolboxHariIni: false, insidenBelumSelesai: 0, jsaBerlaku: null as any });
		}
	}
	return map;
}
