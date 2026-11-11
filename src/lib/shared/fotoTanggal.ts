// src/lib/shared/fotoTanggal.ts
// PDP-26 — tanggal ambil foto untuk bukti laporan SUSULAN. MURNI (tanpa DOM), aman diuji.
// Dibaca dari EXIF DateTimeOriginal (JPEG, APP1/TIFF) → cadangan File.lastModified. Harus dipanggil pada berkas
// ASLI sebelum watermark/kompres (canvas membuang EXIF dan lastModified jadi "sekarang").
// Parser ringan sendiri (±60 baris) supaya tidak menambah dependensi; hanya membaca tag 0x9003/0x9004/0x0132.

const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;

/** "2026:11:05 14:03:22" → "2026-11-05" (tanggal lokal kamera; tanpa zona waktu di EXIF). */
function exifDateToYmd(s: string): string | null {
	const m = /^(\d{4}):(\d{2}):(\d{2})[ T]/.exec(s.trim());
	if (!m || m[1] === '0000') return null;
	return `${m[1]}-${m[2]}-${m[3]}`;
}

function readAscii(dv: DataView, off: number, len: number): string {
	let s = '';
	for (let i = 0; i < len && off + i < dv.byteLength; i++) {
		const c = dv.getUint8(off + i);
		if (c === 0) break;
		s += String.fromCharCode(c);
	}
	return s;
}

/** Tanggal (YYYY-MM-DD) dari EXIF JPEG, atau null bila tidak ada / bukan JPEG / rusak. */
export function exifTanggalDariBuffer(buf: ArrayBuffer): string | null {
	try {
		const dv = new DataView(buf);
		if (dv.byteLength < 12 || dv.getUint16(0) !== 0xffd8) return null;
		let off = 2;
		while (off + 4 < dv.byteLength) {
			if (dv.getUint8(off) !== 0xff) return null;
			const marker = dv.getUint8(off + 1);
			const size = dv.getUint16(off + 2);
			if (marker === 0xe1 && readAscii(dv, off + 4, 4) === 'Exif') {
				const tiff = off + 10;
				const little = dv.getUint16(tiff) === 0x4949;
				const u16 = (o: number) => dv.getUint16(o, little);
				const u32 = (o: number) => dv.getUint32(o, little);
				const hasil: Record<number, string> = {};
				const bacaIfd = (ifdOff: number): number | null => {
					let exifPtr: number | null = null;
					const n = u16(tiff + ifdOff);
					for (let i = 0; i < n; i++) {
						const e = tiff + ifdOff + 2 + i * 12;
						if (e + 12 > dv.byteLength) break;
						const tag = u16(e);
						if (tag === TAG_EXIF_IFD) exifPtr = u32(e + 8);
						if (tag === TAG_DATETIME_ORIGINAL || tag === TAG_DATETIME_DIGITIZED || tag === TAG_DATETIME) {
							const count = u32(e + 4);
							const valOff = count > 4 ? tiff + u32(e + 8) : e + 8;
							hasil[tag] = readAscii(dv, valOff, count);
						}
					}
					return exifPtr;
				};
				const exifPtr = bacaIfd(u32(tiff + 4));
				if (exifPtr != null) bacaIfd(exifPtr);
				const raw = hasil[TAG_DATETIME_ORIGINAL] || hasil[TAG_DATETIME_DIGITIZED] || hasil[TAG_DATETIME];
				return raw ? exifDateToYmd(raw) : null;
			}
			if (marker === 0xda) return null; // mulai data gambar, tak ada EXIF
			off += 2 + size;
		}
	} catch {
		/* rusak → anggap tidak ada EXIF */
	}
	return null;
}

/** Epoch ms → tanggal WIB (YYYY-MM-DD). */
export function ymdWIB(ms: number): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/**
 * Tanggal ambil foto: EXIF dulu, lalu lastModified. Mengembalikan null bila keduanya tidak dapat dipakai
 * (mis. lastModified 0). Tidak pernah melempar.
 */
export async function tanggalFotoAsli(file: File): Promise<string | null> {
	try {
		if (/jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name)) {
			const head = await file.slice(0, 131072).arrayBuffer();
			const exif = exifTanggalDariBuffer(head);
			if (exif) return exif;
		}
	} catch {
		/* lanjut ke lastModified */
	}
	return file.lastModified > 86_400_000 ? ymdWIB(file.lastModified) : null;
}

/** Selisih hari kalender |a - b|; null bila salah satu tidak valid. */
function selisihHari(a: string, b: string): number | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
	return Math.abs(Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86_400_000));
}

/** Foto cocok bila tanggal ambilnya = tanggal laporan (± toleransi hari, mis. shift malam). */
export function fotoCocokTanggal(tanggalFoto: string | null | undefined, tanggalLaporan: string, toleransiHari = 0): boolean {
	if (!tanggalFoto) return false;
	const d = selisihHari(tanggalFoto, String(tanggalLaporan).slice(0, 10));
	return d !== null && d <= toleransiHari;
}
