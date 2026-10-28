// @vitest-environment jsdom
// Penjelasan "Syarat Pengajuan" harus bisa dibuka dengan ketukan (bukan hanya title native).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import GateChecklistCard from './GateChecklistCard.svelte';

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('GateChecklistCard — petunjuk bisa diketuk', () => {
	it('tidak ada title native; ketuk ⓘ menampilkan penjelasan syarat; ketuk di luar menutup', () => {
		window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q })) as any;
		box = document.createElement('div');
		document.body.appendChild(box);
		inst = mount(GateChecklistCard, { target: box, props: { gates: [{ key: 'G_BUKTI_STRUK', status: 'failed', mode: 'soft', message: 'Foto struk belum ada' }] } });
		flushSync();
		expect(box.querySelector('span[title^="Syarat ini menentukan"]')).toBeNull();
		const trg = box.querySelector('[role="button"]') as HTMLElement;
		expect(trg).toBeTruthy();
		trg.click();
		flushSync();
		expect(box.textContent).toContain('Tanda kuning berarti belum wajib');
		document.body.click();
		flushSync();
		expect(box.textContent).not.toContain('Tanda kuning berarti belum wajib');
	});
});
