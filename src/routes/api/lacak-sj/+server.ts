// src/routes/api/lacak-sj/+server.ts
// Daftar Surat Jalan yang relevan dengan user lapangan (proyek yang dipimpin, atau
// SJ yang drivernya user). Tracking SJ v2 Fase 4. Firebase auth.

import { json, type RequestHandler } from '@sveltejs/kit';
import { authenticateLacakActor, perluVerifikasi, sudahDiverifikasi, tanggalMulaiVerifikasi } from '$lib/server/sjVerifikasiAkses';
import { directusServerJson } from '$lib/server/directus';
import { STAGE_LABELS } from '$lib/server/sjTracking';
import { resolveDriverIdentity, isSjDriver } from '$lib/server/driverIdentity';

export const GET: RequestHandler = async (event) => {
	const { karyawan, projectIds, isAdmin } = await authenticateLacakActor(event);
	const stageParam = event.url.searchParams.get('stage') || '';
	// SJ-06: 'perlu_verifikasi' = chip daftar (bukan tahap tracking)
	const onlyPerlu = stageParam === 'perlu_verifikasi';
	const stageFilter = onlyPerlu ? '' : stageParam;
	const mulai = await tanggalMulaiVerifikasi();

	// SJH-17: identitas driver per jenis (UUID fleet_drivers, karyawan.id, teks PERSIS) — bukan _icontains.
	const ident = await resolveDriverIdentity(karyawan);
	const or: any[] = [
		{ driver: { _in: ident.nameVariants } },
		{ delegated_user_id: { _eq: karyawan.id } }
	];
	if (ident.fleetDriverId) or.push({ delegated_driver_id: { _eq: ident.fleetDriverId } });
	if (projectIds.length > 0) or.push({ project_id: { _in: projectIds } });

	// SJ-06: daftar kandidat verifikasi (SJ proyek yang boleh dicek aktor). Admin: semua proyek sejak tanggal mulai.
	const FIELDS_V = 'id,project_id,status,draft_status,print_count,reprint_status,date_created,pengaju_verification';
	let perluRows: any[] = [];
	if (isAdmin || projectIds.length > 0) {
		const fv: any = { _and: [{ date_created: { _gte: `${mulai}T00:00:00+07:00` } }, isAdmin ? { project_id: { _nnull: true } } : { project_id: { _in: projectIds } }] };
		const vq = new URLSearchParams({ filter: JSON.stringify(fv), fields: FIELDS_V, sort: '-id', limit: '300' });
		const vr = await directusServerJson<{ data: any[] }>(`/items/surat_jalan?${vq.toString()}`).catch((e) => {
			console.error('[lacak-sj] gagal baca kandidat verifikasi:', e instanceof Error ? e.message : e);
			return { data: [] as any[] };
		});
		perluRows = (vr?.data || []).filter((s) => perluVerifikasi(s, mulai));
	}
	const perluIds = new Set(perluRows.map((s) => s.id));
	const bisaVerifikasi = isAdmin || projectIds.length > 0;
	// SJ-06: hitung ringan untuk lencana kartu menu (Barang / Stok Lapangan) — tanpa query daftar utama.
	if (event.url.searchParams.get('count_only') === '1') {
		return json({ perlu_verifikasi_count: perluIds.size, bisa_verifikasi: bisaVerifikasi });
	}

	const filter: any = { _and: [{ _or: or }] };
	if (onlyPerlu) filter._and = [{ id: { _in: perluIds.size ? [...perluIds] : [-1] } }];
	if (stageFilter) filter._and.push({ track_stage: { _eq: stageFilter } });

	const q = new URLSearchParams({
		filter: JSON.stringify(filter),
		fields: 'id,nomor_sj,status,track_stage,track_stage_at,track_evidence_pct,driver,delegated_driver_id,delegated_user_id,delivery_address,project_id,type,date_created,print_count,draft_status,reprint_status,pengaju_verification',
		sort: '-track_stage_at,-date_created',
		limit: '80'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/surat_jalan?${q.toString()}`).catch(() => ({ data: [] }));
	const now = Date.now();

	const rows = (res?.data || []).map((sj) => {
		const since = sj.track_stage_at || sj.date_created;
		const ageMin = since ? Math.round((now - new Date(since).getTime()) / 60000) : null;
		return {
			id: sj.id,
			nomor_sj: sj.nomor_sj,
			stage: sj.track_stage || 'draft',
			stage_label: STAGE_LABELS[sj.track_stage] || sj.track_stage || 'Draft',
			tujuan: sj.delivery_address || null,
			driver: sj.driver || null,
			evidence_pct: sj.track_evidence_pct ?? null,
			age_min: ageMin,
			type: sj.type || null,
			is_driver: isSjDriver(sj, ident),
			// SJ-06: lencana "Perlu cek muat" / "✓ Dicek" (hanya untuk SJ proyek yang boleh dicek aktor)
			perlu_verifikasi: perluIds.has(sj.id),
			terverifikasi: sudahDiverifikasi(sj)
		};
	});

	// SJH-17 §4.3: hint bila akun belum tertaut ke master driver Fleet
	return json({ items: rows, count: rows.length, driver_linked: !!ident.fleetDriverId, perlu_verifikasi_count: perluIds.size, bisa_verifikasi: bisaVerifikasi });
};
