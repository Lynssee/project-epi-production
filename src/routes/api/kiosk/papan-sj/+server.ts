// src/routes/api/kiosk/papan-sj/+server.ts
// Papan pantau tahap Surat Jalan untuk layar gudang. Read-only, agregat dari cache
// `surat_jalan.track_*` (bukan ledger). Guard: sesi kiosk (badge+PIN — Q4).
// Tracking SJ v2 Fase 3b.

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { directusServerJson } from '$lib/server/directus';
import { STAGE_LABELS } from '$lib/server/sjTracking';

const BOARD_STAGES = ['disiapkan', 'siap_muat', 'dimuat', 'menunggu_gerbang', 'dalam_perjalanan', 'tiba_lokasi'];
// Ambang "lewat" per tahap dalam menit (cermin default erp inventory.sj.sla_hours).
const SLA_MIN: Record<string, number> = { menunggu_gerbang: 30, dalam_perjalanan: 72 * 60, tiba_lokasi: 12 * 60 };

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'papan_sj', 'Papan Pantau SJ');
	const now = Date.now();

	const cntRes = await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan?aggregate[count]=id&groupBy=track_stage&filter[track_stage][_in]=${BOARD_STAGES.join(',')}&limit=-1`
	).catch(() => ({ data: [] }));
	const totals: Record<string, number> = {};
	for (const r of cntRes?.data || []) totals[String(r.track_stage)] = Number(r.count?.id ?? r.count ?? 0);

	const cardRes = await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan?filter[track_stage][_in]=${BOARD_STAGES.join(',')}` +
		`&sort=track_stage_at,id&limit=120` +
		`&fields=id,nomor_sj,track_stage,track_stage_at,driver,delivery_address`
	).catch(() => ({ data: [] }));

	const columns = BOARD_STAGES.map((stage) => ({
		stage,
		label: STAGE_LABELS[stage] || stage,
		count: totals[stage] || 0,
		cards: (cardRes?.data || [])
			.filter((sj) => sj.track_stage === stage)
			.map((sj) => {
				const ageMin = sj.track_stage_at ? Math.round((now - new Date(sj.track_stage_at).getTime()) / 60000) : null;
				const sla = SLA_MIN[stage];
				return {
					id: sj.id,
					nomor_sj: sj.nomor_sj,
					driver: sj.driver || null,
					tujuan: sj.delivery_address || null,
					age_min: ageMin,
					tone: ageMin == null || !sla ? 'green' : ageMin > sla ? 'red' : ageMin > sla * 0.7 ? 'yellow' : 'green'
				};
			})
	}));

	return json({ columns, generated_at: new Date().toISOString() });
};
