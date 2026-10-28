// Antrian generik berbasis localStorage untuk submit yang gagal karena sinyal lemah
// (mis. saat driver di lapangan). Dipakai oleh service driver.ts (trip/POD/checkpoint/checklist)
// dan bisa dipakai ulang modul lain yang butuh retry-saat-online.

export interface QueuedRequest {
	id: string;
	url: string;
	method: string;
	body: unknown;
	createdAt: string;
}

const STORAGE_KEY = 'epi_offline_queue';

function readQueue(): QueuedRequest[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function writeQueue(queue: QueuedRequest[]) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function enqueue(url: string, method: string, body: unknown): QueuedRequest {
	const entry: QueuedRequest = {
		id: crypto.randomUUID(),
		url,
		method,
		body,
		createdAt: new Date().toISOString()
	};
	const queue = readQueue();
	queue.push(entry);
	writeQueue(queue);
	return entry;
}

export function getQueue(): QueuedRequest[] {
	return readQueue();
}

export function removeFromQueue(id: string) {
	writeQueue(readQueue().filter((entry) => entry.id !== id));
}

/**
 * Kirim ulang semua item di antrian. Item yang berhasil dihapus dari antrian;
 * item yang gagal (mis. masih offline) tetap tersimpan untuk percobaan berikutnya.
 */
export async function flushQueue(
	sendFn: (entry: QueuedRequest) => Promise<Response>
): Promise<{ sent: number; failed: number }> {
	const queue = readQueue();
	let sent = 0;
	let failed = 0;
	for (const entry of queue) {
		try {
			const res = await sendFn(entry);
			if (res.ok) {
				removeFromQueue(entry.id);
				sent++;
			} else {
				failed++;
			}
		} catch {
			failed++;
		}
	}
	return { sent, failed };
}

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di root layout/halaman driver. */
export function registerAutoFlush(sendFn: (entry: QueuedRequest) => Promise<Response>) {
	if (typeof window === 'undefined') return;
	window.addEventListener('online', () => {
		flushQueue(sendFn).catch(() => {});
	});
}
