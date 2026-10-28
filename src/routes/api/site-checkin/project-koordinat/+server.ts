// src/routes/api/site-checkin/project-koordinat/+server.ts
// R1 (Fase 0, Pertajam Site Visit) — leader menyumbang koordinat proyek dari lokasi saat
// site check-in pertama. Menyembuhkan B6 (geo_lat terisi 1/11 proyek) tanpa kerja GA.
//
// Keputusan D3 (29 Agu 2026): koordinat dari lapangan LANGSUNG dipakai (area_status setara
// 'diterapkan') — ditandai projects.geo_sumber='lapangan_checkin' agar bisa dibedakan dari
// isian GA/PM. Guard: hanya boleh mengisi bila geo_lat/geo_lng MASIH kosong (tidak menimpa
// data GA), dan akurasi GPS wajar.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { getSiteCheckinSettings, getKantorPusat } from '$lib/server/siteCheckin';
import { getPeranProyek } from '$lib/server/siteCheckinPeran';
import { haversineMeters } from '$lib/server/ess/geo';

const AKURASI_MAKS_M = 75; // titik proyek tidak boleh dipatok dari fix GPS yang terlalu kasar
const JARAK_MIN_DARI_KANTOR_M = 1000; // Paket 04 §3.6 (SVR-19) — tolak titik dekat kantor pusat

export const POST: RequestHandler = async (event) => {
	const { karyawan, user } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.projectId);
	const lat = Number(body?.lat);
	const lng = Number(body?.lng);
	const akurasi = body?.accuracy != null ? Number(body.accuracy) : null;

	if (!Number.isFinite(projectId) || projectId <= 0) throw error(400, 'Proyek tidak valid.');
	if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
		throw error(400, 'Koordinat GPS tidak valid.');
	}
	if (akurasi != null && Number.isFinite(akurasi) && akurasi > AKURASI_MAKS_M) {
		throw error(422, `Akurasi GPS ±${Math.round(akurasi)}m terlalu rendah untuk memetakan titik proyek. Coba lagi di tempat terbuka.`);
	}

	// Paket 04 §3.6 (SVR-19): hanya peran penugasan (leader/manpower leader/wakil) proyek ini —
	// peran 'kunjungan' (siapa saja) TIDAK boleh mematok titik proyek secara permanen.
	const peran = await getPeranProyek(karyawan, user, projectId);
	if (peran === 'kunjungan') {
		throw error(403, 'Hanya leader proyek ini yang bisa memetakan titik.');
	}

	// Paket 04 §3.6: tolak bila ≤1km dari Kantor Pusat — mencegah orang "coba-coba" mematok
	// proyek dari kantor/rumah (sudah terjadi: proyek #402, #846 = titik Kantor Pusat).
	const kantor = await getKantorPusat();
	if (kantor) {
		const jarakDariKantorM = haversineMeters(lat, lng, kantor.lat, kantor.lng);
		if (jarakDariKantorM <= JARAK_MIN_DARI_KANTOR_M) {
			throw error(422, 'Titik ini terlalu dekat dengan kantor. Petakan saat Anda berada di lokasi proyek.');
		}
	}

	// Ambil kondisi proyek saat ini — jangan menimpa koordinat yang sudah ada.
	const projRes = await directusServerJson<{ data: { id: number; name: string; geo_lat: number | null; geo_lng: number | null } }>(
		`/items/projects/${projectId}?fields=id,name,geo_lat,geo_lng`
	).catch(() => null);
	const project = projRes?.data;
	if (!project) throw error(404, 'Proyek tidak ditemukan.');
	if (project.geo_lat != null && project.geo_lng != null) {
		throw error(409, 'Titik proyek ini sudah dipetakan. Perubahan koordinat hanya lewat GA.');
	}

	const settings = await getSiteCheckinSettings().catch(() => null);
	const radiusDefault = Number(settings?.radius_default_m) || 300;

	await directusServerJson(`/items/projects/${projectId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			geo_lat: lat,
			geo_lng: lng,
			geo_radius_m: radiusDefault,
			geo_sumber: 'lapangan_checkin'
		})
	});

	console.info(
		`[SiteCheckin][R1] Koordinat proyek #${projectId} (${project.name}) dipatok oleh karyawan #${karyawan.id} dari lapangan: ${lat},${lng} (±${akurasi ?? '?'}m), radius ${radiusDefault}m`
	);

	// Paket 04 §3.6 poin 4 — beri tahu GA ada titik baru dari lapangan untuk ditinjau
	// (created_at otomatis, fail-soft: tidak pernah menggagalkan pematokan titik itu sendiri).
	directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'koordinat_dipetakan_lapangan',
			title: 'Titik Proyek Dipetakan dari Lapangan',
			message: `Karyawan #${karyawan.id} (${karyawan.nama_karyawan || '-'}, peran ${peran}) memetakan titik proyek "${project.name}" dari lokasi lapangan (±${akurasi ?? '?'}m).`,
			priority: 'low',
			source_collection: 'projects',
			source_id: String(projectId),
			action_url: '/hrd?tab=wizard-lokasi-proyek',
			action_type: 'view_wizard_lokasi_proyek'
		})
	}).catch((e) => {
		console.error('[project-koordinat] gagal kirim notifikasi GA', e);
	});

	return json({
		ok: true,
		geo_lat: lat,
		geo_lng: lng,
		geo_radius_m: radiusDefault
	});
};
