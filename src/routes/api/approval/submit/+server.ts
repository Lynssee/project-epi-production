// src/routes/api/approval/submit/+server.ts
// Terbitkan approval_requests baru dari dashboard lapangan (project-epi).
// requester_id diambil dari identitas Firebase yang login (bukan dari body)
// agar tidak bisa dipalsukan. Lihat src/lib/server/approvalSubmit.ts.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid, createApprovalRequest } from '$lib/server/approvalSubmit';
import { createMasterPengajuanEntry } from '$lib/server/masterPengajuanSubmit';

// Modul yang BELUM punya hook di titik submit aslinya (CTI/LMB/RMB/PJM/PKL/PR sudah).
const MODULE_JENIS_MAP: Record<string, { jenis: string; kategori: string }> = {
  'laporan.harian':           { jenis: 'LH',   kategori: 'proyek' },
  'resource.spk':             { jenis: 'SPK',  kategori: 'proyek' },
  'resource.spk.eskalasi':    { jenis: 'SPK',  kategori: 'proyek' },
  'project_ncr':              { jenis: 'NCR',  kategori: 'proyek' },
  'sji':                      { jenis: 'SJI',  kategori: 'logistik' },
  'shift_swap':               { jenis: 'SHIFT',kategori: 'hrd' },
  'hrd.izin_sakit':           { jenis: 'ISK',  kategori: 'hrd' },
  'izin_jam':                 { jenis: 'IJM',  kategori: 'hrd' },
  'ga.request':               { jenis: 'GA',   kategori: 'ga' },
  'hrd.ga.checklist':         { jenis: 'GA',   kategori: 'ga' },
  'logistik.surat_jalan_manual': { jenis: 'SJM', kategori: 'logistik' },
  'rental_order.external':    { jenis: 'RNT',  kategori: 'logistik' },
};

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);

	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}

	const body = await event.request.json().catch(() => ({}));
	const { moduleKey, sourceCollection, sourceId, title, summary, amount, departmentKey, callbackUrl, payload } = body;

	if (!moduleKey || !sourceCollection || !sourceId) {
		throw error(400, 'moduleKey, sourceCollection, dan sourceId wajib diisi');
	}

	try {
		const created = await createApprovalRequest({
			moduleKey,
			sourceCollection,
			sourceId,
			title,
			summary,
			amount,
			departmentKey: departmentKey || karyawan.divisi,
			requesterId: karyawan.id,
			callbackUrl,
			payload
		});

		// Katalog master_pengajuan best-effort
		const jenisInfo = MODULE_JENIS_MAP[moduleKey];
		if (jenisInfo) {
			createMasterPengajuanEntry({
				kategori: jenisInfo.kategori,
				jenisPengajuan: jenisInfo.jenis,
				judul: title || `${moduleKey} #${sourceId}`,
				deskripsi: summary || null,
				totalAmount: amount || 0,
				pengajuId: karyawan.id,
				departmentKey: departmentKey || karyawan.divisi || null,
				detailRefCollection: sourceCollection,
				detailRefId: String(sourceId),
				approvalRequestId: (created as any)?.id || null,
				sourceApp: 'field',
				clientTxnId: `${moduleKey}:${sourceCollection}:${sourceId}`,
			}).catch((e: any) => console.warn('[approval/submit] katalog gagal (diabaikan):', e?.message));
		}

		return json({ success: true, data: created });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal membuat permintaan approval');
	}
}

export async function GET() {
	throw error(405, 'Gunakan POST');
}
