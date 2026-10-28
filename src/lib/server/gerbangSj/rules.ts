// src/lib/server/gerbangSj/rules.ts
// GSP-04 — aturan boleh-lolos + validasi input. FUNGSI MURNI (tanpa I/O), mudah diuji.
// Blocker yang butuh I/O (cetak/barang bermasalah/gate ERP — sjGerbangGuard SJH-12) digabung
// di actions.ts/query.ts lewat parameter `extra`.

import { normalizeChecklist } from './checklist';
import {
	GateError, KATEGORI_TAHAN,
	type GateBlocker, type GateGps, type GateItemCheck, type GateKode, type GateWarning, type LoloskanInput, type TahanInput
} from './types';

/** Status yang berarti SJ sudah lewat gerbang (GSP-04 §4.2). */
export const STATUS_SUDAH_LOLOS = ['shipped', 'delivered', 'received', 'complete', 'closed'] as const;

export type PassSj = {
	status?: string | null;
	draft_status?: string | null;
	approval_status?: string | null;
	security_verified_at?: string | null;
	security_verified_by?: string | null;
	security_checklist?: unknown;
	koli_acuan?: number | null;
	print_count?: number | string | null;
};

/** RSM-08: SJ yang sudah dicetak final tapi belum discan muat (status 'created') boleh diperiksa & diloloskan satpam. */
export const siapUntukGerbang = (sj: { status?: string | null; print_count?: number | string | null }): boolean =>
	sj?.status === 'needs_security_check' || (sj?.status === 'created' && Number(sj?.print_count) >= 1);

export type PassEvaluation = {
	already_passed: boolean;
	can_pass: boolean;
	ditahan: boolean;
	blockers: GateBlocker[];
	warnings: GateWarning[];
};

export function evaluatePass(sj: PassSj, extra: { blockers?: GateBlocker[]; warnings?: GateWarning[] } = {}): PassEvaluation {
	const blockers: GateBlocker[] = [];
	const warnings: GateWarning[] = [...(extra.warnings || [])];
	const status = String(sj?.status || '');
	const sudahLolos = (STATUS_SUDAH_LOLOS as readonly string[]).includes(status);
	const cl = normalizeChecklist(sj?.security_checklist);
	const ditahan = cl?.hasil === 'ditahan';

	if (sudahLolos) {
		return {
			already_passed: true, can_pass: false, ditahan: false, warnings,
			blockers: [{ kode: 'SUDAH_LOLOS', pesan: `SJ sudah lewat gerbang (${status}).`, siapa: null }]
		};
	}
	if (status === 'needs_security_check' && sj?.security_verified_at) {
		if (sj?.draft_status === 'menunggu_verifikasi') {
			return {
				already_passed: true,
				can_pass: false,
				ditahan: false,
				warnings,
				blockers: [{ kode: 'SUDAH_LOLOS', pesan: 'Pemeriksaan fisik satpam sudah selesai (Menunggu verifikasi Admin Proyek).', siapa: 'Admin Proyek' }]
			};
		}
		blockers.push({ kode: 'DATA_TIDAK_KONSISTEN', pesan: 'Data SJ ini tidak konsisten (tercatat lolos tapi status belum berubah). Hubungi Admin Logistik.', siapa: 'Admin Logistik' });
	} else if (!siapUntukGerbang(sj)) {
		blockers.push({ kode: 'BELUM_SIAP_GERBANG', pesan: `SJ masih "${status || '-'}" — belum dikirim ke gerbang.`, siapa: 'Gudang' });
	}
	if (sj?.draft_status !== 'menunggu_verifikasi') {
		if (sj?.draft_status === 'menunggu_approval' || sj?.approval_status === 'menunggu') {
			blockers.push({ kode: 'BELUM_DISETUJUI', pesan: 'SJ belum disetujui admin — jangan loloskan.', siapa: 'Approver SJ / Admin Logistik' });
		}
	}
	if (sj?.approval_status === 'ditolak') {
		blockers.push({ kode: 'DITOLAK_APPROVER', pesan: 'SJ ditolak approver — jangan loloskan.', siapa: 'Admin Logistik' });
	}
	for (const b of extra.blockers || []) {
		// hindari dobel dengan blocker yang sama dari aturan di atas
		if (!blockers.some((x) => x.kode === b.kode)) blockers.push(b);
	}
	if (ditahan) warnings.push({ kode: 'PERNAH_DITAHAN', pesan: 'SJ ini pernah ditahan. Periksa ulang; loloskan bila masalah sudah beres.' });
	if (sj?.koli_acuan == null) warnings.push({ kode: 'KOLI_TIDAK_TERCATAT', pesan: 'Koli: tidak tercatat — hitung dan tulis di catatan.' });

	return { already_passed: false, can_pass: blockers.length === 0, ditahan, blockers, warnings };
}

// ───────────────────────── validasi input ─────────────────────────

const bad = (kode: GateKode, pesan: string, status = 400) => new GateError(status, kode, pesan);

export function parseClientEventId(v: unknown): string {
	const s = String(v ?? '').trim();
	if (s.length < 8 || s.length > 100) throw bad('CLIENT_EVENT_ID_WAJIB', 'client_event_id wajib (8–100 karakter) sebagai pengaman klik ganda.');
	return s;
}

export function parseGps(raw: any): GateGps | null {
	if (!raw || typeof raw !== 'object') return null;
	const lat = Number(raw.lat), lng = Number(raw.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
	const acc = Number(raw.accuracy);
	return { lat, lng, accuracy: Number.isFinite(acc) ? acc : null };
}

export function parseItems(raw: any): GateItemCheck[] | null {
	if (!Array.isArray(raw)) return null;
	return raw
		.map((x) => ({ sj_item_id: Number(x?.sj_item_id), ok: x?.ok === true, catatan: x?.catatan ? String(x.catatan).slice(0, 200) : null }))
		.filter((x) => Number.isFinite(x.sj_item_id) && x.sj_item_id > 0);
}

function parseKoli(v: unknown): number | null {
	if (v == null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export type ValidasiKonteks = {
	koli_acuan: number | null;
	/** id semua item SJ — dipakai cek "semua item sudah diperiksa" */
	item_ids: number[];
	/** K1 = A (rekomendasi): cek per item wajib. false = tidak wajib tapi kalau dikirim tetap divalidasi. */
	item_wajib: boolean;
	/** jalur lama (kiosk/app sebelum layar GSP) belum mengirim koli_dihitung/items — dilonggarkan sementara */
	legacy?: boolean;
	/** wajib ambil foto muatan/kendaraan di gerbang */
	foto_wajib?: boolean;
};

/** Validasi body loloskan. Lempar GateError 400; kembalikan input yang sudah dinormalisasi. */
export function validateLoloskan(raw: any, ctx: ValidasiKonteks): LoloskanInput {
	const client_event_id = parseClientEventId(raw?.client_event_id);
	const cl = raw?.checklist || {};
	if (cl.jumlah_ok !== true || cl.plat_ok !== true || cl.driver_ok !== true) {
		throw bad('CEK_BELUM_LENGKAP', 'Centang jumlah koli, plat, dan driver. Kalau ada yang tidak sesuai, tekan Tahan.');
	}
	const koli_dihitung = parseKoli(raw?.koli_dihitung);
	if (ctx.koli_acuan != null && koli_dihitung != null && koli_dihitung !== ctx.koli_acuan) {
		throw bad('KOLI_BEDA', `Koli dihitung ${koli_dihitung}, di SJ ${ctx.koli_acuan}. Tekan Tahan.`);
	}
	if (ctx.koli_acuan == null && koli_dihitung == null && !ctx.legacy) {
		throw bad('KOLI_WAJIB_DIHITUNG', 'Koli tidak tercatat di SJ — hitung koli dan isi jumlahnya.');
	}
	const items = parseItems(raw?.items);
	const kirimItems = !!items && items.length > 0;
	if (ctx.item_wajib && !ctx.legacy) {
		const ids = new Set((items || []).map((i) => i.sj_item_id));
		const asing = (items || []).some((i) => !ctx.item_ids.includes(i.sj_item_id));
		if (ctx.item_ids.length > 0 && (asing || !ctx.item_ids.every((id) => ids.has(id)))) {
			throw bad('ITEM_BELUM_DICEK', 'Periksa semua barang di daftar sebelum meloloskan.');
		}
	} else if (kirimItems && (items || []).some((i) => !ctx.item_ids.includes(i.sj_item_id))) {
		throw bad('ITEM_BELUM_DICEK', 'Ada barang yang bukan bagian dari SJ ini.');
	}
	if ((items || []).some((i) => !i.ok)) {
		throw bad('ADA_SELISIH_ITEM', 'Ada barang tidak sesuai. Tekan Tahan supaya gudang memperbaiki.');
	}

	const foto_file_id = raw?.foto_file_id ? String(raw.foto_file_id).trim() : null;
	if (ctx.foto_wajib && !foto_file_id && !ctx.legacy) {
		throw bad('FOTO_GERBANG_WAJIB', 'Wajib ambil foto muatan/kendaraan di pos satpam sebelum meloloskan.');
	}

	return {
		client_event_id,
		checklist: { jumlah_ok: true, plat_ok: true, driver_ok: true },
		koli_dihitung,
		items,
		foto_file_id,
		gps: parseGps(raw?.gps),
		catatan: raw?.catatan ? String(raw.catatan).slice(0, 500) : null
	};
}

export function validateTahan(raw: any): TahanInput {
	const client_event_id = parseClientEventId(raw?.client_event_id);
	const alasan = String(raw?.alasan ?? '').trim();
	if (alasan.length < 5) throw bad('ALASAN_WAJIB', 'Alasan menahan wajib diisi (min. 5 karakter).');
	const kategori = String(raw?.kategori ?? 'lainnya');
	if (!(KATEGORI_TAHAN as readonly string[]).includes(kategori)) {
		throw bad('KATEGORI_TIDAK_DIKENAL', `Kategori tahan tidak dikenal. Pilih: ${KATEGORI_TAHAN.join(', ')}.`);
	}
	const cl = raw?.checklist && typeof raw.checklist === 'object' ? raw.checklist : null;
	const tri = (v: unknown) => (v === true ? true : v === false ? false : null);
	return {
		client_event_id,
		alasan: alasan.slice(0, 500),
		kategori: kategori as TahanInput['kategori'],
		checklist: cl ? { jumlah_ok: tri(cl.jumlah_ok), plat_ok: tri(cl.plat_ok), driver_ok: tri(cl.driver_ok) } : null,
		koli_dihitung: parseKoli(raw?.koli_dihitung),
		items: parseItems(raw?.items),
		foto_file_id: raw?.foto_file_id ? String(raw.foto_file_id) : null,
		gps: parseGps(raw?.gps)
	};
}

/** Tahan hanya untuk SJ yang masih menunggu gerbang (GSP-04 §4.4). Blocker #2/#4/#5 TIDAK menghalangi. */
export function assertBisaDitahan(status: string | null | undefined): void {
	if (status !== 'needs_security_check' && status !== 'created') {
		throw new GateError(409, 'TIDAK_BISA_DITAHAN', `SJ sudah ${status || '-'} — tidak bisa ditahan dari gerbang. Laporkan lewat Insiden.`);
	}
}

/** Angka koli acuan (GSP-03 §4.4): fleet_shipments terbaru → SUM(jumlah_pcs) bila semua terisi → null. */
export function resolveKoliAcuan(
	fleetKoli: number | null | undefined,
	items: { jumlah_pcs?: unknown }[]
): { koli_acuan: number | null; koli_sumber: 'fleet' | 'item' | null } {
	const f = Number(fleetKoli);
	if (fleetKoli != null && Number.isFinite(f) && f > 0) return { koli_acuan: f, koli_sumber: 'fleet' };
	if (items.length > 0 && items.every((i) => Number(i.jumlah_pcs) > 0)) {
		return { koli_acuan: items.reduce((a, i) => a + Number(i.jumlah_pcs), 0), koli_sumber: 'item' };
	}
	return { koli_acuan: null, koli_sumber: null };
}
