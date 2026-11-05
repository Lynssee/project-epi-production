// src/lib/utils/readConfirmQueue.ts
// Antrean "Saya Sudah Membaca" SOP saat OFFLINE (R-L4): konfirmasi yang gagal terkirim disimpan di perangkat (`sop_read_pending_sync`) lalu
// dikirim otomatis saat aplikasi kembali online, supaya laporan kepatuhan baca SOP di HRD/Admin akurat. Waktu baca ASLI ikut terkirim.
// Storage & pengirim disuntikkan (dites tanpa jaringan). Tidak melempar. Kegagalan sementara (jaringan/5xx/401) → tetap di antrean;
// penolakan permanen (400/404/422) → dibuang agar antrean tidak macet.
export const READ_QUEUE_KEY = 'sop_read_pending_sync';
const MAX_QUEUE = 100;

export interface PendingRead {
	flow_key: string;
	version_seq: number;
	/** ISO — kapan pengguna benar-benar menekan tombol. */
	read_at: string;
}
type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

export function readQueue(storage: Store): PendingRead[] {
	try {
		const parsed = JSON.parse(storage?.getItem(READ_QUEUE_KEY) || '[]');
		return (Array.isArray(parsed) ? parsed : []).filter((x) => x && typeof x.flow_key === 'string' && x.flow_key && typeof x.read_at === 'string').slice(0, MAX_QUEUE);
	} catch {
		return [];
	}
}

function writeQueue(storage: Store, list: PendingRead[]): void {
	try {
		storage?.setItem(READ_QUEUE_KEY, JSON.stringify(list.slice(0, MAX_QUEUE)));
	} catch {
		/* kuota penuh / mode privat: antrean hanya kenyamanan */
	}
}

/** Tambah ke antrean; satu butir per (alur, versi) — menekan ulang tidak menggandakan. */
export function enqueueRead(storage: Store, item: { flow_key: string; version_seq?: number; read_at?: string }): PendingRead[] {
	const entry: PendingRead = { flow_key: item.flow_key, version_seq: Number(item.version_seq) || 1, read_at: item.read_at || new Date().toISOString() };
	const cur = readQueue(storage).filter((x) => !(x.flow_key === entry.flow_key && x.version_seq === entry.version_seq));
	const next = [...cur, entry];
	writeQueue(storage, next);
	return next;
}

export interface SendResult {
	ok: boolean;
	/** Status HTTP; 0 = jaringan putus. */
	status: number;
}

/** Kirim semua butir antrean berurutan; berhenti di kegagalan sementara (jaringan putus tak perlu dicoba berulang). */
export async function flushReadQueue(storage: Store, send: (item: PendingRead) => Promise<SendResult>): Promise<{ sent: number; dropped: number; remaining: number }> {
	const queue = readQueue(storage);
	let sent = 0;
	let dropped = 0;
	const keep: PendingRead[] = [];
	let stopped = false;
	for (const item of queue) {
		if (stopped) {
			keep.push(item);
			continue;
		}
		let r: SendResult;
		try {
			r = await send(item);
		} catch {
			r = { ok: false, status: 0 };
		}
		if (r.ok) sent++;
		else if ([400, 404, 422].includes(r.status)) dropped++;
		else {
			keep.push(item);
			stopped = true;
		}
	}
	if (sent || dropped) writeQueue(storage, keep);
	return { sent, dropped, remaining: keep.length };
}
