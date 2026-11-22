// Util murni Learning Path (roadmap silabus berjenjang) — salinan logika erp-epi `utils/learningPathCore.js`. Ubah bersamaan.
// Status: selesai | berjalan | terbuka | terkunci. Prasyarat di luar daftar silabus karyawan dianggap terpenuhi (tak mengunci tanpa data).

export type LearningStepStatus = 'selesai' | 'berjalan' | 'terbuka' | 'terkunci';

export interface LearningPathInput {
	id: number;
	namaSilabus: string;
	kategori?: string | null;
	level?: string | null;
	prerequisiteId?: number | null;
	progressPersen: number;
	urutan?: number | null;
}

export interface LearningStep {
	id: number;
	nomor: number;
	nama: string;
	level: string | null;
	kategori: string | null;
	persen: number;
	status: LearningStepStatus;
	prasyaratNama: string | null;
}

// Dasar/Menengah/Lanjutan (kanonis) setara Basic/Intermediate/Advanced (data lama).
const LEVEL_ORDER: Record<string, number> = { dasar: 1, basic: 1, menengah: 2, intermediate: 2, lanjutan: 3, advanced: 3 };
export const levelRank = (level?: string | null): number => (level ? LEVEL_ORDER[level.trim().toLowerCase()] || 0 : 0);

export function buildLearningPath(silabus: LearningPathInput[] | null | undefined): LearningStep[] {
	const list = (silabus || []).filter((s) => s && s.id != null && s.id > 0);
	const byId = new Map(list.map((s) => [s.id, s]));
	const cmp = (a: LearningPathInput, b: LearningPathInput) =>
		levelRank(a.level) - levelRank(b.level) || (a.urutan ?? 0) - (b.urutan ?? 0) || a.id - b.id;

	const ordered: LearningPathInput[] = [];
	const done = new Set<number>();
	const visiting = new Set<number>();
	const visit = (s: LearningPathInput) => {
		if (done.has(s.id) || visiting.has(s.id)) return;
		visiting.add(s.id);
		const pre = s.prerequisiteId != null ? byId.get(s.prerequisiteId) : undefined;
		if (pre) visit(pre);
		visiting.delete(s.id);
		done.add(s.id);
		ordered.push(s);
	};
	[...list].sort(cmp).forEach(visit);

	const statusOf = new Map<number, LearningStepStatus>();
	return ordered.map((s, i) => {
		const pre = s.prerequisiteId != null ? byId.get(s.prerequisiteId) : undefined;
		const persen = Math.min(100, Math.max(0, Number(s.progressPersen) || 0));
		const preSelesai = !pre || statusOf.get(pre.id) === 'selesai';
		const status: LearningStepStatus =
			persen >= 100 ? 'selesai' : !preSelesai ? 'terkunci' : persen > 0 ? 'berjalan' : 'terbuka';
		statusOf.set(s.id, status);
		return {
			id: s.id,
			nomor: i + 1,
			nama: s.namaSilabus || `Silabus #${s.id}`,
			level: s.level || null,
			kategori: s.kategori || null,
			persen,
			status,
			prasyaratNama: pre ? pre.namaSilabus || `Silabus #${pre.id}` : null
		};
	});
}

export function summarizeLearningPath(steps: LearningStep[]) {
	const total = steps.length;
	const selesai = steps.filter((s) => s.status === 'selesai').length;
	const next = steps.find((s) => s.status === 'berjalan') || steps.find((s) => s.status === 'terbuka') || null;
	return { total, selesai, persen: total ? Math.round((selesai / total) * 100) : 0, next };
}

export interface NextMateriInput {
	programId: number;
	programJudul: string;
	status: string;
	progressPersen: number;
	locked: boolean;
	isWajib: boolean;
	urutan?: number | null;
}

/** Program berikutnya yang harus dikerjakan di satu silabus: yang sedang berjalan dulu, lalu yang belum mulai (wajib sebelum opsional). Terkunci/Lulus dilewati. */
export function findNextMateri<T extends NextMateriInput>(materi: T[] | null | undefined): T | null {
	const open = (materi || []).filter((m) => m && !m.locked && m.status !== 'Lulus');
	if (!open.length) return null;
	const rank = (m: T) => (m.status === 'Ongoing' || m.status === 'Remedial' || (m.progressPersen ?? 0) > 0 ? 0 : 1);
	return [...open].sort((a, b) => rank(a) - rank(b) || Number(b.isWajib) - Number(a.isWajib) || (a.urutan ?? 0) - (b.urutan ?? 0))[0];
}

/** Estimasi sisa menit belajar; null bila durasi program tak diketahui. */
export function estimasiSisaMenit(durasiMenit: number | null | undefined, progressPersen: number): number | null {
	const d = Number(durasiMenit);
	if (!Number.isFinite(d) || d <= 0) return null;
	const sisa = d * (1 - Math.min(100, Math.max(0, Number(progressPersen) || 0)) / 100);
	return Math.max(1, Math.round(sisa));
}
