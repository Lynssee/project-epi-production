// src/lib/utils/bukuSakuOfflineCache.ts
// Salinan OFFLINE "Buku Saku Jabatan" (PDF) di IndexedDB perangkat — memakai ulang offlineDocumentCache (satu penyimpanan blob untuk seluruh app).
// Kunci menyertakan karyawan + jabatan: salinan orang lain / jabatan lama tidak pernah tampil. Tidak pernah melempar (gagal = tidak ada salinan).
import { cacheDocumentFile, getCachedDocumentFile, removeCachedDocumentFile } from '$lib/utils/offlineDocumentCache';

const keyOf = (karyawanId: number | string, posisiId: number | string) => `buku-saku-jabatan:${karyawanId}:${posisiId}`;

export interface SalinanBukuSaku {
	blob: Blob;
	/** ISO waktu PDF disimpan di perangkat */
	cachedAt: string;
}

export async function simpanSalinanBukuSaku(karyawanId: number | string, posisiId: number | string, blob: Blob, posisiNama = 'jabatan'): Promise<boolean> {
	try {
		await cacheDocumentFile(keyOf(karyawanId, posisiId), blob, `Buku Saku Jabatan - ${posisiNama}.pdf`);
		return true;
	} catch (e: any) {
		console.warn('[bukuSakuOfflineCache] gagal menyimpan salinan offline:', e?.message || e);
		return false;
	}
}

export async function bacaSalinanBukuSaku(karyawanId: number | string, posisiId: number | string): Promise<SalinanBukuSaku | null> {
	const row = await getCachedDocumentFile(keyOf(karyawanId, posisiId));
	return row?.blob ? { blob: row.blob, cachedAt: row.cachedAt } : null;
}

export async function hapusSalinanBukuSaku(karyawanId: number | string, posisiId: number | string): Promise<void> {
	await removeCachedDocumentFile(keyOf(karyawanId, posisiId));
}
