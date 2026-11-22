import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	settings: {} as Record<string, unknown>,
	ledger: [] as any[],
	failBudaya: false,
	musim: [{ id: 3, kode: '2026-11' }] as any[]
}));

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (url: string) => {
		if (url.startsWith('/items/gamifikasi_musim')) return { data: h.musim };
		if (url.startsWith('/items/gamifikasi_ledger')) return { data: h.ledger };
		if (url.startsWith('/items/karyawan')) return { data: [{ id: 1, nama_karyawan: 'Andi' }, { id: 2, nama_karyawan: 'Budi' }] };
		return { data: [] };
	})
}));
vi.mock('$lib/server/ess/budayaHarian', () => ({
	loadCultureSettings: vi.fn(async () => ({ 'culture.kiosk_standby_enabled': true, 'culture.kiosk_standby_idle_seconds': 120, ...h.settings }))
}));
vi.mock('$lib/server/ess/budaya', () => ({
	getBudaya: vi.fn(async () => {
		if (h.failBudaya) throw new Error('boom');
		return { motto: 'Presisi', visi: 'Visi X', misi: ['M1', 'M2'], nilai: [{ judul: 'Keselamatan', arti_singkat: 'a', ikon: '🦺', warna: '#f00' }] };
	})
}));
vi.mock('$lib/server/ess/belongingServer', () => ({
	getWall: vi.fn(async () => ({ days: 7, spotlight: [], events: [{ judul: 'Selamat Ulang Tahun, Andi! 🎂', tanggal_event: '2026-11-13' }] }))
}));
vi.mock('$lib/server/ess/spotlight', () => ({
	loadSpotlightTayang: vi.fn(async () => [{ id: 9, judul: 'Proyek Soeta selesai', ringkasan: 'Terima kasih', pemimpin_nama: 'Budi', kru_nama: [], foto_id: null }])
}));

const { buildSlides, topPeringkat, getStandby, clearStandbyCache } = await import('./kioskStandby');

beforeEach(() => {
	h.settings = {};
	h.ledger = [];
	h.failBudaya = false;
	clearStandbyCache();
});

describe('topPeringkat', () => {
	it('jumlahkan per karyawan, urut turun, buang poin <= 0, batasi', () => {
		const r = topPeringkat([{ karyawan_id: 1, poin: 10 }, { karyawan_id: 1, poin: 5 }, { karyawan_id: 2, poin: 20 }, { karyawan_id: 3, poin: 0 }, null as any], 5);
		expect(r).toEqual([{ karyawan_id: '2', poin: 20 }, { karyawan_id: '1', poin: 15 }]);
		expect(topPeringkat(Array.from({ length: 9 }, (_, i) => ({ karyawan_id: i, poin: i + 1 })), 5)).toHaveLength(5);
		expect(topPeringkat(null as any)).toEqual([]);
	});
});

describe('buildSlides', () => {
	it('urutan: visi/misi → motto → nilai → milestone → peringkat → spotlight; bagian kosong dilewati', () => {
		const s = buildSlides({
			budaya: { motto: 'M', visi: 'V', misi: ['a'], nilai: [{ judul: 'N' }] },
			milestone: [{ judul: 'x', tanggal_event: null }],
			peringkat: { musim: '2026-11', baris: [{ nama: 'A', poin: 1 }] },
			spotlight: [{ judul: 'J', ringkasan: 'R', foto_id: null, pemimpin_nama: null }]
		});
		expect(s.map((x) => x.type)).toEqual(['visimisi', 'motto', 'nilai', 'milestone', 'peringkat', 'spotlight']);
		expect(buildSlides({}).length).toBe(0);
		expect(buildSlides({ budaya: { motto: '', visi: '', misi: [], nilai: [] }, milestone: [], peringkat: { musim: 'x', baris: [] } })).toEqual([]);
	});
});

describe('getStandby', () => {
	it('mati bila setelan nonaktif (tanpa slide); idleSeconds di-clamp 30..900', async () => {
		h.settings = { 'culture.kiosk_standby_enabled': false };
		expect(await getStandby()).toMatchObject({ enabled: false, slides: [] });
		clearStandbyCache();
		h.settings = { 'culture.kiosk_standby_idle_seconds': 5 };
		expect((await getStandby()).idleSeconds).toBe(30);
	});
	it('menyusun semua slide dengan nama peringkat dari Directus', async () => {
		h.ledger = [{ karyawan_id: 1, poin: 10 }, { karyawan_id: 2, poin: 30 }];
		const d = await getStandby();
		expect(d.enabled).toBe(true);
		expect(d.slides.map((s) => s.type)).toEqual(['visimisi', 'motto', 'nilai', 'milestone', 'peringkat', 'spotlight']);
		const rank: any = d.slides.find((s) => s.type === 'peringkat');
		expect(rank.baris).toEqual([{ nama: 'Budi', poin: 30 }, { nama: 'Andi', poin: 10 }]);
	});
	it('satu bagian gagal → dilewati, slide lain tetap (fail-soft)', async () => {
		h.failBudaya = true;
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const d = await getStandby();
		expect(d.slides.some((s) => s.type === 'motto')).toBe(false);
		expect(d.slides.some((s) => s.type === 'milestone')).toBe(true);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
