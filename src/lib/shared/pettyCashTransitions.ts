// src/lib/shared/pettyCashTransitions.ts
// PC3-04 — salinan TS dari erp-epi `src/lib/server/pettyCashTransitions.js` (tabel transisi status kas kecil).
// JAGA IDENTIK: tes kontrak (pettyCashTransitions.test.ts) memakai tabel harapan yang sama di kedua repo.
// Aturan #3: hanya syarat STATUS → tidak mengunci tiket lama secara retroaktif.

export type Filter = Record<string, any>;

export const PRE_POSTED = ['draft', 'revisi', 'menunggu_atasan', 'menunggu_finance', 'menunggu_kasir'];

/** Bangun filter Directus per aksi. `nowIso` disuntik (tidak bergantung dukungan `$NOW`). */
export function transitionGuard(action: string, nowIso: string = new Date().toISOString()): Filter | null {
	const noLock = { _or: [{ processing_lock: { _null: true } }, { processing_lock_until: { _lt: nowIso } }] };
	const noJournal = { journal_entry_id: { _null: true } };
	const guards: Record<string, Filter> = {
		submit: { _and: [{ status: { _in: ['draft', 'revisi'] } }, noLock] },
		edit: { _and: [{ status: { _in: ['draft', 'revisi'] } }, noLock] },
		atasan_approve: { status: { _eq: 'menunggu_atasan' } },
		atasan_reject: { status: { _eq: 'menunggu_atasan' } },
		atasan_revisi: { status: { _eq: 'menunggu_atasan' } },
		finance_approve: { status: { _eq: 'menunggu_finance' } },
		finance_reject: { status: { _eq: 'menunggu_finance' } },
		finance_revisi: { status: { _eq: 'menunggu_finance' } },
		kasir_reject: { _and: [{ status: { _eq: 'menunggu_kasir' } }, noJournal, noLock] },
		kasir_revisi: { _and: [{ status: { _eq: 'menunggu_kasir' } }, noJournal, noLock] },
		cancel: { _and: [{ status: { _in: PRE_POSTED } }, noJournal, noLock] },
		lpj_submit: {
			_and: [
				{ status: { _eq: 'posted' } },
				{ mode: { _eq: 'advance' } },
				{ _or: [{ advance_settlement_status: { _null: true } }, { advance_settlement_status: { _in: ['menunggu_lpj', 'revisi'] } }] }
			]
		},
		// PC3-13 — kasir mengembalikan LPJ (aksi kasir dijalankan di admin; guard disalin agar kontrak tetap identik)
		lpj_reject: {
			_and: [
				{ status: { _eq: 'posted' } },
				{ advance_settlement_status: { _eq: 'lpj_diajukan' } },
				noLock
			]
		}
		// kasir_approve & lpj_verify memakai kunci proses (admin)
	};
	return guards[action] || null;
}

/** Evaluator subset filter Directus (_and/_or/_eq/_in/_null/_lt) — untuk tes kontrak & mock. */
export function matchesFilter(row: Record<string, any>, f: Filter | null): boolean {
	if (!f) return true;
	if (f._and) return f._and.every((x: Filter) => matchesFilter(row, x));
	if (f._or) return f._or.some((x: Filter) => matchesFilter(row, x));
	const [k, cond] = Object.entries(f)[0];
	const [op, val] = Object.entries(cond as Record<string, any>)[0];
	const v = row?.[k];
	if (op === '_eq') return v === val;
	if (op === '_in') return Array.isArray(val) && val.includes(v);
	if (op === '_null') return (v === null || v === undefined) === val;
	if (op === '_lt') return v != null && v < val;
	throw new Error(`operator filter tak didukung: ${op}`);
}

/** Apakah aksi boleh menulis pada baris ini? */
export function guardAllows(action: string, row: Record<string, any>, nowIso: string = new Date().toISOString()): boolean {
	const g = transitionGuard(action, nowIso);
	return g ? matchesFilter(row, g) : false;
}

/** Pesan 409 ramah untuk pengguna awam. */
export function conflictMessage(action: string): string {
	if (action === 'cancel') {
		return 'Pengajuan sedang/sudah diproses kasir sehingga tidak bisa dibatalkan. Hubungi kasir bila perlu dikembalikan.';
	}
	if (action.startsWith('atasan_') || action.startsWith('finance_')) {
		return 'Pengajuan ini baru saja berubah status (mis. dibatalkan pemohon atau sudah diputuskan) — tidak perlu tindakan. Daftar akan dimuat ulang.';
	}
	return 'Status pengajuan sudah berubah (mungkin baru disetujui/dibatalkan/diproses orang lain). Muat ulang halaman untuk melihat status terbaru.';
}
