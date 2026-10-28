// Paket 02 Site Visit Release (docs/(analyst) site visit/02_offline-idempotensi.md §3.3, §6) —
// bukti regresi: 22 antrean lain (stock, absensi, komplain, dst) memakai createOfflineQueue()
// TANPA opsi baru (ordered/isRetryable) dan harus berperilaku identik dengan sebelum paket ini.
// Ditambah uji opsi baru itu sendiri untuk antrean site check-in.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { createOfflineQueue, type OfflineQueueEntryBase } from './offlineQueueFactory';

interface Entry extends OfflineQueueEntryBase {
	label: string;
}

function uniqueDb() {
	return `test_db_${Math.random().toString(36).slice(2)}`;
}

describe('createOfflineQueue — perilaku lama tidak berubah (tanpa opsi baru)', () => {
	it('flush: entri gagal (retryable default) tetap di antrean, tidak pernah ditandai failed', async () => {
		const queue = createOfflineQueue<Entry>({ dbName: uniqueDb(), storeName: 'items' });
		await queue.enqueue({ client_txn_id: 'a', label: 'A' });
		await queue.enqueue({ client_txn_id: 'b', label: 'B' });

		const sendFn = vi.fn(async (e: Entry) => {
			if (e.client_txn_id === 'a') throw new Error('network down');
		});
		const result = await queue.flush(sendFn);

		expect(result).toEqual({ sent: 1, failed: 1 });
		const remaining = await queue.getQueued();
		expect(remaining.map((e) => e.client_txn_id)).toEqual(['a']);
		// Perilaku lama: tidak pernah ditandai 'failed' — selalu diulang lagi nanti.
		expect(await queue.getFailed()).toEqual([]);
	});

	it('flush: lanjut ke entri berikutnya meski entri sebelumnya gagal (unordered = default)', async () => {
		const queue = createOfflineQueue<Entry>({ dbName: uniqueDb(), storeName: 'items' });
		await queue.enqueue({ client_txn_id: 'a', label: 'A' });
		await queue.enqueue({ client_txn_id: 'b', label: 'B' });

		const sent: string[] = [];
		await queue.flush(async (e) => {
			if (e.client_txn_id === 'a') throw new Error('gagal');
			sent.push(e.client_txn_id);
		});
		expect(sent).toEqual(['b']);
	});

	it('registerAutoFlush: idempoten, tidak error dipanggil berkali-kali (tiap mount komponen)', async () => {
		const queue = createOfflineQueue<Entry>({ dbName: uniqueDb(), storeName: 'items' });
		expect(() => {
			queue.registerAutoFlush(async () => {});
			queue.registerAutoFlush(async () => {});
			queue.registerAutoFlush(async () => {});
		}).not.toThrow();
	});

	it('entri lama tanpa field status/createdAt tetap muncul di getQueued (kompatibel mundur)', async () => {
		const queue = createOfflineQueue<Entry>({ dbName: uniqueDb(), storeName: 'items' });
		// simulasikan entri v1 (sebelum field status/createdAt ada di tipe)
		await queue.enqueue({ client_txn_id: 'lama', label: 'Entri Lama' } as Entry);
		const queued = await queue.getQueued();
		expect(queued).toHaveLength(1);
		expect(queued[0].client_txn_id).toBe('lama');
	});
});

describe('createOfflineQueue — opsi baru opt-in (ordered + isRetryable)', () => {
	it('ordered: mengurutkan createdAt, bukan urutan enqueue', async () => {
		const queue = createOfflineQueue<Entry>({ dbName: uniqueDb(), storeName: 'items', ordered: true });
		await queue.enqueue({ client_txn_id: 'kedua', label: 'kedua', createdAt: '2026-09-29T10:00:00.000Z' });
		await queue.enqueue({ client_txn_id: 'pertama', label: 'pertama', createdAt: '2026-09-29T09:00:00.000Z' });
		const queued = await queue.getQueued();
		expect(queued.map((e) => e.client_txn_id)).toEqual(['pertama', 'kedua']);
	});

	it('ordered: berhenti di error retryable pertama, tidak lompat ke entri berikutnya', async () => {
		const queue = createOfflineQueue<Entry>({
			dbName: uniqueDb(),
			storeName: 'items',
			ordered: true,
			isRetryable: () => true
		});
		await queue.enqueue({ client_txn_id: 'a', label: 'a', createdAt: '2026-09-29T09:00:00.000Z' });
		await queue.enqueue({ client_txn_id: 'b', label: 'b', createdAt: '2026-09-29T10:00:00.000Z' });

		const sent: string[] = [];
		await queue.flush(async (e) => {
			if (e.client_txn_id === 'a') throw new Error('gagal jaringan');
			sent.push(e.client_txn_id);
		});
		expect(sent).toEqual([]); // 'b' TIDAK dikirim walau 'a' gagal — urutan dijaga
		expect((await queue.getQueued()).map((e) => e.client_txn_id)).toEqual(['a', 'b']);
	});

	it('isRetryable=false: entri ditandai failed, tidak diulang otomatis, entri lain tetap dicoba', async () => {
		const queue = createOfflineQueue<Entry>({
			dbName: uniqueDb(),
			storeName: 'items',
			isRetryable: (err) => (err as Error).message !== 'PERMANEN'
		});
		await queue.enqueue({ client_txn_id: 'a', label: 'a' });
		await queue.enqueue({ client_txn_id: 'b', label: 'b' });

		await queue.flush(async (e) => {
			if (e.client_txn_id === 'a') throw new Error('PERMANEN');
		});

		expect((await queue.getQueued()).map((e) => e.client_txn_id)).toEqual([]);
		const failed = await queue.getFailed();
		expect(failed).toHaveLength(1);
		expect(failed[0].client_txn_id).toBe('a');
		expect(failed[0].last_error).toBe('PERMANEN');
		expect(failed[0].attempts).toBe(1);

		// flush lagi — entri 'failed' TIDAK ikut terkirim ulang otomatis
		const sendFn = vi.fn();
		await queue.flush(sendFn);
		expect(sendFn).not.toHaveBeenCalled();
	});

	it('retryFailed: mengembalikan entri failed ke pending untuk dicoba lagi', async () => {
		const queue = createOfflineQueue<Entry>({
			dbName: uniqueDb(),
			storeName: 'items',
			isRetryable: () => false
		});
		await queue.enqueue({ client_txn_id: 'a', label: 'a' });
		await queue.flush(async () => {
			throw new Error('permanen');
		});
		expect(await queue.getFailed()).toHaveLength(1);

		await queue.retryFailed('a');
		expect(await queue.getFailed()).toHaveLength(0);
		expect((await queue.getQueued()).map((e) => e.client_txn_id)).toEqual(['a']);
	});

	it('flush paralel: kunci in-memory mencegah 2 eksekusi bersamaan (kirim dobel)', async () => {
		const queue = createOfflineQueue<Entry>({ dbName: uniqueDb(), storeName: 'items' });
		await queue.enqueue({ client_txn_id: 'a', label: 'a' });

		let calls = 0;
		let resolveFirst!: () => void;
		const gate = new Promise<void>((r) => (resolveFirst = r));
		const sendFn = vi.fn(async () => {
			calls++;
			await gate; // tahan panggilan pertama supaya panggilan kedua sempat dipicu
		});

		const p1 = queue.flush(sendFn);
		const p2 = queue.flush(sendFn); // dipicu SEBELUM p1 selesai — harus ikut promise p1, bukan jalan baru
		resolveFirst();
		await Promise.all([p1, p2]);

		expect(calls).toBe(1); // bukan 2 — entri hanya benar-benar dikirim sekali
	});
});
