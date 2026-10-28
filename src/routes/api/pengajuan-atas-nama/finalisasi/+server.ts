// src/routes/api/pengajuan-atas-nama/finalisasi/+server.ts
// PA atas nama dari lapangan dibuat di KLIEN (Directus SDK), jadi otorisasi ditegakkan DI SINI sebelum
// pemohon diberi tahu: pengisi harus Leader/Wakil proyek / Supervisor berizin, pemohon anggota aktif
// proyek. Bila tidak sah, PA otomatis dibatalkan (tidak pernah sampai ke pemohon/approval).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { authorizeAtasNama } from '$lib/server/pengajuanAtasNama';
import { notifyPemohonViaAdmin } from '$lib/server/atasNamaNotify';

const STATUS_MENUNGGU = 'Menunggu Konfirmasi Pemohon';
const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

export const POST: RequestHandler = async (event) => {
	const user: any = await requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const pengajuanId = Number(body?.pengajuanId);
	if (!Number.isFinite(pengajuanId) || pengajuanId <= 0) throw error(400, 'pengajuanId wajib diisi');

	const rec: any = (await directusServerJson(
		`/items/pengajuan_anggaran/${pengajuanId}?fields=id,status,is_on_behalf,pemohon_status,pengaju_id,pengisi_karyawan_id,project_id`
	).catch(() => null))?.data;
	if (!rec?.id || !rec.is_on_behalf) throw error(404, 'Pengajuan atas nama tidak ditemukan');
	if (rec.status !== STATUS_MENUNGGU || rec.pemohon_status !== 'menunggu') {
		return json({ success: true, skipped: 'tidak menunggu konfirmasi' });
	}

	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const auth = await authorizeAtasNama({
		idToken,
		uid: user.uid || user.localId,
		email: user.email,
		projectId: Number(idOf(rec.project_id)),
		pemohonKaryawanId: Number(idOf(rec.pengaju_id))
	});
	const pengisiSesuai = auth.pengisi && String(auth.pengisi.id) === String(idOf(rec.pengisi_karyawan_id));
	if (!auth.ok || !pengisiSesuai) {
		const alasan = !auth.ok ? (auth as any).message : 'Penginput tidak sesuai dengan akun yang login.';
		await directusServerJson(`/items/pengajuan_anggaran/${rec.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'Dibatalkan', pemohon_status: 'ditolak', pemohon_reject_reason: `Dibatalkan sistem: ${alasan}` })
		}).catch((e: any) => console.error('[finalisasi] gagal membatalkan PA atas nama tidak sah:', e?.message));
		throw error(403, alasan);
	}

	const notified = await notifyPemohonViaAdmin(event, 'anggaran', rec.id);
	return json({ success: true, notified });
};
