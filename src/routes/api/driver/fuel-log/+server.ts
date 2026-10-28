import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { checkBbmVisitGate } from '$lib/server/visitGate';
import { getFieldGateMode } from '$lib/server/gateEnforcement';
import { evaluateExpenseGates, failedHardGates } from '$lib/server/gates/expenseGate';

// Log BBM aktual (rekomendasi tambahan #3, implementation_plan_fleet_module_v2.md) — dasar
// kalibrasi Cost Estimator Fase 4. Diisi driver dari HP saat isi BBM.
export const POST: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const vehicleId = String(form.get('vehicle_id') || '');
	const liter = Number(form.get('liter'));
	const totalBiaya = Number(form.get('total_biaya'));
	const odometerRaw = form.get('odometer');
	const odometer = odometerRaw ? Number(odometerRaw) : null;
	const catatan = String(form.get('catatan') || '').trim();
	const foto = form.get('foto'); // File
	// Fase 1-3 v2 (9 Sep 2026): kolom bukti baru — semua opsional di request, pemaksaan
	// murni di lapisan gate (Aturan #3, nol constraint DB).
	const siteCheckinId = form.get('site_checkin_id')?.toString()?.trim() || null;
	const tripId = form.get('trip_id')?.toString()?.trim() || null;
	const projectId = form.get('project_id') ? Number(form.get('project_id')) : null;
	const fotoOdometer = form.get('foto_odometer'); // File

	if (!vehicleId) throw error(400, 'Kendaraan wajib dipilih.');
	if (!Number.isFinite(liter) || liter <= 0) throw error(400, 'Jumlah liter tidak valid.');
	if (!Number.isFinite(totalBiaya) || totalBiaya <= 0) throw error(400, 'Total biaya tidak valid.');
	if (odometerRaw && (!Number.isFinite(odometer) || (odometer as number) < 0)) {
		throw error(400, 'Odometer tidak valid.');
	}

	let fotoId: string | null = null;
	if (foto instanceof File && foto.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', foto);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah foto struk.');
		const uploaded = await res.json();
		fotoId = uploaded?.data?.id ?? null;
	}

	let fotoOdometerId: string | null = null;
	if (fotoOdometer instanceof File && fotoOdometer.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', fotoOdometer);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah foto odometer.');
		const uploaded = await res.json();
		fotoOdometerId = uploaded?.data?.id ?? null;
	}

	// G_BBM_VISIT — sama gate dengan biaya-lapangan (pengisian BBM mandiri tetap butuh
	// bukti kunjungan/peminjaman kendaraan yang sah). Mode-aware, default shadow.
	const bbmVisitMode = await getFieldGateMode('G_BBM_VISIT').catch(() => 'shadow');
	const visitCheck = await checkBbmVisitGate(siteCheckinId, tripId, driver.karyawan_id, todayJakarta()).catch((e) => ({
		allowed: false,
		reason: e instanceof Error ? e.message : 'Gagal memeriksa gate kunjungan'
	}));
	if (!visitCheck.allowed) {
		if (bbmVisitMode === 'hard') {
			throw error(400, `Gate G_BBM_VISIT: ${visitCheck.reason || 'Pengisian BBM wajib terkait kunjungan atau peminjaman kendaraan yang sah.'}`);
		}
		console.warn(`[G_BBM_VISIT] mode=${bbmVisitMode} — gate gagal tapi tidak diblokir: ${visitCheck.reason}`);
	}

	// G_P2H_UNIT_LAPANGAN + G_BUKTI_BBM (jenis selalu 'bbm' di endpoint ini) + G_BUKTI_STRUK.
	// G_SJ_KIRIM N/A di sini (pengisian BBM bukan pengiriman barang).
	const expenseGates = await evaluateExpenseGates({
		jenis: 'bbm',
		vehicleId,
		karyawanId: null,
		driverId: driver.id,
		fotoStrukId: fotoId,
		odometer,
		fotoOdometerId
	});
	const blockedGates = failedHardGates(expenseGates);
	if (blockedGates.length > 0) {
		throw error(400, `Pencatatan BBM tidak bisa dikirim: ${blockedGates.map((g) => `${g.key} — ${g.message}`).join('; ')}`);
	}
	for (const g of expenseGates) {
		if (g.status === 'failed' && g.mode !== 'hard') {
			console.warn(`[${g.key}] mode=${g.mode} — gate gagal tapi tidak diblokir: ${g.message}`);
		}
	}

	const result = await directusServerJson<{ data: any }>('/items/fleet_fuel_log', {
		method: 'POST',
		body: JSON.stringify({
			vehicle_id: Number(vehicleId),
			driver_id: driver.id,
			tanggal: todayJakarta(),
			liter,
			total_biaya: totalBiaya,
			harga_per_liter: Math.round(totalBiaya / liter),
			odometer,
			foto_struk: fotoId,
			catatan: catatan || null,
			site_checkin_id: siteCheckinId,
			foto_odometer: fotoOdometerId,
			project_id: projectId
		})
	});

	// Perbarui km_terakhir kendaraan bila odometer yang dilaporkan lebih besar (data hygiene,
	// sama seperti pola trip start/finish) — non-fatal bila gagal.
	if (odometer != null) {
		try {
			const kendaraanRes = await directusServerJson<{ data: any[] }>(
				`/items/fleet_kendaraan?filter[id][_eq]=${vehicleId}&fields=id,km_terakhir&limit=1`
			);
			const current = Number(kendaraanRes?.data?.[0]?.km_terakhir) || 0;
			if (odometer > current) {
				await directusServerJson(`/items/fleet_kendaraan/${vehicleId}`, {
					method: 'PATCH',
					body: JSON.stringify({ km_terakhir: odometer })
				});
			}
		} catch {
			/* non-fatal */
		}
	}

	return json({ record: result?.data ?? result });
};
