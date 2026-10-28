// src/routes/api/fleet-booking/[id]/+server.ts
// Operasi detail & pembatalan peminjaman kendaraan oleh pemohon

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { requestFleetCancelCascade } from '$lib/server/fleetNotify';
import { isBookingOwner, isBookingOwnerForRead, pesanTolakTulis, PESAN_BUKAN_PEMILIK } from '$lib/server/fleetBookingOwner';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const id = event.params.id;
	if (!id) throw error(400, 'ID booking tidak valid.');

	const bookingRes = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${id}`).catch(() => null);
	const booking = bookingRes?.data ?? bookingRes;
	if (!booking) throw error(404, 'Data peminjaman tidak ditemukan.');

	// Cek kepemilikan
	// Baca: fallback nama HANYA untuk baris lama tanpa karyawan_id (Peminjaman 12 §1).
	if (!isBookingOwnerForRead(booking, karyawan)) {
		throw error(403, PESAN_BUKAN_PEMILIK);
	}

	// Fetch Separate Relations: fleet_kendaraan
	let vehicle = null;
	if (booking.vehicle_id) {
		try {
			const vRes = await directusServerJson<{ data: any }>(
				`/items/fleet_kendaraan/${booking.vehicle_id}?fields=id,merk,model,nomor_polisi,jenis,kapasitas_penumpang,fuel_type,location_id,status,km_terakhir`
			);
			const v = vRes?.data ?? vRes;
			if (v) {
				let lokasiNama = 'Pool Utama';
				if (v.location_id) {
					try {
						const locRes = await directusServerJson<{ data: any }>(
							`/items/location/${v.location_id}?fields=id,name`
						);
						lokasiNama = (locRes?.data ?? locRes)?.name || lokasiNama;
					} catch (e) {
						console.error('Error fetching separate location relation:', e);
					}
				}
				vehicle = {
					...v,
					name: [v.merk, v.model].filter(Boolean).join(' ') || v.nomor_polisi,
					kapasitas: v.kapasitas_penumpang || 5,
					bahan_bakar: v.fuel_type || 'Belum diisi',
					lokasi: lokasiNama,
					odometer: v.km_terakhir || 0
				};
			}
		} catch (e) {
			console.error('Error fetching separate fleet_kendaraan:', e);
		}
	}

	// Fetch Separate Relations: fleet_drivers
	let driver = null;
	if (booking.driver_id) {
		try {
			const dRes = await directusServerJson<{ data: any }>(
				`/items/fleet_drivers/${booking.driver_id}?fields=id,nama,no_telepon,status`
			);
			driver = dRes?.data ?? dRes;
		} catch (e) {
			console.error('Error fetching separate fleet_drivers:', e);
		}
	}

	return json({
		data: {
			...booking,
			vehicle,
			driver
		}
	});
};

export const PATCH: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const id = event.params.id;
	if (!id) throw error(400, 'ID booking tidak valid.');

	const bookingRes = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${id}`).catch(() => null);
	const booking = bookingRes?.data ?? bookingRes;
	if (!booking) throw error(404, 'Data peminjaman tidak ditemukan.');

	// Tulis (batal): WAJIB karyawan_id (Peminjaman 12 §1) — karyawan bernama sama tidak boleh membatalkan booking orang lain.
	if (!isBookingOwner(booking, karyawan)) {
		throw error(403, pesanTolakTulis(booking));
	}

	const body = await event.request.json().catch(() => ({}));
	const action = body?.action || 'cancel';
	const reason = (body?.reason || '').trim();

	if (action === 'cancel') {
		if (['selesai', 'dibatalkan', 'ditolak'].includes(booking.status)) {
			throw error(400, `Peminjaman dengan status "${booking.status}" tidak dapat dibatalkan.`);
		}
		if (booking.status === 'aktif') {
			throw error(400, 'Kendaraan sedang dalam perjalanan aktif. Harap lakukan proses pengembalian via Admin GA / Driver.');
		}

		// Peminjaman 10 §2.4 — pembatalan tuntas dikerjakan ERP (approval_requests, PCR uang muka, WA approver/GA/sopir).
		const cascade = await requestFleetCancelCascade({ bookingId: id, alasan: reason, actorNama: karyawan.nama_karyawan });
		if (cascade.ok) {
			const fresh = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${id}`).catch((e) => {
				console.error('[fleet-booking/cancel] gagal membaca booking setelah cascade:', e);
				return null;
			});
			return json({ success: true, cascade: true, data: fresh?.data ?? { ...booking, status: 'dibatalkan' } });
		}
		if (cascade.definitive) throw error(400, cascade.message);

		// ERP tidak terjangkau: booking TETAP dibatalkan lokal (jangan tahan peminjam), ditandai agar disapu rekonsiliasi.
		const cancelNote = reason
			? `[Dibatalkan oleh Pemohon: ${reason}] [CASCADE_GAGAL] ${booking.catatan || ''}`
			: `[Dibatalkan oleh Pemohon] [CASCADE_GAGAL] ${booking.catatan || ''}`;

		const updated = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({
				status: 'dibatalkan',
				catatan: cancelNote.trim()
			})
		});

		return json({
			success: true,
			cascade: false,
			data: updated?.data ?? updated
		});
	}

	throw error(400, 'Aksi tidak dikenali.');
};
