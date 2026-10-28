// src/lib/utils/sjkSelfVerify.ts
// WSK-35 §4a — kunci "pembuat SJ ≠ verifikator gerbang" (MURNI). SALINAN TERUJI dari erp-epi: src/lib/utils/workshopSjkCreator.js
// (ubah KEDUANYA bersamaan). Pembuat = kolom dibuat_oleh_karyawan_id (karyawan.id, diisi proxy erp-epi). SJ lama = kosong ⇒ tidak terkunci.
//   mode 'reason' (default): boleh dengan ALASAN (≥ 10 karakter) + notifikasi atasan  ← fallback bila hanya satu orang bertugas (Aturan #4)
//   mode 'block' menolak total · 'off' mematikan kunci

export const SJK_CREATOR_COLUMN = 'dibuat_oleh_karyawan_id';
export const SELF_VERIFY_SETTING_KEY = 'workshop_sjk_self_verify_mode';
export const SELF_VERIFY_MODES = ['off', 'reason', 'block'] as const;
export type SelfVerifyMode = (typeof SELF_VERIFY_MODES)[number];
export const DEFAULT_SELF_VERIFY_MODE: SelfVerifyMode = 'reason';
export const MIN_ALASAN_SELF_VERIFY = 10;

export function normalizeSelfVerifyMode(v: unknown): SelfVerifyMode {
	const m = String(v ?? '').trim().toLowerCase();
	return (SELF_VERIFY_MODES as readonly string[]).includes(m) ? (m as SelfVerifyMode) : DEFAULT_SELF_VERIFY_MODE;
}

export type SelfVerifyResult = {
	allowed: boolean; selfDetected: boolean; needsNotify: boolean;
	code: 'VERIFIKASI_SENDIRI_ALASAN_WAJIB' | 'VERIFIKASI_SENDIRI_DIBLOKIR' | null; message: string | null;
};

export function evaluateSelfVerify(p: { creatorIds?: Array<number | string | null | undefined>; actorKaryawanId: number | string | null; alasan?: string; mode?: string }): SelfVerifyResult {
	const m = normalizeSelfVerifyMode(p.mode);
	const actor = Number(p.actorKaryawanId);
	const creators = new Set((p.creatorIds || []).filter((v) => v != null && v !== '').map(Number).filter(Number.isFinite));
	const selfDetected = m !== 'off' && Number.isFinite(actor) && actor > 0 && creators.has(actor);
	if (!selfDetected) return { allowed: true, selfDetected: false, needsNotify: false, code: null, message: null };
	if (m === 'block') {
		return { allowed: false, selfDetected: true, needsNotify: false, code: 'VERIFIKASI_SENDIRI_DIBLOKIR', message: 'Anda pembuat SJ ini, sehingga tidak boleh memverifikasi gerbangnya sendiri. Minta petugas gerbang lain.' };
	}
	if (String(p.alasan || '').trim().length < MIN_ALASAN_SELF_VERIFY) {
		return {
			allowed: false, selfDetected: true, needsNotify: false, code: 'VERIFIKASI_SENDIRI_ALASAN_WAJIB',
			message: `Anda pembuat SJ ini. Idealnya petugas lain yang memverifikasi. Bila hanya Anda yang bertugas, isi alasan di kolom catatan (min. ${MIN_ALASAN_SELF_VERIFY} karakter) lalu tekan Loloskan lagi — atasan Anda akan diberi tahu.`
		};
	}
	return { allowed: true, selfDetected: true, needsNotify: true, code: null, message: null };
}
