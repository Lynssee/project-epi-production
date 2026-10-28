// src/lib/server/workshopSjkReceipt.ts
// SERVER-ONLY. Serah-terima digital SJ Keluar Workshop via scan QR (R7 Ciketing; Fase 7 Unifikasi Workshop menambah Balaraja).
// Siapa pun yang login (Firebase) boleh submit — penerima barang customer di lapangan biasanya bukan staf sistem
// (mirror pola proof-of-delivery.ts SJ peminjaman) — TETAPI WSK-14: wajib memegang QR (token), karena PATCH memakai token server.
//
// WSK-14: token QR wajib & dibandingkan aman (anti-IDOR); gate approval Finance & satpam (mode dari gate_definitions, bisa diatur
// superadmin); status_kirim → 'terkirim'; SEMUA baris no_sj+project (Ciketing & Balaraja); PATCH bersyarat (diterima_at kosong) =
// dua submit bersamaan → satu 409; scan_log wajib (gagal = konfirmasi dibatalkan); tidak ada .catch(() => null) di jalur baca.

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { isWorkshopKey, type WorkshopKey } from '$lib/kiosk/workshopKiosk';
import { isRateLimited } from '$lib/server/rateLimit';
import { resolveGateMode, type GateMode } from '$lib/server/gateDefinitionsMode';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';

export const SJK_RECEIPT: Record<WorkshopKey, { collection: string; label: string; scanType: string; securityGate: string }> = {
	ciketing: { collection: 'ciketing_surat_jalan_keluar', label: 'Ciketing', scanType: 'Konfirmasi Terima SJK Ciketing', securityGate: 'G_CIK_SJ_SECURITY' },
	balaraja: { collection: 'balaraja_surat_jalan_keluar', label: 'Balaraja', scanType: 'Konfirmasi Terima SJK Balaraja', securityGate: 'G_BL_SJ_SECURITY' }
};

/** Gate baru WSK-14. Belum terdaftar di gate_definitions → resolveGateMode memberi 'soft' (boleh dengan alasan). Daftarkan lewat Kalibrasi Gate/seed. */
export const GATE_TERIMA_BELUM_APPROVE = 'G_WS_TERIMA_BELUM_APPROVE';
export const GATE_DOC_TYPE = 'sj_keluar';
export const MIN_ALASAN = 20;
export const CODE_REASON_REQUIRED = 'GATE_REASON_REQUIRED';

/** Perbandingan token waktu-konstan (panjang beda → false, tanpa melempar). */
export function tokensMatch(expected: string | null | undefined, given: string | null | undefined): boolean {
	if (!expected || !given) return false;
	const a = Buffer.from(String(expected));
	const b = Buffer.from(String(given));
	return a.length === b.length && timingSafeEqual(a, b);
}

interface SjkRow {
	id: number; no_sj: string; project: any; diterima_at: string | null; qr_token: string | null;
	approval_status: string | null; security_verified_at?: string | null; status_kirim: string | null;
}

async function scanTypeId(name: string): Promise<string | null> {
	try {
		const res = await directusServerJson<{ data: Array<{ id: string }> }>(
			`/items/category?filter[group][_eq]=scan_type&filter[name][_eq]=${encodeURIComponent(name)}&limit=1&fields=id`
		);
		return res?.data?.[0]?.id || null;
	} catch (e) {
		// Jenis scan hanya label; nama jenis tetap tercatat di notes. Gagal baca tidak membatalkan serah-terima, TAPI dilog jelas.
		console.error('[workshop-sjk-confirm-receipt] gagal baca jenis scan_log:', e);
		return null;
	}
}

export async function confirmWorkshopSjkReceipt(event: RequestEvent, workshop: unknown) {
	if (!isWorkshopKey(workshop)) throw error(400, 'Workshop tidak dikenal.');
	const cfg = SJK_RECEIPT[workshop];
	const user = await requireUser(event);
	if (isRateLimited(`sjk-receipt:${user.localId}`, { windowMs: 60_000, max: 20 })) {
		throw error(429, 'Terlalu banyak percobaan. Tunggu sebentar lalu pindai ulang QR.');
	}
	const body = await event.request.json().catch(() => ({}));
	const sjkId = Number(body?.sjkId);
	const token = String(body?.token || '').trim();
	const receiverName = String(body?.receiverName || '').trim();
	const fotoFileId = body?.fotoFileId || null;
	const alasan = String(body?.exceptionReason || '').trim();

	if (!Number.isFinite(sjkId) || !token) throw error(400, 'QR tidak lengkap. Pindai ulang QR di surat jalan.');
	if (!receiverName) throw error(400, 'Nama penerima wajib diisi.');

	// Baca SJ (query daftar: "tidak ada" = [] → 404; galat Directus = throw → 502, BUKAN 404 palsu — Aturan #1)
	let sjk: SjkRow | undefined;
	try {
		const res = await directusServerJson<{ data: SjkRow[] }>(
			`/items/${cfg.collection}?filter[id][_eq]=${sjkId}&fields=id,no_sj,project,diterima_at,qr_token,approval_status,security_verified_at,status_kirim&limit=1`
		);
		sjk = res?.data?.[0];
	} catch (e) {
		console.error(`[workshop-sjk-confirm-receipt:${workshop}] gagal baca SJ #${sjkId}:`, e);
		throw error(502, 'Server sibuk, coba lagi sebentar.');
	}
	if (!sjk) throw error(404, `SJ Keluar ${cfg.label} tidak ditemukan.`);
	if (!tokensMatch(sjk.qr_token, token)) throw error(403, 'QR tidak cocok dengan surat jalan ini. Pindai ulang QR di surat jalan.');
	if (sjk.diterima_at) throw error(409, `SJ ${sjk.no_sj} sudah dikonfirmasi diterima sebelumnya — tidak bisa diulang.`);

	// Gate (mode dari gate_definitions/gate_enforcement — superadmin yang mengatur): hard → tolak; soft → wajib alasan; shadow/warn → catat.
	const catatanGate: string[] = [];
	const butuhAlasan: Array<{ gate_key: string; label: string; mode: GateMode }> = [];
	const cek = async (gateKey: string, label: string) => {
		const mode = await resolveGateMode(gateKey, GATE_DOC_TYPE);
		if (mode === 'hard') throw error(403, `${gateKey}: ${label} Konfirmasi ditolak — hubungi admin.`);
		if (mode === 'soft') {
			if (alasan.length < MIN_ALASAN) butuhAlasan.push({ gate_key: gateKey, label, mode });
			else catatanGate.push(`[Pengecualian ${gateKey}: ${alasan}]`);
		} else {
			catatanGate.push(`[${gateKey} (${mode}): ${label}]`);
		}
	};
	if (sjk.approval_status !== 'approved') await cek(GATE_TERIMA_BELUM_APPROVE, 'SJ ini belum disetujui Finance.');
	if (!sjk.security_verified_at) await cek(cfg.securityGate, 'SJ ini belum lolos pemeriksaan satpam.');
	if (butuhAlasan.length > 0) {
		return json(
			{ success: false, code: CODE_REASON_REQUIRED, gates: butuhAlasan, minAlasan: MIN_ALASAN, message: `${butuhAlasan.map((g) => g.label).join(' ')} Isi alasan (min. ${MIN_ALASAN} karakter) untuk tetap menandai diterima.` },
			{ status: 422 }
		);
	}

	// Semua baris SJ yang sama (no_sj + project) yang belum diterima — Ciketing & Balaraja.
	const projectId = sjk.project && typeof sjk.project === 'object' ? sjk.project.id : sjk.project;
	let keys: number[] = [sjkId];
	if (sjk.no_sj && projectId) {
		try {
			const group = await directusServerJson<{ data: Array<{ id: number }> }>(
				`/items/${cfg.collection}?filter[no_sj][_eq]=${encodeURIComponent(sjk.no_sj)}&filter[project][_eq]=${projectId}&filter[diterima_at][_null]=true&fields=id&limit=500`
			);
			keys = Array.from(new Set([sjkId, ...(group?.data || []).map((r) => r.id)]));
		} catch (e) {
			console.error(`[workshop-sjk-confirm-receipt:${workshop}] gagal baca baris grup SJ ${sjk.no_sj}:`, e);
			throw error(502, 'Server sibuk, coba lagi sebentar.');
		}
	}

	const nowISO = new Date().toISOString();
	const karyawan = user.email ? await resolveKaryawanByEmail(user.email).catch((e) => { console.error('[workshop-sjk-confirm-receipt] gagal resolve karyawan:', e); return null; }) : null;
	const scanType = await scanTypeId(cfg.scanType);

	// Jejak audit WAJIB dulu: gagal menulis scan_log = konfirmasi dibatalkan (tidak ada serah-terima tanpa jejak).
	let logId: number | string | null = null;
	try {
		const log = await directusServerJson<{ data: { id: number } }>('/items/scan_log', {
			method: 'POST',
			body: JSON.stringify({
				ref_collection: cfg.collection,
				ref_id: String(sjkId),
				scan_type: scanType,
				actor_id: karyawan?.id ?? null,
				actor_role: 'penerima_lapangan',
				timestamp: nowISO,
				foto_id: fotoFileId,
				notes: `${cfg.scanType}: diterima oleh ${receiverName} (login: ${user.email || user.localId}); ${keys.length} baris SJ ${sjk.no_sj}${catatanGate.length ? ' ' + catatanGate.join(' ') : ''}`.slice(0, 1000),
				source: 'lapangan',
				client_event_id: body?.clientEventId || null
			})
		});
		logId = log?.data?.id ?? null;
	} catch (e) {
		console.error(`[workshop-sjk-confirm-receipt:${workshop}] scan_log gagal — konfirmasi dibatalkan:`, e);
		throw error(502, 'Gagal mencatat jejak serah-terima. Coba lagi sebentar.');
	}

	const data = {
		diterima_oleh: receiverName,
		diterima_at: nowISO,
		status_kirim: 'terkirim',
		...(fotoFileId ? { diterima_foto: fotoFileId } : {})
	};
	let updated: Array<{ id: number }> = [];
	try {
		// PATCH bersyarat (bentuk batch-by-query Directus: { query, data }): hanya baris yang masih belum diterima.
		const res = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/${cfg.collection}`, {
			method: 'PATCH',
			body: JSON.stringify({ query: { filter: { _and: [{ id: { _in: keys } }, { diterima_at: { _null: true } }] }, fields: ['id'] }, data })
		});
		updated = res?.data || [];
	} catch (e) {
		console.error(`[workshop-sjk-confirm-receipt:${workshop}] PATCH gagal:`, e);
		await hapusLog(logId, workshop);
		throw error(502, 'Gagal menyimpan konfirmasi. Coba lagi sebentar.');
	}
	if (updated.length === 0) {
		await hapusLog(logId, workshop); // kalah balapan: orang lain sudah mengonfirmasi lebih dulu
		throw error(409, `SJ ${sjk.no_sj} sudah dikonfirmasi diterima sebelumnya — tidak bisa diulang.`);
	}

	// activity_log (koleksi bersama dgn admin) — sekunder: gagal dilog jelas tetapi tidak membatalkan serah-terima yang sudah sah.
	try {
		await directusServerJson('/items/activity_log', {
			method: 'POST',
			body: JSON.stringify({
				module: 'workshop',
				collection: cfg.collection,
				record_id: String(sjkId),
				action: 'sjk_diterima',
				description: `SJ Keluar ${cfg.label} ${sjk.no_sj} dikonfirmasi diterima oleh ${receiverName} (${updated.length} baris)${catatanGate.length ? ' ' + catatanGate.join(' ') : ''}`.slice(0, 2000),
				actor_id: user.localId,
				actor_name: karyawan?.nama_karyawan || user.email || user.localId,
				actor_role: 'penerima_lapangan',
				changes: { before: { diterima_at: null, status_kirim: sjk.status_kirim }, after: { diterima_at: nowISO, diterima_oleh: receiverName, status_kirim: 'terkirim', baris: updated.map((r) => r.id) } },
				created_at: nowISO
			})
		});
	} catch (e) {
		console.error(`[workshop-sjk-confirm-receipt:${workshop}] gagal catat activity_log (serah-terima tetap sah):`, e);
	}

	return json({ success: true, noSj: sjk.no_sj, diterimaAt: nowISO, baris: updated.length });
}

async function hapusLog(logId: number | string | null, workshop: string) {
	if (!logId) return;
	try {
		await directusServerJson(`/items/scan_log/${logId}`, { method: 'DELETE' });
	} catch (e) {
		console.error(`[workshop-sjk-confirm-receipt:${workshop}] gagal menghapus scan_log #${logId} (kompensasi):`, e);
	}
}
