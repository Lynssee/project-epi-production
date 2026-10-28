// src/lib/server/sjGerbangGuard.ts
// SJH-12 — syarat minimum agar satpam boleh meloloskan SJ di gerbang. Dipakai identik oleh
// kiosk (gerbang-sj/loloskan + lookup) dan jalur aplikasi (sj-security-check).
//
// Prinsip: barang TIDAK boleh keluar tanpa SJ resmi tercetak. Murni baca (tanpa token tulis);
// "Tahan" tidak melewati guard ini sehingga selalu tersedia (Aturan #6). Gate lain di titik
// gerbang (erp-epi, SJH-08 point 'gerbang') menyusul lewat jembatan server-ke-server.

import { directusServerJson } from '$lib/server/directus';
import { checkErpGerbangGates, type ErpGateBlocker, type ErpGateStatus } from '$lib/server/sjGerbangErpGate';

export type GerbangWho = 'Admin Logistik' | 'Approver SJ' | 'Gudang / QC';
export type GerbangBlocker =
	| { code: 'BELUM_DICETAK' | 'BELUM_DISETUJUI' | 'BARANG_BERMASALAH'; message: string; who: GerbangWho }
	| ErpGateBlocker;

export const GERBANG_GUARD_FIELDS = 'id,nomor_sj,status,print_count,approval_status';

/** Bagian murni (tanpa I/O) — mudah diuji. */
export function evaluateGerbangMinimum(sj: { status?: string | null; nomor_sj?: string; print_count?: number | string | null; approval_status?: string | null }): GerbangBlocker[] {
	const out: GerbangBlocker[] = [];
	const isPrePrintCheck = sj?.status === 'needs_security_check';
	if (!isPrePrintCheck && !(Number(sj?.print_count) >= 1)) {
		out.push({
			code: 'BELUM_DICETAK',
			message: `SJ ${sj?.nomor_sj ?? ''} belum dicetak final. Barang tidak boleh keluar tanpa SJ resmi — minta admin logistik mencetak.`.replace('  ', ' '),
			who: 'Admin Logistik'
		});
	}
	if (!isPrePrintCheck && sj?.approval_status && !['disetujui', 'tidak_perlu'].includes(sj.approval_status)) {
		out.push({ code: 'BELUM_DISETUJUI', message: 'SJ belum disetujui admin.', who: 'Approver SJ' });
	}
	return out;
}

/** Log barang bermasalah terbuka yang memblokir dispatch untuk SJ ini (query terpisah). */
export async function getBarangBermasalahBlockers(sjId: number): Promise<GerbangBlocker[]> {
	try {
		const r = await directusServerJson<{ data: any[] }>(
			`/items/barang_bermasalah_log?filter[surat_jalan_id][_eq]=${sjId}&filter[status][_in]=open,in_review` +
			`&filter[blocks_dispatch][_eq]=true&fields=id,nama_barang&limit=5`
		);
		const rows = r?.data || [];
		if (!rows.length) return [];
		const names = [...new Set(rows.map((x) => x.nama_barang).filter(Boolean))].join(', ');
		return [{ code: 'BARANG_BERMASALAH', message: `Ada barang bermasalah yang belum diselesaikan${names ? `: ${names}` : ''}.`, who: 'Gudang / QC' }];
	} catch (e) {
		// Gerbang tidak boleh lumpuh karena query pelengkap gagal (Aturan #3/#6) — log keras, lanjut.
		console.error('[sjGerbangGuard] gagal baca barang_bermasalah_log, dilewati:', e instanceof Error ? e.message : e);
		return [];
	}
}

type GuardSj = { id: number; nomor_sj?: string; print_count?: any; approval_status?: string | null };

/**
 * Blocker lokal (cetak/approval/barang bermasalah) + gate titik "gerbang" dari erp-epi (SJH-12 §4.2).
 * `gate_check` dicatat ke security_checklist: 'ok' | 'diblokir' | 'tidak_terhubung' (fail-safe).
 * Gate erp hanya dipanggil bila blocker lokal kosong (hemat panggilan; alasan lokal sudah cukup).
 */
export async function getGerbangBlockersDetailed(sj: GuardSj): Promise<{ blockers: GerbangBlocker[]; gate_check: ErpGateStatus }> {
	const local = [...evaluateGerbangMinimum(sj), ...(await getBarangBermasalahBlockers(Number(sj.id)))];
	if (local.length) return { blockers: local, gate_check: 'diblokir' };
	const erp = await checkErpGerbangGates(sj.id);
	return { blockers: erp.blockers, gate_check: erp.status };
}

export async function getGerbangBlockers(sj: GuardSj): Promise<GerbangBlocker[]> {
	return (await getGerbangBlockersDetailed(sj)).blockers;
}
