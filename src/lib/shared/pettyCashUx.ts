// src/lib/shared/pettyCashUx.ts
// PC3-20 — fungsi murni paket UX pengguna awam (bisa diuji tanpa Directus/DOM).

/** Status yang berarti "sedang menunggu seseorang" — dipakai filter & KPI "Menunggu" (U6: dulu tak memuat Finance). */
export const WAITING_STATUSES = ['menunggu_atasan', 'menunggu_finance', 'menunggu_kasir'] as const;

/**
 * U8 — tingkat saldo untuk pemohon biasa (angka saldo mentah hanya untuk kustodian/Finance).
 * habis: ≤ 0 · rendah: di bawah ambang isi ulang (pct dari limit, default 30%) · cukup: selain itu / tak bisa dinilai.
 */
export function balanceLevel(
	balance: number | string | null | undefined,
	limit: number | string | null | undefined,
	thresholdPct?: number | string | null
): 'cukup' | 'rendah' | 'habis' {
	if (balance === null || balance === undefined || balance === '') return 'cukup';
	const b = Number(balance);
	if (!Number.isFinite(b)) return 'cukup';
	if (b <= 0) return 'habis';
	const lim = Number(limit);
	const pctRaw = thresholdPct === null || thresholdPct === undefined || thresholdPct === '' ? 30 : Number(thresholdPct);
	const pct = Number.isFinite(pctRaw) && pctRaw > 0 ? pctRaw : 30;
	if (Number.isFinite(lim) && lim > 0 && b < lim * (pct / 100)) return 'rendah';
	return 'cukup';
}

export class RequestTimeoutError extends Error {
	constructor(message = 'Sinyal lemah — permintaan terlalu lama.') {
		super(message);
		this.name = 'RequestTimeoutError';
	}
}

/** U3 — fetch dengan batas waktu (AbortController) supaya spinner tak menggantung saat sinyal hilang. */
export async function fetchWithTimeout(
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit = {},
	ms = 20_000
): Promise<Response> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ms);
	try {
		return await fetchImpl(url, { ...init, signal: ctrl.signal });
	} catch (e: any) {
		if (e?.name === 'AbortError') {
			throw new RequestTimeoutError(
				'Sinyal lemah — draf Anda aman. Cek riwayat sebelum kirim ulang (pengajuan mungkin sudah tersimpan).'
			);
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

const EVENT_LABEL: Record<string, string> = {
	created: 'Dibuat',
	submitted: 'Dikirim',
	revised: 'Diperbaiki pemohon',
	atasan_approved: 'Disetujui atasan',
	atasan_rejected: 'Ditolak atasan',
	atasan_revisi: 'Diminta revisi atasan',
	finance_approved: 'Disetujui Finance Pusat',
	finance_rejected: 'Ditolak Finance Pusat',
	finance_revisi: 'Diminta revisi Finance Pusat',
	kasir_approved: 'Diposting kasir (uang dicairkan)',
	kasir_rejected: 'Ditolak kasir',
	kasir_revisi: 'Diminta revisi kasir',
	cancelled: 'Dibatalkan pemohon',
	lpj_submitted: 'LPJ dikirim',
	lpj_verified: 'LPJ diverifikasi kasir',
	lpj_rejected: 'LPJ dikembalikan kasir',
	kasir_reassigned: 'Kasir dialihkan',
	reminder_escalated: 'Pengingat dieskalasi'
};

export interface TimelineEntry {
	label: string;
	who: string | null;
	when: string | null;
	note: string | null;
}

/** U7 — linimasa ramah dari baris petty_cash_request_logs (urut lama → baru). */
export function buildTimeline(
	logs: Array<{ event?: string; actor_name?: string | null; actor?: string | null; date_created?: string | null; note?: string | null }> | null | undefined
): TimelineEntry[] {
	return (logs || []).map((l) => ({
		label: EVENT_LABEL[String(l.event)] || String(l.event || 'Perubahan'),
		who: l.actor_name || (l.actor && l.actor !== 'system' ? l.actor : null) || null,
		when: l.date_created || null,
		note: l.note ? String(l.note) : null
	}));
}
