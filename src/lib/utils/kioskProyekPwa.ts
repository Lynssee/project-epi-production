// src/lib/utils/kioskProyekPwa.ts
// Deteksi platform/mode pasang untuk panduan "tambah ke layar utama" (Kiosk Proyek, Fase 3).

export type Platform = 'ios' | 'android' | 'lain';

export function deteksiPlatform(ua: string | null | undefined): Platform {
	const s = ua || '';
	if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
	if (/Android/i.test(s)) return 'android';
	return 'lain';
}

/** Sedang berjalan dari ikon layar utama (mode standalone), bukan tab browser biasa. */
export function sudahTerpasang(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
		return (navigator as any).standalone === true; // iOS Safari
	} catch {
		return false;
	}
}

/** Tukar <link rel="manifest"> ke manifest kiosk proyek; kembalikan fungsi pemulih ke manifest semula. */
export function pasangManifestKiosk(kode: string): () => void {
	const href = `/k/${encodeURIComponent(kode)}/manifest.webmanifest`;
	let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
	const dibuat = !link;
	const semula = link?.getAttribute('href') ?? null;
	if (!link) {
		link = document.createElement('link');
		link.rel = 'manifest';
		document.head.appendChild(link);
	}
	link.setAttribute('href', href);
	return () => {
		if (dibuat) link?.remove();
		else if (semula != null) link?.setAttribute('href', semula);
	};
}
