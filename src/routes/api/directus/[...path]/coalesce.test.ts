import { describe, it, expect, beforeEach } from 'vitest';
import { coalesced, dropInflight, _inflightSize } from './coalesce';

function deferredUpstream(body: string, status = 200) {
	let resolve!: () => void;
	const gate = new Promise<void>((r) => (resolve = r));
	let calls = 0;
	const run = async () => {
		calls++;
		await gate;
		return new Response(status === 204 ? null : body, { status, headers: { 'content-type': 'application/json' } });
	};
	return { run, release: resolve, calls: () => calls };
}

describe('coalesced — in-flight dedup GET proxy lapangan', () => {
	beforeEach(() => dropInflight(''));

	it('5 GET identik serentak = 1 round-trip, semua menerima body sendiri', async () => {
		const up = deferredUpstream('{"data":[1,2,3]}');
		const all = Array.from({ length: 5 }, () => coalesced('GET:/items/employees?limit=5', up.run));
		up.release();
		const res = await Promise.all(all);
		expect(up.calls()).toBe(1);
		expect(res.filter((r) => r.coalesced)).toHaveLength(4);
		const bodies = await Promise.all(res.map((r) => r.response.text()));
		expect(new Set(bodies)).toEqual(new Set(['{"data":[1,2,3]}']));
		expect(res[0].response.headers.get('content-type')).toBe('application/json');
	});

	it('kunci berbeda (scope user / query berbeda) tidak digabung', async () => {
		const a = deferredUpstream('A');
		const b = deferredUpstream('B');
		const p = [coalesced('GET:/items/x?filter=1', a.run), coalesced('GET:/items/x?filter=2', b.run)];
		a.release();
		b.release();
		const [ra, rb] = await Promise.all(p);
		expect(await ra.response.text()).toBe('A');
		expect(await rb.response.text()).toBe('B');
		expect(ra.coalesced || rb.coalesced).toBe(false);
	});

	it('tidak menyimpan hasil setelah selesai (tanpa cache basi)', async () => {
		const up1 = deferredUpstream('v1');
		up1.release();
		await coalesced('GET:/items/y', up1.run);
		expect(_inflightSize()).toBe(0);
		const up2 = deferredUpstream('v2');
		up2.release();
		const r = await coalesced('GET:/items/y', up2.run);
		expect(r.coalesced).toBe(false);
		expect(await r.response.text()).toBe('v2');
	});

	it('error pemimpin diteruskan ke penumpang & entri dibersihkan', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const failing = async () => {
			await gate;
			throw new Error('upstream down');
		};
		const p1 = coalesced('GET:/items/z', failing);
		const p2 = coalesced('GET:/items/z', failing);
		release();
		await expect(p1).rejects.toThrow('upstream down');
		await expect(p2).rejects.toThrow('upstream down');
		expect(_inflightSize()).toBe(0);
	});

	it('204 tanpa body tidak melempar', async () => {
		const up = deferredUpstream('', 204);
		up.release();
		const r = await coalesced('GET:/items/w', up.run);
		expect(r.response.status).toBe(204);
	});

	it('dropInflight memutus penumpang baru sesudah tulis (read-your-writes)', async () => {
		const before = deferredUpstream('lama');
		const p1 = coalesced('GET:/items/employees?limit=5', before.run);
		dropInflight('items/employees/12');
		const after = deferredUpstream('baru');
		const p2 = coalesced('GET:/items/employees?limit=5', after.run);
		before.release();
		after.release();
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(await r1.response.text()).toBe('lama');
		expect(await r2.response.text()).toBe('baru');
		expect(r2.coalesced).toBe(false);
		expect(after.calls()).toBe(1);
	});
});
