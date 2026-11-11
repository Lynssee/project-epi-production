import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ url: string; opts?: any }> = [];
let failCreate = false;
let uploadResult: string | null = 'file-1';

vi.mock('./secureDirectus', () => ({
	secureDirectusJson: vi.fn(async (url: string, opts?: any) => {
		calls.push({ url, opts });
		if (opts?.method === 'POST') {
			if (failCreate) throw new Error('403');
			return { data: { id: 9, ...JSON.parse(opts.body) } };
		}
		return { data: [{ id: 1, project_object_id: 5, tahap: 'lapisan_1', foto: { id: 'f9' } }, { id: 2, project_object_id: 5, tahap: null, foto: 'f8' }] };
	})
}));
vi.mock('./inspectionApi', () => ({ uploadFile: vi.fn(async () => uploadResult) }));

const { fetchObjectStagePhotos, groupPhotos, addStagePhoto } = await import('./projectObjectPhotoApi');

beforeEach(() => { calls.length = 0; failCreate = false; uploadResult = 'file-1'; });

describe('fetchObjectStagePhotos', () => {
	it('tanpa objek → [] tanpa query; dengan objek → filter _in + hanya yang berfoto', async () => {
		expect(await fetchObjectStagePhotos([])).toEqual([]);
		expect(calls).toHaveLength(0);
		const r = await fetchObjectStagePhotos([5, 5, 6]);
		const url = decodeURIComponent(calls[0].url);
		expect(url).toContain('"project_object_id":{"_in":[5,6]}');
		expect(url).toContain('"foto":{"_nnull":true}');
		expect(r[0].foto).toBe('f9'); // objek file diratakan jadi id
	});
});

describe('groupPhotos', () => {
	it('per objek lalu per tahap; tahap kosong → ""', async () => {
		const g = groupPhotos(await fetchObjectStagePhotos([5]));
		expect(Object.keys(g[5]).sort()).toEqual(['', 'lapisan_1']);
	});
});

describe('addStagePhoto', () => {
	const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
	it('unggah file lalu catat aktivitas bertahap', async () => {
		const r = await addStagePhoto({ objectId: 5, stageKey: 'lapisan_1', stageLabel: 'L1 Primer', file, author: 'Budi' });
		const body = JSON.parse(calls[0].opts.body);
		expect(body).toMatchObject({ project_object_id: 5, tahap: 'lapisan_1', foto: 'file-1', dibuat_oleh: 'Budi', aktivitas: 'Foto tahap: L1 Primer' });
		expect(r.foto).toBe('file-1');
	});
	it('unggah gagal → error jelas, tidak mencatat aktivitas', async () => {
		uploadResult = null;
		await expect(addStagePhoto({ objectId: 5, stageKey: 'persiapan', stageLabel: 'x', file })).rejects.toThrow('gagal diunggah');
		expect(calls).toHaveLength(0);
	});
	it('catat gagal setelah unggah → error menyebut foto sudah terunggah', async () => {
		failCreate = true;
		await expect(addStagePhoto({ objectId: 5, stageKey: 'persiapan', stageLabel: 'x', file })).rejects.toThrow('terunggah tetapi gagal dicatat');
	});
});
