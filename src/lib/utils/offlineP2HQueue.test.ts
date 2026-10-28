import { describe, expect, it, vi } from 'vitest';

// Modul menarik store/firebase lewat import — dimock: yang diuji hanya logika murni.
vi.mock('svelte/store', () => ({ get: () => ({ user: { uid: 'u1' } }) }));
vi.mock('$lib/stores/auth', () => ({ authStore: {} }));
vi.mock('$lib/services/ess/fleetBooking', () => ({ submitFleetChecklist: vi.fn() }));
vi.mock('./offlineQueueFactory', () => ({
	createOfflineQueue: () => ({ enqueue: vi.fn(), getQueued: vi.fn(async () => []), removeQueued: vi.fn(), flush: vi.fn(), registerAutoFlush: vi.fn() })
}));

import { buildOverlay, classifyError, planFlushOrder, type QueuedP2HSubmission } from './offlineP2HQueue';

const e = (over: Partial<QueuedP2HSubmission>): QueuedP2HSubmission => ({
	client_txn_id: 'x',
	bookingId: 'b1',
	tahap: 'sebelum',
	items: [],
	kmSaatCek: 100,
	temuan: null,
	kmKoreksiAlasan: null,
	lupaSebelum: false,
	fotoBlob: null,
	fotoName: null,
	fotoDashboardBlob: null,
	createdAt: '2026-09-29T08:00:00.000Z',
	userId: 'u1',
	...over
});

describe('planFlushOrder', () => {
	it('mengurutkan menurut createdAt (sebelum sebelum setelah), bukan urutan key', () => {
		const list = [
			e({ client_txn_id: 'zzz', tahap: 'setelah', createdAt: '2026-09-29T16:00:00.000Z' }),
			e({ client_txn_id: 'aaa', tahap: 'sebelum', createdAt: '2026-09-29T08:00:00.000Z' })
		];
		expect(planFlushOrder(list, 'u1').map((x) => x.tahap)).toEqual(['sebelum', 'setelah']);
	});
	it('hanya entri milik user & bukan yang ditolak', () => {
		const list = [e({ client_txn_id: '1' }), e({ client_txn_id: '2', userId: 'lain' }), e({ client_txn_id: '3', status: 'rejected' })];
		expect(planFlushOrder(list, 'u1').map((x) => x.client_txn_id)).toEqual(['1']);
	});
});

describe('classifyError', () => {
	it('jaringan & 5xx & 408/429 = sementara (coba lagi)', () => {
		expect(classifyError(Object.assign(new Error('x'), { isNetwork: true }))).toBe('transient');
		expect(classifyError(Object.assign(new Error('x'), { status: 502 }))).toBe('transient');
		expect(classifyError(Object.assign(new Error('x'), { status: 429 }))).toBe('transient');
		expect(classifyError(Object.assign(new Error('x'), { status: 408 }))).toBe('transient');
	});
	it('4xx lain = ditolak permanen', () => {
		expect(classifyError(Object.assign(new Error('x'), { status: 400 }))).toBe('rejected');
		expect(classifyError(Object.assign(new Error('x'), { status: 422 }))).toBe('rejected');
		expect(classifyError(Object.assign(new Error('x'), { status: 403 }))).toBe('rejected');
	});
	it('status tidak diketahui → sementara (data peminjam tidak dibuang)', () => {
		expect(classifyError(new Error('aneh'))).toBe('transient');
	});
});

describe('buildOverlay', () => {
	it('setelah mengalahkan sebelum; ditolak & milik orang lain diabaikan', () => {
		const list = [
			e({ bookingId: 'b1', tahap: 'sebelum' }),
			e({ bookingId: 'b1', tahap: 'setelah', client_txn_id: '2' }),
			e({ bookingId: 'b2', tahap: 'sebelum', client_txn_id: '3' }),
			e({ bookingId: 'b3', tahap: 'sebelum', client_txn_id: '4', status: 'rejected' }),
			e({ bookingId: 'b4', tahap: 'sebelum', client_txn_id: '5', userId: 'lain' })
		];
		const m = buildOverlay(list, 'u1');
		expect(m.get('b1')).toBe('setelah');
		expect(m.get('b2')).toBe('sebelum');
		expect(m.has('b3')).toBe(false);
		expect(m.has('b4')).toBe(false);
	});
});
