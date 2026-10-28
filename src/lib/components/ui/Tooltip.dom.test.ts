// @vitest-environment jsdom
// Tooltip harus bisa dibuka dengan KETUKAN di layar sentuh (mouseenter hasil emulasi tap diabaikan; toggle klik yang membuka) dan ditutup
// dengan ketukan di luar. Ini kontrak yang dipakai semua titik "title native → <Tooltip>" (audit sentuh 20 Okt 2026).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TooltipHost from './__TooltipHost.svelte';

let box: HTMLElement | null, inst: any;
function render(touch: boolean, props: Record<string, unknown> = {}) {
	window.matchMedia = vi.fn((q: string) => ({ matches: !touch && q.includes('hover: hover'), media: q })) as any;
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(TooltipHost, { target: box, props });
	flushSync();
}
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

const trigger = () => box!.querySelector('[role="button"]') as HTMLElement;
const balloon = () => box!.querySelector('.pointer-events-none');

describe('Tooltip — jalur ketuk (sentuh)', () => {
	it('sentuh: mouseenter hasil emulasi tap tidak membuka; klik (tap) membuka, tap di luar menutup', () => {
		render(true, { text: 'Saldo minus — laporkan ke admin.' });
		trigger().dispatchEvent(new MouseEvent('mouseenter'));
		flushSync();
		expect(balloon()).toBeNull();
		trigger().click();
		flushSync();
		expect(balloon()?.textContent).toContain('Saldo minus');
		document.body.click();
		flushSync();
		expect(balloon()).toBeNull();
	});

	it('bermouse: hover membuka & keluar menutup', () => {
		render(false, { text: 'Info hover' });
		trigger().dispatchEvent(new MouseEvent('mouseenter'));
		flushSync();
		expect(balloon()?.textContent).toContain('Info hover');
		trigger().dispatchEvent(new MouseEvent('mouseleave'));
		flushSync();
		expect(balloon()).toBeNull();
	});

	it('ketukan pada pemicu tidak menembus ke baris/anchor induk (stopPropagation)', () => {
		render(true, { text: 'x', parentClick: true });
		const parentClick = (box as any).__parentClicks ?? 0;
		trigger().click();
		flushSync();
		expect((window as any).__parentClicked ?? 0).toBe(parentClick);
	});

	it('akar <span> (valid di dalam <p>) dan balon tidak menutup <p> saat muncul', () => {
		render(true, { text: 'Info', inP: true });
		const trg = trigger();
		expect(trg.tagName).toBe('SPAN');
		expect(trg.parentElement!.tagName).toBe('P');
		trg.click();
		flushSync();
		expect(trg.parentElement!.tagName).toBe('P');
		expect(balloon()?.tagName).toBe('SPAN');
	});

	it('class absolute menghilangkan relative; style diteruskan ke pembungkus', () => {
		render(true, { text: 'Rentang', cls: 'absolute top-0 bottom-0', style: 'left: 10%; width: 30%' });
		const trg = trigger();
		expect(trg.className).toContain('absolute');
		expect(trg.className.split(/\s+/)).not.toContain('relative');
		expect(trg.getAttribute('style')).toContain('left: 10%');
		render(true, { text: 'Biasa' });
		expect(trigger().className).toMatch(/relative/);
	});

	it('listener dokumen dipakai bersama: 30 instance hanya memasang 1 pasang listener & tap di luar menutup yang terbuka', () => {
		const add = vi.spyOn(document, 'addEventListener');
		render(true, { text: 'T', count: 30 });
		const pasang = add.mock.calls.filter(([t]) => t === 'click' || t === 'touchstart').length;
		expect(pasang).toBeLessThanOrEqual(2);
		const trg = box!.querySelectorAll('[role="button"]')[7] as HTMLElement;
		trg.click();
		flushSync();
		expect(box!.querySelectorAll('.pointer-events-none').length).toBe(1);
		document.body.click();
		flushSync();
		expect(box!.querySelectorAll('.pointer-events-none').length).toBe(0);
		add.mockRestore();
	});
});
