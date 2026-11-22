import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { path: string; opts?: any }[] = [];
let responder: (path: string, opts?: any) => any;
vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (path: string, opts?: any) => {
		calls.push({ path, opts });
		return responder(path, opts);
	})
}));
vi.mock('$lib/server/ess/polaKerjaResolver', () => ({ resolveKaryawanPolaKerja: vi.fn(async () => 'project') }));

// Cache modul (setelan/konten 60 dtk) → muat modul BARU di tiap tes.
async function fresh() {
	vi.resetModules();
	return import('./budayaPopup');
}
const { todayJakarta } = await import('$lib/server/ess/time');
const TODAY = todayJakarta();

const setRows = [
	{ setting_key: 'culture.popup_enabled', setting_value: 'true' },
	{ setting_key: 'culture.microquiz_enabled', setting_value: 'true' }
];
const base = (o: any = {}) => ({ id: 1, judul: 'SOP APD', isi_pesan: 'Pakai APD', tipe: 'reminder_sop', aktif: true, target_audiens: 'semua', prioritas: 0, pertanyaan_kuis: 'Kapan?', opsi_kuis: ['Sebelum kerja', 'Sesudah', 'Kadang'], jawaban_benar_idx: 0, ...o });
const f6 = (o: any = {}) => ({ id: 1, display_mode: 'popup', trigger_moments: ['clock_in'], popup_behavior: { max_show_per_day: 2 }, kuis_reviewed: true, microquiz_aktif: true, penjelasan_kuis: 'Selalu sebelum.', sop_document_id: 9, ...o });
const karyawan = { id: 77, divisi: 'Produksi', posisi: 'Mandor' };

function setup(o: { rows?: any[]; items?: any[]; f6rows?: any[]; f6fail?: boolean; ack?: any[]; ackToday?: number } = {}) {
	const { rows = setRows, items = [base()], f6rows = [f6()], f6fail = false, ack = [], ackToday = 0 } = o;
	calls.length = 0;
	responder = (path) => {
		if (path.includes('/items/app_settings')) return { data: rows };
		if (path.includes('/items/culture_propaganda_ack') && path.includes('aggregate')) return { data: [{ count: ackToday }] };
		if (path.includes('/items/culture_propaganda_ack')) return { data: ack };
		if (path.includes('/items/culture_propaganda?') && path.includes('trigger_moments')) {
			if (f6fail) throw new Error('403 FORBIDDEN');
			return { data: f6rows };
		}
		if (path.includes('/items/culture_propaganda?')) return { data: items };
		return { data: [] };
	};
}
beforeEach(() => vi.clearAllMocks());

describe('getPopupPayload (lapangan)', () => {
	it('mati bila popup_enabled false; skema Fase 6 belum ada → kosong tanpa melempar', async () => {
		setup({ rows: [] });
		let m = await fresh();
		expect((await m.getPopupPayload(karyawan)).enabled).toBe(false);
		setup({ f6fail: true });
		m = await fresh();
		const p = await m.getPopupPayload(karyawan);
		expect(p.items).toEqual([]);
		expect(p.enabled).toBe(false);
	});
	it('soal tanpa kunci/penjelasan; audiens admin disaring; konten berbatas pola kerja memakai resolver', async () => {
		setup({
			items: [base({ id: 1 }), base({ id: 2, target_audiens: 'admin' }), base({ id: 3 }), base({ id: 4 })],
			f6rows: [f6({ id: 1 }), f6({ id: 2 }), f6({ id: 3, target_pola_kerja: ['project'] }), f6({ id: 4, target_pola_kerja: ['office'] })]
		});
		const m = await fresh();
		const p = await m.getPopupPayload(karyawan);
		expect(p.items.map((i) => i.id).sort()).toEqual([1, 3]);
		expect(p.items[0].microquiz).toMatchObject({ pertanyaan: 'Kapan?' });
		expect(JSON.stringify(p)).not.toMatch(/jawaban_benar|Selalu sebelum|pertanyaan_kuis/);
	});
	it('kuota harian habis → tanpa microquiz', async () => {
		setup({ ack: [{ id: 5, propaganda_id: 1, status_aksi: 'kuis_salah', tanggal: TODAY }] });
		const m = await fresh();
		expect((await m.getPopupPayload(karyawan)).items[0].microquiz).toBeNull();
	});
});

describe('submitMicroquizAnswer & submitPopupAck (lapangan)', () => {
	it('salah → ulang → final dengan kunci & tulis ack', async () => {
		setup();
		const m = await fresh();
		const r1 = await m.submitMicroquizAnswer(karyawan, { propagandaId: 1, jawabanIdx: 2, momen: 'break_in' });
		expect(r1).toMatchObject({ benar: false, boleh_ulang: true, kunci_idx: null });
		expect(calls.some((c) => c.opts?.method)).toBe(false);
		const r2 = await m.submitMicroquizAnswer(karyawan, { propagandaId: 1, jawabanIdx: 1, momen: 'break_in' });
		expect(r2).toMatchObject({ status_aksi: 'kuis_salah', kunci_idx: 0, penjelasan: 'Selalu sebelum.' });
		expect(JSON.parse(calls.find((c) => c.opts?.method === 'POST')!.opts.body)).toMatchObject({ karyawan_id: 77, momen: 'break_in', percobaan: 2 });
	});
	it('anti-replay, kuota 409, tidak valid 400', async () => {
		setup({ ack: [{ id: 42, propaganda_id: 1, status_aksi: 'kuis_benar', tanggal: TODAY }] });
		let m = await fresh();
		expect(await m.submitMicroquizAnswer(karyawan, { propagandaId: 1, jawabanIdx: 2 })).toMatchObject({ sudah_dijawab: true, benar: true });
		setup({ ackToday: 1 });
		m = await fresh();
		await expect(m.submitMicroquizAnswer(karyawan, { propagandaId: 1, jawabanIdx: 0 })).rejects.toMatchObject({ status: 409 });
		setup();
		m = await fresh();
		await expect(m.submitMicroquizAnswer(karyawan, { propagandaId: 1, jawabanIdx: 9 })).rejects.toMatchObject({ status: 400 });
	});
	it('Paham: tanpa kuis → paham_komitmen; berkuis → tidak ditulis', async () => {
		setup({ items: [base({ id: 2, pertanyaan_kuis: null, opsi_kuis: null }), base({ id: 1 })], f6rows: [f6({ id: 2 }), f6({ id: 1 })] });
		const m = await fresh();
		expect(await m.submitPopupAck(karyawan, { propagandaId: 2, momen: 'clock_out' })).toMatchObject({ status: 'paham_komitmen', selesai: true });
		calls.length = 0;
		expect(await m.submitPopupAck(karyawan, { propagandaId: 1 })).toMatchObject({ status: null });
		expect(calls.some((c) => c.opts?.method)).toBe(false);
	});
});
