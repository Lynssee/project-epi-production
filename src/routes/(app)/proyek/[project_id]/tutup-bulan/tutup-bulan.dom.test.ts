// @vitest-environment jsdom
// /proyek/[project_id]/tutup-bulan — Jalankan: npx vitest run --config vitest.dom.config.ts "src/routes/(app)/proyek/[project_id]/tutup-bulan"
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { readable } from 'svelte/store';

vi.mock('$app/stores', () => ({ page: readable({ params: { project_id: '7' } }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/services/secureDirectus', () => ({ getIdToken: vi.fn(async () => 'tok') }));
vi.mock('$lib/actions/secureAsset', () => ({ secureAssetSrc: () => ({ destroy() {} }) }));

const { default: Page } = await import('./+page.svelte');

const getPayload = (over: any = {}) => ({
	success: true, project: { id: 7, name: 'Gudang X' }, period: '2026-10', schemaReady: true, narasi: null,
	checklist: { hariKalender: 31, hariTarget: 31, hariBerlapor: 29, hariKosong: ['2026-10-04', '2026-10-05'], laporanDihitung: 29, laporanDraf: 1, laporanDitolak: 0, bulanBerjalan: false, kepatuhanPct: 94 },
	warnings: ['2 hari belum ada laporan harian.', 'Kendala utama belum diisi.'],
	photoCandidates: [{ id: 'foto-aaaaaa', category: 'progress', label: 'P', date: '2026-10-01' }, { id: 'foto-bbbbbb', category: 'area', label: 'A', date: '2026-10-02' }],
	...over
});

let container: HTMLElement; let instance: any;
const fetchMock = vi.fn();
async function settle() { for (let i = 0; i < 10; i++) { await Promise.resolve(); await new Promise((r) => setTimeout(r, 5)); flushSync(); } }
const text = () => container.textContent!.replace(/\s+/g, ' ');
async function render() {
	container = document.createElement('div'); document.body.appendChild(container);
	instance = mount(Page, { target: container });
	await settle();
}
const respond = (body: any, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockImplementation(async (url: string, opts?: any) => (opts?.method === 'POST'
		? respond({ success: true, narasi: { status: JSON.parse(opts.body).action === 'close' ? 'closed' : 'draft', closed_by_name: 'Budi PL', closed_at: '2026-11-01T00:00:00Z' } })
		: respond(getPayload())));
});
afterEach(() => { if (instance) unmount(instance); container?.remove(); instance = null; vi.unstubAllGlobals(); });

describe('Tutup Bulan', () => {
	it('menampilkan checklist (hari kosong, draf) dan kandidat foto', async () => {
		await render();
		expect(text()).toContain('29 dari 31 hari ada laporan');
		expect(text()).toContain('kepatuhan 94%');
		expect(text()).toContain('1 laporan masih draf');
		expect(container.querySelectorAll('[data-testid="tb-photos"] button').length).toBe(2);
		expect(container.querySelector('[data-testid="tb-schema-warning"]')).toBeNull();
	});

	it('Tutup Bulan dengan peringatan: klik pertama minta konfirmasi (tidak mengirim), klik kedua mengirim close + foto pilihan', async () => {
		await render();
		(container.querySelectorAll('[data-testid="tb-photos"] button')[1] as HTMLButtonElement).click();
		flushSync();
		(container.querySelector('[data-testid="tb-close"]') as HTMLButtonElement).click();
		await settle();
		expect(container.querySelector('[data-testid="tb-confirm"]')).toBeTruthy();
		expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0);
		(container.querySelector('[data-testid="tb-close"]') as HTMLButtonElement).click();
		await settle();
		const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
		expect(JSON.parse(post[1].body)).toMatchObject({ projectId: 7, period: expect.any(String), action: 'close', photo_ids: ['foto-bbbbbb'] });
		expect(container.querySelector('[data-testid="tb-notice"]')!.textContent).toContain('Bulan ditutup');
	});

	it('tanpa peringatan: langsung menutup tanpa konfirmasi', async () => {
		fetchMock.mockImplementation(async (url: string, opts?: any) => (opts?.method === 'POST' ? respond({ success: true, narasi: { status: 'closed' } }) : respond(getPayload({ warnings: [] }))));
		await render();
		(container.querySelector('[data-testid="tb-close"]') as HTMLButtonElement).click();
		await settle();
		expect(container.querySelector('[data-testid="tb-confirm"]')).toBeNull();
		expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true);
	});

	it('bulan sudah ditutup: banner + tombol Buka Kembali; skema belum aktif: peringatan tampil, halaman tidak crash', async () => {
		fetchMock.mockImplementation(async () => respond(getPayload({ schemaReady: false, narasi: { status: 'closed', closed_by_name: 'Budi PL', kendala_utama: 'Hujan', photo_ids: [] } })));
		await render();
		expect(container.querySelector('[data-testid="tb-closed"]')!.textContent).toContain('Budi PL');
		expect(container.querySelector('[data-testid="tb-schema-warning"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="tb-close"]')).toBeNull();
		expect((container.querySelector('#tb-kendala') as HTMLTextAreaElement).value).toBe('Hujan');
	});

	it('gagal memuat → pesan galat + Coba lagi (bukan layar kosong); gagal simpan menampilkan pesan server', async () => {
		fetchMock.mockImplementationOnce(async () => respond({ message: 'Data laporan harian gagal dibaca' }, false));
		await render();
		expect(text()).toContain('Data laporan harian gagal dibaca');
		unmount(instance); container.remove();
		fetchMock.mockImplementation(async (url: string, opts?: any) => (opts?.method === 'POST' ? respond({ message: 'Fitur Tutup Bulan belum aktif' }, false) : respond(getPayload({ warnings: [] }))));
		await render();
		(container.querySelector('[data-testid="tb-close"]') as HTMLButtonElement).click();
		await settle();
		expect(container.querySelector('[data-testid="tb-notice"]')!.textContent).toContain('belum aktif');
	});
});
