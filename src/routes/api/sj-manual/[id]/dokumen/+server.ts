// src/routes/api/sj-manual/[id]/dokumen/+server.ts
// e-Surat Jalan (QR) untuk SJ Manual milik pemohon yang login. Hanya tersedia
// setelah approval_status='disetujui' — SJ yang masih menunggu/ditolak belum
// boleh dipakai untuk dispatch fisik. Format payload SAMA PERSIS dengan yang
// dibaca /api/scan/resolve (parseEpiQr type 'SJ'): EPI:SJ:<id>:<qr_token>,
// qr_token dibandingkan APA ADANYA (bukan hash) — lihat catatan di scanResolve.ts.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { SJ_MANUAL_TYPE, toLegacyHeader } from '$lib/server/sjManualFields';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const res = await directusServerJson<{ data: any }>(
		`/items/surat_jalan/${event.params.id}?fields=id,nomor_sj,qr_token,approval_status,requested_by,notes,type`
	).catch(() => null);
	const sj = res?.data;
	if (!sj || sj.type !== SJ_MANUAL_TYPE || sj.requested_by !== karyawan.id) throw error(404, 'SJ Manual tidak ditemukan');

	if (sj.approval_status !== 'disetujui' || !sj.qr_token) {
		return json({ available: false, status: sj.approval_status, reference_no: sj.nomor_sj });
	}

	return json({
		available: true,
		reference_no: sj.nomor_sj,
		customerName: toLegacyHeader(sj).manual_customer_name,
		qrPayload: `EPI:SJ:${sj.id}:${sj.qr_token}`
	});
};
