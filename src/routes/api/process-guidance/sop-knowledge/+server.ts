// src/routes/api/process-guidance/sop-knowledge/+server.ts
// "Skor Pengetahuan SOP Saya" untuk SATU alur (kartu di /panduan/alur). Wajib login ESS; hanya membaca data milik karyawan itu sendiri.
// Memakai ulang mesin kuis yang ada (training_quiz/enrollment/attempt) — TIDAK ada mesin kuis kedua, jadi anti-cheat, batas percobaan,
// dan gating modul tetap ditegakkan di /ess/pelatihan. Query terpisah per relasi (aturan #2); kegagalan dicatat & dilaporkan, tidak ditelan.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { bestQuizForProgram, loadKnowledgeSettings } from '$lib/server/ess/sopKnowledge';
import { computeFlowKnowledge, readStatusOf } from '$lib/utils/sopKnowledgeMine';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const flowKey = event.url.searchParams.get('flow_key')?.trim();
	if (!flowKey) throw error(400, 'flow_key wajib diisi.');

	const warnings: string[] = [];
	let flows;
	try {
		flows = await loadPublishedFlowsForField();
	} catch (e: any) {
		console.error('[sop-knowledge] alur gagal dimuat:', e?.message || e);
		return json({ success: false, error: 'Alur gagal dimuat.' }, { status: 502 });
	}
	const flow = flows.find((f) => f.id === flowKey);
	if (!flow) throw error(404, 'Alur tidak ditemukan.');

	const programIds = [
		...new Set([
			...((flow.training ?? []) as { program_id: number }[]).map((t) => Number(t.program_id)),
			...(flow.nodes ?? []).flatMap((n: any) => (Array.isArray(n?.training_ids) ? n.training_ids : []).map(Number))
		].filter((n) => Number.isInteger(n) && n > 0))
	];

	const [settings, readRes] = await Promise.all([
		loadKnowledgeSettings(warnings),
		directusServerJson<{ data: { flow_version: number | null }[] }>(
			`/items/sop_read_confirmations?filter[karyawan_id][_eq]=${karyawan.id}&filter[flow_key][_eq]=${encodeURIComponent(flowKey)}&fields=flow_version&limit=-1`
		).catch((e) => {
			console.error('[sop-knowledge] konfirmasi baca gagal dibaca:', e?.message || e);
			warnings.push('Status baca gagal dimuat.');
			return { data: [] };
		})
	]);
	const confirmed = (readRes?.data ?? []).map((r) => (r.flow_version == null ? null : Number(r.flow_version)));
	const bestConfirmed = confirmed.reduce<number | null>((m, v) => (v == null ? m : m == null || v > m ? v : m), null);
	const read = readStatusOf((flow as any).version, bestConfirmed, confirmed.length > 0);

	const quizzes: { program_id: number; quiz_id: number | null; enrolled: boolean; best: number | null; lulus: boolean }[] = [];
	for (const pid of programIds) {
		try {
			quizzes.push(await bestQuizForProgram(karyawan.id, pid));
		} catch (e: any) {
			console.error(`[sop-knowledge] program ${pid} gagal dibaca:`, e?.message || e);
			warnings.push(`Program ${pid} gagal dimuat.`);
		}
	}

	const hasQuiz = quizzes.some((q) => q.quiz_id != null);
	const bestQuiz = quizzes.reduce<number | null>((m, q) => (q.best == null ? m : m == null || q.best > m ? q.best : m), null);
	const result = computeFlowKnowledge({ read, hasQuiz, bestQuiz, settings });
	return json({ success: true, flow_key: flowKey, read, has_quiz: hasQuiz, quizzes, ...result, warnings });
};
