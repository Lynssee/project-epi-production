import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { assertKasbonEligible } from '$lib/server/ess/kasbon';
import { mirrorSubmitApprovalRequest } from '$lib/server/approvalMirror';
import { createMasterPengajuanEntry } from '$lib/server/masterPengajuanSubmit';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	const nominal = Number(body?.nominal);
	const tenor = Number(body?.tenor);
	const keterangan = body?.keterangan ? String(body.keterangan).trim() : '';

	if (!Number.isFinite(nominal) || nominal <= 0) throw error(400, 'Nominal kasbon tidak valid.');
	if (!Number.isFinite(tenor) || tenor <= 0) throw error(400, 'Tenor tidak valid.');
	if (!keterangan) throw error(400, 'Alasan pengajuan wajib diisi.');

	// Validasi server (S2) — bukan hanya UI: plafon, tenor maks, maks 1 kasbon aktif.
	const eligible = await assertKasbonEligible(karyawan.id, nominal, tenor);
	if (!eligible.ok) throw error(400, eligible.message);

	const payload = {
		karyawan_id: karyawan.id,
		nama: karyawan.nama_karyawan,
		divisi: karyawan.divisi,
		nominal,
		tenor,
		keterangan,
		status: 'Diajukan',
		tanggal_pengajuan: new Date().toISOString(),
		total_paid: 0,
		payment_status: 'pending'
	};

	const result = await directusServerJson('/items/kasbon', {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	const recordId = result?.data?.id ?? result?.id;
	try {
		await mirrorSubmitApprovalRequest({
			moduleKey: 'hrd.kasbon',
			sourceCollection: 'kasbon',
			sourceId: recordId,
			title: `Kasbon — ${karyawan.nama_karyawan}`,
			summary: keterangan || null,
			amount: nominal,
			departmentKey: karyawan.divisi,
			requesterId: karyawan.id
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mendaftarkan kasbon ke Inbox terpusat:', e);
	}

	createMasterPengajuanEntry({
		kategori: 'hrd',
		jenisPengajuan: 'PJM',
		judul: `Kasbon — ${karyawan.nama_karyawan}`,
		deskripsi: keterangan || null,
		totalAmount: nominal,
		pengajuId: karyawan.id,
		departmentKey: karyawan.divisi,
		detailRefCollection: 'kasbon',
		detailRefId: recordId,
		sourceApp: 'field'
	}).catch((e: any) => console.warn('[masterPengajuanSubmit] gagal katalog PJM (diabaikan):', e?.message));

	return json({ record: result?.data ?? result });
};
