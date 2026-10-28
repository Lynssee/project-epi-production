import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { submitKasbonManpower } from '$lib/server/ess/manpowerKasbon';
import { mirrorSubmitApprovalRequest } from '$lib/server/approvalMirror';
import { createMasterPengajuanEntry } from '$lib/server/masterPengajuanSubmit';

/** Fase 3 (R1, Q2): Project Leader mengajukan kasbon ATAS NAMA pekerja lapangan (manpower)
 * yang ditugaskan di proyek yang ia pimpin. Submit = endorsement Leader (langsung 'Disetujui
 * Atasan'), lanjut ke Admin Proyek -> Finance di dashboard admin. */
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Payload tidak valid.');

	const manpowerId = Number(body.manpowerId);
	const nominal = Number(body.nominal);
	const tenor = Number(body.tenor);
	const keterangan = String(body.keterangan || '').trim();
	const manpowerNama = String(body.manpowerNama || '').trim();

	if (!manpowerId) throw error(400, 'Pekerja belum dipilih.');
	if (!nominal || nominal <= 0) throw error(400, 'Nominal harus lebih besar dari 0.');
	if (!tenor || tenor <= 0) throw error(400, 'Tenor harus lebih besar dari 0.');
	if (!keterangan) throw error(400, 'Alasan pengajuan wajib diisi.');

	const record = await submitKasbonManpower({
		leaderKaryawanId: karyawan.id,
		leaderNama: karyawan.nama_karyawan || String(karyawan.id),
		manpowerId,
		manpowerNama,
		nominal,
		tenor,
		keterangan
	});

	try {
		// Leader = tahap-1 (sudah otomatis "disetujui" saat submit) -> mirror langsung dibuat
		// sebagai pending TAHAP-2 (Admin Proyek), bukan pending tahap-1 seperti kasbon karyawan.
		await mirrorSubmitApprovalRequest({
			moduleKey: 'project.kasbon_manpower',
			sourceCollection: 'kasbon',
			sourceId: record.id,
			title: `Kasbon Lapangan — ${manpowerNama}`,
			summary: keterangan,
			amount: nominal,
			requesterId: karyawan.id
		});
	} catch (e) {
		console.warn('[approvalMirror] gagal mendaftarkan kasbon manpower ke Inbox terpusat:', e);
	}

	createMasterPengajuanEntry({
		kategori: 'proyek',
		jenisPengajuan: 'PJM',
		judul: `Kasbon Lapangan — ${manpowerNama}`,
		deskripsi: keterangan || null,
		totalAmount: nominal,
		pengajuId: karyawan.id,
		detailRefCollection: 'kasbon',
		detailRefId: record.id,
		sourceApp: 'field'
	}).catch((e: any) => console.warn('[masterPengajuanSubmit] gagal katalog PJM-manpower (diabaikan):', e?.message));

	return json({ record });
};
