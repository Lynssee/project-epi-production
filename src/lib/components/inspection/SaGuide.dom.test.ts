// @vitest-environment jsdom
// Panduan Sa di form inspeksi: tertutup default, terbuka lewat tombol, menyorot Sa target proyek.
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SaGuide from './SaGuide.svelte';
import { findSaGrade, SA_GRADES } from '$lib/data/saGuide';

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

function render(target: string | null = null) {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(SaGuide, { target: box, props: { target } });
	flushSync();
}

describe('SaGuide', () => {
	it('tertutup default; tombol membuka & menutup panel', () => {
		render();
		expect(box!.querySelector('[data-testid="sa-guide"]')).toBeNull();
		const btn = box!.querySelector('button')!;
		expect(btn.getAttribute('aria-expanded')).toBe('false');
		btn.click(); flushSync();
		expect(box!.querySelector('[data-testid="sa-guide"]')).toBeTruthy();
		expect(box!.textContent).toContain('SSPC-SP 10');
		btn.click(); flushSync();
		expect(box!.querySelector('[data-testid="sa-guide"]')).toBeNull();
	});
	it('menyorot Sa target proyek di tombol & panel', () => {
		render('sa 2.5');
		expect(box!.querySelector('button')!.textContent).toContain('spek proyek: Sa 2.5');
		box!.querySelector('button')!.click(); flushSync();
		expect(box!.textContent).toContain('TARGET PROYEK');
		expect(box!.textContent!.match(/TARGET PROYEK/g)).toHaveLength(1);
	});
	it('target tak dikenal tidak menyorot apa pun', () => {
		render('Sa 9');
		box!.querySelector('button')!.click(); flushSync();
		expect(box!.textContent).not.toContain('TARGET PROYEK');
	});
});

describe('data saGuide', () => {
	it('empat grade, findSaGrade toleran huruf/spasi, null-safe', () => {
		expect(SA_GRADES.map((g) => g.grade)).toEqual(['Sa 1', 'Sa 2', 'Sa 2.5', 'Sa 3']);
		expect(findSaGrade(' SA   2.5 ')?.sspc).toContain('SP 10');
		expect(findSaGrade(null)).toBeNull();
		expect(findSaGrade('Sa 4')).toBeNull();
	});
});
