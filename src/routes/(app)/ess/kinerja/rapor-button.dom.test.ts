// @vitest-environment jsdom
// Tombol "Rapor PDF" di /ess/kinerja (Penyatuan Engine Cetak, Fase 4): hanya aktif bila ada scorecard final; memanggil endpoint server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

vi.mock('$lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'tok' } } }));
vi.mock('$lib/components/project/PdfBlobViewer.svelte', async () => ({ default: (await import('$lib/components/shared/__pdfViewerStub.svelte')).default }));
const getKpiList = vi.fn();
vi.mock('$lib/services/ess/kpi', () => ({ getKpiList: () => getKpiList(), submitSelfAssessment: vi.fn() }));
vi.mock('$lib/services/ess/kpiDispute', () => ({ getMyDisputes: async () => [], submitDispute: vi.fn() }));
vi.mock('$lib/services/ess/skillGap', () => ({ getMySkillGap: async () => null }));
vi.mock('$lib/components/ess/GateKpiSayaCard.svelte', async () => ({ default: (await import('$lib/components/shared/__pdfViewerStub.svelte')).default }));
vi.mock('$lib/components/ess/TugasSayaAlurCard.svelte', async () => ({ default: (await import('$lib/components/shared/__pdfViewerStub.svelte')).default }));
vi.mock('$lib/components/ess/SopSayaCard.svelte', async () => ({ default: (await import('$lib/components/shared/__pdfViewerStub.svelte')).default }));
vi.mock('$lib/components/ess/TimProyekSayaCard.svelte', async () => ({ default: (await import('$lib/components/shared/__pdfViewerStub.svelte')).default }));
vi.mock('$lib/components/ess/KinerjaTrenCard.svelte', async () => ({ default: (await import('$lib/components/shared/__pdfViewerStub.svelte')).default }));

const { default: Page } = await import('./+page.svelte');

const rec = { id: 'sc1', tipe: 'Karyawan', periode: 'Oktober', tahun: 2026, status: 'Finalized', targets: [], total_skor: 80, skor_pelatihan: null, catatan: null, kpi_period_id: null };
const base = { kpiList: [rec], pendingList: [], liveKpiList: [], selfReviews: [], defaultKriteria: [], notifications: [], trend: [] };

let box: HTMLElement | null, inst: any;
const settle = async () => { for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); } };
async function render() {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Page, { target: box, props: {} });
	await settle();
}
const btn = () => box!.querySelector('[data-testid="btn-rapor-kinerja"]') as HTMLButtonElement;

beforeEach(() => { getKpiList.mockResolvedValue(base); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('/ess/kinerja — Rapor PDF', () => {
	it('ada scorecard final → tombol aktif; klik → GET rapor dengan Bearer', async () => {
		const f = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['%PDF']) }));
		vi.stubGlobal('fetch', f);
		await render();
		expect(btn().disabled).toBe(false);
		btn().click();
		await settle();
		const call = (f.mock.calls as any[]).find((c) => String(c[0]).includes('kinerja-rapor-pdf'));
		expect(call[0]).toBe('/api/ess/kinerja-rapor-pdf');
		expect(call[1].headers.Authorization).toBe('Bearer tok');
	});
	it('belum ada scorecard final → tombol nonaktif dengan alasan di tooltip (bukan PDF kosong)', async () => {
		getKpiList.mockResolvedValue({ ...base, kpiList: [] });
		await render();
		expect(btn().disabled).toBe(true);
		expect(btn().title).toContain('Belum ada scorecard final');
	});
});
