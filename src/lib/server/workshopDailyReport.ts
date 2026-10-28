// src/lib/server/workshopDailyReport.ts
// SERVER-ONLY. WSK-10/13 — simpan Laporan Harian workshop dari LAPANGAN sekaligus: atomik + idempoten + penjaga tanggal ganda.
// Padanan endpoint erp-epi `/api/workshop/[ws]/daily-report` (aturan SAMA: utils/workshopDailyReport.ts adalah salinannya).
//
// Sebelumnya HP menyimpan dari browser lewat 5+ request ke proxy Directus (header → PO → absensi → split → material) dengan
// kompensasi di sisi klien — sinyal putus di tengah / aplikasi ditutup = laporan setengah jadi atau dobel. Sekarang SATU request:
//   1. otorisasi: pemanggil harus berwenang atas SETIAP PO yang dilaporkan (peran penuh · pemegang kursi proyek · anggota roster
//      workshop ini) DAN PO itu memang milik workshop ini — kolom `projects.workshop`
//   2. validasi + saring kolom (hanya kolom skema live); jumlah_tenaga DIHITUNG SERVER = orang unik yang hadir
//   3. idempoten: penanda [txn:<id>] di `catatan` — kirim ulang (antrian offline) ⇒ laporan yang sama, bukan baru
//   4. tanggal ganda: setelan app_settings ws_ciketing_laporan.laporan_tanggal_ganda_mode — 'tolak' (bawaan) → 409 + info laporan
//      yang ada; 'gabung' → tambahkan ke laporan itu (orang/material/progres identik dilewati)
//   5. tulis: header → absensi → pembagian PO → material → progres PO; gagal di tengah ⇒ KOMPENSASI (hapus yang sudah ditulis) —
//      tidak ada header yatim
//   6. dibuat_oleh = nama karyawan dari token (server), bukan kiriman klien
//   7. sinkron ke HR (manpower_absensi) tetap dilakukan klien setelah sukses; server mengembalikan baris yang perlu disinkron

import { json, error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { resolveKaryawanByEmail } from '$lib/server/projectLeaderGuard';
import { resolveFieldProjectScope } from '$lib/server/fieldProjectScope';
import { opsProfile, type OpsWorkshopKey } from '$lib/services/workshopOpsProfile';
import {
	normalizeDailyReportInput, countUniqueHadir, applyPoManpower, planMerge, mergeText, normalizeTanggalGandaMode, DEFAULT_TANGGAL_GANDA_MODE
} from '$lib/utils/workshopDailyReport';

const SETTING_MODULE = 'ws_ciketing_laporan';
const SETTING_KEY = 'laporan_tanggal_ganda_mode';
const DAILY = 'workshop_daily_report';
const ABSENSI = 'workshop_report_absensi';
const MATERIAL = 'workshop_report_material';
const PO_DETAIL = 'workshop_report_po_detail';
const SPLIT = 'workshop_absensi_po_split';

/** Awalan `catatan` Quick Report (pelengkap foto 1 PO). Header ber-awalan ini TIDAK dihitung sebagai "laporan harian tanggal itu" pada penjaga tanggal ganda. */
export const QUICK_PREFIX = '[Quick Report]';
/** Filter Directus: bukan Quick Report (catatan kosong ATAU tidak berawalan [Quick Report]). */
export const NOT_QUICK_FILTER = `&filter[_or][0][catatan][_null]=true&filter[_or][1][catatan][_nstarts_with]=${encodeURIComponent(QUICK_PREFIX)}`;

/** Penanda idempoten di `catatan` (sama dengan klien lama: WSK-13 §4d). */
export const txnMarker = (id: string) => `[txn:${id}]`;

const unavailable = (msg: string) => error(503, msg);
const idsOf = (res: any): any[] => (Array.isArray(res?.data) ? res.data : []).map((r: any) => r.id);

/** Mode tanggal ganda dari app_settings. Gagal baca → default aman ('tolak') + dicatat. */
export async function readTanggalGandaMode(): Promise<string> {
	try {
		const res = await directusServerJson(
			`/items/app_settings?filter[module][_eq]=${SETTING_MODULE}&filter[setting_key][_eq]=${SETTING_KEY}&fields=setting_value&limit=1`
		);
		return normalizeTanggalGandaMode(res?.data?.[0]?.setting_value);
	} catch (e: any) {
		console.error('[workshopDailyReport] gagal baca mode tanggal ganda — memakai default:', e?.message);
		return DEFAULT_TANGGAL_GANDA_MODE;
	}
}

/** Anggota roster aktif workshop ini (Project Leader / Manpower). Galat baca → false (fail-closed) + dicatat. */
async function isRosterMember(karyawanId: number, workshopId: number): Promise<boolean> {
	try {
		const [leaders, manpower] = await Promise.all([
			directusServerJson(`/items/workshop_project_leader?filter[workshop_id][_eq]=${workshopId}&filter[status][_eq]=aktif&filter[karyawan_id][_eq]=${karyawanId}&fields=id&limit=1`),
			directusServerJson(`/items/workshop_manpower?filter[workshop_id][_eq]=${workshopId}&filter[status][_eq]=aktif&filter[karyawan_id][_eq]=${encodeURIComponent(String(karyawanId))}&fields=id&limit=1`)
		]);
		return (leaders?.data?.length || 0) > 0 || (manpower?.data?.length || 0) > 0;
	} catch (e: any) {
		console.error('[workshopDailyReport] gagal baca roster (akses ditolak, fail-closed):', e?.message);
		return false;
	}
}

/**
 * Otorisasi per PO (bersama laporan lengkap & Quick Report): pemanggil login + berwenang atas SETIAP PO (peran penuh · pemegang kursi proyek ·
 * anggota roster aktif workshop ini) DAN PO itu milik workshop ini (`projects.workshop`). Mengembalikan identitas petugas dari token.
 */
async function authorizeForPos(event: RequestEvent, P: ReturnType<typeof opsProfile>, poIds: number[]) {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email).catch((e) => {
		console.error('[workshopDailyReport] lookup karyawan gagal:', e?.message);
		return null;
	});
	const actor = karyawan?.nama_karyawan || user.email || null;
	if (!actor) throw error(400, 'Identitas petugas tidak dikenali — login ulang lalu coba lagi.');
	const projRes = await directusServerJson(`/items/projects?filter[id][_in]=${poIds.join(',')}&fields=id,workshop&limit=${poIds.length}`).catch((e: any) => {
		console.error('[workshopDailyReport] gagal membaca PO:', e?.message);
		throw unavailable('Gagal memeriksa PO — coba lagi.');
	});
	const wsOf = new Map<number, string>((projRes?.data || []).map((p: any) => [Number(p.id), String(p.workshop || '')]));
	const salah = poIds.filter((id) => wsOf.get(id) !== P.projectWorkshop);
	if (salah.length) throw error(400, `PO #${salah.join(', #')} bukan milik Workshop ${P.label} — laporan tidak disimpan.`);
	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const scope = await resolveFieldProjectScope(idToken, user.localId, user.email);
	if (!scope.unrestricted) {
		const luar = poIds.filter((id) => !scope.projectIds.includes(id));
		if (luar.length && !(karyawan && (await isRosterMember(karyawan.id, P.id)))) {
			throw error(403, `Anda tidak memegang PO #${luar.join(', #')} dan bukan anggota roster Workshop ${P.label}.`);
		}
	}
	return { user, karyawan, actor };
}

export async function handleDailyReportCreate(event: RequestEvent, wsKey: OpsWorkshopKey) {
	const P = opsProfile(wsKey);
	const body: any = await event.request.json().catch(() => ({}));
	const txn = String(body?.clientTxnId || '').trim();
	if (txn.length < 8 || txn.length > 100) throw error(400, 'clientTxnId wajib (muat ulang halaman lalu coba lagi).');
	const parsed = normalizeDailyReportInput(body);
	if (!parsed.ok) throw error(400, parsed.errors.join(' '));
	const { header, absensi, absensiLeader, material, poDetails } = parsed.value;

	const poIds = [...new Set<number>([
		...poDetails.map((d: any) => Number(d.po_id)),
		...[...absensi, ...absensiLeader].flatMap((r: any) => (r.po_split || []).map((s: any) => Number(s.po_id)))
	].filter((n) => Number.isFinite(n) && n > 0))];
	if (poIds.length === 0) throw error(400, 'Isi progres minimal 1 PO/subtask.');
	const { karyawan, actor } = await authorizeForPos(event, P, poIds);

	const marker = txnMarker(txn);
	const catatanBase = header.catatan ? String(header.catatan) : '';
	header.catatan = (catatanBase ? `${catatanBase}\n${marker}` : marker);

	// 3) idempoten
	const prior = await directusServerJson(
		`/items/${DAILY}?filter[workshop_id][_eq]=${P.id}&filter[catatan][_contains]=${encodeURIComponent(marker)}&fields=id&limit=1`
	).catch((e: any) => {
		console.error('[workshopDailyReport] cek idempoten gagal:', e?.message);
		throw unavailable('Gagal memeriksa permintaan sebelumnya — coba lagi.');
	});
	if (prior?.data?.[0]) {
		return json({ success: true, idempotent: true, laporanId: prior.data[0].id, merged: false, manpowerForSync: [] });
	}

	// 4) tanggal ganda
	const existingRes = await directusServerJson(
		`/items/${DAILY}?filter[workshop_id][_eq]=${P.id}&filter[tanggal][_eq]=${encodeURIComponent(header.tanggal)}${NOT_QUICK_FILTER}` +
			`&fields=id,tanggal,dibuat_oleh,kendala,catatan,jumlah_tenaga,foto_absensi_masuk,foto_absensi_pulang&sort=id&limit=5`
	).catch((e: any) => {
		console.error('[workshopDailyReport] cek tanggal ganda gagal:', e?.message);
		throw unavailable('Gagal memeriksa laporan di tanggal ini — coba lagi.');
	});
	const target: any = existingRes?.data?.[0] || null;
	if (target) {
		const mode = await readTanggalGandaMode();
		if (mode !== 'gabung') {
			return json({
				success: false,
				code: 'LAPORAN_TANGGAL_ADA',
				message: `Laporan tanggal ${header.tanggal} sudah ada (#${target.id}${target.dibuat_oleh ? ', oleh ' + target.dibuat_oleh : ''}). Jangan buat laporan baru di tanggal yang sama — hubungi admin workshop atau leader yang membuatnya untuk menambahkan progresnya.`,
				existing: { id: target.id, tanggal: target.tanggal, dibuat_oleh: target.dibuat_oleh || null }
			}, { status: 409 });
		}
	}

	// 5) rencana tulis
	let plan: ReturnType<typeof planMerge> = { absensi, absensiLeader, material, poDetails, skipped: { absensi: [], material: 0, poDetails: 0 } };
	let existingAbsensi: any[] = [];
	if (target) {
		const kids = await Promise.all([
			directusServerJson(`/items/${ABSENSI}?filter[laporan_id][_eq]=${target.id}&fields=id,nama,tipe,manpower_id,status_hadir&limit=-1`),
			directusServerJson(`/items/${MATERIAL}?filter[laporan_id][_eq]=${target.id}&fields=id,kategori,nama_material,no_po,qty,satuan&limit=-1`),
			directusServerJson(`/items/${PO_DETAIL}?filter[laporan_id][_eq]=${target.id}&fields=id,po_id,subtask_id,subtask_name,volume_aktual,progress_hari_ini&limit=-1`)
		]).catch((e: any) => {
			console.error('[workshopDailyReport] gagal membaca isi laporan yang ada (gabung):', e?.message);
			throw unavailable('Gagal membaca laporan yang ada — coba lagi.');
		});
		existingAbsensi = kids[0]?.data || [];
		plan = planMerge({ absensi: existingAbsensi, material: kids[1]?.data || [], poDetails: kids[2]?.data || [] }, { header, absensi, absensiLeader, material, poDetails });
	}
	const newPoDetails = applyPoManpower(plan.poDetails, plan.absensi, plan.absensiLeader);
	const jumlahTenaga = countUniqueHadir(
		[...existingAbsensi.filter((r) => r.tipe !== 'leader'), ...plan.absensi],
		[...existingAbsensi.filter((r) => r.tipe === 'leader'), ...plan.absensiLeader]
	);

	// 6) tulis dengan kompensasi
	const done: { headerCreatedId: number | null; headerBefore: Record<string, any> | null; absensi: any[]; splits: any[]; material: any[]; poDetail: any[] } =
		{ headerCreatedId: null, headerBefore: null, absensi: [], splits: [], material: [], poDetail: [] };
	const del = (coll: string, ids: any[]) => (ids.length ? directusServerJson(`/items/${coll}`, { method: 'DELETE', body: JSON.stringify(ids) }) : Promise.resolve());
	async function compensate(): Promise<string[]> {
		const failures: string[] = [];
		for (const [coll, ids] of [[SPLIT, done.splits], [PO_DETAIL, done.poDetail], [MATERIAL, done.material], [ABSENSI, done.absensi]] as [string, any[]][]) {
			try { await del(coll, ids); } catch (e: any) { failures.push(`${coll}: ${e?.message}`); }
		}
		try {
			if (done.headerCreatedId) await directusServerJson(`/items/${DAILY}/${done.headerCreatedId}`, { method: 'DELETE' });
			else if (done.headerBefore && target) await directusServerJson(`/items/${DAILY}/${target.id}`, { method: 'PATCH', body: JSON.stringify(done.headerBefore) });
		} catch (e: any) { failures.push(`header: ${e?.message}`); }
		return failures;
	}

	let laporanId: number | undefined;
	try {
		if (target) {
			laporanId = target.id;
			const patch: Record<string, any> = { jumlah_tenaga: jumlahTenaga };
			const kendala = mergeText(target.kendala, header.kendala);
			const catatan = mergeText(target.catatan, header.catatan);
			if (kendala !== String(target.kendala ?? '').trim()) patch.kendala = kendala;
			if (catatan !== String(target.catatan ?? '').trim()) patch.catatan = catatan;
			if (!target.foto_absensi_masuk && header.foto_absensi_masuk) patch.foto_absensi_masuk = header.foto_absensi_masuk;
			if (!target.foto_absensi_pulang && header.foto_absensi_pulang) patch.foto_absensi_pulang = header.foto_absensi_pulang;
			done.headerBefore = Object.fromEntries(Object.keys(patch).map((k) => [k, target[k] ?? null]));
			await directusServerJson(`/items/${DAILY}/${target.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
		} else {
			const created = (await directusServerJson(`/items/${DAILY}`, {
				method: 'POST',
				body: JSON.stringify({ ...header, workshop_id: P.id, sumber_data: 'sistem', dibuat_oleh: actor, jumlah_tenaga: jumlahTenaga })
			}))?.data;
			if (!created?.id) throw new Error('respons header tidak lengkap');
			laporanId = created.id as number;
			done.headerCreatedId = created.id;
		}

		const absRows = [
			...plan.absensi.map((r: any) => ({ r, tipe: 'manpower' })),
			...plan.absensiLeader.map((r: any) => ({ r, tipe: 'leader' }))
		];
		if (absRows.length) {
			const res = await directusServerJson(`/items/${ABSENSI}`, {
				method: 'POST',
				body: JSON.stringify(absRows.map(({ r, tipe }) => ({
					workshop_id: P.id, laporan_id: laporanId, nama: r.nama, jabatan: r.jabatan, status_hadir: r.status_hadir, keterangan: r.keterangan,
					tipe, foto_masuk: r.foto_masuk, foto_pulang: r.foto_pulang, manpower_id: r.manpower_id ?? null
				})))
			});
			const ids = idsOf(res);
			done.absensi.push(...ids);
			if (ids.length !== absRows.length) throw new Error('respons absensi tidak lengkap');
			const splitRows: any[] = [];
			absRows.forEach(({ r }, i) => (r.po_split || []).forEach((s: any) => splitRows.push({ laporan_id: laporanId, absensi_id: ids[i], po_id: s.po_id, persentase: s.persentase })));
			if (splitRows.length) {
				const sres = await directusServerJson(`/items/${SPLIT}`, { method: 'POST', body: JSON.stringify(splitRows) });
				done.splits.push(...idsOf(sres));
				if (done.splits.length !== splitRows.length) throw new Error('respons pembagian PO tidak lengkap');
			}
		}
		if (plan.material.length) {
			const res = await directusServerJson(`/items/${MATERIAL}`, { method: 'POST', body: JSON.stringify(plan.material.map((m: any) => ({ workshop_id: P.id, laporan_id: laporanId, ...m }))) });
			done.material.push(...idsOf(res));
			if (done.material.length !== plan.material.length) throw new Error('respons material tidak lengkap');
		}
		if (newPoDetails.length) {
			const res = await directusServerJson(`/items/${PO_DETAIL}`, { method: 'POST', body: JSON.stringify(newPoDetails.map((d: any) => ({ workshop_id: P.id, laporan_id: laporanId, ...d }))) });
			done.poDetail.push(...idsOf(res));
			if (done.poDetail.length !== newPoDetails.length) throw new Error('respons progres PO tidak lengkap');
		}
	} catch (e: any) {
		console.error('[workshopDailyReport] penyimpanan gagal — kompensasi:', e?.message);
		const failures = await compensate();
		if (failures.length) {
			console.error('[workshopDailyReport] KOMPENSASI SEBAGIAN GAGAL — periksa laporan #' + (laporanId ?? '?') + ':', failures);
			throw unavailable(`Penyimpanan gagal DAN pembatalan otomatis tidak tuntas. JANGAN kirim ulang — hubungi admin workshop: periksa laporan #${laporanId ?? '?'} (${header.tanggal}).`);
		}
		throw unavailable('Laporan gagal disimpan — tidak ada yang tersimpan. Isian Anda masih ada di form, coba lagi.');
	}

	// 7) audit (non-fatal)
	directusServerJson('/items/activity_log', {
		method: 'POST',
		body: JSON.stringify({
			module: P.key === 'balaraja' ? 'ws_balaraja' : 'ws_ciketing', collection: DAILY, record_id: String(laporanId), action: target ? 'update' : 'create', activity_type: 'info',
			description: `Laporan harian ${header.tanggal} ${target ? 'digabung ke laporan #' + laporanId : 'dicatat'} dari lapangan oleh ${actor}: ${jumlahTenaga} orang hadir, ${done.absensi.length} absensi baru, ${done.poDetail.length} progres PO, ${done.material.length} material.`.slice(0, 2000),
			actor_id: karyawan?.id != null ? String(karyawan.id) : null, actor_name: actor, created_at: new Date().toISOString()
		})
	}).catch((e: any) => console.warn('[workshopDailyReport] gagal catat activity_log:', e?.message));

	const manpowerForSync = plan.absensi.filter((r: any) => r.manpower_id != null && r.manpower_id !== '').map((r: any) => ({ manpower_id: r.manpower_id, status_hadir: r.status_hadir }));
	return json({
		success: true, idempotent: false, laporanId, merged: !!target, jumlahTenaga, dibuatOleh: target ? target.dibuat_oleh ?? null : actor,
		counts: { absensi: done.absensi.length, splits: done.splits.length, material: done.material.length, poDetail: done.poDetail.length },
		skipped: plan.skipped, manpowerForSync
	});
}

const WIB_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const QUICK_LIMITS = Object.freeze({ aktivitas: 500, foto: 20 });

/**
 * Quick Report lapangan (1 PO + foto + catatan singkat) — atomik + idempoten.
 *   POST { clientTxnId, projectId, aktivitas?, fotoIds[] }
 * Sengaja TIDAK dibatasi satu-per-tanggal (pelengkap laporan lengkap; boleh >1 per hari agar jejak waktu foto akurat) dan TIDAK menghitung
 * jumlah_tenaga. Tanggal = hari ini WIB menurut SERVER (bukan jam HP). Header Quick Report tidak menghalangi laporan lengkap hari itu (NOT_QUICK_FILTER).
 */
export async function handleQuickReportCreate(event: RequestEvent, wsKey: OpsWorkshopKey) {
	const P = opsProfile(wsKey);
	const body: any = await event.request.json().catch(() => ({}));
	const txn = String(body?.clientTxnId || '').trim();
	if (txn.length < 8 || txn.length > 100) throw error(400, 'clientTxnId wajib (muat ulang halaman lalu coba lagi).');
	const projectId = Number(body?.projectId);
	if (!Number.isInteger(projectId) || projectId <= 0) throw error(400, 'Pilih PO terlebih dahulu.');
	const aktivitas = String(body?.aktivitas ?? '').trim();
	if (aktivitas.length > QUICK_LIMITS.aktivitas) throw error(400, `Catatan maksimal ${QUICK_LIMITS.aktivitas} karakter.`);
	const fotoIds: string[] = Array.isArray(body?.fotoIds) ? body.fotoIds.map((x: unknown) => String(x)) : [];
	if (fotoIds.length === 0) throw error(400, 'Foto wajib diambil.');
	if (fotoIds.length > QUICK_LIMITS.foto) throw error(400, `Maksimal ${QUICK_LIMITS.foto} foto.`);
	if (fotoIds.some((id) => !FILE_ID.test(id))) throw error(400, 'Foto tidak valid — unggah ulang fotonya.');

	const { karyawan, actor } = await authorizeForPos(event, P, [projectId]);

	const marker = txnMarker(txn);
	const prior = await directusServerJson(
		`/items/${DAILY}?filter[workshop_id][_eq]=${P.id}&filter[catatan][_contains]=${encodeURIComponent(marker)}&fields=id&limit=1`
	).catch((e: any) => {
		console.error('[quickReport] cek idempoten gagal:', e?.message);
		throw unavailable('Gagal memeriksa permintaan sebelumnya — coba lagi.');
	});
	if (prior?.data?.[0]) return json({ success: true, idempotent: true, laporanId: prior.data[0].id });

	const tanggal = WIB_DATE.format(new Date());
	let laporanId: number | undefined;
	try {
		const created = (await directusServerJson(`/items/${DAILY}`, {
			method: 'POST',
			body: JSON.stringify({
				workshop_id: P.id, tanggal, jumlah_tenaga: 0, sumber_data: 'sistem', dibuat_oleh: actor,
				catatan: `${QUICK_PREFIX} ${aktivitas}`.trim() + `\n${marker}`
			})
		}))?.data;
		if (!created?.id) throw new Error('respons header tidak lengkap');
		laporanId = created.id as number;
		const res = await directusServerJson(`/items/${PO_DETAIL}`, {
			method: 'POST',
			body: JSON.stringify([{
				workshop_id: P.id, laporan_id: laporanId, po_id: projectId, subtask_name: 'Quick Report Lapangan', aktivitas: aktivitas || null,
				jumlah_manpower: 0, foto_urls: fotoIds.map((id) => ({ stage: null, file_id: id }))
			}])
		});
		if (idsOf(res).length !== 1) throw new Error('respons progres PO tidak lengkap');
	} catch (e: any) {
		console.error('[quickReport] penyimpanan gagal — kompensasi:', e?.message);
		if (laporanId) {
			try { await directusServerJson(`/items/${DAILY}/${laporanId}`, { method: 'DELETE' }); } catch (e2: any) {
				console.error('[quickReport] KOMPENSASI GAGAL — header #' + laporanId + ' tersisa:', e2?.message);
				throw unavailable(`Penyimpanan gagal DAN pembatalan otomatis tidak tuntas. JANGAN kirim ulang — hubungi admin workshop: periksa laporan #${laporanId}.`);
			}
		}
		throw unavailable('Quick report gagal disimpan — tidak ada yang tersimpan. Coba lagi.');
	}

	directusServerJson('/items/activity_log', {
		method: 'POST',
		body: JSON.stringify({
			module: P.key === 'balaraja' ? 'ws_balaraja' : 'ws_ciketing', collection: DAILY, record_id: String(laporanId), action: 'create', activity_type: 'info',
			description: `Quick report ${tanggal} PO #${projectId} dari lapangan oleh ${actor}: ${fotoIds.length} foto.`.slice(0, 2000),
			actor_id: karyawan?.id != null ? String(karyawan.id) : null, actor_name: actor, created_at: new Date().toISOString()
		})
	}).catch((e: any) => console.warn('[quickReport] gagal catat activity_log:', e?.message));

	return json({ success: true, idempotent: false, laporanId, tanggal });
}
