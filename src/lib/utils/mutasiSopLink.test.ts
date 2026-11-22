import { describe, it, expect } from 'vitest';
import { sopNodeForStatus, sopHrefForStatus, SOP_MUTASI_FLOW } from './mutasiSopLink';

describe('mutasiSopLink', () => {
	it('status → langkah SOP (selaras tahap dokumen)', () => {
		expect(sopNodeForStatus('diajukan')).toBe('mut_verifikasi_kebutuhan');
		expect(sopNodeForStatus('disetujui_tujuan')).toBe('mut_terbit_sj_mutasi');
		expect(sopNodeForStatus('dikirim')).toBe('mut_pengiriman_driver');
		expect(sopNodeForStatus('lolos_gerbang')).toBe('mut_terima_site_tujuan');
		expect(sopNodeForStatus('diterima_sebagian')).toBe('mut_terima_site_tujuan');
		expect(sopNodeForStatus('batal')).toBe('mut_ajukan_transfer');
	});
	it('status kosong/tak dikenal → langkah penerimaan (tidak error)', () => {
		expect(sopNodeForStatus(undefined)).toBe('mut_terima_site_tujuan');
		expect(sopNodeForStatus('aneh')).toBe('mut_terima_site_tujuan');
	});
	it('href menunjuk Panduan Alur dengan alur + fokus', () => {
		expect(sopHrefForStatus('dikirim')).toBe(`/panduan/alur?alur=${SOP_MUTASI_FLOW}&fokus=mut_pengiriman_driver`);
	});
});
