// src/routes/api/site-checkin/report-koordinat-salah/+server.ts
// UX-07 (correction plan site-visit-payroll, 27 Sep 2026) — leader melaporkan koordinat proyek
// yang KELIHATAN salah (proyek SUDAH punya geo_lat/geo_lng, tapi leader selalu tampak di luar
// geofence). BEDA dari project-koordinat/+server.ts (R1, hanya untuk proyek yang BELUM punya
// koordinat sama sekali) — di sini koordinat TIDAK langsung ditimpa, hanya masuk sebagai usulan
// yang direview GA lewat ProyekLokasiWizard (erp-epi), konsisten dengan pola usulan_jarak untuk
// tier_absensi (resolveTierAbsensi di siteCheckin.ts).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const COOLDOWN_HARI = 7; // jangan spam GA dengan usulan berulang untuk proyek yang sama

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.projectId);
	const lat = Number(body?.lat);
	const lng = Number(body?.lng);
	const akurasi = body?.accuracy != null ? Number(body.accuracy) : null;

	if (!Number.isFinite(projectId) || projectId <= 0) throw error(400, 'Proyek tidak valid.');
	if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
		throw error(400, 'Koordinat GPS tidak valid.');
	}
	// Paket 04 §3.4 (SVR-18) — GPS kasar tidak boleh jadi dasar usulan koreksi koordinat proyek
	// (bisa memindahkan titik ke lokasi yang SAMA salahnya, mis. menara BTS terdekat).
	if (akurasi != null && akurasi > 100) {
		throw error(422, 'GPS Anda belum cukup tepat untuk mengusulkan titik proyek. Nyalakan Lokasi akurat lalu coba lagi.');
	}

	const projRes = await directusServerJson<{ data: { id: number; name: string } }>(
		`/items/projects/${projectId}?fields=id,name`
	).catch(() => null);
	const project = projRes?.data;
	if (!project) throw error(404, 'Proyek tidak ditemukan.');

	// Dedup: jangan buat usulan baru kalau sudah ada yang belum direview GA (masih 'diterapkan'=false)
	// untuk proyek yang sama dalam masa cooldown.
	// Paket 04 §3.4 (Aturan #1): app_notifications TIDAK punya date_created (selalu 403) — dedup
	// ini TIDAK PERNAH benar-benar berjalan sebelumnya, ditelan diam-diam oleh .catch(() => null)
	// di bawah (pelanggaran Aturan #7). Field yang benar: created_at, dan error sekarang dicatat.
	const cooldownDate = new Date(Date.now() - COOLDOWN_HARI * 24 * 3600 * 1000).toISOString();
	const existingQuery = new URLSearchParams({
		'filter[type][_eq]': 'koordinat_usulan_leader',
		'filter[source_collection][_eq]': 'projects',
		'filter[source_id][_eq]': String(projectId),
		'filter[created_at][_gte]': cooldownDate,
		limit: '1',
		fields: 'id'
	});
	const existingRes = await directusServerJson<{ data: { id: number }[] }>(`/items/app_notifications?${existingQuery.toString()}`).catch((e) => {
		console.error('[report-koordinat-salah] dedup gagal', e);
		return null;
	});
	if ((existingRes?.data || []).length > 0) {
		return json({ ok: true, note: 'Usulan sebelumnya untuk proyek ini masih menunggu review GA.' });
	}

	await directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'koordinat_usulan_leader',
			title: 'Leader Usulkan Koreksi Koordinat Proyek',
			message: `Karyawan #${karyawan.id} (${karyawan.nama_karyawan || '-'}) melaporkan koordinat proyek "${project.name}" kelihatan salah dan mengusulkan titik GPS-nya sendiri sebagai koreksi.`,
			priority: 'medium',
			source_collection: 'projects',
			source_id: String(projectId),
			// Payload usulan disimpan di `changes` (field generik teks) sebagai JSON — dibaca
			// ProyekLokasiWizard saat GA meninjau, bukan kolom baru (tidak ada perubahan skema).
			changes: JSON.stringify({ lat, lng, accuracy: akurasi, karyawan_id: karyawan.id, karyawan_nama: karyawan.nama_karyawan || null }),
			action_url: '/hrd?tab=wizard-lokasi-proyek',
			action_type: 'view_wizard_lokasi_proyek'
		})
	});

	return json({ ok: true });
};
