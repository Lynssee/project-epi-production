// src/lib/services/inspectionApi.ts
// Blasting & Painting Inspection Report (BPIR) — Fase 1: input lapangan & draft.
// Koleksi Directus: inspection_report, inspection_paint_layer, inspection_dft_reading,
// inspection_photo (Fase 2). Pola sama hse.ts/maintenance.ts: direct @directus/sdk
// calls + handleDirectusError. Anak (layer/dft) di-replace penuh saat draft disimpan
// (overwrite-on-save) — hindari nested-write Directus (lihat memory: nested-field .id).

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, deleteItem, deleteItems, uploadFiles } from '@directus/sdk';
import { formatReportNo } from '$lib/utils/inspectionCalc';

export type InspectionWorkshop = 'ciketing' | 'balaraja';
export type InspectionStatus = 'draft' | 'menunggu_approval' | 'approved' | 'revisi' | 'void';

export interface InspectionReport {
	id: number;
	workshop: InspectionWorkshop | string;
	project_id: number | null;
	so_customer_id: number | null;
	sppr_id: number | null;
	report_no: string | null;
	po_no: string | null;
	client_name: string | null;
	part_number: string | null;
	part_name: string | null;
	description: string | null;
	qty: number | null;
	satuan: string | null;
	dry_bulb: number | null;
	wet_bulb: number | null;
	rh_pct: number | null;
	dew_point: number | null;
	steel_temp: number | null;
	weather: string | null;
	measured_at: string | null;
	prep_method: string | null;
	abrasive_type: string | null;
	dust_level: string | null;
	surface_profile: string | null;
	method_of_application: string | null;
	hold_point_flag: boolean | null;
	hold_point_justification: string | null;
	note: string | null;
	status: InspectionStatus;
	prepared_by: string | null;
	prepared_at: string | null;
	inspected_by: string | null;
	inspected_at: string | null;
	prepared_signature_file: string | null;
	inspected_signature_file: string | null;
	created_by_name: string | null;
	date_created: string;
	date_updated: string | null;
}

export type InspectionPhotoCategory = 'ambient' | 'surface' | 'dft_gauge' | 'hasil';

export interface InspectionPhoto {
	id?: number;
	report_id?: number;
	file: string;
	kategori: InspectionPhotoCategory;
	caption: string | null;
	taken_at: string | null;
	geo_lat: number | null;
	geo_lng: number | null;
}

export interface InspectionPaintLayer {
	id?: number;
	report_id?: number;
	layer_no: number;
	painting_system: string | null;
	paint_name: string | null;
	paint_colour: string | null;
	date_application: string | null;
	time_application: string | null;
	pot_life: string | null;
	mixing_ratio: string | null;
	thinner_name: string | null;
	visual_appearance: string | null;
	paint_thinner_ratio: string | null;
	batch_part_a: string | null;
	batch_part_b: string | null;
	batch_thinner: string | null;
	dft_spec_min: number | null;
	dft_spec_max: number | null;
	dft_avg: number | null;
	dft_pass_8515: boolean | null;
}

export interface InspectionDftReading {
	id?: number;
	report_id?: number;
	layer_no: number;
	stage: string | null;
	unit_no: string | null;
	material: string | null;
	point_index: number;
	value_um: number;
}

const REPORT_FIELDS = [
	'id', 'workshop', 'project_id', 'so_customer_id', 'sppr_id', 'report_no', 'po_no',
	'client_name', 'part_number', 'part_name', 'description', 'qty', 'satuan',
	'dry_bulb', 'wet_bulb', 'rh_pct', 'dew_point', 'steel_temp', 'weather', 'measured_at',
	'prep_method', 'abrasive_type', 'dust_level', 'surface_profile', 'method_of_application',
	'hold_point_flag', 'hold_point_justification', 'note', 'status',
	'prepared_by', 'prepared_at', 'inspected_by', 'inspected_at',
	'prepared_signature_file', 'inspected_signature_file',
	'created_by_name', 'date_created', 'date_updated'
];

/** Upload file mentah (foto/TTD) ke directus_files, kembalikan file id. */
export async function uploadFile(file: File, description: string): Promise<string | null> {
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

/** Konversi PNG dataURL (hasil SignaturePad.toDataURL()) jadi File untuk diupload. */
export function dataUrlToFile(dataUrl: string, filename = 'ttd.png'): File {
	const [meta, base64] = dataUrl.split(',');
	const mime = meta.match(/data:(.*?);base64/)?.[1] || 'image/png';
	const bytes = atob(base64);
	const arr = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
	return new File([arr], filename, { type: mime });
}

export async function getPhotos(reportId: number | string): Promise<InspectionPhoto[]> {
	try {
		return (await directus.request(
			readItems('inspection_photo', {
				filter: { report_id: { _eq: Number(reportId) } },
				sort: ['-date_created'],
				limit: -1
			})
		)) as unknown as InspectionPhoto[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function addPhoto(reportId: number, file: File, kategori: InspectionPhotoCategory, caption: string, geo?: { lat: number; lng: number } | null): Promise<InspectionPhoto> {
	const fileId = await uploadFile(file, `inspection_report:${reportId}:${kategori}`);
	if (!fileId) throw new Error('Gagal mengupload foto.');
	const saved = await directus.request(
		createItem('inspection_photo', {
			report_id: reportId,
			file: fileId,
			kategori,
			caption: caption || null,
			taken_at: new Date().toISOString(),
			geo_lat: geo?.lat ?? null,
			geo_lng: geo?.lng ?? null
		})
	);
	return saved as unknown as InspectionPhoto;
}

export async function deletePhoto(id: number): Promise<void> {
	await directus.request(deleteItem('inspection_photo', id));
}

/** Laporan draft/aktif milik inspector saat ini (berdasarkan nama pembuat). */
export async function fetchMyReports(createdByName: string): Promise<InspectionReport[]> {
	if (!createdByName) return [];
	try {
		return (await directus.request(
			readItems('inspection_report', {
				filter: { created_by_name: { _eq: createdByName } },
				fields: REPORT_FIELDS,
				sort: ['-date_created'],
				limit: 100
			})
		)) as unknown as InspectionReport[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function getReport(id: number | string): Promise<InspectionReport | null> {
	try {
		return (await directus.request(
			readItem('inspection_report', id, { fields: REPORT_FIELDS })
		)) as unknown as InspectionReport;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export async function getPaintLayers(reportId: number | string): Promise<InspectionPaintLayer[]> {
	try {
		return (await directus.request(
			readItems('inspection_paint_layer', {
				filter: { report_id: { _eq: Number(reportId) } },
				sort: ['layer_no'],
				limit: -1
			})
		)) as unknown as InspectionPaintLayer[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function getDftReadings(reportId: number | string): Promise<InspectionDftReading[]> {
	try {
		return (await directus.request(
			readItems('inspection_dft_reading', {
				filter: { report_id: { _eq: Number(reportId) } },
				sort: ['layer_no', 'point_index'],
				limit: -1
			})
		)) as unknown as InspectionDftReading[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function createDraft(payload: Partial<InspectionReport>, createdByName: string): Promise<InspectionReport> {
	const saved = await directus.request(
		createItem('inspection_report', { ...payload, status: 'draft', created_by_name: createdByName })
	);
	return saved as unknown as InspectionReport;
}

export async function updateReport(id: number | string, payload: Partial<InspectionReport>): Promise<InspectionReport> {
	const saved = await directus.request(updateItem('inspection_report', id, payload));
	return saved as unknown as InspectionReport;
}

/** Ganti seluruh layer cat untuk laporan ini (overwrite-on-save — hindari nested-write). */
export async function replacePaintLayers(reportId: number, layers: InspectionPaintLayer[]): Promise<void> {
	const existing = await directus.request(
		readItems('inspection_paint_layer', { filter: { report_id: { _eq: reportId } }, fields: ['id'], limit: -1 })
	);
	const existingIds = (existing as any[]).map((r) => r.id);
	if (existingIds.length > 0) {
		await directus.request(deleteItems('inspection_paint_layer', existingIds));
	}
	for (const layer of layers) {
		const { id: _id, ...rest } = layer;
		await directus.request(createItem('inspection_paint_layer', { ...rest, report_id: reportId }));
	}
}

/** Ganti seluruh titik ukur DFT untuk laporan ini (overwrite-on-save). */
export async function replaceDftReadings(reportId: number, readings: InspectionDftReading[]): Promise<void> {
	const existing = await directus.request(
		readItems('inspection_dft_reading', { filter: { report_id: { _eq: reportId } }, fields: ['id'], limit: -1 })
	);
	const existingIds = (existing as any[]).map((r) => r.id);
	if (existingIds.length > 0) {
		await directus.request(deleteItems('inspection_dft_reading', existingIds));
	}
	for (const reading of readings) {
		const { id: _id, ...rest } = reading;
		await directus.request(createItem('inspection_dft_reading', { ...rest, report_id: reportId }));
	}
}

/** Field wajib sebelum laporan bisa difinalisasi (dikirim ke menunggu_approval). */
export function validateRequiredForFinalize(report: Partial<InspectionReport>, layers: InspectionPaintLayer[]): string[] {
	const missing: string[] = [];
	if (!report.workshop) missing.push('Workshop');
	// Fase 7 (Revamp Project Management v2, 3 Agu 2026): project_id wajib sebelum submit —
	// tanpa ini, laporan tak pernah ikut terhitung di Quality Score (qualityApi.js::computePassRate
	// menyaring inspection_report by project_id). Field sudah dikirim sejak dulu kalau dipilih user
	// (lihat buildReportPayload di [id]/+page.svelte) — yang tadinya hilang cuma validasi wajibnya.
	if (!report.project_id) missing.push('Proyek');
	if (!report.po_no) missing.push('PO No');
	if (!report.po_no) missing.push('PO No');
	if (!report.client_name) missing.push('Client');
	if (!report.part_name) missing.push('Part Name');
	if (report.dry_bulb === null || report.dry_bulb === undefined) missing.push('Dry Bulb Temp');
	if (report.wet_bulb === null || report.wet_bulb === undefined) missing.push('Wet Bulb Temp');
	if (report.steel_temp === null || report.steel_temp === undefined) missing.push('Steel Temp');
	if (!report.prep_method) missing.push('Method of Preparation');
	if (!report.method_of_application) missing.push('Method of Application');
	if (!report.prepared_by) missing.push('Prepared By');
	if (!report.inspected_by) missing.push('Inspected By');
	if (!report.prepared_signature_file) missing.push('TTD digital Prepared By');
	if (!report.inspected_signature_file) missing.push('TTD digital Inspected By');
	if (layers.length === 0) missing.push('Minimal 1 layer cat');
	if (report.hold_point_flag && !report.hold_point_justification) {
		missing.push('Catatan justifikasi hold point (steel temp terlalu dekat dew point)');
	}
	return missing;
}

/**
 * Nomor laporan otomatis: IREPIOG-YYMMDD-urut, urutan harian GLOBAL lintas
 * workshop (keputusan Fase 0 — bukan per-workshop).
 */
async function generateReportNo(): Promise<string> {
	const now = new Date();
	const prefix = formatReportNo(now, 1).replace(/-\d{3}$/, '-');
	const existing = await directus.request(
		readItems('inspection_report', {
			filter: { report_no: { _starts_with: prefix } },
			fields: ['id'],
			limit: -1
		})
	);
	const seq = (existing as any[]).length + 1;
	return formatReportNo(now, seq);
}

export async function finalizeReport(id: number, report: Partial<InspectionReport>, layers: InspectionPaintLayer[]): Promise<InspectionReport> {
	const missing = validateRequiredForFinalize(report, layers);
	if (missing.length > 0) {
		throw new Error(`Lengkapi field wajib: ${missing.join(', ')}`);
	}
	const reportNo = report.report_no || (await generateReportNo());
	const saved = await directus.request(
		updateItem('inspection_report', id, { status: 'menunggu_approval', report_no: reportNo })
	);
	return saved as unknown as InspectionReport;
}


export interface ProjectInspectionSummary {
	reportId: number;
	measuredAt: string | null;
	steelTemp: number | null;
	dewPoint: number | null;
	rhPct: number | null;
	airTemp?: number | null;
	surfaceProfile?: string | null;
	holdPointFlag: boolean | null;
}

/**
 * Mengambil data pengukuran ambient terbaru dari laporan inspeksi BPIR proyek ini.
 * Dipakai untuk auto-pull QC Ambient di Laporan Harian (Leader).
 */
export async function getLatestProjectInspectionSummary(projectId: number | string, date?: string): Promise<ProjectInspectionSummary | null> {
	try {
		const filter: Record<string, any> = {
			project_id: { _eq: Number(projectId) }
		};
		if (date) {
			filter.measured_at = { _starts_with: date };
		}
		const reports = await directus.request(
			readItems('inspection_report', {
				filter,
				fields: ['id', 'measured_at', 'steel_temp', 'dew_point', 'rh_pct', 'dry_bulb', 'surface_profile', 'hold_point_flag'] as any,
				sort: ['-measured_at', '-id'] as any,
				limit: 1
			})
		) as any[];

		const report = reports?.[0];
		if (!report) return null;

		return {
			reportId: report.id,
			measuredAt: report.measured_at,
			steelTemp: report.steel_temp,
			dewPoint: report.dew_point,
			rhPct: report.rh_pct,
			airTemp: report.dry_bulb ?? null,
			surfaceProfile: report.surface_profile ?? null,
			holdPointFlag: report.hold_point_flag ?? null
		};
	} catch (e) {
		console.warn('Gagal membaca ringkasan inspeksi proyek:', e);
		return null;
	}
}
