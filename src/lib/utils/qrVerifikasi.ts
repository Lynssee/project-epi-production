// src/lib/utils/qrVerifikasi.ts
// Sisi KLIEN QR verifikasi dokumen (Fase 3 §5.2): minta tautan bertanda tangan ke server (rahasia HMAC tidak pernah
// ke browser), lalu ubah jadi QR data-URI. Gagal APA PUN → null (QR hanya pelengkap; dokumen tetap tercetak) dengan
// log jelas — tidak ditelan diam-diam (Aturan #1).
import { auth } from '$lib/firebase';

export interface QrVerifikasi {
	qrDataUrl: string;
	verifyUrl: string;
}

export async function requestVerifyUrl(jenis: 'pa', id: string | number, fetchImpl: typeof fetch = fetch): Promise<string | null> {
	try {
		const idToken = await auth.currentUser?.getIdToken();
		const res = await fetchImpl('/api/verifikasi/sign', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
			body: JSON.stringify({ jenis, id })
		});
		if (!res.ok) {
			console.warn(`[qrVerifikasi] server menolak/tidak siap menerbitkan QR (HTTP ${res.status}) — dokumen dicetak tanpa QR`);
			return null;
		}
		const j = await res.json().catch(() => null);
		return typeof j?.url === 'string' && j.url ? j.url : null;
	} catch (e: any) {
		console.warn('[qrVerifikasi] gagal meminta tautan verifikasi:', e?.message || e);
		return null;
	}
}

export async function buatQrVerifikasi(jenis: 'pa', id: string | number): Promise<QrVerifikasi | null> {
	const verifyUrl = await requestVerifyUrl(jenis, id);
	if (!verifyUrl) return null;
	try {
		const QRCode = (await import('qrcode')).default;
		// Koreksi error 'M': tetap terbaca di kertas thermal yang agak buram; margin kecil hemat ruang slip.
		const qrDataUrl = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
		return { qrDataUrl, verifyUrl };
	} catch (e: any) {
		console.warn('[qrVerifikasi] gagal membuat gambar QR:', e?.message || e);
		return null;
	}
}
