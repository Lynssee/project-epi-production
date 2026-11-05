// src/lib/utils/kioskProyekRoster.ts
// Helper tampilan roster Kiosk Proyek (Fase 1) — murni, dites. Null-safe (Aturan #7).

export interface HariIni {
	status?: string | null;
	jam_masuk?: string | null;
	jam_pulang?: string | null;
	verifikasi?: string | null;
}

export interface StatusLabel {
	teks: string;
	tone: 'belum' | 'hadir' | 'pulang' | 'izin' | 'lain';
}

const jamWIB = (iso?: string | null): string => {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false })
		.format(d)
		.replace('.', ':');
};

export function labelStatusKru(h: HariIni | null | undefined): StatusLabel {
	if (!h || !h.status) return { teks: 'Belum absen', tone: 'belum' };
	const masuk = jamWIB(h.jam_masuk);
	const pulang = jamWIB(h.jam_pulang);
	switch (h.status) {
		case 'hadir':
		case 'setengah_hari': {
			const awal = h.status === 'setengah_hari' ? 'Setengah hari' : 'Hadir';
			if (pulang) return { teks: `${awal} ${masuk || ''} · Pulang ${pulang}`.replace('  ', ' ').trim(), tone: 'pulang' };
			return { teks: masuk ? `${awal} ${masuk}` : awal, tone: 'hadir' };
		}
		case 'izin':
			return { teks: 'Izin', tone: 'izin' };
		case 'sakit':
			return { teks: 'Sakit', tone: 'izin' };
		case 'alpha':
			return { teks: 'Alpha', tone: 'lain' };
		default:
			return { teks: String(h.status), tone: 'lain' };
	}
}

/** Inisial untuk avatar (maks 2 huruf). */
export function inisial(nama: string | null | undefined): string {
	const parts = (nama || '').trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return '?';
	return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Filter pencarian nama/posisi — tanpa peduli huruf besar-kecil. */
export function filterKru<T extends { nama?: string | null; posisi?: string | null }>(kru: T[] | null | undefined, q: string): T[] {
	const list = kru || [];
	const needle = (q || '').trim().toLowerCase();
	if (!needle) return list;
	return list.filter((k) => `${k.nama || ''} ${k.posisi || ''}`.toLowerCase().includes(needle));
}

/** Ambil token aktivasi dari fragmen URL (#t=...). Bukan dari query agar tidak masuk log server. */
export function tokenDariHash(hash: string | null | undefined): string | null {
	const m = /(?:^#|&)t=([A-Za-z0-9_\-.]+)/.exec(hash || '');
	return m ? m[1] : null;
}
