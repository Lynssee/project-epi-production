// F0 — Token Directus admin TIDAK lagi ditaruh di bundle klien. SDK menembak
// proxy server /api/directus/* (lihat src/routes/api/directus/[...path]) yang
// memverifikasi sesi Firebase lalu meneruskan ke Directus dengan token
// rahasia sisi server. Header Authorization di sini berisi Firebase ID token,
// BUKAN token Directus.
import { createDirectus, rest } from '@directus/sdk';
import { getIdToken } from './secureDirectus';

// `ssr = false` global (src/routes/+layout.ts) — modul ini hanya pernah
// dievaluasi di browser, jadi window.location selalu tersedia. SDK
const PROXY_BASE = typeof window !== 'undefined' ? `${window.location.origin}/api/directus` : 'http://localhost:9391/api/directus';

// Client default — semua request lewat proxy terautentikasi.
const directus = createDirectus(PROXY_BASE).with(
	rest({
		onRequest: async (options) => {
			const token = await getIdToken();
			return {
				...options,
				headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
			};
		}
	})
);

export default directus;

// Dipertahankan untuk kompatibilitas pemanggil lama (row-level per-user
// token Directus sudah tidak relevan — proxy selalu memakai sesi Firebase
// pemanggil saat ini). Mengembalikan client default.
export function createUserDirectus(_userToken?: string) {
	return directus;
}

export function handleDirectusError(error: any) {
	if (error?.errors && error.errors.length > 0) {
		const firstError = error.errors[0];
		if (firstError.extensions?.code === 'FORBIDDEN' || error.response?.status === 403) {
			// 403 di arsitektur ini = field/relasi salah atau schema drift, bukan izin (CLAUDE.md)
			console.error('[Directus 403] Kemungkinan field/relasi tidak ada di skema live:', { url: error.response?.url || '', message: firstError.message });
			throw new Error('Gagal mengambil data dari server.');
		}
	}
	throw error;
}
