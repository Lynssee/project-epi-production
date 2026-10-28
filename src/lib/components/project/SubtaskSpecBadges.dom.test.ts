// @vitest-environment jsdom
// Badge spek/kebutuhan subtask: isinya hanya ada di tooltip → harus bisa diketuk (bukan title native).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SubtaskSpecBadges from './SubtaskSpecBadges.svelte';

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

const SUB = {
	spec: { tebal: [2, 3], warna: 'abu' },
	bom: [{}, {}],
	equipment: [{}],
	manpower: [{ role: 'Tukang cat', qty: 3 }],
	mob_stage: 'material',
	executor_type: 'external_prereq',
	external_party: 'PLN'
};
function render(sub: any = SUB) {
	window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q })) as any;
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(SubtaskSpecBadges, { target: box, props: { sub, mobStageLabel: 'Material' } });
	flushSync();
}
const triggers = () => [...box!.querySelectorAll('[role="button"]')] as HTMLElement[];

describe('SubtaskSpecBadges — penjelasan badge bisa diketuk', () => {
	it('tidak ada title native; tiap badge membuka penjelasannya saat diketuk', () => {
		render();
		expect(box!.querySelectorAll('.tl-spec-badge[title]').length).toBe(0);
		expect(triggers().length).toBe(6); // spek, bom, equipment, manpower, mobilisasi, prasyarat eksternal
	});

	it('badge Spek menampilkan ringkasan spesifikasi; badge prasyarat menampilkan pihak ketiga', () => {
		render();
		const byText = (t: string) => triggers().find((x) => x.textContent!.includes(t))!;
		byText('Spek').click();
		flushSync();
		expect(box!.textContent).toContain('tebal: 2–3');
		byText('PLN').click(); // klik badge lain: balon pertama tetap (tiap instance mandiri), balon kedua muncul
		flushSync();
		expect(box!.textContent).toContain('Prasyarat pihak ketiga: PLN');
	});

	it('tanpa data tidak merender apa pun', () => {
		render({});
		expect(box!.querySelectorAll('.tl-spec-badge').length).toBe(0);
	});
});
