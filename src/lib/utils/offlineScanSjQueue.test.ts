import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { HttpError } from './networkError';
import { enqueueScanSj, getQueuedScanSj, flushScanSjQueue, getFailedScanSj } from './offlineScanSjQueue';

const entry = (id: string) => ({ client_txn_id: id, sjId: 1, photoBlob: new Blob(['x']), createdAt: new Date().toISOString() });

describe('offlineScanSjQueue', () => {
	it('terkirim -> keluar dari antrean', async () => {
		await enqueueScanSj(entry('a'));
		const r = await flushScanSjQueue(async () => {});
		expect(r.sent).toBe(1);
		expect(await getQueuedScanSj()).toHaveLength(0);
	});
	it('gangguan jaringan -> tetap di antrean; penolakan tegas -> failed', async () => {
		await enqueueScanSj(entry('b'));
		await flushScanSjQueue(async () => { throw new HttpError('bad gateway', 502); });
		expect(await getQueuedScanSj()).toHaveLength(1);
		await flushScanSjQueue(async () => { throw new HttpError('SJ tidak berkaitan', 403); });
		expect(await getQueuedScanSj()).toHaveLength(0);
		expect((await getFailedScanSj())[0]?.client_txn_id).toBe('b');
	});
});
