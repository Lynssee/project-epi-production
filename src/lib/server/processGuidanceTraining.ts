// src/lib/server/processGuidanceTraining.ts
// ⚠️ SERVER-ONLY. Status training SAYA untuk sekumpulan program yang ditautkan di Peta Alur (T5).
// Dua query terpisah (aturan #2): program (id,kode,judul,status,…) dan enrollment milik karyawan itu. Tanpa relasi bersarang.
// Hanya membaca; tidak mendaftarkan siapa pun. Gagal baca → MELEMPAR (endpoint → respons fallback tanpa galat layar).
import { directusServerJson } from '$lib/server/directus';
import { bestOf, kategoriEnrollment, type StatusSaya } from '$lib/utils/processTraining';

export const MAX_IDS = 20;

export interface TrainingStatusItem {
	id: number;
	kode: string;
	judul: string;
	/** hanya program terbit yang bisa diikuti */
	terbit: boolean;
	self_enroll: boolean;
	status_saya: StatusSaya;
	progress: number | null;
	tenggat: string | null;
}

const unwrapId = (v: any): number | null => (v == null ? null : typeof v === 'object' ? (v.id ?? null) : Number(v));

/** "13,14,x,13" → [13,14] (unik, bilangan bulat > 0, maks MAX_IDS). */
export function parseIds(raw: string | null | undefined): number[] {
	const ids = String(raw ?? '')
		.split(',')
		.map((x) => Number(x.trim()))
		.filter((n) => Number.isInteger(n) && n > 0);
	return [...new Set(ids)].slice(0, MAX_IDS);
}

export async function loadMyTrainingStatus(karyawanId: number, ids: number[]): Promise<TrainingStatusItem[]> {
	if (!Number.isInteger(karyawanId) || karyawanId <= 0 || ids.length === 0) return [];
	const list = ids.join(',');
	const [programs, enrollments] = await Promise.all([
		directusServerJson<{ data: any[] }>(`/items/training_program?filter[id][_in]=${list}&fields=id,kode,judul,status,self_enroll&limit=${MAX_IDS}`),
		directusServerJson<{ data: any[] }>(
			`/items/training_enrollment?filter[karyawan_id][_eq]=${karyawanId}&filter[program_id][_in]=${list}&fields=program_id,status,progress_persen,tenggat&limit=200`
		)
	]);

	const mine = new Map<number, { status: StatusSaya; progress: number | null; tenggat: string | null }>();
	for (const e of Array.isArray(enrollments?.data) ? enrollments.data : []) {
		const pid = unwrapId(e.program_id);
		if (!pid) continue;
		const cat = kategoriEnrollment(e.status);
		const cur = mine.get(pid);
		const status = cur ? bestOf(cur.status, cat) : cat;
		const pr = Number(e.progress_persen);
		mine.set(pid, { status, progress: Number.isFinite(pr) ? Math.max(cur?.progress ?? 0, pr) : (cur?.progress ?? null), tenggat: e.tenggat || cur?.tenggat || null });
	}

	const byId = new Map<number, any>((Array.isArray(programs?.data) ? programs.data : []).map((p: any) => [Number(p.id), p]));
	// Urutan mengikuti ids yang diminta; program yang tak ada di master dilewati (UI menandainya dari ketiadaan item).
	return ids
		.filter((id) => byId.has(id))
		.map((id) => {
			const p = byId.get(id);
			const m = mine.get(id);
			return {
				id,
				kode: p.kode || '',
				judul: p.judul || `Program #${id}`,
				terbit: p.status === 'published',
				self_enroll: p.self_enroll === true || p.self_enroll === 1,
				status_saya: m?.status ?? 'belum',
				progress: m && m.status !== 'belum' ? m.progress : null,
				tenggat: m?.tenggat ?? null
			};
		});
}
