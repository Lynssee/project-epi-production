// src/routes/api/equipment/handover/+server.ts
// Alih pakai darurat: pengguna yang TIDAK terdaftar pada booking aktif melanjutkan memakai kendaraan dengan alasan tertulis
// (gate G_FLT_DRIVER_LOCK mode soft/warn; mode hard hanya untuk pemegang permission penembus).
// Fase 2: HANYA mencatat keputusan sebagai jejak audit di scan_log (EQUIPMENT_VERIFY|handover|...|reason=...). Booking TIDAK
// diubah (penugasan ulang driver tetap lewat Booking Armada oleh GA). Pemegang booking (driver + pemohon) dikabari WA segera
// (fire-and-forget); koordinator armada/GA dikabari lewat alert terjadwal erp-epi (fleet-scheduled-checks?type=scan_alert).
// Seluruh keputusan dihitung ULANG di server — klien tidak bisa mengaku "diizinkan".

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { decideOverride, isReasonValid, normalizeReason, sanitizeGps } from '$lib/server/equipmentVerifyCore';
import { hasOverridePermission } from '$lib/server/equipmentVerifyAuth';
import { notifyFleetHandover } from '$lib/server/projectNotify';
import { findEquipmentByCode, findVehicleByEquipment, loadVerifySettings, logHandover, verifyVehicle } from '$lib/server/equipmentVerify';

export async function POST(event: RequestEvent) {
	const { user, karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => ({}));
	const code = String(body?.code || '').trim();
	if (!code) throw error(400, 'Kode equipment wajib diisi.');

	const equipment = await findEquipmentByCode(code).catch((e) => {
		console.error('[api/equipment/handover] gagal baca equipment:', e instanceof Error ? e.message : e);
		throw error(502, 'Gagal membaca data equipment. Coba lagi.');
	});
	if (!equipment) throw error(404, `Equipment dengan kode "${code}" tidak ditemukan.`);
	const vehicle = await findVehicleByEquipment(equipment.id).catch(() => null);
	if (!vehicle) throw error(400, 'Unit ini bukan kendaraan armada — alih pakai tidak berlaku.');

	const karyawanId = String(karyawan.id);
	const result = await verifyVehicle(equipment, vehicle, karyawanId);
	const v = result.verification;
	if (v.decision !== 'denied' || v.mode === 'shadow') {
		// Tidak ada penolakan yang perlu dikecualikan (mis. booking berubah sejak scan). Bukan error — klien cukup lanjut.
		return json({ ok: true, recorded: false, message: 'Tidak ada penolakan yang perlu dikecualikan untuk unit ini.' });
	}

	const settings = await loadVerifySettings();
	const hasPerm = v.mode === 'hard' ? await hasOverridePermission(event, user, settings) : false;
	const rule = decideOverride(v.mode, hasPerm, settings.handoverReasonMin);
	if (!rule.allowed) {
		throw error(403, 'Unit ini dikunci untuk pengemudi terdaftar. Hubungi koordinator armada/GA untuk penugasan ulang.');
	}
	const reason = normalizeReason(body?.reason);
	if (!isReasonValid(reason, rule.reasonMin)) {
		throw error(400, `Alasan alih pakai minimal ${rule.reasonMin} karakter.`);
	}

	try {
		await logHandover(
			{
				equipmentId: equipment.id,
				karyawanId,
				gateKey: v.gateKey,
				mode: v.mode,
				bookingCode: result.booking?.kode_booking ?? null,
				gps: sanitizeGps(body?.gps),
				clientEventId: typeof body?.clientEventId === 'string' ? body.clientEventId : null
			},
			reason
		);
	} catch (e) {
		console.error('[api/equipment/handover] gagal menulis jejak alih pakai:', e instanceof Error ? e.message : e);
		throw error(502, 'Alih pakai belum tercatat karena gangguan sistem. Coba lagi — jangan melanjutkan sebelum berhasil.');
	}
	// Kabari pemegang booking (driver + pemohon), kecuali pelaku sendiri. Tidak ditunggu & tidak boleh menggagalkan alih pakai.
	const holders = [result.holder?.karyawanId, result.booking?.karyawan_id].filter((x): x is string => !!x && String(x) !== karyawanId);
	void notifyFleetHandover({
		holderKaryawanIds: holders,
		actorName: karyawan.nama_karyawan || `Karyawan #${karyawanId}`,
		unitLabel: `${vehicle.nomor_polisi} ${vehicle.merk} ${vehicle.model}`.trim(),
		bookingCode: result.booking?.kode_booking ?? null,
		reason
	}).catch((e) => console.error('[api/equipment/handover] gagal mengabari pemegang booking:', e instanceof Error ? e.message : e));
	return json({ ok: true, recorded: true });
}
