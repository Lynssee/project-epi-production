import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { getPatrolControlSettings } from '$lib/server/patrolControlSettings';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { computePatrolScore, evaluatePatrolComplianceGate } from '$lib/server/gates/patrolComplianceGate';
import { writeGateAudit } from '$lib/server/gates/gateAudit';
import { notifyRondaSelesai } from '$lib/server/patrolNotify';

/**
 * Selesai ronda (G_SEC5). Dulu klien menghitung skor lalu menulis langsung ke security_patrol_log
 * (skor bisa dipalsukan, tidak ada titik gate). Sekarang server menghitung skor dari scan di
 * Directus, mengevaluasi gate, lalu menutup sesi. Gate durasi minimal & anomali kecepatan tetap
 * dievaluasi di klien seperti sebelumnya; alasannya diteruskan lewat `durasi_override_reason`.
 * shadow = hanya dicatat ke gate_audit_log; soft = 422 sampai `gate_sec5_reason` diisi; hard = 400.
 */
export const POST: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	const patrolLogId = Number(body?.patrol_log_id);
	if (!Number.isInteger(patrolLogId) || patrolLogId <= 0) throw error(400, 'patrol_log_id wajib diisi.');
	const clientRouteId = Number(body?.route_id) || null;
	const durasiReason = String(body?.durasi_override_reason ?? '').trim() || null;
	const gateReason = String(body?.gate_sec5_reason ?? '').trim() || null;

	const logRes = await directusServerJson<{ data: any }>(`/items/security_patrol_log/${patrolLogId}`).catch(() => null);
	const log = logRes?.data;
	if (!log) throw error(404, 'Sesi ronda tidak ditemukan.');
	if (Number(log.satpam_id) !== Number(karyawan.id)) throw error(403, 'Sesi ronda ini bukan milik Anda.');
	if (log.status !== 'ongoing') throw error(409, 'Sesi ronda ini sudah diselesaikan.');

	// Rute: dari jadwal sesi bila ada; ronda mandiri memakai rute pilihan klien (divalidasi aktif).
	let routeCheckpointIds: Array<number | string> = [];
	let routeId: number | null = null;
	if (log.schedule_id) {
		const sch = await directusServerJson<{ data: any }>(`/items/security_patrol_schedule/${log.schedule_id}?fields=route_id`).catch(() => null);
		routeId = sch?.data?.route_id ? Number(sch.data.route_id) : null;
	}
	if (!routeId && clientRouteId) routeId = clientRouteId;
	if (routeId) {
		const routeRes = await directusServerJson<{ data: any[] }>(
			`/items/security_patrol_route?${new URLSearchParams({ 'filter[id][_eq]': String(routeId), 'filter[status][_eq]': 'active', fields: 'id,checkpoint_ids', limit: '1' }).toString()}`
		).catch(() => null);
		const ids = routeRes?.data?.[0]?.checkpoint_ids;
		if (Array.isArray(ids)) routeCheckpointIds = ids;
	}

	let scannedCheckpointIds: Array<number | string> = [];
	try {
		const scansRes = await directusServerJson<{ data: any[] }>(
			`/items/security_patrol_scan?${new URLSearchParams({ 'filter[patrol_log_id][_eq]': String(patrolLogId), fields: 'checkpoint_id', limit: '-1' }).toString()}`
		);
		scannedCheckpointIds = (scansRes?.data || []).map((s) => (typeof s.checkpoint_id === 'object' ? s.checkpoint_id?.id : s.checkpoint_id));
	} catch (err) {
		// Skor tidak bisa dihitung tanpa data scan, dan klien tidak dipercaya → minta coba lagi.
		console.error('[ronda/selesai] gagal membaca scan:', err);
		throw error(502, 'Gagal memuat data scan ronda. Coba lagi.');
	}

	const score = computePatrolScore({ routeCheckpointIds, scannedCheckpointIds });

	// --- G_SEC5 ---
	let audit: { decision: 'shadow' | 'warn'; reason: string | null; summary: string } | null = null;
	try {
		const [mode, ps] = await Promise.all([
			resolveGateMode('G_SEC5', 'security_lifecycle'),
			getPatrolControlSettings()
		]);
		const verdict = evaluatePatrolComplianceGate({
			skor: score.skor,
			total: score.total,
			scannedInRoute: score.scannedInRoute,
			threshold: ps.patrolLowComplianceThreshold
		});
		if (!verdict.passed) {
			const snapshot = { patrol_log_id: patrolLogId, route_id: routeId, mode, skor: score.skor, total: score.total, titik_belum_discan: score.missingIds };
			if (mode === 'hard') {
				await writeGateAudit({ gate: 'G_SEC5', collection: 'security_patrol_log', recordId: patrolLogId, decision: 'block', reason: verdict.summary, snapshot, email: user.email ?? null });
				throw error(400, `Ronda belum bisa diselesaikan: ${verdict.summary}. Scan titik yang tersisa dulu.`);
			}
			if (mode === 'soft' && !gateReason) {
				throw error(422, `Ronda belum memenuhi standar: ${verdict.summary}. Isi alasan untuk tetap menyelesaikan, atau scan titik yang tersisa dulu.`);
			}
			audit = { decision: mode === 'soft' ? 'warn' : 'shadow', reason: mode === 'soft' ? gateReason : verdict.summary, summary: verdict.summary };
		}
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[ronda/selesai] evaluasi G_SEC5 gagal, dilewati (fail-open):', err);
	}

	const updated = await directusServerJson<{ data: any }>(`/items/security_patrol_log/${patrolLogId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			selesai: new Date().toISOString(),
			skor_kepatuhan: score.skor,
			status: 'done',
			...(durasiReason ? { durasi_override_reason: durasiReason } : {})
		})
	});

	if (audit) {
		await writeGateAudit({
			gate: 'G_SEC5',
			collection: 'security_patrol_log',
			recordId: patrolLogId,
			decision: audit.decision,
			reason: audit.reason,
			snapshot: { patrol_log_id: patrolLogId, route_id: routeId, skor: score.skor, total: score.total, titik_belum_discan: score.missingIds, summary: audit.summary },
			email: user.email ?? null
		});
	}

	// Alert skor rendah/anomali (Fase 4.2) — best-effort, tidak menghalangi respons.
	notifyRondaSelesai(patrolLogId).catch(() => {});

	return json({ record: updated?.data ?? updated, skor: score.skor, gate: audit ? { decision: audit.decision, summary: audit.summary } : null });
};
