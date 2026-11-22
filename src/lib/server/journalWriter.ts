// src/lib/server/journalWriter.ts
// SERVER-ONLY. FIN-20 — penulis jurnal lapangan yang AMAN: idempoten, diverifikasi, tidak pernah meninggalkan
// header yatim, dan tidak menelan error. Menggantikan pola lama:
//   - `.catch(() => {})` pada tiap baris detail (header tersimpan dengan total, baris hilang diam-diam)
//   - nomor jurnal tanpa idempotency_key (konfirmasi dua kali → dua jurnal)
// Pola mengikuti postJournal() di erp-epi (src/lib/server/journalPoster.js) — repo berbeda, jadi disalin ringkas.
// `journal_entries.idempotency_key` UNIK di Directus (PC3-01).
//
// Kontrak: fungsi TIDAK melempar. Hasil `ok:false` berisi pesan; pemanggil memutuskan (umumnya: transaksi utama
// tetap jalan, tetapi kegagalan jurnal DILAPORKAN ke user + dicatat di finance_audit_log agar terlihat Finance).

import { directusServerJson as realJson } from './directus';

export type JournalLine = {
	account_code: string;
	account_name?: string;
	debit_amount: number;
	credit_amount: number;
	description?: string;
};

export type WriteJournalInput = {
	idempotencyKey: string;
	/** Header TANPA total_debit/total_credit/is_posted/idempotency_key (diisi fungsi ini). Wajib: journal_number, transaction_date, reference_type. */
	header: Record<string, any>;
	lines: JournalLine[];
	/** false (default) = draf untuk review Finance; true = langsung diposting. */
	autoPost?: boolean;
};

export type WriteJournalResult =
	| { ok: true; id: number; alreadyExisted: boolean; totalDebit: number }
	| { ok: false; error: string };

type Json = (endpoint: string, options?: { method?: string; body?: string }) => Promise<any>;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function makeJournalWriter(json: Json) {
	async function findByKey(key: string) {
		const res = await json(
			`/items/journal_entries?limit=1&fields=id,total_debit,is_posted&filter[idempotency_key][_eq]=${encodeURIComponent(key)}`
		);
		return res?.data?.[0] ?? null;
	}

	async function cleanup(headerId: number, detailIds: number[]) {
		for (const id of detailIds) {
			await json(`/items/journal_entry_details/${id}`, { method: 'DELETE' }).catch((e: any) =>
				console.error(`[journalWriter] gagal membersihkan journal_entry_details #${id} (yatim, hapus manual):`, e?.message || e)
			);
		}
		await json(`/items/journal_entries/${headerId}`, { method: 'DELETE' }).catch((e: any) =>
			console.error(`[journalWriter] gagal membersihkan journal_entries #${headerId} (yatim, hapus manual):`, e?.message || e)
		);
	}

	/** Catat kegagalan agar terlihat di audit Finance (bukan hanya log server). Tidak pernah melempar. */
	async function recordFailure(input: WriteJournalInput, error: string) {
		try {
			await json('/items/finance_audit_log', {
				method: 'POST',
				body: JSON.stringify({
					entity: 'journal_entries',
					entity_id: input.idempotencyKey,
					action: 'gagal_buat',
					actor: 'project-epi',
					before: null,
					after: {
						error,
						reference_type: input.header?.reference_type ?? null,
						reference_number: input.header?.reference_number ?? null,
						total: r2((input.lines || []).reduce((s, l) => s + (Number(l.debit_amount) || 0), 0)),
						lines: input.lines
					},
					timestamp: new Date().toISOString()
				})
			});
		} catch (e: any) {
			console.error('[journalWriter] gagal mencatat kegagalan jurnal ke finance_audit_log:', e?.message || e);
		}
	}

	return async function writeJournalSafe(input: WriteJournalInput): Promise<WriteJournalResult> {
		const fail = async (error: string): Promise<WriteJournalResult> => {
			console.error(`[journalWriter] ${input.idempotencyKey}: ${error}`);
			await recordFailure(input, error);
			return { ok: false, error };
		};

		const lines = input.lines || [];
		if (!input.idempotencyKey) return fail('idempotencyKey wajib diisi.');
		if (!input.header?.journal_number || !input.header?.transaction_date || !input.header?.reference_type) {
			return fail('header.journal_number, transaction_date, dan reference_type wajib diisi.');
		}
		if (lines.length < 2) return fail('Jurnal minimal 2 baris.');
		for (const l of lines) {
			const d = Number(l.debit_amount) || 0;
			const c = Number(l.credit_amount) || 0;
			if (!l.account_code || !Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0 || (d === 0 && c === 0)) {
				return fail(`Baris jurnal tidak valid (akun ${l.account_code || '-'}).`);
			}
		}
		const totalDebit = r2(lines.reduce((s, l) => s + (Number(l.debit_amount) || 0), 0));
		const totalCredit = r2(lines.reduce((s, l) => s + (Number(l.credit_amount) || 0), 0));
		if (Math.abs(totalDebit - totalCredit) > 0.01) return fail(`Jurnal tidak balance: debit ${totalDebit} ≠ kredit ${totalCredit}.`);

		// Idempotensi: kunci sudah ada → kembalikan jurnal lama (konfirmasi ganda tidak menggandakan).
		try {
			const existing = await findByKey(input.idempotencyKey);
			if (existing) {
				if (Math.abs((Number(existing.total_debit) || 0) - totalDebit) > 0.01) {
					console.warn(
						`[journalWriter] ${input.idempotencyKey}: jurnal sudah ada (#${existing.id}) dengan total ${existing.total_debit}, ` +
							`permintaan baru ${totalDebit} — jurnal lama dipertahankan, periksa manual.`
					);
				}
				return { ok: true, id: existing.id, alreadyExisted: true, totalDebit: Number(existing.total_debit) || 0 };
			}
		} catch (e: any) {
			return fail(`Gagal memeriksa idempotensi: ${e?.message || e}`);
		}

		let headerId: number | null = null;
		const detailIds: number[] = [];
		try {
			const created = await json('/items/journal_entries', {
				method: 'POST',
				body: JSON.stringify({
					...input.header,
					idempotency_key: input.idempotencyKey,
					total_debit: totalDebit,
					total_credit: totalCredit,
					is_posted: false
				})
			});
			headerId = created?.data?.id ?? null;
			if (!headerId) throw new Error('Header jurnal tersimpan tanpa id.');

			for (let i = 0; i < lines.length; i++) {
				const l = lines[i];
				const r = await json('/items/journal_entry_details', {
					method: 'POST',
					body: JSON.stringify({ ...l, journal_entry_id: headerId, line_number: i + 1 })
				});
				if (!r?.data?.id) throw new Error(`Baris jurnal #${i + 1} tersimpan tanpa id.`);
				detailIds.push(r.data.id);
			}

			// Verifikasi dari DATABASE sebelum dianggap berhasil.
			const sums = await json(
				`/items/journal_entry_details?filter[journal_entry_id][_eq]=${headerId}&aggregate[sum]=debit_amount,credit_amount&aggregate[count]=*`
			);
			const row = sums?.data?.[0] || {};
			const d = parseFloat(row?.sum?.debit_amount) || 0;
			const c = parseFloat(row?.sum?.credit_amount) || 0;
			if (Math.abs(d - c) > 0.01 || Number(row?.count) !== lines.length) {
				throw new Error(`Verifikasi gagal: debit=${d}, kredit=${c}, baris=${row?.count}/${lines.length}.`);
			}

			if (input.autoPost) {
				await json(`/items/journal_entries/${headerId}`, {
					method: 'PATCH',
					body: JSON.stringify({ is_posted: true, posted_date: new Date().toISOString().split('T')[0] })
				});
			}
			return { ok: true, id: headerId, alreadyExisted: false, totalDebit };
		} catch (e: any) {
			const msg = e?.message || String(e);
			// Balapan: permintaan lain menulis kunci yang sama di antara pra-cek dan POST (ditolak unik DB).
			if (!headerId && /unique|duplicate/i.test(msg)) {
				try {
					const existing = await findByKey(input.idempotencyKey);
					if (existing) return { ok: true, id: existing.id, alreadyExisted: true, totalDebit: Number(existing.total_debit) || 0 };
				} catch {
					/* jatuh ke kegagalan di bawah */
				}
			}
			if (headerId) await cleanup(headerId, detailIds);
			return fail(msg);
		}
	};
}

/** Penulis jurnal yang dipakai kode produksi (Directus server). */
export const writeJournalSafe = makeJournalWriter(realJson as Json);
