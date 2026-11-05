// src/lib/shared/kioskFlags.ts
// Penanda anomali absensi kiosk (Rencana Kiosk Proyek, Fase 2) — MURNI, dipakai server & klien.
//
// Disimpan di kolom manpower_absensi.verifikasi_leader_catatan dengan awalan "[kiosk] " supaya
// TIDAK perlu skema baru: "[kiosk] jendela_jam,rekan_batas | catatan leader". Saat leader memverifikasi,
// bagian [kiosk] dipertahankan (lihat verifikasiAbsensi) sehingga jejak anomali tidak hilang.

export const KIOSK_FLAG_PREFIX = '[kiosk] ';

export type KioskFlag = 'jendela_jam' | 'rekan_batas' | 'foto_ganda' | 'lupa_pulang';

export const KIOSK_FLAG_LABEL: Record<KioskFlag, string> = {
	jendela_jam: 'Di luar jam absen',
	rekan_batas: 'Perangkat mengabsenkan banyak orang',
	foto_ganda: 'Foto sama dengan absen lain',
	// Ditulis otomatis malam hari oleh pengingat n8n (erp-epi, Fase 6) bila setelan kiosk_proyek.lupa_pulang_tandai menyala.
	lupa_pulang: 'Lupa absen pulang'
};

const KNOWN = new Set<string>(Object.keys(KIOSK_FLAG_LABEL));

export function decodeFlags(catatan: string | null | undefined): KioskFlag[] {
	const s = catatan || '';
	if (!s.startsWith(KIOSK_FLAG_PREFIX)) return [];
	const head = s.slice(KIOSK_FLAG_PREFIX.length).split(' | ')[0];
	return head.split(',').map((x) => x.trim()).filter((x): x is KioskFlag => KNOWN.has(x));
}

/** Teks leader di luar bagian [kiosk] (bila ada). */
export function teksLeader(catatan: string | null | undefined): string {
	const s = catatan || '';
	if (!s.startsWith(KIOSK_FLAG_PREFIX)) return s;
	const idx = s.indexOf(' | ');
	return idx === -1 ? '' : s.slice(idx + 3);
}

export function encodeCatatan(flags: readonly string[], teks = ''): string {
	const uniq = [...new Set(flags.filter((f) => KNOWN.has(f)))];
	const head = uniq.length ? `${KIOSK_FLAG_PREFIX}${uniq.join(',')}` : '';
	const t = (teks || '').trim();
	return head && t ? `${head} | ${t}` : head || t;
}

/** Gabungkan penanda baru ke catatan yang ada, teks leader tidak diubah. */
export function mergeFlags(catatan: string | null | undefined, baru: readonly string[]): string {
	return encodeCatatan([...decodeFlags(catatan), ...baru], teksLeader(catatan));
}

export interface BarisAbsensi {
	status?: string | null;
	jam_pulang?: string | null;
	masuk_valid?: boolean | number | null;
	pulang_valid?: boolean | number | null;
	dobel_proyek_flag?: boolean | number | null;
	dikunci?: boolean | number | null;
	verifikasi_leader_status?: string | null;
	verifikasi_leader_catatan?: string | null;
}

/**
 * "Normal" = aman disetujui massal: hadir/setengah hari, di dalam radius (masuk_valid === true),
 * pulang (bila ada) juga di dalam radius, tanpa penanda kiosk, tanpa tanda dobel proyek, belum terkunci.
 * Selebihnya WAJIB dilihat leader satu per satu. Server memakai fungsi ini juga saat verifikasi massal,
 * jadi klien tidak bisa menyetujui massal baris anomali.
 */
export function absensiNormal(r: BarisAbsensi | null | undefined): boolean {
	if (!r) return false;
	if (r.dikunci) return false;
	if (r.verifikasi_leader_status && r.verifikasi_leader_status !== 'menunggu') return false;
	if (r.status !== 'hadir' && r.status !== 'setengah_hari') return false;
	if (!(r.masuk_valid === true || r.masuk_valid === 1)) return false;
	if (r.jam_pulang && !(r.pulang_valid === true || r.pulang_valid === 1)) return false;
	if (r.dobel_proyek_flag) return false;
	return decodeFlags(r.verifikasi_leader_catatan).length === 0;
}

/** Alasan baris TIDAK normal, untuk ditampilkan ke leader (kosong bila normal atau tidak relevan). */
export function alasanAnomali(r: BarisAbsensi | null | undefined): string[] {
	if (!r) return [];
	const out: string[] = [];
	if (r.status === 'hadir' || r.status === 'setengah_hari') {
		if (r.masuk_valid === false || r.masuk_valid === 0) out.push('Di luar radius proyek (masuk)');
		else if (r.masuk_valid == null) out.push('Lokasi masuk tidak dicek');
		if (r.jam_pulang && (r.pulang_valid === false || r.pulang_valid === 0)) out.push('Di luar radius proyek (pulang)');
	}
	if (r.dobel_proyek_flag) out.push('Terdaftar hadir di proyek lain hari yang sama');
	for (const f of decodeFlags(r.verifikasi_leader_catatan)) out.push(KIOSK_FLAG_LABEL[f]);
	return out;
}
