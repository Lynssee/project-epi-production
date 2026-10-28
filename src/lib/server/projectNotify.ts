// src/lib/server/projectNotify.ts
// Notifikasi Terpusat v2 — rollout modul Project (lihat
// "(sales)implementation_plan_project notifikasi (TAJAM).md" §3 Fase 1). Relay ke hub
// terpusat di erp-epi-1 (/api/automation/notif-dispatch), pola sama persis dgn
// gaChecklistNotify.ts — FONNTE_TOKEN & registry event hanya ada di env/kode erp-epi-1.
//
// Resolusi penerima Hybrid C (Keputusan D1, 13 Agu 2026):
//  - in-app: broadcast ke individu via karyawanId bila record menyimpannya (reports.karyawan_id,
//    requester_user_id, operator_id) — TIDAK dijamin selalu terisi, boleh null (fail-soft, in-app
//    saja tidak terkirim, WA tetap jalan via koleksi flat di bawah).
//  - WA: HANYA ke koleksi flat `project_notify_recipients` (role: supervisor/admin_project/
//    procurement), supaya tidak bergantung pada mapping projects.leader_id yang belum tentu rapi
//    di semua record lama.
//
// Gagal kirim TIDAK BOLEH menggagalkan alur submit lapangan — fail-soft (log warning saja).

import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';

type WaRecipient = { nama: string; no_telpon: string };

async function fetchProjectRecipients(role?: string): Promise<WaRecipient[]> {
	try {
		const filter: Record<string, unknown> = { active: { _eq: true } };
		if (role) filter.role = { _eq: role };
		const res = await directusServerJson<{ data: WaRecipient[] }>(
			`/items/project_notify_recipients?limit=-1&fields=nama,no_telpon&filter=${encodeURIComponent(JSON.stringify(filter))}`
		);
		return res?.data || [];
	} catch {
		return [];
	}
}

async function dispatch(
	eventType: string,
	message: string,
	opts: {
		waRecipients?: WaRecipient[];
		waKaryawanIds?: Array<number | string>;
		karyawanId?: number | string | null;
		sourceCollection?: string;
		sourceId?: string | number;
		actionUrl?: string;
		actionRequired?: boolean;
		legacyType?: string;
	}
) {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[projectNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi dilewati.');
		return;
	}
	try {
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				secret,
				eventType,
				message,
				waRecipients: opts.waRecipients || [],
				waKaryawanIds: opts.waKaryawanIds || [],
				karyawanId: opts.karyawanId ?? null,
				sourceCollection: opts.sourceCollection,
				sourceId: opts.sourceId != null ? String(opts.sourceId) : undefined,
				actionUrl: opts.actionUrl,
				actionRequired: opts.actionRequired ?? false,
				department: 'project',
				legacyType: opts.legacyType
			})
		});
	} catch (e) {
		console.warn('[projectNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
	}
}

/** Submit laporan harian — dipanggil setelah reports.status jadi 'submitted'. */
export async function notifyProjectReportSubmitted(
	reportId: number | string,
	projectId: number | string,
	projectName: string
): Promise<void> {
	const waRecipients = await fetchProjectRecipients('supervisor');
	await dispatch('project_daily_report_submitted', `Laporan harian proyek ${projectName} baru disubmit, menunggu verifikasi.`, {
		waRecipients,
		sourceCollection: 'reports',
		sourceId: reportId,
		actionUrl: `/laporan/${projectId}`
	});
}

/**
 * Executor Partitioning Fase 5 (28 Sep 2026) — laporan harian memuat progres subtask
 * executor_type='vendor'. Notifikasi TERPISAH dari project_daily_report_submitted supaya PM
 * bisa langsung tahu ada progres vendor yang perlu dipantau (opname), tanpa harus buka tiap
 * laporan. Fail-soft, dipanggil fire-and-forget dari notify-submitted/+server.ts.
 */
export async function notifyProjectReportVendorProgress(
	reportId: number | string,
	projectId: number | string,
	projectName: string,
	vendorNames: string[]
): Promise<void> {
	const waRecipients = await fetchProjectRecipients('supervisor');
	const daftarVendor = vendorNames.join(', ');
	await dispatch(
		'project_executor_vendor_progress_reported',
		`Laporan harian proyek ${projectName} memuat progres vendor: ${daftarVendor}.`,
		{
			waRecipients,
			sourceCollection: 'reports',
			sourceId: reportId,
			actionUrl: `/laporan/${projectId}`
		}
	);
}

/**
 * Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — leader menandai instruksi lisan
 * klien di lapangan berpotensi kerja tambah (VO). Admin Project perlu tahu segera supaya
 * tidak gagal ditagihkan saat BAST. Fail-soft, dipanggil fire-and-forget dari
 * notify-submitted/+server.ts (sama pola seperti notifyProjectReportVendorProgress).
 */
export async function notifyProjectClientInstructionVo(
	reportId: number | string,
	projectId: number | string,
	projectName: string,
	pengawasKlien: string
): Promise<void> {
	const waRecipients = await fetchProjectRecipients('admin_project');
	await dispatch(
		'project_client_instruction_vo',
		`Laporan harian proyek ${projectName}: ada instruksi klien (${pengawasKlien}) berpotensi kerja tambah (VO) — segera cek sebelum BAST.`,
		{
			waRecipients,
			sourceCollection: 'reports',
			sourceId: reportId,
			actionUrl: `/laporan/${projectId}`,
			actionRequired: true
		}
	);
}

// Catatan: notifikasi approve/reject laporan harian TIDAK direlay dari sini — keputusan
// verify/reject sekarang terjadi langsung di erp-epi-1 (endpoint RBAC-gated, lihat
// src/routes/api/laporan/[id]/decide/+server.js), yang punya akses langsung ke
// notifyEvent()/registry.js sendiri (sama seperti requisitionEngine.js), jadi tidak perlu
// bolak-balik HTTP relay ke project-epi untuk event ini.

/**
 * F5.2 (Audit & Hardening Gate v2, 30 Agu 2026) — WA ke RANTAI APPROVAL + GM untuk
 * requisition yang ditandai mendesak. Resolusi approver dari approval_matrix
 * (semua band module_key) + jabatan GM (default 4, dari system_settings
 * gate.override.jabatan_ids), lalu ambil no_telpon karyawan aktif. Fail-soft.
 */
async function fetchApprovalChainWa(moduleKey: string): Promise<WaRecipient[]> {
	try {
		const [matrixRes, gmSetting] = await Promise.all([
			directusServerJson<{ data: any[] }>(
				`/items/approval_matrix?limit=-1&fields=jabatan_id,can_approve,is_active` +
					`&filter[_or][0][module_key][_eq]=${encodeURIComponent(moduleKey)}` +
					`&filter[_or][1][module_key][_eq]=${encodeURIComponent(moduleKey + '.direktur')}`
			),
			directusServerJson<{ data: any[] }>(
				`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent('gate.override.jabatan_ids')}&fields=setting_value&limit=1`
			).catch(() => ({ data: [] }))
		]);
		const jabatanIds = new Set<number>();
		for (const r of matrixRes?.data || []) {
			if (!r.can_approve || r.is_active === false) continue;
			const j = typeof r.jabatan_id === 'object' ? r.jabatan_id?.id : r.jabatan_id;
			if (j != null) jabatanIds.add(Number(j));
		}
		let gmIds: number[] = [4];
		try {
			const raw = (gmSetting as any)?.data?.[0]?.setting_value;
			const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
			if (Array.isArray(parsed) && parsed.length) gmIds = parsed.map((n: any) => Number(n));
		} catch { /* default */ }
		for (const g of gmIds) jabatanIds.add(g);
		if (jabatanIds.size === 0) return [];

		const kRes = await directusServerJson<{ data: any[] }>(
			`/items/karyawan?limit=-1&filter[status][_eq]=On&filter[jabatan_id][_in]=${[...jabatanIds].join(',')}` +
				`&fields=nama_karyawan,no_hp`
		);
		return (kRes?.data || [])
			.filter((k: any) => k.no_hp)
			.map((k: any) => ({ nama: k.nama_karyawan || 'Approver', no_telpon: String(k.no_hp) }));
	} catch (e) {
		console.warn('[projectNotify] fetchApprovalChainWa gagal:', e);
		return [];
	}
}

/** F5.2 — requisition mendesak: WA ke rantai approval + GM. Dipanggil hanya bila urgent=true. */
export async function notifyProjectRequisitionUrgent(
	requisitionId: number | string,
	projectId: number | string,
	opts: { requisitionNumber: string; moduleKey: string; totalAmount: number; reason?: string | null; requesterName?: string | null }
): Promise<void> {
	const chain = await fetchApprovalChainWa(opts.moduleKey);
	if (chain.length === 0) return;
	const rp = `Rp ${Number(opts.totalAmount || 0).toLocaleString('id-ID')}`;
	const msg =
		`🚨 *REQUISITION MENDESAK* — ${opts.requisitionNumber}\n` +
		`Nilai: ${rp}${opts.requesterName ? `\nPengaju: ${opts.requesterName}` : ''}\n` +
		(opts.reason ? `Alasan mendesak: ${opts.reason}\n` : '') +
		`Mohon segera ditinjau di Inbox Approval.`;
	await dispatch('project_requisition_urgent', msg, {
		waRecipients: chain,
		sourceCollection: 'requisitions',
		sourceId: requisitionId,
		actionUrl: `/requisition/${projectId}`,
		actionRequired: true
	});
}

/** Submit requisition/sparepart — Admin Procurement + PL. */
export async function notifyProjectRequisitionSubmitted(
	requisitionId: number | string,
	projectId: number | string,
	requesterUserId: number | string | null
): Promise<void> {
	const [procurement, supervisor] = await Promise.all([
		fetchProjectRecipients('procurement'),
		fetchProjectRecipients('supervisor')
	]);
	await dispatch('project_requisition_submitted', `Requisition/sparepart baru menunggu approval.`, {
		karyawanId: requesterUserId,
		waRecipients: [...procurement, ...supervisor],
		sourceCollection: 'requisitions',
		sourceId: requisitionId,
		actionUrl: `/requisition/${projectId}`,
		actionRequired: true
	});
}

/** Requisition disetujui — notif ke pemohon (in-app saja). */
export async function notifyProjectRequisitionApproved(
	requisitionId: number | string,
	projectId: number | string,
	requesterUserId: number | string | null
): Promise<void> {
	await dispatch('project_requisition_approved', `Requisition Anda telah disetujui.`, {
		karyawanId: requesterUserId,
		sourceCollection: 'requisitions',
		sourceId: requisitionId,
		actionUrl: `/requisition/${projectId}`
	});
}

/** Requisition ditolak — eskalasi WA ke pemohon lewat supervisor. */
export async function notifyProjectRequisitionRejected(
	requisitionId: number | string,
	projectId: number | string,
	requesterUserId: number | string | null,
	reason?: string
): Promise<void> {
	const waRecipients = await fetchProjectRecipients('supervisor');
	await dispatch(
		'project_requisition_rejected',
		`Requisition Anda ditolak${reason ? `: ${reason}` : ''}.`,
		{ karyawanId: requesterUserId, waRecipients, sourceCollection: 'requisitions', sourceId: requisitionId, actionUrl: `/requisition/${projectId}`, actionRequired: true }
	);
}

/** Submit P2H — kasar (tidak kritis) vs halus (item No-Go kritis, +WA +auto-WO context). */
export async function notifyProjectP2hSubmitted(
	sessionId: number | string,
	equipmentLabel: string,
	operatorId: number | string | null,
	criticalNoGoCount: number
): Promise<void> {
	if (criticalNoGoCount > 0) {
		const waRecipients = await fetchProjectRecipients('supervisor');
		await dispatch(
			'project_p2h_critical',
			`⚠️ P2H ${equipmentLabel}: ${criticalNoGoCount} item kritis No-Go. Unit distop, butuh tindak lanjut segera.`,
			{ karyawanId: operatorId, waRecipients, sourceCollection: 'p2h_session', sourceId: sessionId, actionUrl: `/preventive`, actionRequired: true }
		);
	} else {
		await dispatch('project_p2h_submitted', `P2H ${equipmentLabel} selesai diisi.`, {
			karyawanId: operatorId,
			sourceCollection: 'p2h_session',
			sourceId: sessionId,
			actionUrl: `/preventive`
		});
	}
}

/** Submit adendum timeline dari lapangan (leader) — notif ke admin/PM (department-level, tidak ada FK requester). */
export async function notifyProjectAdendumSubmitted(
	adendumId: number | string,
	projectId: number | string,
	message: string
): Promise<void> {
	await dispatch('project_adendum_submitted', message, {
		sourceCollection: 'project_timeline_adendum',
		sourceId: adendumId,
		actionUrl: `/timeline/${projectId}`,
		actionRequired: true,
		legacyType: 'PROJECT_ADENDUM_SUBMITTED'
	});
}

/** Submit checklist peminjaman alat (opsional, kasar). */
export async function notifyProjectLoanChecklistSubmitted(
	checklistId: number | string,
	operatorId: number | string | null
): Promise<void> {
	await dispatch('project_loan_checklist_submitted', `Checklist peminjaman alat baru diisi.`, {
		karyawanId: operatorId,
		sourceCollection: 'loan_checklist',
		sourceId: checklistId,
		actionUrl: `/preventive`
	});
}

/**
 * Fase 6 Site Check-in v3 — event real-time per check-in/out (in_app saja, lihat catatan
 * di registry.js erp-epi-1). Dipanggil fire-and-forget dari siteCheckin.ts — kegagalan di
 * sini TIDAK PERNAH boleh menggagalkan check-in/out itu sendiri (fail-soft, sama seperti
 * seluruh file ini).
 */
export async function notifyProjectSiteCheckin(
	checkinId: string,
	karyawanId: number | string,
	namaLokasi: string | null
): Promise<void> {
	await dispatch('site_checkin_created', `Site check-in baru di ${namaLokasi || 'proyek'}.`, {
		karyawanId,
		sourceCollection: 'site_checkin',
		sourceId: checkinId
	});
}

export async function notifyProjectSiteCheckout(
	checkinId: string,
	karyawanId: number | string,
	namaLokasi: string | null
): Promise<void> {
	await dispatch('site_checkin_closed', `Site check-out dari ${namaLokasi || 'proyek'}.`, {
		karyawanId,
		sourceCollection: 'site_checkin',
		sourceId: checkinId
	});
}

/**
 * Leader melaporkan kendala jadwal / minta pendamping atas penugasan baru (api/project/delegasi-ack).
 * Bila proyek punya Admin Project (projects.admin_project_id): WA + in-app HANYA ke admin itu (nomor HP diresolusi
 * di erp-epi-1 lewat waKaryawanIds). Bila belum ada, fallback ke semua penerima role admin_project + in-app departemen
 * 'project'. actionUrl mengarah ke tab History Pusat Delegasi. Fail-soft: tidak boleh menggagalkan respons leader.
 */
export async function notifyProjectDelegasiKendala(
	delegationLogId: number | string,
	projectName: string,
	leaderNama: string,
	catatan: string,
	jenis: 'kendala' | 'pendamping' = 'kendala',
	adminKaryawanId: number | string | null = null
): Promise<void> {
	const label = jenis === 'pendamping' ? 'meminta pendamping' : 'melaporkan kendala';
	const common = {
		sourceCollection: 'delegation_log',
		sourceId: delegationLogId,
		actionUrl: '/project/delegasi?tab=history',
		actionRequired: true
	};
	const message = `Leader ${leaderNama} ${label} atas penugasan proyek ${projectName}: ${catatan}`;
	if (adminKaryawanId) {
		await dispatch('project_delegasi_leader_kendala', message, { ...common, waKaryawanIds: [adminKaryawanId], karyawanId: adminKaryawanId });
		return;
	}
	const waRecipients = await fetchProjectRecipients('admin_project');
	await dispatch('project_delegasi_leader_kendala', message, { ...common, waRecipients });
}

/**
 * Alert defisit manpower lapangan — dipanggil saat presensi atau laporan harian menunjukkan defisit tim > batas toleransi.
 * Mengirim relay ke hub notifikasi erp-epi untuk diteruskan ke n8n dan Fonnte WhatsApp ke Supervisor/PM.
 */
export async function notifyProjectManpowerDeficit(
	projectId: number | string,
	projectName: string,
	actual: number,
	plan: number,
	deficitPct: number
): Promise<void> {
	const waRecipients = await fetchProjectRecipients('supervisor');
	const message = `⚠️ Alert Defisit Manpower: Proyek "${projectName}" hanya dihadiri ${actual} dari rencana ${plan} pekerja (Defisit ${deficitPct}%). Mohon tindak lanjut tim site.`;
	await dispatch('project_manpower_deficit_alert', message, {
		waRecipients,
		sourceCollection: 'projects',
		sourceId: projectId,
		actionUrl: `/project?tab=manpower&sub=surat-tugas`,
		actionRequired: true
	});
}

