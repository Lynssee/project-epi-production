// GET /api/ess/sop/skor — Skor Pengetahuan SOP Saya per dokumen SOP terbit (halaman /ess/pelatihan/sop).
// Skor = kuis program SOP (training_program_id) × bobot + konfirmasi baca versi terkini × bobot (rumus sama dengan admin).
// SOP tanpa program kuis → "belum diuji" (bawaan). Best-effort: gagal → daftar kosong (tidak mengganggu daftar SOP).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { listPublishedSop } from '$lib/server/ess/sop';
import { bestQuizForProgram, loadKnowledgeSettings } from '$lib/server/ess/sopKnowledge';
import { computeFlowKnowledge } from '$lib/utils/sopKnowledgeMine';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const warnings: string[] = [];
	try {
		const sops = await listPublishedSop();
		if (sops.length === 0) return json({ success: true, skor: [], warnings });
		const [settings, conf] = await Promise.all([
			loadKnowledgeSettings(warnings),
			directusServerJson<{ data: { sop_id: number; sop_version_seq: number }[] }>(
				`/items/sop_read_confirmations?filter[karyawan_id][_eq]=${karyawan.id}&filter[sop_id][_in]=${sops.map((s) => s.id).join(',')}&fields=sop_id,sop_version_seq&limit=-1`
			).catch((e) => {
				console.error('[ess/sop/skor] konfirmasi baca gagal dibaca:', e?.message || e);
				warnings.push('Status baca gagal dimuat.');
				return { data: [] };
			})
		]);
		const seqBySop = new Map<number, Set<number>>();
		for (const c of conf?.data ?? []) (seqBySop.get(c.sop_id) || seqBySop.set(c.sop_id, new Set()).get(c.sop_id)!).add(c.sop_version_seq);

		const programIds = [...new Set(sops.map((s) => Number(s.training_program_id)).filter((n) => Number.isInteger(n) && n > 0))];
		const quizByProgram = new Map<number, Awaited<ReturnType<typeof bestQuizForProgram>>>();
		await Promise.all(
			programIds.map(async (pid) => {
				try {
					quizByProgram.set(pid, await bestQuizForProgram(karyawan.id, pid));
				} catch (e: any) {
					console.error(`[ess/sop/skor] program ${pid} gagal dibaca:`, e?.message || e);
					warnings.push(`Program ${pid} gagal dimuat.`);
				}
			})
		);

		const skor = sops.map((s) => {
			const read = seqBySop.get(s.id)?.has(s.version_seq) ? ('sudah' as const) : seqBySop.get(s.id)?.size ? ('versi_lama' as const) : ('belum' as const);
			const q = s.training_program_id ? quizByProgram.get(Number(s.training_program_id)) : undefined;
			const hasQuiz = !!q?.quiz_id;
			const r = computeFlowKnowledge({ read, hasQuiz, bestQuiz: q?.best ?? null, settings });
			return { sopId: s.id, read, has_quiz: hasQuiz, program_id: hasQuiz ? q!.program_id : null, ...r };
		});
		return json({ success: true, skor, warnings });
	} catch (e: any) {
		console.error('[ess/sop/skor] gagal:', e?.message || e);
		return json({ success: false, skor: [], warnings: ['Skor gagal dimuat.'] });
	}
};
