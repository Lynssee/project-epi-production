import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, uploadFiles } from '@directus/sdk';
import { getIdToken } from './secureDirectus';
import { compressPhoto } from '$lib/utils/photoCompress';

export interface WorkOrderRow {
	id: string;
	equipment_id: string;
	keluhan: string;
	kategori_perbaikan_id: string | null;
	jenis_pekerjaan_id: string | null;
	order_status: string | null;
	approval_status: string | null;
	progress: number | null;
	tanggal_rusak: string | null;
	parent_wo_id: string | null;
	pic_mekanik_1_id: string | null;
	pic_mekanik_2_id: string | null;
	butuh_servis_luar: boolean | null;
	alasan_servis_luar: string | null;
	foto_usul_servis_luar: string | null;
	bengkel_id: string | null;
	qc_status: string | null;
}

// Field-field ini SESUAI skema Directus produksi mekanik_activity (dikonfirmasi lewat
// Directus MCP fields+items 18 Agu 2026) — sebelumnya file ini menulis/membaca field yang
// TIDAK PERNAH ada di collection (deskripsi/progress/kondisi/spareparts/biaya_sparepart/foto/
// pic_mekanik_1_id), yang berarti submitDailyActivity() gagal setiap kali dipanggil. Skema
// asli persis sama dengan yang dipakai sisi admin (erp-epi-1/maintenanceApi.js
// createMechanicDailyReport) — jangan diubah tanpa menyamakan juga di sana.
export interface MekanikActivityRow {
	id: string;
	work_order_id: string;
	equipment_id: string | null;
	tanggal_input: string;
	pic_id: string | null;
	status_repair_id: string | null;
	kegiatan_repair: string | null;
	kendala: string | null;
	remarks: string | null;
	hoursmeter: number | null;
	durasi_kerja_menit: number | null;
	sparepart_ringkas: string | null;
	foto_kegiatan?: any;
}

export interface DailyActivityPayload {
	work_order_id: string;
	equipment_id: string;
	deskripsi: string;
	progress: number;
	kondisi: 'baik' | 'rusak';
	// Fase 4 Pusat Maintenance v2 (14 Sep 2026): sparepart dipilih dari STOK GUDANG
	// (koleksi `sparepart`), bukan lagi Master Barang (identitas_barang) — supaya
	// pemakaian bisa dicatat resmi di sparepart_usage_log (G_WO4) dan potong stok nyata
	// bisa terjadi (di sisi admin, saat Gudang konfirmasi serah). `hargaSatuan`/`unitCategoryId`
	// tetap dikirim untuk hitung biaya_sparepart WO (Rupiah TIDAK ditampilkan ke mekanik,
	// Q2 keputusan Lead 14 Sep 2026 — konsisten dgn kebijakan "TANPA NOMINAL RUPIAH" yang
	// sudah berlaku di Riwayat Perbaikan Unit sejak 4 Sep 2026).
	spareparts?: { nama: string; qty: number; sparepartId?: string | null; hargaSatuan?: number; unitCategoryId?: string | null }[];
	biaya_sparepart?: number;
	// Fase 5 Pusat Maintenance v2 (14 Sep 2026): jam kerja manual, dihitung di UI dari jam
	// mulai/selesai — disimpan ke mekanik_activity.durasi_kerja_menit (kolom sudah ada).
	durasi_kerja_menit?: number | null;
	fotoFileIds?: string[];
	pic_mekanik_1_id: string;
}

const WORK_ORDER_FIELDS = [
	'id', 'equipment_id', 'keluhan', 'kategori_perbaikan_id', 'jenis_pekerjaan_id',
	'order_status', 'approval_status', 'progress', 'tanggal_rusak', 'parent_wo_id',
	'pic_mekanik_1_id', 'pic_mekanik_2_id',
	'butuh_servis_luar', 'alasan_servis_luar', 'foto_usul_servis_luar', 'bengkel_id', 'qc_status'
];

// Fase 6 (Pergerakan External Terpadu v2.0): mekanik boleh MENGUSULKAN alasan servis luar
// (D8) — wewenang menyalakan butuh_servis_luar tetap dikunci untuk supervisor di dashboard
// admin (K2), field itu sengaja TIDAK ditulis dari sini.
// Gate Bengkel / Jasa Eksternal — Fase 6 (29 Agu 2026, dokumen rencana): "alasan_servis_luar
// jadi wajib + foto wajib (hari ini NULL 10/10)". photoFileId WAJIB diisi (bukan opsional) --
// beda dari versi lama fungsi ini yang cuma menulis alasan teks.
export async function submitUsulServisLuar(workOrderId: string, alasan: string, photoFileId: string): Promise<void> {
	if (!alasan.trim()) throw new Error('Alasan usul servis luar wajib diisi.');
	if (!photoFileId) throw new Error('Foto bukti wajib diunggah sebelum mengirim usul.');
	try {
		await directus.request(
			updateItem('work_order', workOrderId, { alasan_servis_luar: alasan, foto_usul_servis_luar: photoFileId })
		);
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}

export async function uploadUsulServisLuarPhoto(file: File): Promise<string | null> {
	try {
		const photoToUpload = await compressPhoto(file);
		const formData = new FormData();
		formData.append('file', photoToUpload);
		formData.append('description', 'work_order:foto_usul_servis_luar');
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

// Gate Bengkel / Jasa Eksternal — Fase 6 (29 Agu 2026): panel read-only "Status Perjanjian
// Kerja" di detail WO lapangan. Q6 (dokumen rencana): harga quotation DISEMBUNYIKAN secara
// default dari mekanik -- interface ini SENGAJA tidak menyertakan total_quotation_vendor
// atau harga per item, hanya status/ringkasan/durasi/status CR.
export interface ServiceAgreementStatus {
	id: string;
	nomorPerjanjian: string;
	status: string;
	estimasiDurasiHari: number | null;
	scopeSummary: string[];
	exclusionSummary: string[];
	openChangeRequestCount: number;
}

export async function getServiceAgreementStatusByWorkOrder(workOrderId: string): Promise<ServiceAgreementStatus | null> {
	try {
		const rows: any[] = await directus.request(
			readItems('service_agreement', {
				filter: { work_order_id: { _eq: workOrderId } },
				fields: ['id', 'nomor_perjanjian', 'status', 'estimasi_durasi_hari'],
				sort: ['-date_created'],
				limit: 1
			})
		);
		const sa = rows?.[0];
		if (!sa) return null;

		const items: any[] = await directus.request(
			readItems('service_agreement_item', {
				filter: { service_agreement_id: { _eq: sa.id } },
				fields: ['tipe', 'deskripsi'],
				limit: -1
			})
		);
		const crs: any[] = await directus.request(
			readItems('service_change_request', {
				filter: { service_agreement_id: { _eq: sa.id }, status: { _in: ['draft', 'pending_approval'] } },
				fields: ['id'],
				limit: -1
			})
		);

		return {
			id: sa.id,
			nomorPerjanjian: sa.nomor_perjanjian,
			status: sa.status,
			estimasiDurasiHari: sa.estimasi_durasi_hari ?? null,
			scopeSummary: items.filter((i) => i.tipe === 'scope').map((i) => i.deskripsi),
			exclusionSummary: items.filter((i) => i.tipe === 'exclusion').map((i) => i.deskripsi),
			openChangeRequestCount: crs.length
		};
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export interface DispatchStatus {
	id: number;
	nomor_sj: string;
	status: string;
	return_status: string;
	bengkel_name: string;
}

// Bab 7: lihat status dispatch dari halaman detail WO yang sama. Dibaca lewat
// surat_jalan_items.work_order_id (bukan surat_jalan.work_order_id, yang cuma menyimpan
// SATU WO utama) — kalau tidak, WO ke-2/ke-3 yang digabung dalam satu SJ (D1) akan selalu
// tampil "belum dispatch" meski sudah dikirim.
export async function getDispatchStatusByWorkOrder(workOrderId: string): Promise<DispatchStatus | null> {
	try {
		const rows: any[] = await directus.request(
			readItems('surat_jalan_items', {
				filter: { work_order_id: { _eq: workOrderId } },
				fields: [
					'id',
					'surat_jalan_id.id',
					'surat_jalan_id.nomor_sj',
					'surat_jalan_id.status',
					'surat_jalan_id.return_status',
					'surat_jalan_id.bengkel_id.name'
				],
				sort: ['-id'],
				limit: 1
			})
		);
		const sj = rows?.[0]?.surat_jalan_id;
		if (!sj) return null;
		return {
			id: sj.id,
			nomor_sj: sj.nomor_sj,
			status: sj.status,
			return_status: sj.return_status,
			bengkel_name: sj.bengkel_id?.name || '-'
		};
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function getMyWorkOrders(personnelId: string): Promise<WorkOrderRow[]> {
	try {
		return (await directus.request(
			readItems('work_order', {
				filter: {
					_or: [{ pic_mekanik_1_id: { _eq: personnelId } }, { pic_mekanik_2_id: { _eq: personnelId } }]
				},
				fields: WORK_ORDER_FIELDS,
				sort: ['-tanggal_rusak'],
				limit: -1
			})
		)) as WorkOrderRow[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getWorkOrderById(id: string): Promise<WorkOrderRow | null> {
	try {
		return (await directus.request(
			readItem('work_order', id, { fields: WORK_ORDER_FIELDS })
		)) as WorkOrderRow;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function getWorkOrderActivities(workOrderId: string): Promise<MekanikActivityRow[]> {
	try {
		return (await directus.request(
			readItems('mekanik_activity', {
				filter: { work_order_id: { _eq: workOrderId } },
				fields: [
					'id', 'work_order_id', 'equipment_id', 'tanggal_input', 'pic_id',
					'status_repair_id', 'kegiatan_repair', 'kendala', 'remarks',
					'hoursmeter', 'durasi_kerja_menit', 'sparepart_ringkas'
				],
				sort: ['-tanggal_input'],
				limit: -1
			})
		)) as MekanikActivityRow[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getCategoryNamesMap(categoryIds: (string | null | undefined)[]): Promise<Record<string, string>> {
	const ids = [...new Set(categoryIds.filter(Boolean))] as string[];
	if (!ids.length) return {};
	try {
		const categories = (await directus.request(
			readItems('category', { filter: { id: { _in: ids } }, limit: -1 })
		)) as any[];
		const map: Record<string, string> = {};
		for (const c of categories) map[c.id] = c.name;
		return map;
	} catch (error) {
		handleDirectusError(error);
		return {};
	}
}

export function isWorkOrderApproved(approvalStatusName: string | undefined): boolean {
	return (approvalStatusName || '').toLowerCase() === 'disetujui';
}

export function isWorkOrderPendingQc(orderStatusName: string | undefined): boolean {
	return (orderStatusName || '').toLowerCase() === 'inspection';
}

export interface WoStepperStep {
	id: string;
	label: string;
	state: 'selesai' | 'aktif' | 'menunggu';
	waitingFor: string | null;
}

/**
 * Pusat Maintenance v2 Fase 5 (14 Sep 2026) — stepper ringkas 6 tahap untuk mekanik
 * ("status apa & menunggu siapa"), TIDAK memblokir/menegakkan apa pun. Versi ringan
 * khusus tampilan lapangan — BUKAN duplikat langsung resolver admin (workOrderLifecycle.js,
 * erp-epi-1), yang mengevaluasi gate & konflik data. Kalau logikanya diubah di admin,
 * cek juga apakah stepper ini perlu disamakan (dua repo, satu Directus).
 */
export function deriveWoStepper(args: {
	orderStatusName: string;
	approved: boolean;
	hasActivity: boolean;
	butuhServisLuar: boolean;
	dispatchStatus: DispatchStatus | null;
	pendingQc: boolean;
	qcPassed: boolean;
}): WoStepperStep[] {
	const { orderStatusName, approved, hasActivity, butuhServisLuar, dispatchStatus, pendingQc, qcPassed } = args;
	const done = orderStatusName.toLowerCase() === 'done';

	const t2Done = approved;
	let t3State: WoStepperStep['state'] = 'menunggu';
	let t3Wait: string | null = 'Supervisor menugaskan pelaksana';
	if (butuhServisLuar) {
		if (dispatchStatus?.return_status === 'selesai') {
			t3State = 'selesai';
			t3Wait = null;
		} else if (dispatchStatus) {
			t3State = 'aktif';
			t3Wait = `Bengkel ${dispatchStatus.bengkel_name} — retur ${dispatchStatus.return_status}`;
		} else if (t2Done) {
			t3State = 'aktif';
			t3Wait = 'Admin menerbitkan Surat Jalan ke bengkel';
		}
	} else if (hasActivity) {
		t3State = 'selesai';
		t3Wait = null;
	} else if (t2Done) {
		t3State = 'aktif';
		t3Wait = 'Anda — mulai kerjakan & lapor harian';
	}

	const t4State: WoStepperStep['state'] = qcPassed ? 'selesai' : pendingQc ? 'aktif' : t3State === 'selesai' ? 'aktif' : 'menunggu';
	const t6State: WoStepperStep['state'] = done ? 'selesai' : 'menunggu';

	return [
		{ id: 'T1', label: 'Lapor', state: 'selesai', waitingFor: null },
		{
			id: 'T2',
			label: 'Diagnosis & Approval',
			state: t2Done ? 'selesai' : 'aktif',
			waitingFor: t2Done ? null : 'Supervisor menyetujui WO ini'
		},
		{ id: 'T3', label: 'Eksekusi', state: t3State, waitingFor: t3State === 'selesai' ? null : t3Wait },
		{
			id: 'T4',
			label: 'QC',
			state: t4State,
			waitingFor: t4State === 'selesai' ? null : t4State === 'aktif' ? 'Supervisor memeriksa hasil QC' : 'Menunggu eksekusi selesai'
		},
		{
			id: 'T5',
			label: 'Biaya',
			state: t4State === 'selesai' && !done ? 'aktif' : done ? 'selesai' : 'menunggu',
			waitingFor: t4State === 'selesai' && !done ? 'Supervisor/Finance verifikasi biaya' : done ? null : 'Menunggu QC lulus'
		},
		{ id: 'T6', label: 'Selesai', state: t6State, waitingFor: t6State === 'selesai' ? null : 'Menunggu biaya terverifikasi' }
	];
}

export interface OverdueDispatch {
	workOrderId: string;
	nomorSj: string;
	bengkelName: string;
	returnDeadline: string | null;
}

/**
 * Pill "retur lewat deadline" (beranda mekanik). Lewat `surat_jalan_items` — BUKAN
 * `surat_jalan.work_order_id` langsung — karena satu SJ bisa menggabung beberapa WO
 * dan field itu cuma menyimpan SATU WO utama (lihat catatan getDispatchStatusByWorkOrder).
 */
export async function getOverdueDispatchForWorkOrders(workOrderIds: string[]): Promise<OverdueDispatch[]> {
	if (!workOrderIds.length) return [];
	try {
		const today = new Date().toISOString().split('T')[0];
		const rows: any[] = await directus.request(
			readItems('surat_jalan_items' as any, {
				filter: {
					work_order_id: { _in: workOrderIds },
					surat_jalan_id: {
						_and: [
							{ return_deadline: { _lt: today } },
							{ return_status: { _in: ['menunggu', 'sebagian', 'terlambat'] } }
						]
					}
				} as any,
				fields: [
					'work_order_id',
					'surat_jalan_id.nomor_sj',
					'surat_jalan_id.return_deadline',
					'surat_jalan_id.bengkel_id.name'
				],
				limit: -1
			})
		);
		return rows.map((r) => ({
			workOrderId: r.work_order_id,
			nomorSj: r.surat_jalan_id?.nomor_sj || '-',
			bengkelName: r.surat_jalan_id?.bengkel_id?.name || '-',
			returnDeadline: r.surat_jalan_id?.return_deadline || null
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Tandai WO selesai dari sisi lapangan: progress 100 + pindah ke antrian QC admin
 * (order_status -> Inspection). Tidak pernah menutup WO (order_status Closed) —
 * itu wewenang admin setelah QC.
 *
 * Pusat Maintenance v2 Fase 6 (14 Sep 2026): TIDAK LAGI menulis Directus langsung dari
 * client — proxy lewat /api/maintenance/mark-wo-done (server project-epi) yang meneruskan
 * ke erp-epi-1 (/api/automation/maintenance-wo-transition), supaya transisi ini ikut
 * ditegakkan gate G_WO4/G_WO6/G_WO7 (hard) — sebelumnya lolos sama sekali tanpa cek gate.
 */
export async function markWorkOrderDone(workOrderId: string): Promise<void> {
	const res = await fetch('/api/maintenance/mark-wo-done', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ workOrderId })
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.message || 'Gagal menandai WO selesai.');
	}
}

export async function uploadActivityPhoto(file: File): Promise<string | null> {
	try {
		const photoToUpload = await compressPhoto(file);
		const formData = new FormData();
		formData.append('file', photoToUpload);
		formData.append('description', 'mekanik_activity:foto');
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

// ==========================================
// Tiket kerusakan (maint_tickets) & Survey/Diagnosis awal (surat_sakit)
// ==========================================
// Skema ini mengikuti persis erp-epi-1/src/lib/services/maintenanceApi.js
// (fetchTickets/createTicket, parseSurveyKeluhan/serializeSurveyKeluhan/createSurvey).
// Koleksi "survey" yang disebut di rencana implementasi ternyata bernama `surat_sakit`
// di Directus bersama, dengan field approval 3-pihak (PM/SPV/Teknisi) yang disimpan
// sebagai blok JSON di dalam teks `keluhan`. Field lapangan hanya mengisi temuan awal;
// status approval dibiarkan default 'pending'/null — approval murni wewenang admin.

export interface MaintTicketRow {
	id: string;
	nomor_tiket: string;
	equipment_id: string;
	asset_type: string;
	masalah: string;
	pelapor: string;
	departemen_pelapor: string | null;
	prioritas: string;
	status: string;
	tanggal_lapor: string;
	foto: string | null;
	wo_created?: boolean | null;
}

export async function getMyTickets(pelaporName: string): Promise<MaintTicketRow[]> {
	try {
		return (await directus.request(
			readItems('maint_tickets', {
				filter: { pelapor: { _eq: pelaporName } },
				sort: ['-tanggal_lapor'],
				limit: -1
			})
		)) as MaintTicketRow[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getTicketById(id: string): Promise<MaintTicketRow | null> {
	try {
		return (await directus.request(readItem('maint_tickets', id))) as MaintTicketRow;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function uploadTicketPhoto(file: File): Promise<string | null> {
	try {
		const photoToUpload = await compressPhoto(file);
		const formData = new FormData();
		formData.append('file', photoToUpload);
		formData.append('description', 'maint_tickets:foto');
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

function generateNomorTiket(): string {
	const now = new Date();
	const yy = String(now.getFullYear()).slice(2);
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	return `TKT-${yy}${mm}-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function notifyTicketSubmitted(ticketId: string | number, nomorTiket: string, payload: { masalah: string; pelapor: string }) {
	try {
		const token = await getIdToken();
		await fetch('/api/maintenance/ticket-notify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				sourceId: ticketId,
				message: `Tiket ${nomorTiket} dari ${payload.pelapor}: ${payload.masalah}`
			})
		});
	} catch (err) {
		console.warn('Gagal mengirim notifikasi tiket maintenance:', err);
	}
}

export async function createFieldTicket(payload: {
	equipment_id: string;
	masalah: string;
	pelapor: string;
	departemen_pelapor?: string;
	prioritas?: 'low' | 'medium' | 'high';
	foto?: string | null;
	loan_id?: string | null;
	sumber?: 'internal' | 'peminjam';
}): Promise<MaintTicketRow> {
	const nomorTiket = generateNomorTiket();
	const created = (await directus.request(
		createItem('maint_tickets', {
			nomor_tiket: nomorTiket,
			equipment_id: payload.equipment_id,
			asset_type: 'equipment',
			masalah: payload.masalah,
			pelapor: payload.pelapor,
			departemen_pelapor: payload.departemen_pelapor || '',
			prioritas: payload.prioritas || 'medium',
			status: 'need_survey',
			tanggal_lapor: new Date().toISOString().split('T')[0],
			// SLA tracking (10 Agustus 2026, dibangun sisi admin) -- tanggal_lapor cuma DATE
			// (bukan jam), jadi catat jam presisi di sini juga. Field baru, opsional, tidak
			// mengganggu apa pun yang sudah baca tanggal_lapor.
			waktu_lapor: new Date().toISOString(),
			foto: payload.foto || null,
			loan_id: payload.loan_id || null,
			sumber: payload.sumber || (payload.loan_id ? 'peminjam' : 'internal')
		})
	)) as MaintTicketRow;
	await notifyTicketSubmitted(created.id, nomorTiket, payload);
	return created;
}

/**
 * Port dari serializeSurveyKeluhan (erp-epi-1/maintenanceApi.js): admin menyimpan
 * approval PM/SPV/Teknisi sebagai JSON di belakang teks catatan. Field lapangan
 * hanya mengisi notes + surveyor; semua status approval dibiarkan default.
 */
function serializeFieldSurveyKeluhan(notes: string, surveyor: string): string {
	const metadata = {
		status_approval_pm: 'pending',
		status_approval_spv: 'pending',
		status_approval_teknisi: 'pending',
		approved_by_pm: null,
		approved_by_spv: null,
		approved_by_teknisi: null,
		approval_date_pm: null,
		approval_date_spv: null,
		approval_date_teknisi: null,
		bisa_sendiri: null,
		surveyor
	};
	return `${notes}\n\n--- METADATA ---\n${JSON.stringify(metadata)}`;
}

export async function createFieldSurvey(payload: {
	ticket_id: string;
	equipment_id: string;
	notes: string;
	temuan_kerusakan: string;
	penyebab_kerusakan?: string;
	tindakan_solusi?: string;
	surveyor: string;
}) {
	try {
		const keluhan = serializeFieldSurveyKeluhan(payload.notes, payload.surveyor);
		return await directus.request(
			createItem('surat_sakit', {
				nomor_surat_sakit: `SS-DRAFT-${Math.floor(Math.random() * 100000)}`,
				tanggal: new Date().toISOString().split('T')[0],
				ticket_id: payload.ticket_id,
				equipment_id: payload.equipment_id,
				keluhan,
				temuan_kerusakan: payload.temuan_kerusakan,
				penyebab_kerusakan: payload.penyebab_kerusakan || '',
				tindakan_solusi: payload.tindakan_solusi || ''
			})
		);
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}

let sparepartStatusIdCache: Record<string, string> | null = null;

/** Resolve id kategori (group sparepart_status) — dipakai sparepart_usage_log.status_id. */
async function resolveSparepartStatusId(name: 'Belum Diserahkan' | 'Barang Diserahkan' | 'Barang Bekas Dikembalikan'): Promise<string | null> {
	if (!sparepartStatusIdCache) {
		const cats = (await directus.request(
			readItems('category', { filter: { group: { _eq: 'sparepart_status' } }, limit: -1 })
		)) as any[];
		sparepartStatusIdCache = {};
		for (const c of cats) sparepartStatusIdCache[c.name] = c.id;
	}
	return sparepartStatusIdCache[name] || null;
}

/**
 * Pusat Maintenance v2 Fase 4 (14 Sep 2026): catat pemakaian part resmi (sparepart_usage_log)
 * tertaut WO ini — mengisi rantai G_WO4 yang sebelumnya selalu kosong (0/206 baseline Fase 0).
 * Status awal 'Belum Diserahkan' — TIDAK memotong stok gudang di sini (Q3, keputusan Lead
 * 14 Sep 2026): potong stok baru terjadi saat Gudang mengonfirmasi serah di admin
 * (lihat erp-epi-1 panel verifikasi part, yang mengisi tanggal_diserahkan + status
 * 'Barang Diserahkan' dan men-decrement sparepart.qty_stock secara idempoten).
 * Best-effort: kegagalan di sini TIDAK menggagalkan submit laporan harian (part masih
 * tercatat di sparepart_ringkas sebagai jaring pengaman).
 */
async function logSparepartUsage(
	spareparts: { sparepartId: string | null; qty: number; unitCategoryId: string | null }[],
	ctx: { workOrderId: string; equipmentId: string; picId: string }
): Promise<void> {
	const rows = spareparts.filter((s) => s.sparepartId && Number(s.qty) > 0);
	if (rows.length === 0) return;
	try {
		const statusId = await resolveSparepartStatusId('Belum Diserahkan');
		const today = new Date().toISOString().split('T')[0];
		for (const s of rows) {
			await directus.request(
				createItem('sparepart_usage_log', {
					tanggal: today,
					pic_id: ctx.picId,
					work_order_id: ctx.workOrderId,
					equipment_id: ctx.equipmentId,
					sparepart_id: s.sparepartId,
					jumlah: s.qty,
					unit: s.unitCategoryId,
					tanggal_diajukan: today,
					status_id: statusId
				} as any)
			);
		}
	} catch (error) {
		// Best-effort — jangan gagalkan submit laporan harian mekanik hanya karena ini.
		console.error('[maintenance] Gagal mencatat sparepart_usage_log:', error);
	}
}

let repairStatusIdCache: Record<string, string> | null = null;

/** Resolve id kategori (group wo_status) dipakai status_repair_id — sama persis dgn logika
    admin (createMechanicDailyReport): progress 100 -> "Done", selain itu -> "On Progress". */
async function resolveRepairStatusId(progress: number): Promise<string | null> {
	if (!repairStatusIdCache) {
		const cats = (await directus.request(
			readItems('category', { filter: { group: { _eq: 'wo_status' } }, limit: -1 })
		)) as any[];
		repairStatusIdCache = {};
		for (const c of cats) repairStatusIdCache[c.name] = c.id;
	}
	const name = progress >= 100 ? 'Done' : 'On Progress';
	return repairStatusIdCache[name] || null;
}

/** Ringkas array sparepart+biaya jadi teks bebas — sparepart_ringkas di skema Directus
    hanya field text (catatan cepat lapangan), bukan struktur qty/biaya tersendiri. */
function formatSparepartRingkas(spareparts: { nama: string; qty: number }[], biaya: number): string | null {
	const parts = (spareparts || []).filter((s) => s.nama?.trim()).map((s) => `${s.nama.trim()} x${s.qty}`);
	if (!parts.length && !biaya) return null;
	const biayaText = biaya ? ` (± Rp${biaya.toLocaleString('id-ID')})` : '';
	return parts.join(', ') + biayaText;
}

/**
 * Fase 6.2 (Penajaman Aset Produktif, 29 Agu 2026): tambahkan biaya sparepart laporan hari
 * ini ke work_order.biaya_sparepart yang SUDAH ADA (akumulasi, bukan timpa — WO bisa dapat
 * beberapa laporan harian sebelum ditutup). biaya_status dikembalikan ke 'draft' supaya
 * gerbang penutupan WO di admin (erp-epi-1) mewajibkan verifikasi ulang setelah biaya
 * berubah — lihat maintenanceApi.js assertBiayaGateForClose (sisi admin, satu Directus sama).
 */
async function addSparepartCostToWorkOrder(workOrderId: string, biayaBaru: number): Promise<void> {
	if (!biayaBaru || biayaBaru <= 0) return;
	try {
		const wo: any = await directus.request(
			readItem('work_order' as any, workOrderId, { fields: ['biaya_sparepart'] })
		);
		const existing = Number(wo?.biaya_sparepart) || 0;
		await directus.request(
			updateItem('work_order', workOrderId, {
				biaya_sparepart: existing + biayaBaru,
				biaya_status: 'draft'
			} as any)
		);
	} catch (error) {
		// Best-effort — jangan gagalkan submit laporan harian mekanik hanya karena ini.
		console.error('[maintenance] Gagal menambahkan biaya sparepart ke WO:', error);
	}
}

/**
 * Laporan Harian: catat progres mekanik_activity, salin progress ke work_order,
 * dan update status equipment kalau kondisi 'rusak' — mengikuti pemetaan yang sudah
 * dipakai admin (erp-epi-1/maintenanceApi.js): rusak -> UNDER MAINTENANCE, baik -> OPERASIONAL.
 *
 * PENTING: field yang ditulis ke mekanik_activity harus SAMA PERSIS dengan skema Directus
 * asli (lihat MekanikActivityRow) — versi sebelumnya menulis field yang tidak ada di
 * collection (deskripsi/progress/kondisi/spareparts/biaya_sparepart/foto/pic_mekanik_1_id),
 * sehingga setiap submit gagal dengan error Directus (diperbaiki 18 Agu 2026).
 */
export async function submitDailyActivity(payload: DailyActivityPayload): Promise<MekanikActivityRow> {
	const statusRepairId = await resolveRepairStatusId(payload.progress);

	const activity: any = await directus.request(
		createItem('mekanik_activity', {
			work_order_id: payload.work_order_id,
			equipment_id: payload.equipment_id,
			tanggal_input: new Date().toISOString().split('T')[0],
			pic_id: payload.pic_mekanik_1_id,
			status_repair_id: statusRepairId,
			kegiatan_repair: payload.deskripsi,
			durasi_kerja_menit: payload.durasi_kerja_menit ?? null,
			sparepart_ringkas: formatSparepartRingkas(payload.spareparts || [], payload.biaya_sparepart || 0),
			foto_kegiatan: (payload.fotoFileIds || []).map((id) => ({ directus_files_id: id }))
		})
	);

	await directus.request(updateItem('work_order', payload.work_order_id, { progress: payload.progress }));

	await directus.request(
		updateItem('equipment', payload.equipment_id, {
			status_operational: payload.kondisi === 'rusak' ? 'UNDER MAINTENANCE' : 'OPERASIONAL'
		})
	);

	const biayaSparepartBaru = (payload.spareparts || []).reduce(
		(sum, s) => sum + (Number(s.qty) || 0) * (Number(s.hargaSatuan) || 0),
		0
	);
	await addSparepartCostToWorkOrder(payload.work_order_id, biayaSparepartBaru);

	await logSparepartUsage(
		(payload.spareparts || []).map((s) => ({
			sparepartId: s.sparepartId || null,
			qty: Number(s.qty) || 0,
			unitCategoryId: s.unitCategoryId || null
		})),
		{ workOrderId: payload.work_order_id, equipmentId: payload.equipment_id, picId: payload.pic_mekanik_1_id }
	);

	return activity as MekanikActivityRow;
}

// ════════════════════════════════════════════════════════════════════════════
// Riwayat Perbaikan Unit (read-only lapangan) — Penajaman Pembelian v3 Fase 7.
// TANPA NOMINAL RUPIAH (keputusan user 4 Sep 2026): personel lapangan hanya
// melihat status & kuantitas. Angka biaya tetap eksklusif dashboard admin.
// ════════════════════════════════════════════════════════════════════════════

export interface UnitRepairWO {
	id: string;
	wo_number: string | null;
	order_status: string | null;
	status_label: string;
	keluhan: string | null;
	tanggal_rusak: string | null;
	tanggal_done: string | null;
	downtime_days: number;
	is_preventive: boolean;
}

export interface UnitRepairHistory {
	equipment: { id: string; code: string | null; name: string | null; brand: string | null; last_hoursmeter: number; is_critical: boolean } | null;
	work_orders: UnitRepairWO[];
	counts: { total: number; preventive: number; corrective: number; downtime_days: number; external_repairs: number };
}

export async function searchEquipmentSimple(term: string): Promise<{ id: string; code: string | null; name: string | null }[]> {
	try {
		const filter: any = term
			? { _or: [{ name: { _icontains: term } }, { code: { _icontains: term } }] }
			: {};
		return (await directus.request(
			readItems('equipment', { filter, fields: ['id', 'code', 'name'], sort: ['name'], limit: 50 })
		)) as any[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getUnitRepairHistory(equipmentId: string): Promise<UnitRepairHistory> {
	const empty: UnitRepairHistory = {
		equipment: null,
		work_orders: [],
		counts: { total: 0, preventive: 0, corrective: 0, downtime_days: 0, external_repairs: 0 }
	};
	if (!equipmentId) return empty;
	try {
		const [eq, wos, selCount] = await Promise.all([
			directus.request(
				readItem('equipment', equipmentId, {
					fields: ['id', 'code', 'name', 'brand', 'last_hoursmeter', 'is_critical']
				})
			) as Promise<any>,
			directus.request(
				readItems('work_order', {
					filter: { equipment_id: { _eq: equipmentId } },
					// SENGAJA tanpa field biaya_* — lapangan tak lihat rupiah.
					fields: ['id', 'wo_number', 'order_status', 'kategori_perbaikan_id', 'keluhan', 'tanggal_rusak', 'tanggal_done', 'downtime_days'],
					sort: ['-tanggal_rusak'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('service_external_log', {
					filter: { equipment_id: { _eq: equipmentId } },
					fields: ['id'],
					limit: -1
				})
			) as Promise<any[]>
		]);
		if (!eq) return empty;

		const statusMap = await getCategoryNamesMap(wos.map((w) => w.order_status));
		const katMap = await getCategoryNamesMap(wos.map((w) => w.kategori_perbaikan_id));
		const isPreventive = (w: any) => /preventif|preventive|\bpm\b|berkala/i.test(katMap[w.kategori_perbaikan_id] || '');

		const work_orders: UnitRepairWO[] = wos.map((w) => ({
			id: w.id,
			wo_number: w.wo_number ?? null,
			order_status: w.order_status ?? null,
			status_label: statusMap[w.order_status || ''] || w.order_status || '-',
			keluhan: w.keluhan ?? null,
			tanggal_rusak: w.tanggal_rusak ?? null,
			tanggal_done: w.tanggal_done ?? null,
			downtime_days: Number(w.downtime_days) || 0,
			is_preventive: isPreventive(w)
		}));

		return {
			equipment: {
				id: eq.id,
				code: eq.code ?? null,
				name: eq.name ?? null,
				brand: eq.brand ?? null,
				last_hoursmeter: Number(eq.last_hoursmeter) || 0,
				is_critical: !!eq.is_critical
			},
			work_orders,
			counts: {
				total: work_orders.length,
				preventive: work_orders.filter((w) => w.is_preventive).length,
				corrective: work_orders.filter((w) => !w.is_preventive).length,
				downtime_days: work_orders.reduce((s, w) => s + w.downtime_days, 0),
				external_repairs: selCount.length
			}
		};
	} catch (error) {
		handleDirectusError(error);
		return empty;
	}
}
