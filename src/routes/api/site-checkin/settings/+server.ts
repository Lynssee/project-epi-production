// src/routes/api/site-checkin/settings/+server.ts
// GET: konfigurasi Site Check-in yang relevan untuk UI klien (foto wajib/tidak, dsb).
// Koleksi site_checkin_settings sengaja NOL field rupiah (T-3/S-6) — aman diekspos apa adanya.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getSiteCheckinSettings } from '$lib/server/siteCheckin';
import { readVisitSettings } from '$lib/server/visitGate';
import { getFieldGateMode } from '$lib/server/gateEnforcement';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const settings = await getSiteCheckinSettings();
	// Paket 06 §2.4/§2.5 — visit_picker_hari/maks_selisih_hari_klaim (readVisitSettings
	// sudah cache 5 menit sendiri) + mode_gate supaya UI klien mengikuti mode server
	// (Aturan #3: soft/shadow TIDAK PERNAH mengunci tombol, hanya hard yang mengunci).
	const [visitSettings, rmrMode, bbmMode] = await Promise.all([
		readVisitSettings(),
		getFieldGateMode('G_RMR_VISIT'),
		getFieldGateMode('G_BBM_VISIT')
	]);
	return json({
		settings: {
			...settings,
			visit_picker_hari: visitSettings.visit_picker_hari,
			maks_selisih_hari_klaim: visitSettings.maks_selisih_hari_klaim
		},
		mode_gate: { G_RMR_VISIT: rmrMode, G_BBM_VISIT: bbmMode }
	});
};
