// src/lib/server/deviceFingerprint.ts
// Hash User-Agent+Accept-Language dari header request — sama pola dengan yang sudah dipakai
// site-checkin.ts (Penajaman SDM v2 Fase 5), diekstrak supaya kiosk absen-istirahat bisa pakai
// tanpa menduplikasi hashString. Bukan device ID sempurna, cukup untuk beda HP/browser jelas.

export async function hashDeviceFingerprint(request: Request): Promise<string> {
	const src = `${request.headers.get('user-agent') || ''}|${request.headers.get('accept-language') || ''}`;
	const buf = new TextEncoder().encode(src);
	const digest = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
