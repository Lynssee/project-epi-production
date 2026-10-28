// @vitest-environment jsdom
// Penjelasan "Belum tercatat" & "Saldo minus" tidak boleh hanya di atribut title (tak terbaca di layar sentuh) — harus lewat <Tooltip> yang bisa diketuk.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
const { default: KioskCekStok } = await import('./KioskCekStok.svelte');

let box: HTMLElement | null, inst: any;
const ITEMS = [
	{ id: 1, namaBarang: 'Cat Epoxy', kode: 'CE-1', satuan: 'kg', stokTersedia: 12, stokMin: 5 },
	{ id: 2, namaBarang: 'Thinner', kode: 'TH-1', satuan: 'ltr', stokTersedia: null, stokMin: 0 },
	{ id: 3, namaBarang: 'Amplas', kode: 'AM-1', satuan: 'lbr', stokTersedia: -4, stokMin: 0 }
];
async function render() {
	window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q })) as any; // sentuh: (hover: hover) tidak cocok
	vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: ITEMS }) })));
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(KioskCekStok, { target: box, props: { workshop: 'ciketing' } });
	flushSync();
	for (let i = 0; i < 15; i++) await Promise.resolve();
	await new Promise((r) => setTimeout(r, 20));
	flushSync();
}
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; vi.unstubAllGlobals(); document.body.innerHTML = ''; });

const rowOf = (txt: string) => [...box!.querySelectorAll('.item-row')].find((r) => r.textContent!.includes(txt)) as HTMLElement;

describe('KioskCekStok — penjelasan stok bisa diketuk', () => {
	it('tidak ada lagi title native pada status stok', async () => {
		await render();
		expect(box!.querySelectorAll('.item-stok[title]').length).toBe(0);
	});

	it('ketuk "Belum tercatat" menampilkan penjelasan stok awal; ketuk di luar menutup', async () => {
		await render();
		const trg = rowOf('Thinner').querySelector('[role="button"]') as HTMLElement;
		expect(trg).toBeTruthy();
		trg.click();
		flushSync();
		expect(rowOf('Thinner').textContent).toContain('stok awal');
		document.body.click();
		flushSync();
		expect(rowOf('Thinner').textContent).not.toContain('stok awal');
	});

	it('ketuk saldo minus menampilkan anjuran lapor ke admin', async () => {
		await render();
		(rowOf('Amplas').querySelector('[role="button"]') as HTMLElement).click();
		flushSync();
		expect(rowOf('Amplas').textContent).toContain('Laporkan ke admin');
	});

	it('stok normal tidak dibungkus tooltip', async () => {
		await render();
		expect(rowOf('Cat Epoxy').querySelector('[role="button"]')).toBeNull();
	});
});
