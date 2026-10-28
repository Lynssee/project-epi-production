// src/routes/api/fleet-booking/settlement-setor/+server.ts
// ESS Redesign Fase 3 — peminjam mengunggah bukti setor balik sisa uang muka (selisih > 0).
// Tidak menutup settlement — Finance memverifikasi bukti & menandai CLOSED di board.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { isBookingOwner, pesanTolakTulis } from '$lib/server/fleetBookingOwner';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { notifyCashAdvanceSetorUploaded } from '$lib/server/fleetNotify';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const bookingId = String(form.get('booking_id') || '');
	const foto = form.get('foto');
	if (!bookingId) throw error(400, 'Booking ID wajib diisi.');
	if (!(foto instanceof File) || foto.size === 0) throw error(400, 'Bukti transfer/setor wajib diunggah.');

	const bRes = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${bookingId}`).catch(() => null);
	const booking = bRes?.data;
	if (!booking) throw error(404, 'Data peminjaman tidak ditemukan.');

	if (!isBookingOwner(booking, karyawan)) throw error(403, pesanTolakTulis(booking)); // Peminjaman 12 §1
	if (booking.settlement_status !== 'menunggu_setor_balik') {
		throw error(409, `Settlement peminjaman ini berstatus "${booking.settlement_status || 'none'}" — tidak menunggu setor balik.`);
	}

	const uploadForm = new FormData();
	uploadForm.append('file', foto);
	const upRes = await directusServerUpload(uploadForm);
	if (!upRes.ok) throw error(502, 'Gagal mengunggah bukti.');
	const fileId = (await upRes.json())?.data?.id ?? null;
	if (!fileId) throw error(502, 'Gagal mengunggah bukti.');

	const updated = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${bookingId}`, {
		method: 'PATCH',
		body: JSON.stringify({ settlement_bukti_setor_balik_file: fileId })
	});

	await notifyCashAdvanceSetorUploaded({
		kodeBooking: booking.kode_booking,
		karyawanNama: karyawan.nama_karyawan,
		selisih: Number(booking.settlement_selisih || 0)
	});

	return json({ success: true, booking: updated?.data ?? null });
};
