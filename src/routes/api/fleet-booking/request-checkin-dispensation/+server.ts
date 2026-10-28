// src/routes/api/fleet-booking/request-checkin-dispensation/+server.ts
// Fase 3 G7 — peminjam menekan "Minta Dispensasi GA" di layar penolakan checklist "setelah"
// karena check-in gagal / terlewat. Endpoint ini HANYA memberi tahu GA (WA) — GA yang
// memutuskan & memberi dispensasi dari dashboard admin (dispenseCheckinBooking). Tidak
// mengubah status booking.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { notifyCheckinDispensationRequested } from '$lib/server/fleetNotify';
import { isBookingOwner, pesanTolakTulis } from '$lib/server/fleetBookingOwner';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const body = await event.request.json().catch(() => null);
	const bookingId = String(body?.bookingId || '');
	const alasan = String(body?.alasan || '').trim();
	if (!bookingId) throw error(400, 'bookingId wajib diisi.');
	if (alasan.length < 10) throw error(400, 'Jelaskan singkat kenapa check-in tidak dilakukan (min. 10 karakter).');

	const bRes = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${bookingId}`).catch(() => null);
	const booking = bRes?.data ?? bRes;
	if (!booking) throw error(404, 'Data peminjaman tidak ditemukan.');
	if (!isBookingOwner(booking, karyawan)) throw error(403, pesanTolakTulis(booking)); // Peminjaman 12 §1

	// Peminjaman 09 §3.6 — permintaan TERCATAT di booking SEBELUM WA dikirim (badge "Minta dispensasi" di board ERP).
	// Bila kolom skema belum ada (scripts/fleet-dispensasi-schema.mjs) → dilog keras, WA tetap dikirim.
	let tercatat = true;
	try {
		await directusServerJson(`/items/fleet_bookings/${bookingId}`, {
			method: 'PATCH',
			body: JSON.stringify({ dispensasi_diminta_at: new Date().toISOString(), dispensasi_diminta_alasan: alasan })
		});
	} catch (e) {
		tercatat = false;
		console.error('[request-checkin-dispensation] gagal mencatat permintaan di fleet_bookings (skema dispensasi_diminta_* sudah dibuat?):', e);
	}

	const waTerkirim = await notifyCheckinDispensationRequested({
		kodeBooking: booking.kode_booking,
		karyawanNama: karyawan.nama_karyawan,
		tujuan: booking.tujuan || '-',
		alasan
	});

	return json({ ok: true, tercatat, wa_terkirim: waTerkirim });
};
