// PC3-06 — validasi upload foto nota (ukuran, magic bytes) + pembersihan file yatim.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
const mockUpload = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: (...a: unknown[]) => mockUpload(...a)
}));

const { uploadBukti, deleteOrphanBukti, detectImageExt, BUKTI_MAX_BYTES } = await import('./pettyCashRequest');

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
const mkFile = (bytes: number[], name = 'nota.jpg', pad = 0) =>
	new File([new Uint8Array([...bytes, ...new Array(pad).fill(0)])], name, { type: 'image/jpeg' });
const statusOf = async (p: Promise<unknown>) => {
	try {
		await p;
		return 'ok';
	} catch (e: any) {
		return e?.status ?? 'error';
	}
};

beforeEach(() => {
	mockJson.mockReset();
	mockUpload.mockReset();
	mockUpload.mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'file-1' } }) });
});

describe('detectImageExt', () => {
	it('mengenali JPEG/PNG/WEBP dari magic bytes', () => {
		expect(detectImageExt(new Uint8Array(JPEG))).toBe('jpg');
		expect(detectImageExt(new Uint8Array(PNG))).toBe('png');
		expect(detectImageExt(new Uint8Array(WEBP))).toBe('webp');
	});
	it('menolak PDF, teks, dan RIFF non-WEBP (mis. WAV/AVI)', () => {
		expect(detectImageExt(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0, 0, 0, 0, 0, 0]))).toBeNull();
		expect(detectImageExt(new TextEncoder().encode('halo dunia!!'))).toBeNull();
		expect(detectImageExt(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
		expect(detectImageExt(new Uint8Array([]))).toBeNull();
	});
});

describe('uploadBukti', () => {
	it('tanpa file / file kosong → null tanpa unggah', async () => {
		expect(await uploadBukti(null, 1)).toBeNull();
		expect(await uploadBukti('teks', 1)).toBeNull();
		expect(await uploadBukti(new File([], 'x.jpg'), 1)).toBeNull();
		expect(mockUpload).not.toHaveBeenCalled();
	});

	it('menerima JPEG/PNG/WEBP dan menamai file sesuai isi (bukan selalu .jpg)', async () => {
		for (const [bytes, ext] of [[JPEG, 'jpg'], [PNG, 'png'], [WEBP, 'webp']] as const) {
			mockUpload.mockClear();
			expect(await uploadBukti(mkFile([...bytes], 'apa-saja.jpg'), 7)).toEqual(['file-1']);
			const fd = mockUpload.mock.calls[0][0] as FormData;
			expect((fd.get('file') as File).name).toMatch(new RegExp(`^pcr-7-\\d+\\.${ext}$`));
		}
	});

	it('menolak PDF/teks berekstensi .jpg → 415, tidak diunggah', async () => {
		expect(await statusOf(uploadBukti(mkFile([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0, 0, 0, 0, 0, 0], 'x.jpg'), 1))).toBe(415);
		expect(await statusOf(uploadBukti(new File(['bukan foto sama sekali'], 'x.jpg'), 1))).toBe(415);
		expect(mockUpload).not.toHaveBeenCalled();
	});

	it('menolak > 10 MB → 413 dengan pesan ramah, tidak diunggah', async () => {
		const big = mkFile(JPEG, 'besar.jpg', BUKTI_MAX_BYTES);
		expect(await statusOf(uploadBukti(big, 1))).toBe(413);
		expect(mockUpload).not.toHaveBeenCalled();
	});

	it('Directus menolak unggahan → 502', async () => {
		mockUpload.mockResolvedValue({ ok: false, json: async () => ({}) });
		expect(await statusOf(uploadBukti(mkFile(JPEG), 1))).toBe(502);
	});
});

describe('deleteOrphanBukti', () => {
	it('menghapus tiap file yatim via DELETE /files/<id>', async () => {
		mockJson.mockResolvedValue(null);
		await deleteOrphanBukti(['a', 'b']);
		expect(mockJson).toHaveBeenCalledWith('/files/a', { method: 'DELETE' });
		expect(mockJson).toHaveBeenCalledWith('/files/b', { method: 'DELETE' });
	});
	it('null/kosong → tidak memanggil apa pun', async () => {
		await deleteOrphanBukti(null);
		await deleteOrphanBukti([]);
		expect(mockJson).not.toHaveBeenCalled();
	});
	it('gagal hapus tidak melempar (best-effort) tetapi dicatat', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockJson.mockRejectedValue(new Error('directus mati'));
		await expect(deleteOrphanBukti(['a', 'b'])).resolves.toBeUndefined();
		expect(err).toHaveBeenCalledTimes(2);
		err.mockRestore();
	});
});
