import { describe, it, expect } from 'vitest';
import { tindakanDisarankan, validasiCheckin } from './kesiapanKru';
import { validasiNominasi } from './leaderNominasi';
import { tipDisc } from './gayaKomunikasi';

describe('kesiapanKru', () => {
	it('saran tindakan', () => {
		expect(tindakanDisarankan({ kondisi_fisik: 'fit', kondisi_mental: 'fit', tidur_cukup: true })).toBe('lanjut');
		expect(tindakanDisarankan({ kondisi_fisik: 'fit', kondisi_mental: 'fit', tidur_cukup: false })).toBe('ringan');
		expect(tindakanDisarankan({ kondisi_fisik: 'kurang', kondisi_mental: 'fit' })).toBe('ringan');
		expect(tindakanDisarankan({ kondisi_fisik: 'fit', kondisi_mental: 'tidak' })).toBe('istirahat');
	});
	it('validasi', () => {
		expect(validasiCheckin({ manpower_id: 1, kondisi_fisik: 'fit', kondisi_mental: 'fit' })).toBeNull();
		expect(validasiCheckin({ manpower_id: 1, kondisi_fisik: 'xx' as any, kondisi_mental: 'fit' })).not.toBeNull();
		expect(validasiCheckin({ manpower_id: 1, kondisi_fisik: 'tidak', kondisi_mental: 'fit', tindakan: 'lanjut' })).toContain('tidak boleh');
		expect(validasiCheckin({ manpower_id: 1, kondisi_fisik: 'tidak', kondisi_mental: 'fit' })).toBeNull(); // saran = istirahat
	});
});

describe('nominasi & gaya komunikasi', () => {
	it('validasi nominasi', () => {
		expect(validasiNominasi({ rating: 4, tags: ['disiplin_k3'], catatan: '' })).toBeNull();
		expect(validasiNominasi({ rating: 0, tags: ['disiplin_k3'] })).not.toBeNull();
		expect(validasiNominasi({ rating: 4, tags: [] })).not.toBeNull();
		expect(validasiNominasi({ rating: 4, tags: ['asal'] })).not.toBeNull();
	});
	it('tipDisc', () => {
		expect(tipDisc('C/S')).toContain('tertulis');
		expect(tipDisc(null)).toBe('');
	});
});
