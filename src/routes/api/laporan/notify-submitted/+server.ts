// src/routes/api/laporan/notify-submitted/+server.ts
// Submit laporan harian (reports) masih murni client-side via Directus SDK
// (src/lib/services/reports.ts::submitReport) — endpoint tipis ini HANYA memicu
// relay notifikasi (projectNotify.ts) setelah client berhasil createItem, karena
// AUTOMATION_SERVER_SECRET cuma boleh dipegang server. Fail-soft: gagal di sini
// tidak pernah menggagalkan laporan yang sudah tersimpan (client memanggilnya
// fire-and-forget, lihat +page.svelte).
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { notifyProjectReportSubmitted, notifyProjectReportVendorProgress, notifyProjectManpowerDeficit, notifyProjectClientInstructionVo } from '$lib/server/projectNotify';
import { createMasterPengajuanEntry } from '$lib/server/masterPengajuanSubmit';
import { createUrgentPackingFromReport } from '$lib/server/reportUrgentPacking';
import { resolveFieldOverrideAllowed } from '$lib/server/gates/plFieldOverride';

export const POST: RequestHandler = async (event) => {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) throw error(403, 'Akun Anda belum terhubung ke data karyawan.');

	const body = await event.request.json().catch(() => ({}));
	const reportId = body?.reportId;
	const projectId = body?.projectId;
	const projectName = body?.projectName ? String(body.projectName) : 'proyek';
	const vendorNames: string[] = Array.isArray(body?.vendorNames) ? body.vendorNames.filter((v: any) => typeof v === 'string' && v) : [];
	const clientInstructionVoPengawas: string = typeof body?.clientInstructionVoPengawas === 'string' ? body.clientInstructionVoPengawas : '';
	if (!projectId) throw error(400, 'projectId wajib diisi.');

	if (reportId) {
		await notifyProjectReportSubmitted(reportId, projectId, projectName);
	}

	// Alert defisit manpower lapangan jika terdeteksi defisit tenaga kerja
	const actual = Number(body?.headcountActual);
	const plan = Number(body?.headcountPlan);
	if (plan > 0 && actual >= 0) {
		const deficitPct = Math.round(((plan - actual) / plan) * 100);
		if (deficitPct > 20) {
			notifyProjectManpowerDeficit(projectId, projectName, actual, plan, deficitPct).catch((e) =>
				console.warn('[laporan/notify-submitted] notifyProjectManpowerDeficit gagal (diabaikan):', e?.message)
			);
		}
	}

	// Executor Partitioning Fase 5 — notifikasi tambahan ke PM kalau ada progres vendor di
	// laporan ini. Fail-soft & fire-and-forget sama seperti notifyProjectReportSubmitted di atas.
	if (reportId && vendorNames.length > 0) {
		notifyProjectReportVendorProgress(reportId, projectId, projectName, vendorNames).catch((e) =>
			console.warn('[laporan/notify-submitted] notifyProjectReportVendorProgress gagal (diabaikan):', e?.message)
		);
	}

	// Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — instruksi klien berpotensi VO.
	if (clientInstructionVoPengawas && reportId) {
		notifyProjectClientInstructionVo(reportId, projectId, projectName, clientInstructionVoPengawas).catch((e) =>
			console.warn('[laporan/notify-submitted] notifyProjectClientInstructionVo gagal (diabaikan):', e?.message)
		);
	}

	// Katalog master_pengajuan best-effort & Urgent packing (hanya jika ada reportId)
	let packing: any = { created: 0 };
	if (reportId) {
		createMasterPengajuanEntry({
			kategori: 'proyek',
			jenisPengajuan: 'LH',
			judul: `Laporan Harian ${projectName}`,
			deskripsi: null,
			totalAmount: 0,
			pengajuId: karyawan.id,
			departmentKey: (karyawan as any).divisi || null,
			projectId: String(projectId),
			detailRefCollection: 'reports',
			detailRefId: String(reportId),
			approvalRequestId: null,
			sourceApp: 'field',
			clientTxnId: `LH:reports:${reportId}`,
		}).catch((e: any) => console.warn('[laporan/notify-submitted] katalog gagal (diabaikan):', e?.message));

		try {
			packing = await createUrgentPackingFromReport(reportId, {
				karyawanId: karyawan.id,
				nama: (karyawan as any).nama_karyawan,
				divisi: (karyawan as any).divisi,
				firebaseUid: fbUser.localId,
				overrideAllowed: await resolveFieldOverrideAllowed(event)
			});
		} catch (e: any) {
			console.warn('[laporan/notify-submitted] pengajuan urgent gagal (diabaikan):', e?.message);
			packing = { created: 0, error: 'internal' };
		}
	}

	return json({ sent: true, packing });
};
