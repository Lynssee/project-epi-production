// src/lib/utils/sopKnowledgeMine.ts
// Skor Pengetahuan SOP SATU karyawan pada SATU alur (sisi lapangan). MURNI — rumus sama dengan erp-epi
// (src/lib/utils/sopKnowledgeScore.js): skor = (kuis × Wkuis + baca × Wbaca) / (Wkuis + Wbaca); tanpa kuis → "belum diuji".

export type KnowledgeStatus = 'kompeten' | 'penguatan' | 'remedial' | 'belum_diuji';
export type ReadStatus = 'sudah' | 'versi_lama' | 'belum';

export interface KnowledgeSettings {
	passingScore: number;
	quizWeight: number;
	readWeight: number;
	untestedPolicy: 'untested_badge' | 'read_only_cap';
}

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = { passingScore: 75, quizWeight: 70, readWeight: 30, untestedPolicy: 'untested_badge' };

export function readStatusOf(flowVersion: number | null | undefined, confirmedVersion: number | null | undefined, hasRecord: boolean): ReadStatus {
	if (!hasRecord) return 'belum';
	if (confirmedVersion == null) return 'sudah'; // versi tak tercatat = data lama
	return confirmedVersion >= (Number(flowVersion) > 0 ? Number(flowVersion) : 1) ? 'sudah' : 'versi_lama';
}

export function statusOfScore(score: number | null, passing: number): KnowledgeStatus {
	if (score == null || !Number.isFinite(score)) return 'belum_diuji';
	if (score >= passing) return 'kompeten';
	return score >= 50 ? 'penguatan' : 'remedial';
}

export function computeFlowKnowledge(input: { read: ReadStatus; hasQuiz: boolean; bestQuiz: number | null; settings?: Partial<KnowledgeSettings> }) {
	const s = { ...DEFAULT_KNOWLEDGE_SETTINGS, ...(input.settings || {}) };
	let wq = Number(s.quizWeight);
	let wr = Number(s.readWeight);
	if (!(wq >= 0) || !(wr >= 0) || wq + wr <= 0) { wq = 70; wr = 30; }
	const readPts = input.read === 'sudah' ? 100 : 0;
	let score: number | null;
	if (!input.hasQuiz) score = s.untestedPolicy === 'read_only_cap' ? readPts : null;
	else score = Math.round(((Math.max(0, input.bestQuiz ?? 0) * wq + readPts * wr) / (wq + wr)) * 10) / 10;
	return { score, status: statusOfScore(score, s.passingScore), passing: s.passingScore };
}
