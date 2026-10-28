// src/lib/server/gerbangSj/checklist.ts
// GSP-07 §4.2 — baca surat_jalan.security_checklist lama (objek v1 / teks / null) jadi objek aman
// di-spread. JANGAN pernah `{...sj.security_checklist}` langsung: pada teks hasilnya objek per huruf.

import type { GateChecklist, GateRiwayat } from './types';

const pick = (o: Record<string, any>, keys: string[]) =>
	Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export function normalizeChecklist(raw: unknown): GateChecklist | null {
	if (raw == null || raw === '') return null;
	if (typeof raw === 'string') return { versi: 1, hasil: 'tidak_diketahui', catatan: raw, riwayat: [] };
	if (typeof raw === 'object' && !Array.isArray(raw)) {
		const r = raw as Record<string, any>;
		if (r.versi === 2) return { ...(r as any), riwayat: Array.isArray(r.riwayat) ? r.riwayat : [] };
		const hasil: GateChecklist['hasil'] = r.ditahan
			? 'ditahan'
			: r.ditolak
				? 'ditahan' // "Tolak" ERP lama = tahan
				: r.jumlah_ok && r.plat_ok && r.driver_ok
					? 'lolos'
					: 'tidak_diketahui';
		return {
			versi: 1,
			hasil,
			...pick(r, ['jumlah_ok', 'plat_ok', 'driver_ok', 'foto', 'catatan', 'alasan']),
			...(r.alasan == null && r.ditolak && r.catatan ? { alasan: r.catatan } : {}),
			oleh_nama: r.oleh ?? r.oleh_kiosk ?? null,
			waktu: r.waktu ?? null,
			riwayat: []
		} as GateChecklist;
	}
	let s = '';
	try { s = JSON.stringify(raw).slice(0, 500); } catch { s = String(raw).slice(0, 500); }
	return { versi: 1, hasil: 'tidak_diketahui', catatan: s, riwayat: [] };
}

/** Entri riwayat dari checklist sebelumnya (kosong bila belum pernah ada hasil yang berarti). */
export function toRiwayatEntry(prev: GateChecklist | null): GateRiwayat | null {
	if (!prev || prev.hasil === 'tidak_diketahui') return null;
	return {
		hasil: prev.hasil,
		kategori: (prev.kategori as string) ?? null,
		alasan: (prev.alasan as string) ?? null,
		oleh_nama: prev.oleh_nama ?? null,
		sumber: prev.sumber ?? null,
		waktu: prev.waktu ?? null
	};
}

/** Riwayat baru: entri hasil sebelumnya di depan + riwayat lama, maksimal 10 (GSP-06 §4.3). */
export function buildRiwayat(prev: GateChecklist | null): GateRiwayat[] {
	const entry = toRiwayatEntry(prev);
	return [...(entry ? [entry] : []), ...(prev?.riwayat || [])].slice(0, 10);
}
