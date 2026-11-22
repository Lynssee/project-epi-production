// @vitest-environment jsdom
// Pakta Pra-Kegiatan Fase 2: kartu pengunci kontekstual (hard menahan halaman, soft boleh lanjut, warn banner), kotak centang
// berwaktu, tanda tangan otomatis, dan "Ada Kendala" yang wajib kategori + alasan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';

// Barrel @tabler/icons-svelte (ribuan modul) membuat jsdom menggantung — ikon tidak relevan utk perilaku.
vi.mock('@tabler/icons-svelte', () => ({ IconShieldCheck: () => {}, IconLock: () => {}, IconExternalLink: () => {}, IconAlertTriangle: () => {}, IconCircleCheck: () => {} }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://project.test/stock-lapangan/opname') } }));

const getStatus = vi.fn();
const setuju = vi.fn();
const kendala = vi.fn();
vi.mock('$lib/services/ess/pakta', () => ({
	PAKTA_REFRESH_EVENT: 'pakta:refresh',
	getPaktaStatus: (...a: any[]) => getStatus(...a),
	setujuiPakta: (...a: any[]) => setuju(...a),
	ajukanKendalaPakta: (...a: any[]) => kendala(...a),
	requestPaktaRefresh: vi.fn()
}));

const { authStore } = await import('$lib/stores/auth');
const { default: PaktaGuard } = await import('./PaktaGuard.svelte');

const ITEM = { type: 'sop', id: 10, flow_key: null, sop_id: 10, title: 'SOP Stock Opname Site', sop_code: 'SOP-PRJ-320', version: 2, sosialisasi_end_date: null, ringkasan: 'Wajib foto rak sebelum simpan angka.', baca_url: '/ess/pelatihan/sop/10' };
const status = (over: any = {}) => ({
	enabled: true, label: 'Stock Opname', gate_nama: 'Foto rak wajib', gate_hint: 'Baca lalu setujui.',
	settings: { min_read_seconds: 0, require_scroll: false },
	decision: { show: true, presentation: 'modal', blocked: true, canProceedWithNote: false },
	items: [ITEM], ...over
});

let box: HTMLElement | null, inst: any;
async function render() {
	box = document.createElement('div');
	document.body.appendChild(box);
	const children = createRawSnippet(() => ({ render: () => '<div data-testid="halaman">isi halaman opname</div>' }));
	inst = mount(PaktaGuard, { target: box, props: { children } });
	authStore.update((a) => ({ ...a, checked: true, karyawanId: 42, karyawanName: 'Budi Mekanik' }));
	flushSync();
	for (let i = 0; i < 12; i++) await Promise.resolve();
	flushSync();
	return box;
}
const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };
const btn = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) ?? null;

beforeEach(() => { getStatus.mockReset(); setuju.mockReset(); kendala.mockReset(); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; authStore.update((a) => ({ ...a, checked: false, karyawanId: null })); });

describe('PaktaGuard', () => {
	it('tanpa pakta (decision.show=false) → halaman langsung tampil, tidak ada kartu', async () => {
		getStatus.mockResolvedValue(status({ decision: { show: false, presentation: 'none', blocked: false, canProceedWithNote: false }, items: [] }));
		const el = await render();
		expect(el.querySelector('[data-testid="halaman"]')).toBeTruthy();
		expect(el.querySelector('[data-testid="pakta-kartu"]')).toBeNull();
	});

	it('gagal memuat status → fail-open: halaman tetap terbuka', async () => {
		getStatus.mockRejectedValue(new Error('down'));
		const el = await render();
		expect(el.querySelector('[data-testid="halaman"]')).toBeTruthy();
		expect(el.querySelector('[data-testid="pakta-kartu"]')).toBeNull();
	});

	it('hard: kartu menahan halaman (halaman TIDAK dirender), ada ringkasan + tautan baca + jalan darurat', async () => {
		getStatus.mockResolvedValue(status());
		const el = await render();
		expect(el.querySelector('[data-testid="pakta-kartu"]')).toBeTruthy();
		expect(el.querySelector('[data-testid="halaman"]')).toBeNull();
		const t = el.textContent!;
		expect(t).toContain('Sebelum mulai Stock Opname');
		expect(t).toContain('Wajib foto rak sebelum simpan angka.');
		expect(t).toContain('Absen Masuk / Pulang');
		expect(el.querySelector('a[href="/ess/pelatihan/sop/10"]')).toBeTruthy();
	});

	it('tombol Setuju mati sampai kotak dicentang; setelah setuju tampil stempel + kode tanda tangan', async () => {
		getStatus.mockResolvedValue(status());
		setuju.mockResolvedValue({ confirmed_at: '2026-11-13T05:00:00.000Z', signature: 'DeuQTJuBo2K4aSc6bJHeM6g8' });
		const el = await render();
		const setujuBtn = btn(el, 'Saya Paham & Setuju') as HTMLButtonElement;
		expect(setujuBtn.disabled).toBe(true);
		const cb = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
		cb.checked = true;
		cb.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		expect((btn(el, 'Saya Paham & Setuju') as HTMLButtonElement).disabled).toBe(false);
		click(btn(el, 'Saya Paham & Setuju'));
		for (let i = 0; i < 10; i++) await Promise.resolve();
		flushSync();
		expect(setuju).toHaveBeenCalledWith(expect.objectContaining({ type: 'sop', sop_id: 10, version: 2 }), '/stock-lapangan/opname');
		expect(el.textContent).toContain('tanda tangan otomatis tercatat');
		expect(el.textContent).toContain('Budi Mekanik');
		expect(el.textContent).toContain('DeuQTJuBo2K4aSc6bJHeM6g8');
	});

	it('item GATE: tanpa tautan baca, label perubahan aturan, setuju memakai kunci gate', async () => {
		const GATE = { type: 'gate', id: 90, gate_key: 'G_A', flow_key: null, sop_id: null, title: 'Foto rak wajib', sop_code: null, version: 90, sosialisasi_end_date: '2026-11-20', ringkasan: 'Aturan diperketat menjadi wajib dipenuhi.', baca_url: null };
		getStatus.mockResolvedValue(status({ items: [GATE] }));
		setuju.mockResolvedValue({ confirmed_at: '2026-11-18T03:00:00.000Z', signature: 'KODE' });
		const el = await render();
		expect(el.textContent).toContain('Perubahan aturan sistem');
		expect(el.textContent).toContain('berlaku sejak 2026-11-20');
		expect(el.textContent).toContain('Aturan diperketat menjadi wajib dipenuhi.');
		expect(el.textContent).not.toContain('Baca lengkap');
		const cb = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
		cb.checked = true;
		cb.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		click(btn(el, 'Saya Paham & Setuju'));
		for (let i = 0; i < 10; i++) await Promise.resolve();
		expect(setuju).toHaveBeenCalledWith(expect.objectContaining({ type: 'gate', gate_key: 'G_A' }), '/stock-lapangan/opname');
	});

	it('waktu baca minimum: kotak terkunci + teks bantu bila min_read_seconds > 0', async () => {
		getStatus.mockResolvedValue(status({ settings: { min_read_seconds: 30, require_scroll: false } }));
		const el = await render();
		expect((el.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
		expect(el.textContent).toContain('Baca dulu ringkasan');
	});

	it('Ada Kendala: wajib kategori + alasan ≥15 karakter; hard tetap terkunci setelah kirim', async () => {
		getStatus.mockResolvedValue(status());
		kendala.mockResolvedValue({ duplicate: false, message: 'Kendala dicatat. Atasan akan menindaklanjuti.' });
		const el = await render();
		click(btn(el, 'Ada Kendala'));
		click(btn(el, 'Kirim kendala'));
		expect(el.textContent).toContain('Pilih jenis kendalanya dulu');
		expect(kendala).not.toHaveBeenCalled();
		const sel = el.querySelector('select') as HTMLSelectElement;
		sel.value = 'alat_belum_tersedia';
		sel.dispatchEvent(new Event('change', { bubbles: true }));
		const ta = el.querySelector('textarea') as HTMLTextAreaElement;
		ta.value = 'singkat';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		click(btn(el, 'Kirim kendala'));
		expect(el.textContent).toContain('minimal 15 karakter');
		ta.value = 'Alat hitung belum ada di site Gresik';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		click(btn(el, 'Kirim kendala'));
		for (let i = 0; i < 10; i++) await Promise.resolve();
		flushSync();
		expect(kendala).toHaveBeenCalledWith(expect.objectContaining({ sop_id: 10 }), { kategori: 'alat_belum_tersedia', alasan: 'Alat hitung belum ada di site Gresik', route: '/stock-lapangan/opname' });
		expect(el.textContent).toContain('tetap terkunci sampai atasan memberi dispensasi');
		expect(el.querySelector('[data-testid="halaman"]')).toBeNull();
	});

	it('soft: kartu muncul tapi "Lanjut dulu" membuka halaman', async () => {
		getStatus.mockResolvedValue(status({ decision: { show: true, presentation: 'modal', blocked: false, canProceedWithNote: true } }));
		const el = await render();
		expect(el.querySelector('[data-testid="pakta-kartu"]')).toBeTruthy();
		expect(el.querySelector('[data-testid="halaman"]')).toBeTruthy(); // soft tidak menahan
		click(btn(el, 'Lanjut dulu'));
		expect(el.querySelector('[data-testid="pakta-kartu"]')).toBeNull();
	});

	it('warn: hanya banner (halaman tetap tampil); "Tinjau" membuka kartu', async () => {
		getStatus.mockResolvedValue(status({ decision: { show: true, presentation: 'banner', blocked: false, canProceedWithNote: false } }));
		const el = await render();
		expect(el.textContent).toContain('aturan/SOP baru untuk Stock Opname');
		expect(el.querySelector('[data-testid="pakta-kartu"]')).toBeNull();
		click(btn(el, 'Tinjau'));
		expect(el.querySelector('[data-testid="pakta-kartu"]')).toBeTruthy();
	});
});
