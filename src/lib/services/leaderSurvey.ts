// src/lib/services/leaderSurvey.ts
// Survei lapangan oleh Leader dari Pra-Mobilisasi (Fase 3 plan "Penguraian PO Jasa", 10 Okt 2026).
// Menulis ke `sales_survey` + `sales_survey_images` (koleksi yang sama dengan survei Sales), terkait lewat
// so_customer_id -- sehingga ProjectCharterTab (getSurveyGate) otomatis membacanya sebagai draf data lapangan.
// Aturan: JANGAN menimpa isian Sales (lihat buildFillEmptyPatch); foto selalu boleh ditambah.

import directus from './directus';
import { readItems, readItem, createItem, updateItem, uploadFiles } from '@directus/sdk';
import {
	LEADER_SURVEY_FIELDS,
	buildFillEmptyPatch,
	normalizeForm,
	validateNewSurvey,
	type LeaderSurveyForm,
	type LeaderSurveyField
} from './leaderSurveyLogic';

export interface LeaderSurveyState {
	soCustomerId: number | null;
	survey: (Record<string, any> & { id: number; nomor_survey: string | null; surveyor: string | null; status: string | null }) | null;
	images: { id: number; file_id: string }[];
}

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

async function loadImages(surveyId: number): Promise<{ id: number; file_id: string }[]> {
	const rows = (await directus.request(
		readItems('sales_survey_images', { filter: { sales_survey_id: { _eq: surveyId } }, fields: ['id', 'file_id'], limit: -1 })
	)) as any[];
	return (rows || []).map((r) => ({ id: r.id, file_id: String(idOf(r.file_id)) }));
}

/** Survei yang terkait PO proyek ini (satu query proyek, satu query survei, satu query foto). Error dilempar, tidak ditelan. */
export async function loadLeaderSurvey(projectId: number | string): Promise<LeaderSurveyState> {
	const project = (await directus.request(readItem('projects', projectId, { fields: ['id', 'so_customer_id'] }))) as any;
	const soCustomerId = idOf(project?.so_customer_id) != null ? Number(idOf(project.so_customer_id)) : null;
	if (!soCustomerId) return { soCustomerId: null, survey: null, images: [] };

	const rows = (await directus.request(
		readItems('sales_survey', {
			filter: { so_customer_id: { _eq: soCustomerId } },
			fields: ['id', 'nomor_survey', 'status', 'surveyor', 'tanggal_survey', ...LEADER_SURVEY_FIELDS],
			sort: ['-id'],
			limit: 1
		})
	)) as any[];
	const survey = rows?.[0] ?? null;
	return { soCustomerId, survey, images: survey ? await loadImages(survey.id) : [] };
}

async function generateNomorSurvey(): Promise<string> {
	const year = new Date().getFullYear();
	const rows = (await directus.request(
		readItems('sales_survey', { filter: { nomor_survey: { _starts_with: `SRV-${year}-` } }, fields: ['nomor_survey'], sort: ['-nomor_survey'], limit: 1 })
	)) as any[];
	const last = rows?.[0]?.nomor_survey;
	const seq = last ? parseInt(String(last).split('-')[2], 10) || 0 : 0;
	return `SRV-${year}-${String(seq + 1).padStart(4, '0')}`;
}

async function uploadPhotos(surveyId: number, files: File[]): Promise<{ ok: number; failed: string[] }> {
	let ok = 0;
	const failed: string[] = [];
	for (const file of files) {
		try {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('title', `Survey Leader - ${surveyId} - ${file.name}`);
			const uploaded: any = await directus.request(uploadFiles(fd));
			if (!uploaded?.id) throw new Error('upload tidak mengembalikan id file');
			await directus.request(createItem('sales_survey_images', { sales_survey_id: surveyId, file_id: uploaded.id }));
			ok++;
		} catch (e: any) {
			console.error('[leaderSurvey] foto gagal:', file.name, e);
			failed.push(file.name);
		}
	}
	return { ok, failed };
}

export interface SaveLeaderSurveyResult {
	surveyId: number;
	created: boolean;
	filled: LeaderSurveyField[];
	skipped: LeaderSurveyField[];
	photosOk: number;
	photosFailed: string[];
}

/**
 * Simpan survei. Belum ada survei -> buat baru (wajib lokasi). Sudah ada -> hanya isi field kosong + tambah foto.
 * Surveyor survei baru = nama Leader. Tidak mengirim notifikasi Sales (survei ini data lapangan, bukan kunjungan sales).
 */
export async function saveLeaderSurvey(params: {
	soCustomerId: number;
	existing: LeaderSurveyState['survey'];
	leaderName: string;
	customerName?: string | null;
	form: LeaderSurveyForm;
	photos: File[];
}): Promise<SaveLeaderSurveyResult> {
	const { soCustomerId, existing, leaderName, form, photos } = params;

	if (!existing) {
		const err = validateNewSurvey(form);
		if (err) throw new Error(err);
		const clean = normalizeForm(form);
		const created = (await directus.request(
			createItem('sales_survey', {
				nomor_survey: await generateNomorSurvey(),
				survey_mode: 'dengan_survey',
				status: 'completed',
				so_customer_id: soCustomerId,
				customer_name: params.customerName || null,
				tanggal_survey: new Date().toISOString().slice(0, 10),
				surveyor: leaderName,
				...clean
			})
		)) as any;
		const up = await uploadPhotos(created.id, photos);
		return {
			surveyId: created.id,
			created: true,
			filled: LEADER_SURVEY_FIELDS.filter((k) => clean[k] != null),
			skipped: [],
			photosOk: up.ok,
			photosFailed: up.failed
		};
	}

	const { patch, skipped } = buildFillEmptyPatch(existing, form);
	if (Object.keys(patch).length > 0) {
		await directus.request(updateItem('sales_survey', existing.id, patch));
	}
	const up = await uploadPhotos(existing.id, photos);
	return {
		surveyId: existing.id,
		created: false,
		filled: Object.keys(patch) as LeaderSurveyField[],
		skipped,
		photosOk: up.ok,
		photosFailed: up.failed
	};
}
