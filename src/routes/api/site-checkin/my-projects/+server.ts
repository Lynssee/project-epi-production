// src/routes/api/site-checkin/my-projects/+server.ts
// GET: daftar proyek kandidat untuk dropdown check-in — union dari:
//   1) projects.leader_id === karyawan.id (Project Leader, persis) — fallback nama PERSIS
//      hanya bila proyek tidak punya leader_id sama sekali (Paket 04 §3.7, SVR-24).
//   2) manpower_assignment aktif (via manpower.karyawan_id / manpower.user_email)
//   3) projects.manpower_leader_id / manpower_leader_wakil_id (Manpower Leader/Wakil)
//   4) Proyek "Kunjungan" — whitelist status dari site_checkin_settings.status_proyek_kunjungan
//      (bukan hardcode), dibatasi 200 atau disaring ?q= (kinerja 2G).
// Server-side (bukan client SDK langsung) supaya konsisten dengan pola /api/ess/* — identitas
// SELALU dari token Firebase, bukan input klien.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { getSiteCheckinSettings } from '$lib/server/siteCheckin';

export interface ProjectOption {
	id: number;
	name: string;
	lokasi: string | null;
	geo_lat: number | null;
	geo_lng: number | null;
	geo_radius_m: number | null;
	peran: 'leader' | 'manpower_leader' | 'wakil_leader' | 'anggota_regu' | 'kunjungan';
	// UX-03 (correction plan site-visit-payroll): status dipakai untuk membedakan proyek
	// bernama identik (mis. SO sama, 2 baris proyek) di daftar pemilihan.
	status: string | null;
	// UX-04: tier yang akan dicatat ke absensi bila leader check-in ke proyek ini — null berarti
	// tunjangan menunggu admin mengatur tier (lihat kartu status payroll di form).
	tier_absensi: string | null;
	// Paket 04 §3.7 — untuk debugging: dari jalur mana proyek ini masuk daftar.
	sumber_cocok: 'leader_id' | 'nama' | 'manpower' | 'kunjungan';
}

const PROJECT_FIELDS = 'id,name,lokasi,geo_lat,geo_lng,geo_radius_m,status,tier_absensi';
const STATUS_TIDAK_AKTIF = ['selesai', 'closed', 'cancelled', 'cancel', 'done'];
const DEFAULT_STATUS_KUNJUNGAN = ['on progress', 'repair', 'prepare'];
const MAX_KUNJUNGAN = 200;

function toProjectOption(p: any, peran: ProjectOption['peran'], sumberCocok: ProjectOption['sumber_cocok']): ProjectOption {
	return {
		id: p.id,
		name: p.name,
		lokasi: p.lokasi || null,
		geo_lat: p.geo_lat != null ? Number(p.geo_lat) : null,
		geo_lng: p.geo_lng != null ? Number(p.geo_lng) : null,
		geo_radius_m: p.geo_radius_m != null ? Number(p.geo_radius_m) : null,
		peran,
		status: p.status || null,
		tier_absensi: p.tier_absensi || null,
		sumber_cocok: sumberCocok
	};
}

export const GET: RequestHandler = async (event) => {
	const { karyawan, user } = await authenticateEss(event);
	const results = new Map<number, ProjectOption>();
	const q = (event.url.searchParams.get('q') || '').trim();

	// 1a) Project Leader — HANYA leader_id persis (Paket 04 §3.7: nama-icontains longgar
	// sebelumnya membuat karyawan bernama pendek/umum "diberi" proyek orang lain).
	try {
		const query = new URLSearchParams({
			filter: JSON.stringify({ _and: [{ status: { _nin: STATUS_TIDAK_AKTIF } }, { leader_id: { _eq: karyawan.id } }] }),
			fields: PROJECT_FIELDS,
			limit: '-1'
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/projects?${query.toString()}`);
		for (const p of res?.data || []) {
			results.set(p.id, toProjectOption(p, 'leader', 'leader_id'));
		}
	} catch (e) {
		console.warn('[SiteCheckin] Error fetching leader_id projects:', e);
	}

	// 1b) Fallback nama PERSIS — HANYA untuk proyek yang leader_id-nya MASIH KOSONG (belum
	// diisi admin, lihat Paket 01) DAN nama leader cocok persis (case-insensitive, trim).
	// Directus tidak punya _eq case-insensitive, jadi ambil kandidat _icontains lalu saring
	// persis di server (Paket 04 §3.7 poin 1).
	if (karyawan.nama_karyawan) {
		try {
			const query = new URLSearchParams({
				filter: JSON.stringify({
					_and: [
						{ status: { _nin: STATUS_TIDAK_AKTIF } },
						{ leader_id: { _null: true } },
						{ leader: { _icontains: karyawan.nama_karyawan } }
					]
				}),
				fields: PROJECT_FIELDS,
				limit: '-1'
			});
			const res = await directusServerJson<{ data: any[] }>(`/items/projects?${query.toString()}`);
			const namaKaryawan = karyawan.nama_karyawan.trim().toLowerCase();
			for (const p of res?.data || []) {
				if (results.has(p.id)) continue;
				if ((p.leader || '').trim().toLowerCase() === namaKaryawan) {
					results.set(p.id, toProjectOption(p, 'leader', 'nama'));
				}
			}
		} catch (e) {
			console.warn('[SiteCheckin] Error fetching leader-by-name projects:', e);
		}
	}

	// 2) Manpower assignment aktif + 3) Manpower Leader/Wakil
	try {
		const orConditions: any[] = [];
		if (user.email) orConditions.push({ user_email: { _eq: user.email.toLowerCase() } });
		if (karyawan.id) orConditions.push({ karyawan_id: { _eq: String(karyawan.id) } });

		if (orConditions.length > 0) {
			const mQuery = new URLSearchParams({
				fields: 'id',
				filter: JSON.stringify({ _or: orConditions }),
				limit: '1'
			});
			const mRes = await directusServerJson<{ data: { id: number }[] }>(`/items/manpower?${mQuery.toString()}`);
			const manpowerId = mRes?.data?.[0]?.id;

			if (manpowerId) {
				// 2a. Manpower Assignment (fetch project_ids, then fetch projects)
				const assignQuery = new URLSearchParams({
					filter: JSON.stringify({
						manpower_id: { _eq: String(manpowerId) },
						status: { _eq: 'aktif' }
					}),
					fields: 'project_id',
					limit: '-1'
				});
				const assignRes = await directusServerJson<{ data: any[] }>(`/items/manpower_assignment?${assignQuery.toString()}`);
				const assignedProjectIds = (assignRes?.data || [])
					.map((a) => (typeof a.project_id === 'object' ? a.project_id?.id : a.project_id))
					.filter((id): id is number => id != null)
					.map(Number)
					.filter((id) => !results.has(id));

				if (assignedProjectIds.length > 0) {
					const projQuery = new URLSearchParams({
						filter: JSON.stringify({
							id: { _in: assignedProjectIds },
							status: { _nin: STATUS_TIDAK_AKTIF }
						}),
						fields: PROJECT_FIELDS,
						limit: '-1'
					});
					const projRes = await directusServerJson<{ data: any[] }>(`/items/projects?${projQuery.toString()}`);
					for (const p of projRes?.data || []) {
						if (!results.has(p.id)) results.set(p.id, toProjectOption(p, 'anggota_regu', 'manpower'));
					}
				}

				// 2b. Manpower Leader / Wakil
				const leadQuery = new URLSearchParams({
					filter: JSON.stringify({
						_and: [
							{ status: { _nin: STATUS_TIDAK_AKTIF } },
							{
								_or: [
									{ manpower_leader_id: { _eq: String(manpowerId) } },
									{ manpower_leader_wakil_id: { _eq: String(manpowerId) } }
								]
							}
						]
					}),
					fields: `${PROJECT_FIELDS},manpower_leader_id`,
					limit: '-1'
				});
				const leadRes = await directusServerJson<{ data: any[] }>(`/items/projects?${leadQuery.toString()}`);
				for (const p of leadRes?.data || []) {
					const isLeader = String(typeof p.manpower_leader_id === 'object' ? p.manpower_leader_id?.id : p.manpower_leader_id) === String(manpowerId);
					results.set(p.id, toProjectOption(p, isLeader ? 'manpower_leader' : 'wakil_leader', 'manpower'));
				}
			}
		}
	} catch (e) {
		console.warn('[SiteCheckin] Error fetching manpower assignment projects:', e);
	}

	const assignedCount = results.size;

	// 4) Proyek "Kunjungan" — whitelist status dari settings (§3.7 poin 2), dibatasi 200 atau
	// disaring ?q= bila daftar besar (kinerja 2G, §3.7 poin 3).
	try {
		const settings = await getSiteCheckinSettings().catch(() => null);
		const statusKunjunganList = (settings?.status_proyek_kunjungan || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const statusList = statusKunjunganList.length > 0 ? statusKunjunganList : DEFAULT_STATUS_KUNJUNGAN;

		const kunjunganFilter: any = {
			_and: [{ status: { _in: statusList } }, ...(q.length >= 2 ? [{ name: { _icontains: q } }] : [])]
		};
		const allQuery = new URLSearchParams({
			filter: JSON.stringify(kunjunganFilter),
			fields: PROJECT_FIELDS,
			sort: 'name',
			limit: String(q.length >= 2 ? 50 : MAX_KUNJUNGAN)
		});
		const allRes = await directusServerJson<{ data: any[] }>(`/items/projects?${allQuery.toString()}`);
		for (const p of allRes?.data || []) {
			if (!results.has(p.id)) results.set(p.id, toProjectOption(p, 'kunjungan', 'kunjungan'));
		}
	} catch (e) {
		console.warn('[SiteCheckin] Error fetching kunjungan projects:', e);
	}

	const allProjects = [...results.values()];
	const peranOrder: Record<string, number> = {
		leader: 1,
		manpower_leader: 2,
		wakil_leader: 3,
		anggota_regu: 4,
		kunjungan: 5
	};
	allProjects.sort((a, b) => {
		const diff = (peranOrder[a.peran] || 99) - (peranOrder[b.peran] || 99);
		if (diff !== 0) return diff;
		return a.name.localeCompare(b.name);
	});

	return json({
		projects: allProjects,
		assignedCount
	});
};
