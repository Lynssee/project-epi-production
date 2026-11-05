// @vitest-environment jsdom
// Mini-matriks tim proyek: sel skor per periode, banner pekerja belum dinilai + tautan ke penilaian, ganti cadence.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/services/ess/kinerjaTren', () => ({ toneClass: (s: number | null) => (s == null ? 'tone-none' : s >= 85 ? 'tone-ok' : 'tone-warn') }));
const { default: Matrix } = await import('./TimMiniMatrix.svelte');

const TREN = {
	available: true, cadence: 'mingguan', thresholds: { onTarget: 85, warning: 65 }, bucketBerjalan: 'W2',
	buckets: [{ key: 'W1', label: 'M1', fullLabel: 'Minggu 1' }, { key: 'W2', label: 'M2', fullLabel: 'Minggu 2 (8-14 Nov)' }],
	proyek: [{ project_id: 1, nama: 'Alpha', anggota: [
		{ manpower_id: 1, nama: 'Budi', jabatan: 'Welder', cells: { W1: 90, W2: null }, avgScore: 90, belumDinilaiPeriodeIni: true },
		{ manpower_id: 2, nama: 'Sari', jabatan: 'Painter', cells: { W1: 60, W2: 70 }, avgScore: 65, belumDinilaiPeriodeIni: false }
	] }]
};

let box: HTMLElement | null, inst: any;
function render(props: any) { box = document.createElement('div'); document.body.appendChild(box); inst = mount(Matrix, { target: box, props }); flushSync(); }
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; goto.mockReset(); });

describe('TimMiniMatrix', () => {
	it('menampilkan skor tiap pekerja; sel kosong "–"', () => {
		render({ tren: TREN, projectId: 1, cadence: 'mingguan', onCadence: vi.fn() });
		const rows = [...box!.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent!.trim()));
		expect(rows[0]).toEqual(['Budi', '90', '–', '90']);
		expect(rows[1]).toEqual(['Sari', '60', '70', '65']);
	});

	it('banner pekerja belum dinilai di periode berjalan + tombol ke penilaian massal', () => {
		render({ tren: TREN, projectId: 1, cadence: 'mingguan', onCadence: vi.fn() });
		const banner = box!.querySelector('[data-testid="tim-belum-dinilai"]')!;
		expect(banner.textContent).toContain('1 pekerja belum dinilai');
		expect(banner.textContent).toContain('Budi');
		(banner.querySelector('button') as HTMLElement).click();
		expect(goto).toHaveBeenCalledWith('/manpower/rating');
	});

	it('ganti cadence memanggil onCadence; loading & data tak tersedia ditangani', () => {
		const onCadence = vi.fn();
		render({ tren: TREN, projectId: 1, cadence: 'mingguan', onCadence });
		([...box!.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Bulanan') as HTMLElement).click();
		expect(onCadence).toHaveBeenCalledWith('bulanan');
		unmount(inst); box!.remove();
		render({ tren: null, projectId: 1, cadence: 'mingguan', loading: true, onCadence });
		expect(box!.querySelector('[data-testid="tim-matrix-loading"]')).not.toBeNull();
		unmount(inst); box!.remove();
		render({ tren: { available: false }, projectId: 1, cadence: 'mingguan', onCadence });
		expect(box!.textContent).toContain('belum tersedia');
	});
});
