// src/lib/server/ess/sopKnowledge.ts
// Bahan bersama "Skor Pengetahuan SOP Saya" (alur Peta Bisnis & dokumen SOP ESS): setelan bobot/KKM dan skor kuis terbaik per program.
// Memakai mesin kuis yang ada (training_quiz/enrollment/attempt) — tidak ada mesin kuis kedua. Kegagalan dicatat & dilaporkan, tidak ditelan.
import { directusServerJson } from '$lib/server/directus';
import { findFinalQuizForProgram, findMyEnrollmentForProgram, listMyAttempts } from '$lib/server/ess/training';
import { DEFAULT_KNOWLEDGE_SETTINGS, type KnowledgeSettings } from '$lib/utils/sopKnowledgeMine';

const KEYS = ['sop.knowledge_passing_score', 'sop.knowledge_quiz_weight', 'sop.knowledge_read_weight', 'sop.knowledge_untested_policy'];

export async function loadKnowledgeSettings(warnings: string[]): Promise<KnowledgeSettings> {
	const s = { ...DEFAULT_KNOWLEDGE_SETTINGS };
	try {
		const res = await directusServerJson<{ data: { setting_key: string; setting_value: unknown }[] }>(
			`/items/app_settings?filter[module][_eq]=sop_lifecycle&filter[setting_key][_in]=${KEYS.join(',')}&fields=setting_key,setting_value&limit=10`
		);
		for (const r of res?.data ?? []) {
			const n = Number(r.setting_value);
			if (r.setting_key === 'sop.knowledge_passing_score' && Number.isFinite(n)) s.passingScore = n;
			if (r.setting_key === 'sop.knowledge_quiz_weight' && Number.isFinite(n)) s.quizWeight = n;
			if (r.setting_key === 'sop.knowledge_read_weight' && Number.isFinite(n)) s.readWeight = n;
			if (r.setting_key === 'sop.knowledge_untested_policy') s.untestedPolicy = r.setting_value === 'read_only_cap' ? 'read_only_cap' : 'untested_badge';
		}
	} catch (e: any) {
		console.error('[sopKnowledge] setelan gagal dibaca, memakai bawaan:', e?.message || e);
		warnings.push('Setelan skor gagal dimuat — memakai bawaan.');
	}
	return s;
}

export interface ProgramQuizResult { program_id: number; quiz_id: number | null; enrolled: boolean; best: number | null; lulus: boolean }

/** Skor kuis akhir terbaik karyawan pada satu program (attempt terbaik, fallback nilai_teori enrollment). */
export async function bestQuizForProgram(karyawanId: number, programId: number): Promise<ProgramQuizResult> {
	const [quiz, enrollment] = await Promise.all([findFinalQuizForProgram(programId), findMyEnrollmentForProgram(karyawanId, programId)]);
	let best: number | null = enrollment?.nilai_teori != null ? Number(enrollment.nilai_teori) : null;
	let lulus = false;
	if (quiz && enrollment) {
		for (const a of await listMyAttempts(enrollment.id, quiz.id)) {
			const n = Number(a.skor);
			if (Number.isFinite(n) && (best == null || n > best)) best = n;
			if (a.lulus) lulus = true;
		}
	}
	return { program_id: programId, quiz_id: quiz?.id ?? null, enrolled: !!enrollment, best, lulus };
}
