// @vitest-environment jsdom
// Chip radar: berdiri sendiri (tombol type=button), validasi catatan, kirim terpisah, kegagalan tidak melempar ke form induk.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

const m = vi.hoisted(() => ({ kirim: vi.fn(async (_p: any) => {}) }));
vi.mock('$lib/services/strategyRadar', async () => {
	const actual = await vi.importActual<any>('$lib/services/strategyRadar');
	return { ...actual, kirimSinyalRadar: (p: any) => m.kirim(p) };
});
vi.mock('$lib/firebase', () => ({ auth: { currentUser: { displayName: 'Andi', email: 'a@b.c', uid: 'u1' } } }));
vi.mock('$lib/services/directus', () => ({ default: { request: vi.fn() }, handleDirectusError: vi.fn() }));
vi.mock('$lib/services/secureDirectus', () => ({ getIdToken: vi.fn(async () => 't') }));

import RadarChip from './RadarChip.svelte';
import { validateRadar, RADAR_PILARS } from '$lib/services/strategyRadar';

let cmp: any, host: HTMLElement;
afterEach(() => {
	if (cmp) unmount(cmp);
	cmp = null;
	host?.remove();
	m.kirim.mockReset();
	m.kirim.mockImplementation(async () => {});
});
const settle = async () => {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve();
		await tick();
		flushSync();
	}
};
const render = async (props: any) => {
	host = document.createElement('div');
	document.body.appendChild(host);
	cmp = mount(RadarChip, { target: host, props });
	await settle();
	return host;
};
const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

describe('validateRadar', () => {
	it('kategori valid + catatan 8–500 karakter', () => {
		expect(validateRadar({ pilar: 'economic', catatan: 'Kompetitor X tawar 10% lebih murah' })).toBeNull();
		expect(validateRadar({ pilar: 'x', catatan: 'cukup panjang sekali' })).toMatch(/kategori/);
		expect(validateRadar({ pilar: 'legal', catatan: 'pendek' })).toMatch(/minimal/);
		expect(validateRadar({ pilar: 'legal', catatan: 'x'.repeat(501) })).toMatch(/maksimal/);
		expect(RADAR_PILARS).toHaveLength(6);
	});
});

describe('RadarChip', () => {
	it('tertutup bawaan; semua tombol type=button (tidak men-submit form induk)', async () => {
		const el = await render({ sourceForm: 'komplain_customer' });
		expect(el.textContent).toContain('Catat sinyal');
		expect(el.querySelector('textarea')).toBeNull();
		(el.querySelector('button[aria-expanded]') as HTMLButtonElement).click();
		await settle();
		expect(el.querySelector('textarea')).toBeTruthy();
		for (const b of el.querySelectorAll('button')) expect(b.getAttribute('type')).toBe('button');
	});

	it('tombol kirim nonaktif sampai kategori & catatan valid; kirim membawa konteks sumber', async () => {
		const el = await render({ sourceForm: 'laporan_harian', projectId: 12 });
		(el.querySelector('button[aria-expanded]') as HTMLButtonElement).click();
		await settle();
		expect(btn(el, 'Kirim sinyal')!.disabled).toBe(true);
		btn(el, 'Harga / kompetitor')!.click();
		const ta = el.querySelector('textarea') as HTMLTextAreaElement;
		ta.value = 'Kompetitor X tawar epoxy 10% lebih murah';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(btn(el, 'Kirim sinyal')!.disabled).toBe(false);
		btn(el, 'Kirim sinyal')!.click();
		await settle();
		expect(m.kirim).toHaveBeenCalledWith(expect.objectContaining({ pilar: 'economic', sourceForm: 'laporan_harian', projectId: 12 }));
		expect(el.textContent).toContain('1 sinyal terkirim');
	});

	it('gagal kirim → pesan di chip, tidak melempar', async () => {
		m.kirim.mockRejectedValueOnce(new Error('Sinyal belum terkirim. Periksa koneksi.'));
		const el = await render({ sourceForm: 'kunjungan_sales', sourceRef: 5 });
		(el.querySelector('button[aria-expanded]') as HTMLButtonElement).click();
		await settle();
		btn(el, 'Aturan / izin')!.click();
		const ta = el.querySelector('textarea') as HTMLTextAreaElement;
		ta.value = 'Syarat dokumen K3 baru di site ini';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		btn(el, 'Kirim sinyal')!.click();
		await settle();
		expect(el.textContent).toContain('Sinyal belum terkirim');
	});
});
