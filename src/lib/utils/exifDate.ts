// src/lib/utils/exifDate.ts
// PMT-52 — baca tanggal pengambilan foto (EXIF DateTimeOriginal / DateTime) dari JPEG SEBELUM dikompres. Kompresi via canvas membuang
// seluruh EXIF, jadi tanggal asli hilang; tanggal ini dilampirkan sebagai deskripsi berkas saat unggah. Parser minimal, tanpa dependensi.
// Mengembalikan 'YYYY-MM-DDTHH:MM:SS' (waktu lokal kamera, tanpa zona) atau null. Tidak pernah melempar.

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME = 0x0132;
const HEAD_BYTES = 256 * 1024; // APP1 EXIF selalu di awal berkas; thumbnail besar masih muat

function ascii(view: DataView, off: number, len: number): string {
	let s = '';
	for (let i = 0; i < len && off + i < view.byteLength; i++) {
		const c = view.getUint8(off + i);
		if (c === 0) break;
		s += String.fromCharCode(c);
	}
	return s;
}

function toIso(raw: string): string | null {
	const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
	if (!m || m[1] === '0000') return null;
	return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** Parser murni atas ArrayBuffer (bisa diuji tanpa File/Blob). */
export function parseExifDate(buf: ArrayBuffer): string | null {
	try {
		const v = new DataView(buf);
		if (v.byteLength < 12 || v.getUint16(0) !== 0xffd8) return null; // bukan JPEG
		let off = 2;
		while (off + 4 < v.byteLength) {
			if (v.getUint8(off) !== 0xff) return null;
			const marker = v.getUint8(off + 1);
			if (marker === 0xda || marker === 0xd9) return null; // mulai data gambar — EXIF tidak ada
			const len = v.getUint16(off + 2);
			if (marker === 0xe1 && ascii(v, off + 4, 4) === 'Exif') return readTiff(v, off + 10, off + 2 + len);
			off += 2 + len;
		}
	} catch {
		/* data rusak -> null */
	}
	return null;
}

function readTiff(v: DataView, tiff: number, end: number): string | null {
	const little = v.getUint16(tiff) === 0x4949;
	if (!little && v.getUint16(tiff) !== 0x4d4d) return null;
	const u16 = (o: number) => v.getUint16(o, little);
	const u32 = (o: number) => v.getUint32(o, little);
	if (u16(tiff + 2) !== 0x002a) return null;

	const readIfd = (ifdOff: number): Map<number, { type: number; count: number; valOff: number }> => {
		const out = new Map<number, { type: number; count: number; valOff: number }>();
		const base = tiff + ifdOff;
		if (base + 2 > end) return out;
		const n = u16(base);
		for (let i = 0; i < n && base + 2 + i * 12 + 12 <= end; i++) {
			const e = base + 2 + i * 12;
			out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 });
		}
		return out;
	};
	const strOf = (ent: { count: number; valOff: number }) => ascii(v, ent.count > 4 ? tiff + u32(ent.valOff) : ent.valOff, ent.count);

	const ifd0 = readIfd(u32(tiff + 4));
	const exifPtr = ifd0.get(TAG_EXIF_IFD);
	if (exifPtr) {
		const orig = readIfd(u32(exifPtr.valOff)).get(TAG_DATETIME_ORIGINAL);
		const iso = orig ? toIso(strOf(orig)) : null;
		if (iso) return iso;
	}
	const dt = ifd0.get(TAG_DATETIME);
	return dt ? toIso(strOf(dt)) : null;
}

export async function readExifDate(file: Blob): Promise<string | null> {
	try {
		if (file.type && file.type !== 'image/jpeg' && file.type !== 'image/jpg') return null;
		return parseExifDate(await file.slice(0, HEAD_BYTES).arrayBuffer());
	} catch {
		return null;
	}
}
