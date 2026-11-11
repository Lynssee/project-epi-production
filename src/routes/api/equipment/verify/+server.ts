// src/routes/api/equipment/verify/+server.ts
// Resolver terpadu scan EPI:EQUIPMENT:<kode> -> "siapa pemegang sah unit ini & apakah saya berhak".
//   - Kendaraan perusahaan (fleet_kendaraan): gate G_FLT_DRIVER_LOCK terhadap booking aktif.
//   - Alat kerja/kompresor: kartu peminjam resmi + gate G_P2H_BORROWER_VERIFY (tidak pernah memblokir P2H).
// Kode dikirim lewat BODY (POST), bukan segmen URL: equipment.code bisa mengandung "/" (mis. "ASET/EPI/KDR/MOB/0001").
// Identitas pengguna SELALU dari token (authenticateEss), tidak pernah dari body. Mode gate dari /settings/gates (erp-epi).

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { decideOverride, sanitizeGps } from '$lib/server/equipmentVerifyCore';
import { hasOverridePermission } from '$lib/server/equipmentVerifyAuth';
import {
	findEquipmentByCode,
	findVehicleByEquipment,
	loadVerifySettings,
	logDeniedAttempt,
	verifyTool,
	verifyVehicle
} from '$lib/server/equipmentVerify';

export async function POST(event: RequestEvent) {
	const { user, karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => ({}));
	const code = String(body?.code || '').trim();
	if (!code) throw error(400, 'Kode equipment wajib diisi.');

	let equipment;
	try {
		equipment = await findEquipmentByCode(code);
	} catch (e) {
		console.error('[api/equipment/verify] gagal baca equipment:', e instanceof Error ? e.message : e);
		throw error(502, 'Gagal membaca data equipment. Coba lagi.');
	}
	if (!equipment) throw error(404, `Equipment dengan kode "${code}" tidak ditemukan.`);

	const karyawanId = String(karyawan.id);
	const vehicle = await findVehicleByEquipment(equipment.id).catch((e) => {
		console.error('[api/equipment/verify] gagal baca fleet_kendaraan (diperlakukan bukan kendaraan):', e instanceof Error ? e.message : e);
		return null;
	});

	if (!vehicle) return json(await verifyTool(equipment, karyawanId));

	const result = await verifyVehicle(equipment, vehicle, karyawanId);
	const v = result.verification;

	let override: { allowed: boolean; reasonMin: number } | null = null;
	if (v.decision === 'denied' && v.mode !== 'shadow') {
		const settings = await loadVerifySettings();
		// Permission hanya dibaca bila perlu (mode hard) — hemat panggilan RBAC.
		const hasPerm = v.mode === 'hard' ? await hasOverridePermission(event, user, settings) : false;
		override = decideOverride(v.mode, hasPerm, settings.handoverReasonMin);
	}
	if (v.attempt) {
		// Jangan ditunggu — pencatatan upaya tidak boleh memperlambat layar peringatan.
		void logDeniedAttempt({
			equipmentId: equipment.id,
			karyawanId,
			gateKey: v.gateKey,
			mode: v.mode,
			bookingCode: result.booking?.kode_booking ?? null,
			gps: sanitizeGps(body?.gps),
			clientEventId: typeof body?.clientEventId === 'string' ? body.clientEventId : null
		});
	}

	return json({ ...result, override });
}
