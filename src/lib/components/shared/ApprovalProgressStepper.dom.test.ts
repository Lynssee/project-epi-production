// @vitest-environment jsdom
// Nama approver yang terpotong (truncate) dulu hanya terbaca lewat title native; kini bisa diketuk (Tooltip) di layar sentuh.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ApprovalProgressStepper from './ApprovalProgressStepper.svelte';

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

const NAMA = 'Muhammad Abdurrahman Al-Faruq Pratama Wijayakusuma';
describe('ApprovalProgressStepper — nama approver bisa diketuk', () => {
	it('tidak ada title native; ketuk nama menampilkan nama lengkap', () => {
		window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q })) as any;
		box = document.createElement('div');
		document.body.appendChild(box);
		const timeline = { steps: [{ step_order: 1, label: 'Atasan', department_key: 'project', status: 'disetujui', actor_name: NAMA, date: '2026-10-01T02:00:00Z' }] };
		inst = mount(ApprovalProgressStepper, { target: box, props: { timeline } });
		flushSync();
		expect(box.querySelector('.truncate[title]')).toBeNull();
		const trg = box.querySelector('[role="button"]') as HTMLElement;
		expect(trg).toBeTruthy();
		expect(box.querySelectorAll('.pointer-events-none').length).toBe(0);
		trg.click();
		flushSync();
		expect(box.querySelector('.pointer-events-none')?.textContent).toContain(NAMA);
	});
});
