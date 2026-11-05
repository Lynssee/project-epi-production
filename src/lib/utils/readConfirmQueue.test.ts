import { describe, it, expect, vi } from 'vitest';
import { enqueueRead, flushReadQueue, readQueue, READ_QUEUE_KEY } from './readConfirmQueue';

const mem = (initial?: string) => {
	const m = new Map<string, string>(initial ? [[READ_QUEUE_KEY, initial]] : []);
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), _m: m };
};

describe('enqueueRead', () => {
	it('menyimpan waktu baca asli; satu butir per (alur, versi) — tekan ulang tidak menggandakan', () => {
		const s = mem();
		enqueueRead(s, { flow_key: 'a', version_seq: 2, read_at: '2026-10-29T01:00:00.000Z' });
		enqueueRead(s, { flow_key: 'b' });
		enqueueRead(s, { flow_key: 'a', version_seq: 2, read_at: '2026-10-29T02:00:00.000Z' });
		const q = readQueue(s);
		expect(q.map((x) => `${x.flow_key}:${x.version_seq}`)).toEqual(['b:1', 'a:2']);
		expect(q[1].read_at).toBe('2026-10-29T02:00:00.000Z');
	});
	it('storage rusak/penuh/tidak ada → tidak melempar', () => {
		expect(readQueue(mem('{rusak'))).toEqual([]);
		expect(readQueue(null)).toEqual([]);
		expect(() => enqueueRead({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, { flow_key: 'x' })).not.toThrow();
		expect(readQueue(mem(JSON.stringify([{ flow_key: '', read_at: 'x' }, { nope: 1 }, { flow_key: 'ok', version_seq: 1, read_at: 'y' }]))).map((x) => x.flow_key)).toEqual(['ok']);
	});
	it('dibatasi 100 butir', () => {
		const s = mem();
		for (let i = 0; i < 130; i++) enqueueRead(s, { flow_key: `f${i}` });
		expect(readQueue(s).length).toBe(100);
	});
});

describe('flushReadQueue', () => {
	const seed = () => {
		const s = mem();
		for (const k of ['a', 'b', 'c']) enqueueRead(s, { flow_key: k, read_at: `t-${k}` });
		return s;
	};
	it('semua terkirim → antrean kosong; waktu baca asli diteruskan', async () => {
		const s = seed();
		const send = vi.fn(async () => ({ ok: true, status: 200 }));
		expect(await flushReadQueue(s, send)).toEqual({ sent: 3, dropped: 0, remaining: 0 });
		expect(send.mock.calls.map((c: any) => c[0].read_at)).toEqual(['t-a', 't-b', 't-c']);
		expect(readQueue(s)).toEqual([]);
	});
	it('jaringan putus → berhenti di butir pertama (tidak menembak sisanya), semua tetap di antrean', async () => {
		const s = seed();
		const send = vi.fn(async () => ({ ok: false, status: 0 }));
		expect(await flushReadQueue(s, send)).toEqual({ sent: 0, dropped: 0, remaining: 3 });
		expect(send).toHaveBeenCalledTimes(1);
		expect(readQueue(s)).toHaveLength(3);
	});
	it('sebagian sukses lalu gagal sementara (5xx/401/throw): yang sukses hilang, sisanya tetap berurutan', async () => {
		const s = seed();
		let n = 0;
		const send = async () => { n++; if (n === 2) throw new Error('boom'); return { ok: true, status: 200 }; };
		expect(await flushReadQueue(s, send)).toEqual({ sent: 1, dropped: 0, remaining: 2 });
		expect(readQueue(s).map((x) => x.flow_key)).toEqual(['b', 'c']);
		for (const st of [500, 401]) {
			const s2 = seed();
			expect((await flushReadQueue(s2, async () => ({ ok: false, status: st }))).remaining).toBe(3);
		}
	});
	it('penolakan permanen (400/404/422) dibuang supaya antrean tidak macet; yang lain tetap diproses', async () => {
		const s = seed();
		const codes = [400, 200, 404];
		let i = 0;
		const r = await flushReadQueue(s, async () => ({ ok: codes[i] === 200, status: codes[i++] }));
		expect(r).toEqual({ sent: 1, dropped: 2, remaining: 0 });
		expect(readQueue(s)).toEqual([]);
	});
	it('antrean kosong → tidak memanggil pengirim', async () => {
		const send = vi.fn();
		expect(await flushReadQueue(mem(), send as any)).toEqual({ sent: 0, dropped: 0, remaining: 0 });
		expect(send).not.toHaveBeenCalled();
	});
});
