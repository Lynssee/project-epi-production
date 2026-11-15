import { describe, it, expect } from 'vitest';
import { exifTanggalDariBuffer, fotoCocokTanggal, tanggalFotoAsli, ymdWIB } from './fotoTanggal';

/** Bangun JPEG minimal: SOI + APP1(Exif, TIFF little-endian, IFD0 → ExifIFD → DateTimeOriginal). */
function jpegDenganExif(dt: string, big = false): ArrayBuffer {
	const dtBytes = new TextEncoder().encode(dt + '\0'); // 20 byte
	// TIFF: header(8) + IFD0(2 + 1*12 + 4) + ExifIFD(2 + 1*12 + 4) + data(dt)
	const ifd0Off = 8;
	const exifOff = ifd0Off + 2 + 12 + 4;
	const dataOff = exifOff + 2 + 12 + 4;
	const tiffLen = dataOff + dtBytes.length;
	const t = new DataView(new ArrayBuffer(tiffLen));
	const le = !big;
	t.setUint16(0, le ? 0x4949 : 0x4d4d);
	t.setUint16(2, 42, le);
	t.setUint32(4, ifd0Off, le);
	t.setUint16(ifd0Off, 1, le);
	t.setUint16(ifd0Off + 2, 0x8769, le);
	t.setUint16(ifd0Off + 4, 4, le);
	t.setUint32(ifd0Off + 6, 1, le);
	t.setUint32(ifd0Off + 10, exifOff, le);
	t.setUint32(ifd0Off + 14, 0, le);
	t.setUint16(exifOff, 1, le);
	t.setUint16(exifOff + 2, 0x9003, le);
	t.setUint16(exifOff + 4, 2, le);
	t.setUint32(exifOff + 6, dtBytes.length, le);
	t.setUint32(exifOff + 10, dataOff, le);
	t.setUint32(exifOff + 14, 0, le);
	new Uint8Array(t.buffer).set(dtBytes, dataOff);

	const exifHeader = new TextEncoder().encode('Exif\0\0');
	const app1Len = 2 + exifHeader.length + tiffLen;
	const out = new Uint8Array(2 + 2 + app1Len + 2);
	const dv = new DataView(out.buffer);
	dv.setUint16(0, 0xffd8);
	dv.setUint16(2, 0xffe1);
	dv.setUint16(4, app1Len);
	out.set(exifHeader, 6);
	out.set(new Uint8Array(t.buffer), 6 + exifHeader.length);
	dv.setUint16(out.length - 2, 0xffd9);
	return out.buffer;
}

describe('exifTanggalDariBuffer', () => {
	it('membaca DateTimeOriginal (little-endian)', () => {
		expect(exifTanggalDariBuffer(jpegDenganExif('2026:11:05 14:03:22'))).toBe('2026-11-05');
	});
	it('membaca DateTimeOriginal (big-endian)', () => {
		expect(exifTanggalDariBuffer(jpegDenganExif('2026:10:30 07:00:00', true))).toBe('2026-10-30');
	});
	it('bukan JPEG / terlalu pendek / tanggal nol → null', () => {
		expect(exifTanggalDariBuffer(new ArrayBuffer(4))).toBeNull();
		expect(exifTanggalDariBuffer(new TextEncoder().encode('PNG-bukan-jpeg-sama-sekali').buffer)).toBeNull();
		expect(exifTanggalDariBuffer(jpegDenganExif('0000:00:00 00:00:00'))).toBeNull();
	});
	it('JPEG rusak tidak melempar', () => {
		const b = new Uint8Array(jpegDenganExif('2026:11:05 14:03:22')).slice(0, 40).buffer;
		expect(() => exifTanggalDariBuffer(b)).not.toThrow();
	});
});

describe('tanggalFotoAsli', () => {
	it('memakai EXIF bila ada, mengalahkan lastModified', async () => {
		const f = new File([jpegDenganExif('2026:11:01 10:00:00')], 'a.jpg', { type: 'image/jpeg', lastModified: Date.parse('2026-11-06T03:00:00Z') });
		expect(await tanggalFotoAsli(f)).toBe('2026-11-01');
	});
	it('tanpa EXIF → lastModified dalam WIB', async () => {
		const f = new File([new Uint8Array([1, 2, 3])], 'wa.png', { type: 'image/png', lastModified: Date.parse('2026-11-05T20:00:00Z') });
		expect(await tanggalFotoAsli(f)).toBe('2026-11-06'); // 03:00 WIB hari berikutnya
		expect(ymdWIB(Date.parse('2026-11-05T20:00:00Z'))).toBe('2026-11-06');
	});
	it('lastModified 0 → null', async () => {
		const f = new File([new Uint8Array([1])], 'x.png', { type: 'image/png', lastModified: 0 });
		expect(await tanggalFotoAsli(f)).toBeNull();
	});
});

describe('fotoCocokTanggal', () => {
	it('cocok persis, toleransi, dan tidak cocok', () => {
		expect(fotoCocokTanggal('2026-11-02', '2026-11-02')).toBe(true);
		expect(fotoCocokTanggal('2026-11-03', '2026-11-02')).toBe(false);
		expect(fotoCocokTanggal('2026-11-03', '2026-11-02', 1)).toBe(true);
		expect(fotoCocokTanggal('2026-11-02', '2026-11-02T00:00:00+07:00')).toBe(true);
	});
	it('tanggal foto tidak diketahui → tidak cocok', () => {
		expect(fotoCocokTanggal(null, '2026-11-02')).toBe(false);
		expect(fotoCocokTanggal(undefined, '2026-11-02', 3)).toBe(false);
	});
});
