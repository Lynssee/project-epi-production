// src/routes/api/kiosk/gerbang-sj/lookup/+server.ts
// GSP-01 §4.4 — PEMBUNGKUS TIPIS masa transisi. Logika (cari QR/nomor, detail, aturan, blocker) ada di
// lib/server/gerbangSj. Bentuk respons lama dipertahankan. Tidak ada layar yang memakainya lagi;
// hapus setelah GSP-11 lulus di produksi (GSP-01 §4.5).

import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveGateActor, toKitError } from '$lib/server/gerbangSj/actor';
import { findIdByCodeOrNomor, getDetail } from '$lib/server/gerbangSj/query';

export const POST: RequestHandler = async (event) => {
	await resolveGateActor(event).catch(toKitError);
	const body = await event.request.json().catch(() => null);
	const d = await findIdByCodeOrNomor({ code: body?.code, nomor: body?.nomor })
		.then((id) => getDetail(id))
		.catch(toKitError);

	return json({
		sj: {
			id: d.sj.id,
			nomor_sj: d.sj.nomor_sj,
			status: d.sj.status,
			track_stage: d.sj.track_stage,
			driver: d.sj.driver,
			vehicle_id: d.sj.vehicle_id,
			plat: d.sj.plat,
			kendaraan: null,
			driver_nama: d.sj.driver,
			print_count: d.sj.print_count,
			foto_kirim: d.sj.foto_kirim,
			items: d.items.map((it) => ({ id: it.id, nama_barang: it.nama_barang, qty: it.qty, unit: it.unit, koli: it.koli })),
			total_koli: d.sj.koli_acuan,
			tujuan: d.sj.tujuan
		},
		already_passed: d.already_passed,
		rangkap: d.rangkap,
		can_pass: d.can_pass,
		// bentuk lama: { code, message, who }
		blockers: d.blockers.map((b) => ({ code: b.kode, message: b.pesan, who: b.siapa })),
		warnings: d.warnings.map((w) => w.pesan)
	});
};
