// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import KpiInteractivePreviewModal from './KpiInteractivePreviewModal.svelte';

vi.mock('$lib/firebase', () => ({
	auth: {
		currentUser: {
			getIdToken: vi.fn(async () => 'mock-token')
		}
	}
}));

let container: HTMLElement | null = null;
let instance: any = null;

async function settle() {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 10));
		flushSync();
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	container = document.createElement('div');
	document.body.appendChild(container);
});

afterEach(() => {
	if (instance) unmount(instance);
	container?.remove();
	instance = null;
	container = null;
});

describe('KpiInteractivePreviewModal', () => {
	it('tidak me-render elemen modal saat open=false', () => {
		instance = mount(KpiInteractivePreviewModal, {
			target: container!,
			props: { open: false, onClose: vi.fn() }
		});
		expect(container!.querySelector('[data-testid="kpi-interactive-preview-modal"]')).toBeNull();
	});

	it('memanggil /api/ess/kpi/print-url dan me-render iframe saat open=true', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				available: true,
				url: 'http://localhost:9390/print/kpi?period=2026-10&scope=individual',
				title: 'Rapor Kinerja - Budi Santoso'
			})
		});
		vi.stubGlobal('fetch', mockFetch);

		instance = mount(KpiInteractivePreviewModal, {
			target: container!,
			props: {
				open: true,
				period: '2026-10',
				scope: 'individual',
				onClose: vi.fn()
			}
		});

		await settle();

		expect(mockFetch).toHaveBeenCalled();
		const callUrl = mockFetch.mock.calls[0][0];
		expect(callUrl).toContain('/api/ess/kpi/print-url');
		expect(callUrl).toContain('period=2026-10');

		const modal = container!.querySelector('[data-testid="kpi-interactive-preview-modal"]');
		expect(modal).not.toBeNull();
		expect(modal?.textContent).toContain('Rapor Kinerja - Budi Santoso');
		expect(modal?.textContent).toContain('True A4 Interaktif');

		const iframe = modal?.querySelector('iframe');
		expect(iframe).not.toBeNull();
		expect(iframe?.getAttribute('src')).toBe('http://localhost:9390/print/kpi?period=2026-10&scope=individual');
	});

	it('menampilkan pesan error dan tombol coba lagi jika panggilan gagal', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 503,
			json: async () => ({ message: 'Koneksi ke server ERP gagal' })
		});
		vi.stubGlobal('fetch', mockFetch);

		instance = mount(KpiInteractivePreviewModal, {
			target: container!,
			props: {
				open: true,
				period: '2026-10',
				onClose: vi.fn()
			}
		});

		await settle();

		const modal = container!.querySelector('[data-testid="kpi-interactive-preview-modal"]');
		expect(modal?.textContent).toContain('Gagal Membuka Pratinjau');
		expect(modal?.textContent).toContain('Koneksi ke server ERP gagal');
	});
});
