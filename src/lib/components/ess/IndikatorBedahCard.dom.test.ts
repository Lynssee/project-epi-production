// @vitest-environment jsdom
// "Bedah Nilai Saya": daftar indikator → ketuk → sheet (atribusi, narasi, log audit, tip) → sanggahan bertaut dokumen terpilih.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Card from './IndikatorBedahCard.svelte';

const IND = [
	{
		nama: 'Ketepatan Waktu Posting Jurnal', pilar: 'administrasi', bobot: 20, target: 90, nilai: 76.49, unit: '%', skor: 85, arah: 'tinggi', terukur: true, otomatis: true,
		catatan: 'SELURUH departemen: 501/655 jurnal diposting dalam ≤3 hari', atribusi: 'departemen',
		outliers: [{ ref: 'JE-1', detail: 'Transaksi 2026-07-01 → diposting 2026-07-20', nilai: 19, satuan: 'hari' }, { ref: 'JE-2', detail: 'x', nilai: 9, satuan: 'hari' }],
		outliers_total: 154, tip: 'Skor ini capaian kolektif departemen'
	},
	{ nama: 'Kehadiran', pilar: 'general', bobot: 20, target: 95, nilai: 100, unit: '%', skor: 100, arah: 'tinggi', terukur: true, otomatis: true, catatan: 'ok', atribusi: null, outliers: [], outliers_total: null, tip: null }
];

let box: HTMLElement | null, inst: any;
function render(props: Record<string, unknown>) { box = document.createElement('div'); document.body.appendChild(box); inst = mount(Card, { target: box, props }); flushSync(); }
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('IndikatorBedahCard', () => {
	it('tidak tampil bila tidak ada indikator', () => {
		render({ indikator: [] });
		expect(document.querySelector('[data-testid="indikator-bedah"]')).toBeNull();
	});

	it('ketuk indikator → sheet menampilkan atribusi tim, narasi, log audit & tip', () => {
		render({ indikator: IND });
		expect(document.querySelectorAll('[data-testid="indikator-bedah"] button')).toHaveLength(2);
		(document.querySelectorAll('[data-testid="indikator-bedah"] button')[0] as HTMLButtonElement).click();
		flushSync();
		const sheet = document.querySelector('[data-testid="bedah-sheet"]')!;
		expect(sheet.querySelector('[data-testid="bedah-atribusi"]')!.textContent).toContain('kolektif departemen');
		expect(sheet.querySelector('[data-testid="bedah-catatan"]')!.textContent).toContain('501/655');
		expect(sheet.querySelector('[data-testid="bedah-outliers"]')!.textContent).toContain('2 dari 154');
		expect(sheet.querySelector('[data-testid="bedah-tip"]')!.textContent).toContain('kolektif');
	});

	it('sanggahan membawa draf berisi indikator + dokumen yang dicentang', () => {
		const onSanggah = vi.fn();
		render({ indikator: IND, bolehSanggah: true, onSanggah });
		(document.querySelectorAll('[data-testid="indikator-bedah"] button')[0] as HTMLButtonElement).click();
		flushSync();
		const cb = document.querySelector('[data-testid="bedah-sheet"] input[type="checkbox"]') as HTMLInputElement;
		cb.click();
		flushSync();
		const ajukan = [...document.querySelectorAll('[data-testid="bedah-sheet"] button')].find((b) => /Ajukan keberatan/.test(b.textContent || '')) as HTMLButtonElement;
		expect(ajukan.textContent).toContain('1 dokumen');
		ajukan.click();
		flushSync();
		expect(onSanggah).toHaveBeenCalledWith('[Indikator: Ketepatan Waktu Posting Jurnal] Dokumen yang dipermasalahkan: JE-1. Alasan: ');
		expect(document.querySelector('[data-testid="bedah-sheet"]')).toBeNull();
	});

	it('bolehSanggah=false menyembunyikan checkbox & tombol keberatan', () => {
		render({ indikator: IND, bolehSanggah: false });
		(document.querySelectorAll('[data-testid="indikator-bedah"] button')[0] as HTMLButtonElement).click();
		flushSync();
		expect(document.querySelector('[data-testid="bedah-sheet"] input[type="checkbox"]')).toBeNull();
		expect(document.querySelector('[data-testid="bedah-sheet"]')!.textContent).not.toContain('Ajukan keberatan');
	});
});
