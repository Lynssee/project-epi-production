// src/routes/api/fleet-booking/availability/+server.ts
// Kalender Ketersediaan Kendaraan (Fase 1, §9.1.3) — satu endpoint, dipakai form
// pengajuan lapangan (peminjam lihat bentrok sebelum submit) dan modal approve
// tahap 2 admin (GA/HRD cek bentrok lintas seluruh departemen).
// Menggabungkan 4 sumber keterpakaian (mematuhi aturan Directus fetching terpisah per relasi).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	await requireUser(event);

	const from = event.url.searchParams.get('from');
	const to = event.url.searchParams.get('to');
	const vehicleIdParam = event.url.searchParams.get('vehicle_id');
	if (!from || !to) throw error(400, 'Parameter from & to (ISO date) wajib diisi.');

	const fromTime = new Date(from).getTime();
	const toTime = new Date(to).getTime();
	if (Number.isNaN(fromTime) || Number.isNaN(toTime)) throw error(400, 'Format tanggal from/to tidak valid.');

	const vehicleIdFilterPart = vehicleIdParam ? { vehicle_id: { _eq: Number(vehicleIdParam) } } : {};
	const idFilterPart = vehicleIdParam ? { id: { _eq: Number(vehicleIdParam) } } : {};

	// 1. fleet_bookings — status disetujui/aktif, beririsan dengan rentang from-to
	const bookingsFilter = encodeURIComponent(
		JSON.stringify({
			_and: [
				{ status: { _in: ['disetujui', 'aktif'] } },
				vehicleIdFilterPart,
				{ tanggal_mulai: { _lte: to } },
				{ _or: [{ tanggal_selesai_rencana: { _gte: from } }, { tanggal_selesai_rencana: { _null: true } }] }
			]
		})
	);
	const bookingsRes = await directusServerJson<{ data: any[] }>(
		`/items/fleet_bookings?filter=${bookingsFilter}&fields=id,kode_booking,vehicle_id,requester_name,requester_dept,tanggal_mulai,tanggal_selesai_rencana&limit=-1`
	).catch(() => ({ data: [] }));

	// 2. fleet_trip_log — status active (delegasi Surat Jalan termasuk)
	const tripFilter = encodeURIComponent(
		JSON.stringify({ _and: [{ status: { _eq: 'active' } }, vehicleIdFilterPart] })
	);
	const tripsRes = await directusServerJson<{ data: any[] }>(
		`/items/fleet_trip_log?filter=${tripFilter}&fields=id,vehicle_id,tujuan,waktu_mulai,booking_id,jenis&limit=-1`
	).catch(() => ({ data: [] }));

	// 3. fleet_kendaraan — semua unit dalam cakupan, untuk cek status Perawatan/Tidak Aktif
	//    sekaligus daftar kode_aset untuk cross-check identitas_barang.kondisi=SERVICE (sumber 4)
	const allVehiclesFilter = encodeURIComponent(JSON.stringify(idFilterPart));
	const allVehiclesRes = await directusServerJson<{ data: any[] }>(
		`/items/fleet_kendaraan?filter=${allVehiclesFilter}&fields=id,merk,model,nomor_polisi,status,kode_aset&limit=-1`
	).catch(() => ({ data: [] }));
	const allVehicles = allVehiclesRes.data || [];

	// 4. identitas_barang — kondisi SERVICE, dijodohkan via kode_aset <-> id_equipment (mencegah BUG-11 berulang)
	const kodeAsetList = [...new Set(allVehicles.map((v) => v.kode_aset).filter(Boolean))];
	let serviceKodeAset = new Set<string>();
	if (kodeAsetList.length > 0) {
		const ibFilter = encodeURIComponent(
			JSON.stringify({ id_equipment: { _in: kodeAsetList }, kondisi: { _eq: 'SERVICE' } })
		);
		const ibRes = await directusServerJson<{ data: any[] }>(
			`/items/identitas_barang?filter=${ibFilter}&fields=id_equipment&limit=-1`
		).catch(() => ({ data: [] }));
		serviceKodeAset = new Set((ibRes.data || []).map((r) => r.id_equipment));
	}

	const blocks: Array<{
		vehicle_id: number;
		source: 'booking' | 'trip' | 'maintenance' | 'service';
		label: string;
		start: string | null;
		end: string | null;
	}> = [];

	for (const b of bookingsRes.data || []) {
		blocks.push({
			vehicle_id: b.vehicle_id,
			source: 'booking',
			label: `${b.kode_booking} — ${b.requester_name || ''} (${b.requester_dept || ''})`,
			start: b.tanggal_mulai,
			end: b.tanggal_selesai_rencana
		});
	}
	// Peminjaman 12 §4: trip peminjaman yang booking-nya SUDAH muncul sebagai blok `booking` dilewati (dulu tampil dua kali),
	// dan label "(Surat Jalan)" hanya untuk trip jenis `pengiriman` (dulu semua trip ber-booking_id).
	const bookingIdSudahAda = new Set((bookingsRes.data || []).map((b: any) => String(b.id)));
	for (const t of tripsRes.data || []) {
		if (t.jenis === 'peminjaman' && t.booking_id && bookingIdSudahAda.has(String(t.booking_id))) continue;
		blocks.push({
			vehicle_id: Number(t.vehicle_id),
			source: 'trip',
			label: `Sedang jalan: ${t.tujuan || '-'}${t.jenis === 'pengiriman' ? ' (Surat Jalan)' : ''}`,
			start: t.waktu_mulai,
			end: null
		});
	}
	for (const v of allVehicles) {
		if (['Perawatan', 'Tidak Aktif'].includes(v.status)) {
			blocks.push({
				vehicle_id: v.id,
				source: 'maintenance',
				label: `${v.status}: ${[v.merk, v.model].filter(Boolean).join(' ')} (${v.nomor_polisi})`,
				start: null,
				end: null
			});
		} else if (v.kode_aset && serviceKodeAset.has(v.kode_aset)) {
			blocks.push({
				vehicle_id: v.id,
				source: 'service',
				label: 'Sedang di bengkel (data Inventory, status Fleet belum disamakan)',
				start: null,
				end: null
			});
		}
	}

	return json({ from, to, blocks });
};
