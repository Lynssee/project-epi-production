// src/lib/server/paktaSign.ts
// SERVER-ONLY. Pembungkus tipis: membaca rahasia dari env lalu menandatangani konfirmasi pakta. Dipisah dari paktaSignature.ts
// (murni, tanpa $env) supaya logika HMAC tetap bisa diuji unit tanpa mock env.
import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { readPaktaSecret, trySignPakta, type PaktaSignInput } from '$lib/server/paktaSignature';

/** Kode tanda tangan otomatis (24 karakter) atau null bila DOKUMEN_VERIFIKASI_HMAC_SECRET belum diset — konfirmasi tetap sah tanpa kode. */
export function signKonfirmasi(input: PaktaSignInput): string | null {
	return trySignPakta(readPaktaSecret(env.DOKUMEN_VERIFIKASI_HMAC_SECRET), input);
}

/**
 * Simpan kode tanda tangan ke kolom `signature_hash` SAAT tanda tangan (bukti anti-ubah: kode tersimpan dibandingkan dengan
 * hitung-ulang dari komponen baris). Best-effort: gagal (mis. kolom belum ada) hanya dicatat — konfirmasi TIDAK boleh gagal karenanya.
 */
export async function persistSignatureHash(collection: 'sop_read_confirmations' | 'pakta_persetujuan', id: number | string | null | undefined, signature: string | null): Promise<boolean> {
	if (!signature || id == null) return false;
	try {
		await directusServerJson(`/items/${collection}/${id}`, { method: 'PATCH', body: JSON.stringify({ signature_hash: signature }) });
		return true;
	} catch (e: any) {
		console.warn(`[pakta] signature_hash tidak tersimpan (${collection}#${id}):`, e?.message || e);
		return false;
	}
}
