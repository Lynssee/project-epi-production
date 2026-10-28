// @vitest-environment jsdom
// Panduan alur mobile: akordeon per lane, kartu langkah, deep-link ?fokus=, navigasi "Lanjut ke".
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ProcessGuidanceMobile from './ProcessGuidanceMobile.svelte';
import { PROCESS_FLOWS } from '$lib/data/processGuidance';

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

function render(props: any) {
	Element.prototype.scrollIntoView = () => {};
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(ProcessGuidanceMobile, { target: box, props });
	flushSync();
}
const flow = PROCESS_FLOWS[0];

describe('ProcessGuidanceMobile', () => {
	it('menampilkan 4 bagian lane; hanya lane pertama terbuka secara default', () => {
		render({ flow });
		expect(box!.querySelectorAll('section')).toHaveLength(4);
		expect(box!.querySelector('#pg-node-survey')).not.toBeNull();
		expect(box!.querySelector('#pg-node-cek_produk')).toBeNull();
	});

	it('mengetuk lane membuka daftar langkahnya', () => {
		render({ flow });
		const btn = [...box!.querySelectorAll('section > button')].find((b) => b.textContent?.includes('INVENTORY')) as HTMLElement;
		btn.click();
		flushSync();
		expect(box!.querySelector('#pg-node-cek_produk')).not.toBeNull();
	});

	it('mengetuk langkah membuka PIC, checklist, penyebab tertahan, "Lanjut ke", dan pintasan', () => {
		render({ flow });
		(box!.querySelector('#pg-node-penawaran > button') as HTMLElement).click();
		flushSync();
		const t = box!.querySelector('#pg-node-penawaran')!.textContent!;
		expect(t).toContain('Penanggung jawab');
		expect(t).toContain('Yang perlu dipenuhi');
		expect(t).toContain('Sering membuat tertahan');
		expect(t).toContain('ditolak');
		expect(t).toContain('diterima');
		expect(box!.querySelector('#pg-node-penawaran a[href="/sales/penawaran"]')).not.toBeNull();
	});

	it('deep-link fokus=cek_produk membuka lane Inventory & langkah itu langsung', async () => {
		render({ flow, fokus: 'cek_produk' });
		await Promise.resolve();
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		const li = box!.querySelector('#pg-node-cek_produk');
		expect(li).not.toBeNull();
		expect(li!.textContent).toContain('Admin Gudang');
	});

	it('"Lanjut ke" memindahkan fokus ke langkah tujuan (termasuk lane lain)', async () => {
		render({ flow, fokus: 'so' });
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		const chip = [...box!.querySelectorAll('#pg-node-so button')].find((b) => b.textContent?.includes('PO Cat')) as HTMLElement;
		expect(chip).toBeTruthy();
		chip.click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(box!.querySelector('#pg-node-minta_produk')!.textContent).toContain('Untuk PO Cat');
	});

	it('flow null → pesan belum tersedia, tidak crash', () => {
		render({ flow: null });
		expect(box!.textContent).toContain('belum tersedia');
	});
});
