// src/routes/api/automation/project-cost-alert/+server.ts
// R8 (Forecast Keuangan Global, rekomendasi laporan) — POST: dipanggil cron n8n harian
// (shared secret di body, pola sama site-checkin/auto-close) — cek proyek yang realisasi
// biayanya sudah lewat ambang plafon RAP, kirim WA ke Project Leader via relay
// /api/automation/notif-dispatch erp-epi-1 (project-epi tidak punya FONNTE_TOKEN sendiri).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { findProjectsOverCostThreshold, logCostAlertSent } from '$lib/server/projectCostAlert';

async function relayNotifyDispatch(eventType: string, karyawanId: number, message: string): Promise<boolean> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[project-cost-alert] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi.');
		return false;
	}
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, eventType, waKaryawanIds: [karyawanId], karyawanId, message })
		});
		return res.ok;
	} catch (e) {
		console.warn('[project-cost-alert] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
		return false;
	}
}

function fmtRp(n: number): string {
	return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export const POST: RequestHandler = async ({ request }) => {
	const expected = env.AUTOMATION_SERVER_SECRET;
	if (!expected) throw error(503, 'AUTOMATION_SERVER_SECRET belum dikonfigurasi di server.');

	const body = await request.json().catch(() => ({}));
	if (body?.secret !== expected) throw error(401, 'Invalid automation server secret');

	const candidates = await findProjectsOverCostThreshold();
	if (candidates.length === 0) {
		return json({ type: 'project_cost_limit_alert', checked_at: new Date().toISOString(), sent: 0, candidates: 0 });
	}

	let sent = 0;
	let skippedNoLeader = 0;
	const results: any[] = [];

	for (const c of candidates) {
		if (!c.leader_id) {
			skippedNoLeader++;
			continue;
		}
		const pct = Math.round(c.used_pct * 100);
		const message =
			`⚠️ *Biaya Proyek Mendekati Limit*\n\n` +
			`Proyek: *${c.project_name}*\n` +
			`Realisasi biaya sudah mencapai *${pct}%* dari plafon RAP.\n` +
			`(${fmtRp(c.realisasi)} dari ${fmtRp(c.rap_plafon)})\n\n` +
			`Cek posisi anggaran di kartu "Kesehatan Keuangan Proyek" pada halaman proyek Anda.`;

		const ok = await relayNotifyDispatch('project_cost_limit_alert', c.leader_id, message);
		if (ok) {
			await logCostAlertSent(c.project_id, c.used_pct);
			sent++;
		}
		results.push({ project_id: c.project_id, used_pct: c.used_pct, sent: ok });
	}

	return json({
		type: 'project_cost_limit_alert',
		checked_at: new Date().toISOString(),
		candidates: candidates.length,
		sent,
		skipped_no_leader: skippedNoLeader,
		results
	});
};
