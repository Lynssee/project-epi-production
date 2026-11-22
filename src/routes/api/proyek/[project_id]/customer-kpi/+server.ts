// src/routes/api/proyek/[project_id]/customer-kpi/+server.ts
// Laporan Periodik Fase 6A — badge KPI customer proyek (READ-ONLY, TANPA nominal). Skor dihitung di ERP admin
// (customerKpi.js, satu sumber kebenaran); di sini hanya diteruskan lewat jembatan server-ke-server.
// Auth: scope SAMA dengan pa-status / dossier-readiness (leader / co-leader / manpower leader / manajemen).
// Gagal/tidak terkonfigurasi -> { available:false } (bukan dianggap "aman"); tidak pernah memblokir halaman proyek.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveFieldProjectScope } from '$lib/server/fieldProjectScope';
import { directusServerJson } from '$lib/server/directus';

export async function GET(event: RequestEvent) {
	const user = await requireUser(event);
	const projectId = Number(event.params.project_id);
	if (!Number.isSafeInteger(projectId) || projectId <= 0) throw error(400, 'project_id tidak valid.');

	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const scope = await resolveFieldProjectScope(idToken, user.localId, user.email);
	if (!scope.unrestricted && !scope.projectIds.includes(projectId)) {
		throw error(403, 'Anda tidak memegang proyek ini.');
	}

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) return json({ available: false, reason: 'jembatan_belum_dikonfigurasi' });

	try {
		// Relasi dipisah (Aturan #2): proyek -> so_customer -> kode_customer.
		const proj = await directusServerJson<{ data: any }>(`/items/projects/${projectId}?fields=id,so_customer_id`);
		const soId = proj?.data?.so_customer_id;
		if (!soId) return json({ available: false, reason: 'proyek_tanpa_so' });
		const so = await directusServerJson<{ data: any }>(`/items/so_customer/${soId}?fields=id,kode_customer`);
		const kode = String(so?.data?.kode_customer || '').trim();
		if (!kode) return json({ available: false, reason: 'so_tanpa_kode_customer' });

		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/customer-kpi-badge`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, kode_customer: kode }),
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) {
			console.warn(`[customer-kpi] ERP HTTP ${res.status} (proyek ${projectId})`);
			return json({ available: false, reason: 'erp_error' });
		}
		const j = await res.json();
		if (!j?.found) return json({ available: false, reason: 'customer_tidak_ditemukan' });
		return json({ available: true, badge: j.badge, label: j.label, composite: j.composite ?? null });
	} catch (e: any) {
		console.warn(`[customer-kpi] proyek ${projectId} gagal:`, e?.message);
		return json({ available: false, reason: 'gagal_memuat' });
	}
}
