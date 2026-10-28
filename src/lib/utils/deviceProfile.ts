// src/lib/utils/deviceProfile.ts
// Deteksi kemampuan perangkat (rencana v2, Fase 1/5) — dipakai untuk menurunkan resolusi
// kamera pada HP RAM/CPU rendah, dan sebagai basis Mode Hemat manual.

export function isWeakDevice(): boolean {
	if (typeof navigator === 'undefined') return false;
	const nav = navigator as Navigator & { deviceMemory?: number };
	return (nav.deviceMemory ?? 4) <= 4 || (navigator.hardwareConcurrency ?? 4) <= 4;
}

export type NetworkSpeed = 'slow' | 'normal';

/** 2g/slow-2g dianggap jaringan lambat — turunkan target kompresi foto. */
export function currentNetworkSpeed(): NetworkSpeed {
	if (typeof navigator === 'undefined') return 'normal';
	const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
	const effectiveType = nav.connection?.effectiveType;
	return effectiveType === '2g' || effectiveType === 'slow-2g' ? 'slow' : 'normal';
}
