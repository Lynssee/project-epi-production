// src/lib/server/charterNotify.ts
// PRJ-35 — Leader mengirim Project Charter (status 'submitted') → beri tahu Admin Project DAN PM
// (supervisor) di ERP. Relay ke hub terpusat erp-epi (/api/automation/notif-dispatch), pola sama dgn
// projectNotify.ts. Penerima WA: koleksi flat `project_notify_recipients` role admin_project + supervisor
// (tanpa duplikat nomor). Fail-soft: gagal kirim TIDAK menggagalkan pengiriman charter.
import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';

type WaRecipient = { nama: string; no_telpon: string };

async function fetchRecipients(): Promise<WaRecipient[]> {
	try {
		const filter = { active: { _eq: true }, role: { _in: ['admin_project', 'supervisor'] } };
		const res = await directusServerJson<{ data: WaRecipient[] }>(
			`/items/project_notify_recipients?limit=-1&fields=nama,no_telpon&filter=${encodeURIComponent(JSON.stringify(filter))}`
		);
		const seen = new Set<string>();
		return (res?.data || []).filter((r) => {
			const k = String(r.no_telpon || '').trim();
			if (!k || seen.has(k)) return false;
			seen.add(k);
			return true;
		});
	} catch (e: any) {
		console.warn('[charterNotify] gagal ambil penerima:', e?.message);
		return [];
	}
}

export async function notifyProjectCharterSubmitted(
	charterId: number | string,
	projectName: string,
	submittedBy: string
): Promise<void> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[charterNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi dilewati.');
		return;
	}
	try {
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				secret,
				eventType: 'project_charter_submitted',
				message: `Project Charter "${projectName}" dikirim oleh ${submittedBy || 'Leader'} — menunggu pemeriksaan & persetujuan Admin Project/PM.`,
				waRecipients: await fetchRecipients(),
				waKaryawanIds: [],
				karyawanId: null,
				sourceCollection: 'project_charters',
				sourceId: String(charterId),
				actionUrl: '/project',
				actionRequired: true,
				department: 'project'
			})
		});
	} catch (e) {
		console.warn('[charterNotify] gagal memanggil relay notif-dispatch:', e);
	}
}
