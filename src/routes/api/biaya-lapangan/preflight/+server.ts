// src/routes/api/biaya-lapangan/preflight/+server.ts
// Fase 2 v2 "Perketat Gate BBM & E-Toll" (9 Sep 2026) — GET mengembalikan GateResult[]
// untuk konteks form SAAT INI (jenis, site_checkin, kendaraan), supaya UI (GateChecklistCard)
// bisa menampilkan checklist SEBELUM user submit, bukan setelah gagal (Aturan #6).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { checkBbmVisitGate } from '$lib/server/visitGate';
import { getFieldGateMode } from '$lib/server/gateEnforcement';
import { todayJakarta } from '$lib/server/ess/time';
import { evaluateExpenseGates } from '$lib/server/gates/expenseGate';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const q = event.url.searchParams;

	const jenis = q.get('jenis') || 'bbm';
	const siteCheckinId = q.get('site_checkin_id')?.trim() || null;
	const tripId = q.get('trip_id')?.trim() || null;
	const vehicleId = q.get('vehicle_id')?.trim() || null;
	const odometerRaw = q.get('odometer');
	const odometer = odometerRaw ? Number(odometerRaw) : null;
	const hasFotoStruk = q.get('has_foto_struk') === '1';
	const hasFotoOdometer = q.get('has_foto_odometer') === '1';
	const mode = q.get('mode') || 'talangan';
	const projectIdRaw = q.get('project_id');
	const projectId = projectIdRaw ? Number(projectIdRaw) : null;
	const nominalRaw = q.get('nominal');
	const nominal = nominalRaw ? Number(nominalRaw) : null;

	const bbmVisitMode = await getFieldGateMode('G_BBM_VISIT').catch(() => 'shadow');
	const visitCheck = await checkBbmVisitGate(siteCheckinId, tripId, String(karyawan.id), todayJakarta()).catch((e) => ({
		allowed: false,
		reason: e instanceof Error ? e.message : 'Gagal memeriksa gate kunjungan'
	}));

	const expenseGates = await evaluateExpenseGates({
		jenis,
		vehicleId,
		karyawanId: karyawan.id,
		driverId: null,
		// Preflight tidak mengunggah file sungguhan — hanya menandai "ada/tidak" dari UI
		// (checkbox/preview lokal) supaya checklist bisa hidup sebelum upload terjadi.
		fotoStrukId: hasFotoStruk ? 'pending' : null,
		odometer,
		fotoOdometerId: hasFotoOdometer ? 'pending' : null,
		projectId,
		nominal,
		mode
	});

	const gates = [
		{
			key: 'G_BBM_VISIT',
			status: visitCheck.allowed ? 'passed' : 'failed',
			mode: bbmVisitMode,
			message: visitCheck.reason || '',
			action: visitCheck.allowed ? undefined : { label: 'Pilih kunjungan / peminjaman kendaraan', href: '#site-checkin' }
		},
		...expenseGates
	];

	return json({ gates });
};
