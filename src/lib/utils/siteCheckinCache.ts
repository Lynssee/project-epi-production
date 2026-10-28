// src/lib/utils/siteCheckinCache.ts
// Paket 02 Site Visit Release (docs/(analyst) site visit/02_offline-idempotensi.md §3.11,
// SVR-04) — cache localStorage untuk daftar proyek/prospek/WO/settings, dipakai CheckinForm
// saat OFFLINE TOTAL (belum pernah bisa memuat apa pun lewat jaringan). Bukan pengganti data
// server — hanya jaring pengaman supaya "Belum ada sinyal" tidak berarti "form kosong tak
// bisa dipakai sama sekali" bagi karyawan yang sudah pernah membuka halaman ini saat online.

const PREFIX = 'site-checkin:cache';

export type SiteCheckinCacheKind = 'projects' | 'settings' | 'prospects' | 'workorders';

interface CacheEnvelope<T> {
	savedAt: string; // ISO
	data: T;
}

function storageKey(uid: string, kind: SiteCheckinCacheKind): string {
	return `${PREFIX}:${uid}:${kind}`;
}

/** Simpan ke localStorage. Gagal-lunak mutlak — cache adalah kenyamanan, bukan fitur wajib. */
export function simpanCache<T>(uid: string, kind: SiteCheckinCacheKind, data: T): void {
	try {
		const envelope: CacheEnvelope<T> = { savedAt: new Date().toISOString(), data };
		localStorage.setItem(storageKey(uid, kind), JSON.stringify(envelope));
	} catch {
		/* localStorage penuh/tidak tersedia (mode privat, dll) — abaikan */
	}
}

/** Baca dari localStorage. null bila tidak ada/rusak/tidak tersedia. */
export function bacaCache<T>(uid: string, kind: SiteCheckinCacheKind): { data: T; savedAt: string } | null {
	try {
		const raw = localStorage.getItem(storageKey(uid, kind));
		if (!raw) return null;
		const envelope = JSON.parse(raw) as CacheEnvelope<T>;
		if (!envelope || typeof envelope.savedAt !== 'string') return null;
		return { data: envelope.data, savedAt: envelope.savedAt };
	} catch {
		return null;
	}
}

/** Label ramah untuk ditampilkan di atas daftar yang berasal dari cache, mis. "Daftar
 *  tersimpan di HP (29 Sep, 14:05)". */
export function labelDariCache(savedAt: string): string {
	try {
		const tanggal = new Date(savedAt).toLocaleString('id-ID', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Jakarta'
		});
		return `Daftar tersimpan di HP (${tanggal} WIB, tanpa sinyal)`;
	} catch {
		return 'Daftar tersimpan di HP (tanpa sinyal)';
	}
}
