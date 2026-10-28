// src/lib/server/gerbangSj/actions.ts
// GSP-04/05/06 — SATU-SATUNYA tempat yang menulis keputusan gerbang SJ (Loloskan / Tahan).
// Route tidak boleh menulis Directus sendiri. Langkah 1 (PATCH surat_jalan, CAS) menentukan sukses;
// langkah berikutnya best-effort (effects.ts) dan dilaporkan di `effects_gagal`.

import { directusServerJson, directusServerUpload } from '../directus';
import { buildRiwayat } from './checklist';
import {
	checkP2hVehicleToday, checkPatrolActiveToday, logProcess, lolosMessage, notifyLogistik, notifyProject, recordLolos, recordTahan,
	runEffect, writeGateGoodsLog
} from './effects';
import { getDetail, type Detail } from './query';
import { FIELDS_PENJUALAN } from './penjualan';
import { normalizeChecklist } from './checklist';
import { assertBisaDitahan, parseClientEventId, validateLoloskan, validateTahan } from './rules';
import { casPatchBody } from '../directusCas';
import { getGerbangSettings } from './settings';
import { recordKioskTrackingEvent } from '../sjTracking';
import { getFieldGateMode } from '../gateEnforcement';
import { writeGateAudit } from '../gates/gateAudit';
import { SCAN_SOURCE_BY_SUMBER } from './types';
import { getInventorySettingServer } from '../inventorySettings';
import { receiveProjectDelivery } from '../receiveProjectDelivery';
import { GateError, type GateActor, type GateResult } from './types';

const sjView = (d: Detail, status?: string, stage?: string | null) => ({
	id: d.sj.id, nomor_sj: d.sj.nomor_sj, status: status ?? d.sj.status, track_stage: stage === undefined ? d.sj.track_stage : stage
});

/** Hasil aksi sebelumnya bila client_event_id sudah pernah diproses (idempoten). */
async function findPriorEvent(clientEventId: string): Promise<'lolos' | 'ditahan' | null> {
	const r = await directusServerJson<{ data: any[] }>(
		`/items/scan_log?filter[client_event_id][_eq]=${encodeURIComponent(clientEventId)}&filter[ref_collection][_eq]=surat_jalan&fields=id,stage_to&limit=1`
	).catch((e) => {
		console.error('[gerbangSj] cek idempoten gagal:', e instanceof Error ? e.message : e);
		return null;
	});
	const row = r?.data?.[0];
	return row ? (row.stage_to === 'lolos_gerbang' ? 'lolos' : 'ditahan') : null;
}

/** foto_file_id harus file yang baru diunggah lewat endpoint foto gerbang untuk SJ ini. */
async function assertFotoValid(fotoId: string | null | undefined, sjId: number) {
	if (!fotoId) return;
	const f = (await directusServerJson<{ data: any }>(`/files/${encodeURIComponent(fotoId)}?fields=id,title`).catch(() => null))?.data;
	if (!f || !String(f.title || '').includes(`Gerbang SJ ${sjId} `)) {
		throw new GateError(400, 'FOTO_TIDAK_VALID', 'Foto tidak valid. Ambil ulang foto dari layar gerbang.');
	}
}

export async function uploadFotoGerbang(sjId: number, file: File, actor: GateActor): Promise<string> {
	if (!(file instanceof File) || file.size === 0) throw new GateError(400, 'INPUT_TIDAK_VALID', 'File foto tidak ada.');
	if (file.size > 8 * 1024 * 1024) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Foto terlalu besar (maks 8 MB).');
	const up = new FormData();
	// "Gerbang SJ <id> " (spasi penutup) = penanda yang dicek assertFotoValid
	up.append('title', `Gerbang SJ ${sjId} - ${actor.label} - ${new Date().toISOString()}`);
	up.append('file', file, `gerbang-sj-${sjId}-${Date.now()}.jpg`);
	const res = await directusServerUpload(up);
	if (!res.ok) throw new GateError(502, 'INPUT_TIDAK_VALID', 'Gagal mengunggah foto.');
	const body = await res.json().catch(() => null);
	if (!body?.data?.id) throw new GateError(502, 'INPUT_TIDAK_VALID', 'Upload foto tidak mengembalikan id.');
	return body.data.id;
}

export type AksiOpsi = {
	/** jalur lama (endpoint kiosk/app sebelum layar GSP): koli_dihitung & cek per item belum dikirim layar */
	legacy?: boolean;
	/** tambahan ke security_checklist (mis. patrol/P2H dari jalur app) */
	extraChecklist?: Record<string, unknown>;
};

export async function loloskan(sjId: number, raw: unknown, actor: GateActor, opsi: AksiOpsi = {}): Promise<GateResult> {
	const clientEventId = parseClientEventId((raw as any)?.client_event_id);

	const prior = await findPriorEvent(clientEventId);
	if (prior) {
		const d = await getDetail(sjId, { fullGuard: false });
		return { ok: true, hasil: prior, idempoten: true, sj: sjView(d), pesan: `SJ ${d.sj.nomor_sj} sudah diproses sebelumnya.`, effects_gagal: [] };
	}

	const d = await getDetail(sjId);
	if (d.already_passed) {
		return {
			ok: true, hasil: 'lolos', idempoten: true, sj: sjView(d),
			pesan: `SJ sudah diloloskan oleh ${d.sj.security_verified_by || 'petugas lain'}.`, effects_gagal: []
		};
	}
	const settings = await getGerbangSettings();
	const input = validateLoloskan(raw, {
		koli_acuan: d.sj.koli_acuan, item_ids: d.items.map((i) => i.id), item_wajib: settings.itemWajib, foto_wajib: settings.fotoWajib, legacy: opsi.legacy
	});
	if (!d.can_pass) {
		const first = d.blockers[0];
		throw new GateError(409, first?.kode ?? 'BELUM_SIAP_GERBANG', d.blockers.map((b) => b.pesan).join(' ') || 'SJ belum boleh diloloskan.', d.blockers);
	}
	if (!opsi.legacy) await assertFotoValid(input.foto_file_id, sjId); // jalur lama mengunggah foto dengan judul berbeda

	const now = new Date().toISOString();
	const [patrolActive, p2hOk] = await Promise.all([
		checkPatrolActiveToday(actor.karyawanId),
		checkP2hVehicleToday(d.sj.vehicle_id)
	]);
	const itemsPayload = input.items?.length
		? input.items.map((c) => {
			const it = d.items.find((x) => x.id === c.sj_item_id);
			return { sj_item_id: c.sj_item_id, nama_barang: it?.nama_barang ?? null, qty: it?.qty ?? null, unit: it?.unit ?? null, ok: c.ok, catatan: c.catatan ?? null };
		})
		: null;

	// ── Langkah 1: PATCH surat_jalan (CAS) — satu-satunya penentu sukses ──
	const isPrePrint = d.sj.draft_status === 'menunggu_verifikasi';
	const adminApproved = !!(d.sj.admin_verif_at || (d.sj as any).pengaju_verification?.verified_at);
	const targetStatus = isPrePrint ? (adminApproved ? 'ready_to_print' : 'needs_security_check') : 'shipped';
	const targetDraftStatus = isPrePrint ? (adminApproved ? 'disetujui' : 'menunggu_verifikasi') : 'siap_kirim';

	const patch = await directusServerJson<{ data: any[] }>(
		'/items/surat_jalan',
		{
			method: 'PATCH',
			body: casPatchBody([{ id: { _eq: sjId } }, { status: { _eq: d.sj.status } }], {
				status: targetStatus,
				draft_status: targetDraftStatus,
				security_verified_at: now,
				security_verified_by: actor.label,
				security_checklist: {
					versi: 2, hasil: 'lolos', sumber: actor.sumber, oleh_id: actor.karyawanId, oleh_nama: actor.nama, waktu: now,
					jumlah_ok: true, plat_ok: true, driver_ok: true,
					koli_acuan: d.sj.koli_acuan, koli_sumber: d.sj.koli_sumber, koli_dihitung: input.koli_dihitung ?? null,
					plat_sj: d.sj.plat, driver_sj: d.sj.driver,
					items: itemsPayload, foto: input.foto_file_id ?? null, gps: input.gps ?? null, catatan: input.catatan ?? null,
					patrol_session_active: patrolActive, p2h_vehicle_ok: p2hOk, gate_check: d._gate_check ?? null,
					client_event_id: clientEventId, riwayat: buildRiwayat(d.checklist),
					...(opsi.extraChecklist || {})
				},
				// jangan kirim null: tidak boleh menghapus foto lama. GPS gerbang TIDAK ditulis ke gr_gps_* (GSP-05).
				...(input.foto_file_id ? { foto_kirim: input.foto_file_id } : {})
			})
		}
	);
	if (!Array.isArray(patch?.data) || patch.data.length === 0) {
		const now2 = await getDetail(sjId, { fullGuard: false });
		if (now2.already_passed) {
			return { ok: true, hasil: 'lolos', idempoten: true, sj: sjView(now2), pesan: `SJ sudah diloloskan oleh ${now2.sj.security_verified_by || 'petugas lain'}.`, effects_gagal: [] };
		}
		throw new GateError(409, 'STATUS_BERUBAH', `Status SJ berubah (${now2.sj.status}). Muat ulang daftar lalu coba lagi.`);
	}

	// ── Langkah 2–5: best-effort ──
	const gagal: string[] = [];
	// RSM-08: SJ masih 'created' = gudang tidak memindai muat. Catat tahap 'dimuat' (otomatis) SEBELUM 'lolos_gerbang'
	// supaya rantai tahap utuh. TIDAK menyentuh stok (stok dipotong saat SJ dibuat / finalisasi draft). Gate
	// G_SJ_MUAT_DISCAN hanya MENCATAT kepatuhan (shadow/warn) — tidak pernah memblokir satpam (Aturan #6).
	if (d.sj.status === 'created') {
		const g1 = await runEffect('muat_otomatis', sjId, () => recordKioskTrackingEvent({
			sjId, stageTo: 'dimuat', actor: { id: actor.karyawanId, nama: actor.nama, role: 'satpam' },
			notes: 'Muat tidak discan — dicatat otomatis saat Loloskan di gerbang (RSM-08)', clientEventId: `${clientEventId}-muat`,
			source: SCAN_SOURCE_BY_SUMBER[actor.sumber]
		}));
		if (g1) gagal.push(g1);
		const g2 = await runEffect('gate_audit_muat', sjId, async () => {
			const mode = await getFieldGateMode('G_SJ_MUAT_DISCAN');
			await writeGateAudit({
				gate: 'G_SJ_MUAT_DISCAN', collection: 'surat_jalan', recordId: sjId, decision: mode === 'shadow' ? 'shadow' : 'warn',
				reason: 'SJ diloloskan di gerbang tanpa scan muat di gudang', snapshot: { nomor_sj: d.sj.nomor_sj, project_id: d.sj.project_id, sumber: actor.sumber }, email: actor.email
			});
		});
		if (g2) gagal.push(g2);
	}
	// RSM-11: mode 'otomatis_gerbang' = barang proyek dianggap DITERIMA saat lolos gerbang (IN-RECEIPT + biaya diakui).
	// Mode lain tidak menyentuh (default 'saat_sj_dibuat' sudah mengakui saat SJ dibuat). Gagal -> effects_gagal, tidak membatalkan.
	if (!isPrePrint && d.sj.project_id) {
		const g3 = await runEffect('terima_site', sjId, async () => {
			const mode = await getInventorySettingServer<string>('inventory.terima_site.mode', 'saat_sj_dibuat');
			if (mode === 'otomatis_gerbang') await receiveProjectDelivery(sjId, { by: { id: actor.karyawanId, nama: actor.nama }, source: 'gerbang' });
		});
		if (g3) gagal.push(g3);
	}
	const koliLog = input.koli_dihitung ?? d.sj.koli_acuan;
	const adaReturn = d.sj.return_status === 'menunggu' || !!d.sj.return_deadline;
	const hasil = await Promise.all([
		!isPrePrint
			? runEffect('tahap_tracking', sjId, () => recordLolos({ sjId, actor, gps: input.gps ?? null, fotoId: input.foto_file_id ?? null, notes: input.catatan || 'Checklist gerbang lolos', clientEventId }))
			: null,
		runEffect('gate_log', sjId, () => writeGateGoodsLog({
			deskripsi: `[SJ ${d.sj.nomor_sj}] ${isPrePrint ? 'VERIFIKASI FISIK PRE-CETAK LOLOS' : 'LOLOS'} — ${d.items.length} item${koliLog != null ? `, ${koliLog} koli` : ''}`,
			qty: koliLog ?? d.items.length, satuan: koliLog != null ? 'koli' : 'item', driver: d.sj.driver, fotoId: input.foto_file_id ?? null,
			nomorSj: d.sj.nomor_sj, actor, expectedReturn: adaReturn ? d.sj.return_deadline : null
		})),
		runEffect('notifikasi', sjId, () => notifyLogistik({
			title: isPrePrint ? `SJ ${d.sj.nomor_sj}: Fisik lolos verifikasi satpam` : `SJ ${d.sj.nomor_sj} lolos gerbang`,
			message: isPrePrint ? `Pemeriksaan muatan fisik di lapangan lolos oleh ${actor.label}.${adminApproved ? ' Surat jalan siap dicetak.' : ' Menunggu verifikasi admin proyek.'}` : lolosMessage(actor),
			priority: 'medium',
			actionRequired: false
		})),
		runEffect('process_log', sjId, () => logProcess(sjId, isPrePrint ? 'security_pre_print_passed' : 'security_passed', actor))
	]);
	for (const g of hasil) if (g) gagal.push(g);

	return {
		ok: true, hasil: 'lolos', idempoten: false, sj: sjView(d, targetStatus, isPrePrint ? (d.sj.track_stage ?? null) : 'lolos_gerbang'),
		pesan: isPrePrint
			? (adminApproved ? `Pemeriksaan fisik lolos! Surat Jalan ${d.sj.nomor_sj} siap dicetak.` : `Pemeriksaan fisik lolos! Menunggu verifikasi Admin Proyek.`)
			: `SJ ${d.sj.nomor_sj} diloloskan keluar.`,
		effects_gagal: gagal
	};
}

export async function tahan(sjId: number, raw: unknown, actor: GateActor): Promise<GateResult> {
	const clientEventId = parseClientEventId((raw as any)?.client_event_id);

	const prior = await findPriorEvent(clientEventId);
	if (prior) {
		const d = await getDetail(sjId, { fullGuard: false });
		return { ok: true, hasil: prior, idempoten: true, sj: sjView(d), pesan: `SJ ${d.sj.nomor_sj} sudah diproses sebelumnya.`, effects_gagal: [] };
	}

	// Tahan TIDAK melewati blocker (cetak/approval/dll) — satpam selalu boleh mencatat penahanan (Aturan #6).
	const d = await getDetail(sjId, { fullGuard: false });
	assertBisaDitahan(d.sj.status);
	const input = validateTahan(raw);
	await assertFotoValid(input.foto_file_id, sjId);

	const now = new Date().toISOString();
	const cl = input.checklist || {};
	const itemsPayload = input.items?.length
		? input.items.map((c) => ({ sj_item_id: c.sj_item_id, nama_barang: d.items.find((x) => x.id === c.sj_item_id)?.nama_barang ?? null, ok: c.ok, catatan: c.catatan ?? null }))
		: null;

	const isPrePrint = d.sj.draft_status === 'menunggu_verifikasi';

	// ── Langkah 1: PATCH security_checklist (CAS) — tidak menimpa hasil Loloskan yang terjadi bersamaan ──
	const patch = await directusServerJson<{ data: any[] }>(
		'/items/surat_jalan',
		{
			method: 'PATCH',
			body: casPatchBody([{ id: { _eq: sjId } }, { status: { _eq: d.sj.status } }], {
				...(isPrePrint ? {
					status: 'perlu_revisi',
					draft_status: 'perlu_revisi',
					catatan_khusus: `[Temuan Satpam - ${actor.nama}]: (${input.kategori}) ${input.alasan}`,
					security_verified_at: null
				} : {}),
				security_checklist: {
					versi: 2, hasil: 'ditahan', ditahan: true /* kompat pembaca lama (ERP tabel SJ) */, sumber: actor.sumber, oleh_id: actor.karyawanId, oleh_nama: actor.nama, waktu: now,
					kategori: input.kategori, alasan: input.alasan,
					jumlah_ok: cl.jumlah_ok ?? null, plat_ok: cl.plat_ok ?? null, driver_ok: cl.driver_ok ?? null,
					koli_acuan: d.sj.koli_acuan, koli_dihitung: input.koli_dihitung ?? null,
					items: itemsPayload, foto: input.foto_file_id ?? null, gps: input.gps ?? null,
					client_event_id: clientEventId, riwayat: buildRiwayat(d.checklist)
				}
			})
		}
	);
	if (!Array.isArray(patch?.data) || patch.data.length === 0) {
		const now2 = await getDetail(sjId, { fullGuard: false });
		throw new GateError(409, 'STATUS_BERUBAH', `Status SJ berubah (${now2.sj.status}). Muat ulang daftar lalu coba lagi.`);
	}

	const gagal: string[] = [];
	const notes = isPrePrint
		? `PERLU REVISI (Satpam - ${input.kategori}): ${input.alasan}`
		: `DITAHAN di gerbang (${input.kategori}): ${input.alasan}`;
	const hasil = await Promise.all([
		!isPrePrint
			? runEffect('scan_log', sjId, () => recordTahan({ sjId, actor, gps: input.gps ?? null, fotoId: input.foto_file_id ?? null, notes, clientEventId, stageFrom: d.sj.track_stage }))
			: null,
		runEffect('gate_log', sjId, () => writeGateGoodsLog({
			deskripsi: `[SJ ${d.sj.nomor_sj}] ${isPrePrint ? 'SELISIH / PERLU REVISI' : 'DITAHAN'} (${input.kategori}) — ${input.alasan}`,
			qty: input.koli_dihitung ?? null, satuan: 'koli', driver: d.sj.driver, fotoId: input.foto_file_id ?? null, nomorSj: d.sj.nomor_sj, actor
		})),
		runEffect('notifikasi', sjId, () => notifyLogistik({
			title: isPrePrint ? `SJ ${d.sj.nomor_sj} PERLU REVISI (Catatan Satpam)` : `SJ ${d.sj.nomor_sj} DITAHAN di gerbang`,
			message: `${input.kategori}: ${input.alasan} — oleh ${actor.label}.${isPrePrint ? ' Silakan periksa dan revisi draft surat jalan.' : ' Bereskan lalu minta satpam periksa ulang.'}`,
			priority: 'high', actionRequired: true
		})),
		runEffect('process_log', sjId, () => logProcess(sjId, isPrePrint ? 'security_pre_print_rejected' : 'security_held', actor, { kategori: input.kategori, alasan: input.alasan })),
		// GSP-06 K1: SJ proyek → admin proyek juga diberi tahu (kiriman proyek tertahan di gerbang).
		d.sj.project_id
			? runEffect('notifikasi_project', sjId, () => notifyProject({
				title: isPrePrint ? `SJ ${d.sj.nomor_sj} PERLU REVISI${d.sj.project_nama ? ` — ${d.sj.project_nama}` : ''}` : `SJ ${d.sj.nomor_sj} DITAHAN di gerbang${d.sj.project_nama ? ` — ${d.sj.project_nama}` : ''}`,
				message: `${input.kategori}: ${input.alasan} — oleh ${actor.label}.${isPrePrint ? ' Ada temuan selisih barang pada pemeriksaan fisik.' : ' Barang proyek belum boleh keluar sampai gudang membereskan.'}`
			}))
			: Promise.resolve(null)
	]);
	for (const g of hasil) if (g) gagal.push(g);

	return {
		ok: true, hasil: 'ditahan', idempoten: false, sj: sjView(d, isPrePrint ? 'perlu_revisi' : d.sj.status),
		pesan: isPrePrint
			? `Catatan selisih berhasil disimpan. SJ ${d.sj.nomor_sj} dikembalikan untuk direvisi.`
			: `SJ ${d.sj.nomor_sj} ditahan. Gudang sudah diberi tahu.`,
		effects_gagal: gagal
	};
}

/** SJ-09 opsi C — loloskan SJ penjualan: catat saja — status TIDAK diubah. Idempoten (CAS pada track_stage/security_verified_at). */
export async function loloskanPenjualan(sjId: number, raw: unknown, actor: GateActor): Promise<GateResult> {
	const clientEventId = parseClientEventId((raw as any)?.client_event_id);
	const settings = await getGerbangSettings();
	if (!settings.penjualanAktif) throw new GateError(409, 'BELUM_SIAP_GERBANG', 'Gerbang SJ penjualan belum diaktifkan (setelan logistik › gerbang_penjualan_aktif).');

	const sj = (await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}?fields=${FIELDS_PENJUALAN}`).catch(() => null))?.data;
	if (!sj) throw new GateError(404, 'TIDAK_DITEMUKAN', 'Surat Jalan tidak ditemukan.');
	if (sj.type !== 'so_delivery') throw new GateError(409, 'BELUM_SIAP_GERBANG', 'Ini bukan SJ penjualan — gunakan antrean gerbang biasa.');
	const view = { id: sj.id, nomor_sj: sj.nomor_sj, status: sj.status, track_stage: sj.track_stage ?? null };
	if (sj.track_stage === 'lolos_gerbang' || sj.security_verified_at) {
		return { ok: true, hasil: 'lolos', idempoten: true, sj: view, pesan: `SJ ${sj.nomor_sj} sudah dicatat lolos gerbang.`, effects_gagal: [] };
	}

	const foto = (raw as any)?.foto_file_id ?? null;
	const catatan = typeof (raw as any)?.catatan === 'string' ? (raw as any).catatan.slice(0, 500) : null;
	const now = new Date().toISOString();
	// CAS: hanya bila belum pernah dicatat. STATUS SENGAJA TIDAK DIUBAH (tetap delivered).
	const patch = await directusServerJson<{ data: any[] }>(
		'/items/surat_jalan',
		{
			method: 'PATCH',
			body: casPatchBody([{ id: { _eq: sjId } }, { type: { _eq: 'so_delivery' } }, { track_stage: { _null: true } }, { security_verified_at: { _null: true } }], {
				security_verified_at: now,
				security_verified_by: actor.label,
				security_checklist: { versi: 2, hasil: 'lolos', sumber: actor.sumber, oleh_id: actor.karyawanId, oleh_nama: actor.nama, waktu: now, jalur: 'penjualan', catatan, client_event_id: clientEventId, riwayat: buildRiwayat(normalizeChecklist(sj.security_checklist)) }
			})
		}
	);
	if (!Array.isArray(patch?.data) || patch.data.length === 0) {
		return { ok: true, hasil: 'lolos', idempoten: true, sj: view, pesan: `SJ ${sj.nomor_sj} sudah dicatat oleh petugas lain.`, effects_gagal: [] };
	}

	const gagal: string[] = [];
	const hasil = await Promise.all([
		runEffect('tahap_tracking', sjId, () => recordLolos({ sjId, actor, gps: null, fotoId: foto, notes: catatan || 'Gerbang SJ penjualan', clientEventId })),
		runEffect('gate_log', sjId, () => writeGateGoodsLog({
			deskripsi: `[SJ ${sj.nomor_sj}] PENJUALAN LOLOS GERBANG`, qty: null, satuan: 'item', driver: sj.driver, fotoId: foto, nomorSj: sj.nomor_sj, actor
		})),
		runEffect('notifikasi', sjId, () => notifyLogistik({ title: `SJ penjualan ${sj.nomor_sj} lolos gerbang`, message: lolosMessage(actor), priority: 'medium', actionRequired: false })),
		runEffect('process_log', sjId, () => logProcess(sjId, 'security_passed', actor, { jalur: 'penjualan' }))
	]);
	for (const g of hasil) if (g) gagal.push(g);
	return { ok: true, hasil: 'lolos', idempoten: false, sj: { ...view, track_stage: 'lolos_gerbang' }, pesan: `SJ penjualan ${sj.nomor_sj} dicatat lolos gerbang (status tetap ${sj.status}).`, effects_gagal: gagal };
}

/**
 * SJ-09 opsi C — TAHAN SJ penjualan: hanya mencatat penahanan (security_checklist.hasil = 'ditahan' + scan_log tanpa
 * perpindahan tahap + notifikasi). Status SJ TIDAK berubah dan security_verified_* TIDAK diisi, jadi SJ tetap di antrean
 * (bertanda DITAHAN) dan masih bisa dicatat lolos setelah dibereskan. Satpam selalu boleh menahan (Aturan #6).
 */
export async function tahanPenjualan(sjId: number, raw: unknown, actor: GateActor): Promise<GateResult> {
	const clientEventId = parseClientEventId((raw as any)?.client_event_id);
	const prior = await findPriorEvent(clientEventId);
	const settings = await getGerbangSettings();
	if (!settings.penjualanAktif) throw new GateError(409, 'BELUM_SIAP_GERBANG', 'Gerbang SJ penjualan belum diaktifkan (setelan logistik › gerbang_penjualan_aktif).');

	const sj = (await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}?fields=${FIELDS_PENJUALAN}`).catch(() => null))?.data;
	if (!sj) throw new GateError(404, 'TIDAK_DITEMUKAN', 'Surat Jalan tidak ditemukan.');
	if (sj.type !== 'so_delivery') throw new GateError(409, 'TIDAK_BISA_DITAHAN', 'Ini bukan SJ penjualan — gunakan antrean gerbang biasa.');
	const view = { id: sj.id, nomor_sj: sj.nomor_sj, status: sj.status, track_stage: sj.track_stage ?? null };
	if (prior) return { ok: true, hasil: 'ditahan', idempoten: true, sj: view, pesan: `SJ ${sj.nomor_sj} sudah diproses sebelumnya.`, effects_gagal: [] };
	if (sj.track_stage || sj.security_verified_at) {
		throw new GateError(409, 'TIDAK_BISA_DITAHAN', `SJ ${sj.nomor_sj} sudah dicatat lolos gerbang — tidak bisa ditahan. Laporkan lewat Insiden.`);
	}

	const input = validateTahan(raw);
	await assertFotoValid(input.foto_file_id, sjId);
	const now = new Date().toISOString();
	const patch = await directusServerJson<{ data: any[] }>(
		'/items/surat_jalan',
		{
			method: 'PATCH',
			body: casPatchBody([{ id: { _eq: sjId } }, { type: { _eq: 'so_delivery' } }, { track_stage: { _null: true } }, { security_verified_at: { _null: true } }], {
				security_checklist: {
					versi: 2, hasil: 'ditahan', ditahan: true, sumber: actor.sumber, oleh_id: actor.karyawanId, oleh_nama: actor.nama, waktu: now,
					jalur: 'penjualan', kategori: input.kategori, alasan: input.alasan, foto: input.foto_file_id ?? null, gps: input.gps ?? null,
					client_event_id: clientEventId, riwayat: buildRiwayat(normalizeChecklist(sj.security_checklist))
				}
			})
		}
	);
	if (!Array.isArray(patch?.data) || patch.data.length === 0) {
		throw new GateError(409, 'STATUS_BERUBAH', 'SJ baru saja dicatat lolos oleh petugas lain. Muat ulang daftar.');
	}

	const gagal: string[] = [];
	const notes = `DITAHAN di gerbang (penjualan, ${input.kategori}): ${input.alasan}`;
	const hasil = await Promise.all([
		runEffect('scan_log', sjId, () => recordTahan({ sjId, actor, gps: input.gps ?? null, fotoId: input.foto_file_id ?? null, notes, clientEventId, stageFrom: sj.track_stage ?? null })),
		runEffect('gate_log', sjId, () => writeGateGoodsLog({
			deskripsi: `[SJ ${sj.nomor_sj}] PENJUALAN DITAHAN (${input.kategori}) — ${input.alasan}`, qty: null, satuan: 'item', driver: sj.driver, fotoId: input.foto_file_id ?? null, nomorSj: sj.nomor_sj, actor
		})),
		runEffect('notifikasi', sjId, () => notifyLogistik({
			title: `SJ penjualan ${sj.nomor_sj} DITAHAN di gerbang`,
			message: `${input.kategori}: ${input.alasan} — oleh ${actor.label}. Bereskan lalu minta satpam periksa ulang.`,
			priority: 'high', actionRequired: true
		})),
		runEffect('process_log', sjId, () => logProcess(sjId, 'security_held', actor, { kategori: input.kategori, alasan: input.alasan, jalur: 'penjualan' })),
		sj.project_id
			? runEffect('notifikasi_project', sjId, () => notifyProject({
				title: `SJ penjualan ${sj.nomor_sj} DITAHAN di gerbang`,
				message: `${input.kategori}: ${input.alasan} — oleh ${actor.label}.`
			}))
			: Promise.resolve(null)
	]);
	for (const g of hasil) if (g) gagal.push(g);
	return { ok: true, hasil: 'ditahan', idempoten: false, sj: view, pesan: `SJ penjualan ${sj.nomor_sj} ditahan. Gudang sudah diberi tahu.`, effects_gagal: gagal };
}
