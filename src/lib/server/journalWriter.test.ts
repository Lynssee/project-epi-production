import { describe, it, expect, vi } from 'vitest';

vi.mock('./directus', () => ({ directusServerJson: vi.fn() }));

import { makeJournalWriter } from './journalWriter';

type Store = { headers: any[]; details: any[]; audit: any[] };

function fakeDirectus(opts: { failDetailAt?: number; failAudit?: boolean; uniqueRace?: boolean } = {}) {
	const store: Store = { headers: [], details: [], audit: [] };
	let hid = 100;
	let did = 500;
	let detailPosts = 0;
	const json = vi.fn(async (url: string, o: { method?: string; body?: string } = {}) => {
		const method = o.method || 'GET';
		const body = o.body ? JSON.parse(o.body) : null;
		if (url.startsWith('/items/journal_entries?') && method === 'GET') {
			const key = decodeURIComponent(url.split('filter[idempotency_key][_eq]=')[1]);
			const h = store.headers.find((x) => x.idempotency_key === key);
			return { data: h ? [h] : [] };
		}
		if (url === '/items/journal_entries' && method === 'POST') {
			if (opts.uniqueRace && !store.headers.length) {
				store.headers.push({ id: ++hid, idempotency_key: body.idempotency_key, total_debit: body.total_debit });
				throw new Error('Value for field "idempotency_key" has to be unique');
			}
			const row = { id: ++hid, ...body };
			store.headers.push(row);
			return { data: { id: row.id } };
		}
		if (url === '/items/journal_entry_details' && method === 'POST') {
			detailPosts++;
			if (opts.failDetailAt && detailPosts === opts.failDetailAt) throw new Error('Directus 500');
			const row = { id: ++did, ...body };
			store.details.push(row);
			return { data: { id: row.id } };
		}
		if (url.startsWith('/items/journal_entry_details?') && method === 'GET') {
			const id = Number(url.match(/_eq\]=(\d+)/)![1]);
			const rows = store.details.filter((d) => d.journal_entry_id === id);
			return { data: [{ count: rows.length, sum: { debit_amount: rows.reduce((s, r) => s + r.debit_amount, 0), credit_amount: rows.reduce((s, r) => s + r.credit_amount, 0) } }] };
		}
		if (url.startsWith('/items/journal_entry_details/') && method === 'DELETE') {
			const id = Number(url.split('/').pop());
			store.details = store.details.filter((d) => d.id !== id);
			return {};
		}
		if (url.startsWith('/items/journal_entries/') && method === 'DELETE') {
			const id = Number(url.split('/').pop());
			store.headers = store.headers.filter((h) => h.id !== id);
			return {};
		}
		if (url.startsWith('/items/journal_entries/') && method === 'PATCH') return { data: {} };
		if (url === '/items/finance_audit_log' && method === 'POST') {
			if (opts.failAudit) throw new Error('audit down');
			store.audit.push(body);
			return {};
		}
		throw new Error(`unexpected ${method} ${url}`);
	});
	return { json, store };
}

const input = (over: any = {}) => ({
	idempotencyKey: 'GR:77',
	header: { journal_number: 'JE-GR-77', transaction_date: '2026-11-12', reference_type: 'GR_COMMIT', reference_number: 'SJ-77' },
	lines: [
		{ account_code: '5100001', debit_amount: 1000, credit_amount: 0 },
		{ account_code: '1131-005', debit_amount: 0, credit_amount: 1000 }
	],
	...over
});

describe('writeJournalSafe (FIN-20)', () => {
	it('menulis header + baris, terverifikasi', async () => {
		const { json, store } = fakeDirectus();
		const r = await makeJournalWriter(json)(input());
		expect(r).toMatchObject({ ok: true, alreadyExisted: false, totalDebit: 1000 });
		expect(store.headers).toHaveLength(1);
		expect(store.details).toHaveLength(2);
		expect(store.headers[0]).toMatchObject({ idempotency_key: 'GR:77', total_debit: 1000, is_posted: false });
	});

	it('konfirmasi dua kali: jurnal tetap satu', async () => {
		const { json, store } = fakeDirectus();
		const w = makeJournalWriter(json);
		const a = await w(input());
		const b = await w(input({ header: { journal_number: 'JE-GR-77-BEDA', transaction_date: '2026-11-12', reference_type: 'GR_COMMIT' } }));
		expect(b).toMatchObject({ ok: true, alreadyExisted: true });
		expect((b as any).id).toBe((a as any).id);
		expect(store.headers).toHaveLength(1);
		expect(store.details).toHaveLength(2);
	});

	it('gagal menulis baris kedua: header & baris dibersihkan (tidak ada yatim) dan kegagalan dicatat', async () => {
		const { json, store } = fakeDirectus({ failDetailAt: 2 });
		const r = await makeJournalWriter(json)(input());
		expect(r.ok).toBe(false);
		expect(store.headers).toHaveLength(0);
		expect(store.details).toHaveLength(0);
		expect(store.audit[0]).toMatchObject({ entity: 'journal_entries', entity_id: 'GR:77', action: 'gagal_buat' });
		expect(store.audit[0].after.error).toContain('Directus 500');
	});

	it('balapan kunci unik: mengembalikan jurnal yang menang, bukan error', async () => {
		const { json } = fakeDirectus({ uniqueRace: true });
		const r = await makeJournalWriter(json)(input());
		expect(r).toMatchObject({ ok: true, alreadyExisted: true });
	});

	it('menolak jurnal tidak balance / baris nol / kurang dari 2 baris tanpa menulis', async () => {
		const { json, store } = fakeDirectus();
		const w = makeJournalWriter(json);
		expect((await w(input({ lines: [{ account_code: 'A', debit_amount: 10, credit_amount: 0 }, { account_code: 'B', debit_amount: 0, credit_amount: 9 }] }))).ok).toBe(false);
		expect((await w(input({ lines: [{ account_code: 'A', debit_amount: 0, credit_amount: 0 }, { account_code: 'B', debit_amount: 0, credit_amount: 0 }] }))).ok).toBe(false);
		expect((await w(input({ lines: [{ account_code: 'A', debit_amount: 5, credit_amount: 0 }] }))).ok).toBe(false);
		expect(store.headers).toHaveLength(0);
	});

	it('kegagalan audit tidak menyembunyikan kegagalan jurnal (tetap ok:false)', async () => {
		const { json } = fakeDirectus({ failDetailAt: 1, failAudit: true });
		const r = await makeJournalWriter(json)(input());
		expect(r.ok).toBe(false);
	});

	it('autoPost memposting setelah verifikasi', async () => {
		const { json } = fakeDirectus();
		const r = await makeJournalWriter(json)(input({ autoPost: true }));
		expect(r.ok).toBe(true);
		expect(json.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(true);
	});
});
