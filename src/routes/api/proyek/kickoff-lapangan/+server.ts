// src/routes/api/proyek/kickoff-lapangan/+server.ts
// Fase 4 — Leader menekan "Mulai Bekerja": status proyek Waiting/Draft → On Progress.
//   GET  ?projectId=   → { can, already?, reason?, failed: string[] }  (pratinjau kekurangan kesiapan, read-only)
//   POST { projectId } → ubah status + catat override bila kesiapan belum 100% (activity_log). Idempoten.
// Tidak mengunci: kekurangan kesiapan hanya dicatat (Aturan #3). Hanya Project Leader proyek ybs.
// Tanggal mulai riil dicatat di activity_log (tak ada kolom skema khusus → tidak menebak field, Aturan #1).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeader } from '$lib/server/projectLeaderGuard';
import { directusServerJson } from '$lib/server/directus';
import {
	canKickoffFrom,
	failedReadiness,
	timelineHasContent,
	KICKOFF_TARGET_STATUS
} from '$lib/shared/kickoffLapangan';
import { evaluateProjectScheduleDiscipline } from '$lib/utils/timelineDisiplin.js';

async function loadSignals(projectId: number, project: any): Promise<string[]> {
	const [charter, budgets] = await Promise.all([
		project.so_customer_id != null
			? directusServerJson(
					`/items/project_charters?filter[so_customer_id][_eq]=${project.so_customer_id}&fields=status,project_leader,timeline_planning&limit=1`
				)
					.then((r: any) => r?.data?.[0] ?? null)
					.catch((e: any) => {
						console.warn('[kickoff-lapangan] gagal baca charter:', e?.message);
						return null;
					})
			: Promise.resolve(null),
		directusServerJson(`/items/project_budgets?filter[project_id][_eq]=${projectId}&fields=planned_amount&limit=-1`)
			.then((r: any) => r?.data ?? [])
			.catch((e: any) => {
				console.warn('[kickoff-lapangan] gagal baca RAB:', e?.message);
				return [];
			})
	]);
	const rabTotal = (budgets ?? []).reduce((a: number, b: any) => a + (Number(b?.planned_amount) || 0), 0);
	const planning = charter?.timeline_planning || project.timeline_planning;
	const scheduleEval = evaluateProjectScheduleDiscipline(planning, { excludeSystemCategory: true });

	return failedReadiness({
		leaderAssigned: !!(charter?.project_leader || project.leader || project.leader_id),
		charterApproved: charter?.status === 'approved',
		rabTotal,
		timelineSet: timelineHasContent(planning),
		timelineScheduled: scheduleEval.passed
	});
}

async function loadProject(projectId: number) {
	const r = await directusServerJson(
		`/items/projects/${projectId}?fields=id,name,status,leader,leader_id,so_customer_id,timeline_planning`
	);
	if (!r?.data) throw error(404, 'Proyek tidak ditemukan.');
	return r.data;
}

function parseId(v: unknown): number {
	const n = Number(v);
	if (!Number.isInteger(n) || n <= 0) throw error(400, 'projectId tidak valid.');
	return n;
}

export const GET: RequestHandler = async (event) => {
	const projectId = parseId(event.url.searchParams.get('projectId'));
	await authenticateProjectLeader(event, projectId);
	const project = await loadProject(projectId);
	const decision = canKickoffFrom(project.status);
	const failed = decision.can ? await loadSignals(projectId, project) : [];
	return json({ ...decision, failed });
};

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => null);
	const projectId = parseId(body?.projectId);
	const { karyawan } = await authenticateProjectLeader(event, projectId);
	const project = await loadProject(projectId);

	const decision = canKickoffFrom(project.status);
	if (!decision.can) {
		if (decision.already) return json({ success: true, alreadyStarted: true, failed: [] });
		throw error(409, decision.reason);
	}

	const failed = await loadSignals(projectId, project);
	const now = new Date().toISOString();
	try {
		await directusServerJson(`/items/projects/${projectId}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: KICKOFF_TARGET_STATUS })
		});
	} catch (e: any) {
		console.error('[kickoff-lapangan] gagal ubah status:', e?.message);
		throw error(502, 'Gagal mengubah status proyek — coba lagi.');
	}

	await directusServerJson('/items/activity_log', {
		method: 'POST',
		body: JSON.stringify({
			module: 'project',
			collection: 'projects',
			record_id: String(projectId),
			action: 'status',
			activity_type: failed.length ? 'warning' : 'info',
			description:
				`Kickoff Lapangan: "${project.name}" dimulai oleh Leader ${karyawan.nama_karyawan} pada ${now.slice(0, 10)} ` +
				`(${project.status} → ${KICKOFF_TARGET_STATUS})` +
				(failed.length ? `. OVERRIDE Gerbang Kesiapan — belum lengkap: ${failed.join(', ')}` : '. Kesiapan wajib lengkap.'),
			actor_id: String(karyawan.id),
			actor_name: karyawan.nama_karyawan,
			created_at: now
		})
	}).catch((e: any) => console.warn('[kickoff-lapangan] gagal catat activity_log:', e?.message));

	return json({ success: true, alreadyStarted: false, failed, startedAt: now });
};
