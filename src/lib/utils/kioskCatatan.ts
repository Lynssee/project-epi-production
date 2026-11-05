// src/lib/utils/kioskCatatan.ts
// Aturan murni Catatan Kerja kru (Rencana Kiosk Proyek, Fase 4): menentukan jenis catatan dari pilihan
// cepat, dan menyusun isi yang diimpor ke Laporan Harian. Dipakai server (validasi) & klien (impor).

export type JenisCatatan = 'progres' | 'kendala';

export const CATATAN_MAKS_KARAKTER = 300;

/** Jenis dari pilihan cepat (abaikan huruf besar-kecil). null = pilihan tidak ada di setelan manapun. */
export function tentukanJenis(kategori: unknown, progres: readonly string[], kendala: readonly string[]): JenisCatatan | null {
	const k = String(kategori ?? '').trim().toLowerCase();
	if (!k) return null;
	if (kendala.some((x) => x.toLowerCase() === k)) return 'kendala';
	if (progres.some((x) => x.toLowerCase() === k)) return 'progres';
	return null;
}

/** Nama pilihan sesuai penulisan di setelan (agar baris tersimpan rapi walau klien mengirim huruf kecil). */
export function namaKategoriResmi(kategori: string, progres: readonly string[], kendala: readonly string[]): string {
	const k = kategori.trim().toLowerCase();
	return [...kendala, ...progres].find((x) => x.toLowerCase() === k) ?? kategori.trim();
}

export interface CatatanKru {
	id: number;
	manpower_nama?: string | null;
	jenis: JenisCatatan | string | null;
	kategori?: string | null;
	catatan?: string | null;
	foto?: string | null;
}

export interface HasilImpor {
	fotoProgres: string[];
	fotoKendala: string[];
	teksProgres: string[];
	teksKendala: string[];
}

function baris(c: CatatanKru): string {
	const nama = (c.manpower_nama || 'Kru').trim();
	const kat = c.kategori ? ` (${c.kategori})` : '';
	const isi = (c.catatan || '').trim().replace(/\s+/g, ' ') || (c.foto ? 'lihat foto' : '');
	return `• ${nama}${kat}: ${isi}`.trim();
}

/** Pisahkan catatan terpilih menjadi foto & baris teks per bagian laporan. Catatan tanpa foto/teks dilewati. */
export function susunImpor(items: CatatanKru[] | null | undefined): HasilImpor {
	const out: HasilImpor = { fotoProgres: [], fotoKendala: [], teksProgres: [], teksKendala: [] };
	for (const c of items || []) {
		if (!c) continue;
		const kendala = c.jenis === 'kendala';
		const teks = (c.catatan || '').trim();
		if (!teks && !c.foto) continue;
		(kendala ? out.teksKendala : out.teksProgres).push(baris(c));
		if (c.foto) (kendala ? out.fotoKendala : out.fotoProgres).push(c.foto);
	}
	return out;
}

/** Tambahkan baris ke teks yang sudah ada, tanpa mengulang baris yang sama (impor ulang aman). */
export function tambahBaris(existing: string | null | undefined, baru: readonly string[]): string {
	const cur = (existing || '').trimEnd();
	const sudah = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
	const tambah = baru.filter((b) => b && !sudah.has(b.trim()));
	if (!tambah.length) return existing || '';
	// "-" adalah isian placeholder umum di laporan ("-" = kosong): jangan dipertahankan.
	const dasar = cur === '-' ? '' : cur;
	return [dasar, ...tambah].filter(Boolean).join('\n');
}

/** Gabung id foto tanpa duplikat, urutan lama dipertahankan. */
export function gabungFoto(existing: readonly string[] | null | undefined, baru: readonly string[]): string[] {
	const out = [...(existing || [])];
	for (const f of baru) if (f && !out.includes(f)) out.push(f);
	return out;
}
