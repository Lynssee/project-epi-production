// src/routes/api/lacak-sj/[id]/+server.ts
// Detail tracking satu SJ untuk layar lapangan: header + timeline (scan_log) + aksi
// yang boleh dilakukan user (driver / penerima / leader). Tracking SJ v2 Fase 4.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { aktorBolehProyek, authenticateLacakActor, evaluasiKelayakan, sudahDiverifikasi, tanggalMulaiVerifikasi } from '$lib/server/sjVerifikasiAkses';
import { directusServerJson } from '$lib/server/directus';
import { STAGE_LABELS } from '$lib/server/sjTracking';
import { sjButuhSatpam } from '$lib/server/driver/berangkatGuard';
import { sjReadiness } from '$lib/shared/sjReadiness';
import { canDriverMark, effectiveStage, stageBlockMessage } from '$lib/shared/sjFieldTransitions';
import { resolveDriverIdentity, isSjDriver } from '$lib/server/driverIdentity';

export const GET: RequestHandler = async (event) => {
	const aktor = await authenticateLacakActor(event);
	const { karyawan, projectIds } = aktor;
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'id tidak valid.');

	const sj = (await directusServerJson<{ data: any }>(
		`/items/surat_jalan/${id}?fields=id,nomor_sj,status,type,track_stage,track_stage_at,track_actor,` +
		`track_evidence_pct,driver,delivery_address,project_id,gr_enabled,delegated_driver_id,delegated_user_id,pengaju_verification,print_count,category,draft_status,reprint_status,date_created,scan_sj_file,received_at,` +
		`mode_kirim,expedition_id,no_resi,biaya_kirim,eta_tiba`
	).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');

	// Fase 1 Pengiriman Ekspedisi (15 Okt 2026) — expedition_id string lepas (bukan relasi
	// Directus di skema), resolusi nama vendor + template lacak terpisah (query relasi dipisah).
	let ekspedisi: { nama: string; no_resi: string | null; eta_tiba: string | null; url_tracking: string | null } | null = null;
	if (sj.mode_kirim === 'ekspedisi' && sj.expedition_id) {
		const expRes = await directusServerJson<{ data: any }>(
			`/items/fleet_expeditions/${encodeURIComponent(sj.expedition_id)}?fields=id,nama,url_tracking_template`
		).catch(() => null);
		const exp = expRes?.data;
		if (exp) {
			ekspedisi = {
				nama: exp.nama,
				no_resi: sj.no_resi || null,
				eta_tiba: sj.eta_tiba || null,
				url_tracking: exp.url_tracking_template && sj.no_resi
					? String(exp.url_tracking_template).replace('{resi}', encodeURIComponent(sj.no_resi))
					: null
			};
		}
	}

	const projId = typeof sj.project_id === 'object' ? sj.project_id?.id : sj.project_id;
	const isMyProject = projId != null && projectIds.includes(Number(projId));
	const isDriver = isSjDriver(sj, await resolveDriverIdentity(karyawan));
	// SJ-06: Admin boleh membuka SJ proyek manapun HANYA untuk verifikasi (bukan terima barang / komplain).
	const canVerify = projId != null && aktorBolehProyek(aktor, Number(projId));
	if (!isMyProject && !isDriver && !canVerify) throw error(403, 'SJ ini tidak berkaitan dengan Anda.');

	// timeline
	const logRes = await directusServerJson<{ data: any[] }>(
		`/items/scan_log?filter[ref_collection][_eq]=surat_jalan&filter[ref_id][_eq]=${id}` +
		`&sort=timestamp,id&limit=-1&fields=id,actor_id,actor_role,timestamp,gps_lat,gps_lng,` +
		`signature_id,foto_id,notes,stage_from,stage_to,source`
	).catch(() => ({ data: [] }));

	const actorIds = [...new Set((logRes?.data || []).map((r) => r.actor_id).filter((v) => v != null))];
	const nameById = new Map<string, string>();
	if (actorIds.length > 0) {
		const kRes = await directusServerJson<{ data: any[] }>(
			`/items/karyawan?filter[id][_in]=${actorIds.join(',')}&fields=id,nama_karyawan&limit=-1`
		).catch(() => ({ data: [] }));
		for (const k of kRes?.data || []) nameById.set(String(k.id), k.nama_karyawan);
	}

	const events = (logRes?.data || []).map((r) => ({
		id: r.id,
		stage_from: r.stage_from || null,
		stage_to: r.stage_to || null,
		stage_label: r.stage_to ? STAGE_LABELS[r.stage_to] || r.stage_to : null,
		at: r.timestamp,
		actor: r.actor_id != null ? nameById.get(String(r.actor_id)) || r.actor_role : r.actor_role,
		source: r.source || null,
		has_gps: r.gps_lat != null,
		has_foto: !!r.foto_id,
		has_ttd: !!r.signature_id,
		notes: r.notes || null,
		is_backfill: r.source === 'backfill'
	}));

	// aksi
	const stage = sj.track_stage || 'draft';
	const actions: string[] = [];
	let hint: string | null = null;
	let readiness: ReturnType<typeof sjReadiness> | null = null;
	if (isDriver) {
		// SJH-16: tombol mengikuti tabel transisi (bukan semua tahap). SJ tanpa track_stage diturunkan dari status.
		const eff = effectiveStage(sj.track_stage, sj.status);
		const needsGate = await sjButuhSatpam(sj.category);
		readiness = sjReadiness(sj, needsGate);
		if (canDriverMark('dalam_perjalanan', eff, needsGate)) actions.push('dalam_perjalanan');
		else if (needsGate && !['dalam_perjalanan', 'tiba_lokasi', 'diterima', 'selisih', 'received', 'closed'].includes(eff)) hint = stageBlockMessage('dalam_perjalanan', eff, needsGate);
		if (canDriverMark('tiba_lokasi', eff, needsGate)) actions.push('tiba_lokasi');
		// POD hanya setelah barang keluar gerbang (berangkat/tiba)
		if (['dalam_perjalanan', 'tiba_lokasi'].includes(eff)) actions.push('proof_of_delivery');
	}
	if (isMyProject && sj.gr_enabled && !['received', 'closed'].includes(sj.status)) actions.push('terima_barang');
	if (isMyProject) actions.push('lapor_komplain');
	// Penajaman Gate SJ Fase 3: foto SJ fisik bertanda tangan lengkap, setelah barang sampai di tujuan.
	if ((isMyProject || isDriver) && (!!sj.received_at || ['tiba_lokasi', 'diterima', 'selisih', 'dokumen_kembali', 'tutup'].includes(stage))) actions.push('scan_fisik');
	// SJH-02/SJ-06: PL, staf backup, dan admin memverifikasi fisik barang SJ proyek sebelum SJ dicetak final.
	const pvDone = sudahDiverifikasi(sj);
	const kelayakan = evaluasiKelayakan(sj, await tanggalMulaiVerifikasi());
	if (canVerify && !pvDone && kelayakan.boleh) actions.push('verifikasi_fisik');
	const pv = (sj.pengaju_verification as any) || null;
	const pvItems: any[] = Array.isArray(pv?.items) ? pv.items : [];

	return json({
		sj: {
			id: sj.id,
			nomor_sj: sj.nomor_sj,
			status: sj.status,
			type: sj.type,
			stage,
			stage_label: STAGE_LABELS[stage] || stage,
			stage_at: sj.track_stage_at || null,
			actor: sj.track_actor || null,
			evidence_pct: sj.track_evidence_pct ?? null,
			tujuan: sj.delivery_address || null,
			driver: sj.driver || null,
			gr_enabled: !!sj.gr_enabled,
			has_scan: !!sj.scan_sj_file,
			mode_kirim: sj.mode_kirim || null,
			ekspedisi
		},
		role: { is_driver: isDriver, is_my_project: isMyProject, can_verify: canVerify },
		// SJ-06 Layar B: ringkasan hasil cek + boleh-ubah (K2: tidak boleh setelah cetak)
		verifikasi: canVerify ? {
			done: pvDone,
			by: pv?.verified_by_name || null, at: pv?.verified_at || null, source: pv?.source || null, mode: pv?.mode || null,
			sesuai: pvItems.filter((i) => i.status === 'sesuai').length, total: pvItems.length,
			boleh_ubah: kelayakan.boleh, alasan_tidak_boleh: kelayakan.alasan
		} : null,
		actions,
		hint,
		steps: readiness?.steps ?? null,
		next_hint: readiness?.next_hint ?? null,
		events
	});
};
