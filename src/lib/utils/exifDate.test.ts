import { describe, it, expect } from 'vitest';
import { parseExifDate } from './exifDate';

/** Bangun JPEG minimal: SOI + APP1(Exif, TIFF little/big endian) berisi DateTimeOriginal (+ opsional DateTime) + EOI. */
function buatJpeg({ little = true, original = '2026:11:05 14:30:15', dateTime = null as string | null } = {}): ArrayBuffer {
	const enc = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0); // ASCII + NUL
	const o = enc(original);
	const d = dateTime ? enc(dateTime) : null;
	// Tata letak TIFF: header(8) | IFD0 | ExifIFD | string
	const ifd0Entries = 1 + (d ? 1 : 0);
	const ifd0Off = 8;
	const ifd0Size = 2 + ifd0Entries * 12 + 4;
	const exifOff = ifd0Off + ifd0Size;
	const exifSize = 2 + 12 + 4;
	const strOrig = exifOff + exifSize;
	const strDt = strOrig + o.length;
	const total = strDt + (d ? d.length : 0);
	const tiff = new DataView(new ArrayBuffer(total));
	const w16 = (off: number, v: number) => tiff.setUint16(off, v, little);
	const w32 = (off: number, v: number) => tiff.setUint32(off, v, little);
	tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
	w16(2, 0x002a);
	w32(4, ifd0Off);
	w16(ifd0Off, ifd0Entries);
	let e = ifd0Off + 2;
	w16(e, 0x8769); w16(e + 2, 4); w32(e + 4, 1); w32(e + 8, exifOff); e += 12;
	if (d) { w16(e, 0x0132); w16(e + 2, 2); w32(e + 4, d.length); w32(e + 8, strDt); e += 12; }
	w32(e, 0);
	w16(exifOff, 1);
	w16(exifOff + 2, 0x9003); w16(exifOff + 4, 2); w32(exifOff + 6, o.length); w32(exifOff + 10, strOrig);
	w32(exifOff + 14, 0);
	o.forEach((b, i) => tiff.setUint8(strOrig + i, b));
	d?.forEach((b, i) => tiff.setUint8(strDt + i, b));

	const exifHead = [...'Exif'].map((c) => c.charCodeAt(0)).concat(0, 0);
	const app1Len = 2 + exifHead.length + total;
	const out = new Uint8Array(2 + 2 + 2 + exifHead.length + total + 2);
	out.set([0xff, 0xd8, 0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff], 0);
	out.set(exifHead, 6);
	out.set(new Uint8Array(tiff.buffer), 6 + exifHead.length);
	out.set([0xff, 0xd9], out.length - 2);
	return out.buffer;
}

describe('parseExifDate', () => {
	it('membaca DateTimeOriginal (little & big endian)', () => {
		expect(parseExifDate(buatJpeg({ little: true }))).toBe('2026-11-05T14:30:15');
		expect(parseExifDate(buatJpeg({ little: false }))).toBe('2026-11-05T14:30:15');
	});
	it('DateTimeOriginal diutamakan atas DateTime', () => {
		expect(parseExifDate(buatJpeg({ original: '2026:11:05 14:30:15', dateTime: '2026:11:06 08:00:00' }))).toBe('2026-11-05T14:30:15');
	});
	it('tanggal nol/rusak → null', () => {
		expect(parseExifDate(buatJpeg({ original: '0000:00:00 00:00:00' }))).toBeNull();
		expect(parseExifDate(buatJpeg({ original: 'bukan tanggal' }))).toBeNull();
	});
	it('bukan JPEG / terpotong / kosong → null tanpa melempar', () => {
		expect(parseExifDate(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer)).toBeNull();
		expect(parseExifDate(buatJpeg().slice(0, 30))).toBeNull();
		expect(parseExifDate(new ArrayBuffer(0))).toBeNull();
	});
	it('JPEG tanpa EXIF → null', () => {
		expect(parseExifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]).buffer)).toBeNull();
	});
});
