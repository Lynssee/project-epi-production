import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	isLembur, normalizeLembur, normalizeCharterValue, optionsWithLegacy, validateCharterForm,
	WAKTU_KERJA_OPTIONS, SHIFT_KERJA_OPTIONS, LEMBUR_OPTIONS, YA_TIDAK_OPTIONS, JENIS_MANPOWER_OPTIONS,
	VERIFIKASI_KONTRAK_OPTIONS, PERSIAPAN_PERMUKAAN_OPTIONS
} from './charterOptions';

describe('charterOptions (PRJ-15)', () => {
	it('isLembur / normalizeLembur', () => {
		for (const v of ['boleh', 'BOLEH', 'ada', 'Ya']) expect(isLembur(v)).toBe(true);
		for (const v of ['tidak', 'TIDAK', 'TIDAK ADA', '', null]) expect(isLembur(v)).toBe(false);
		expect(normalizeLembur('TIDAK ADA')).toBe('tidak');
		expect(normalizeLembur('ADA (Terjadwal)')).toBe('boleh');
		expect(normalizeLembur('')).toBe('tidak');
	});
	it('nilai lapangan lama dipetakan ke kosakata ERP', () => {
		expect(normalizeCharterValue('waktu_kerja', '5 Hari Kerja (Senin - Jumat)')).toBe('SENIN-JUMAT');
		expect(normalizeCharterValue('jenis_manpower', 'Harian Lepas')).toBe('HARIAN');
		expect(normalizeCharterValue('persiapan_permukaan', 'POWER TOOL')).toBe('POWER TOOL');
		expect(normalizeCharterValue('shift_kerja', '')).toBe('');
	});
	it('nilai tak dikenal muncul sebagai "(nilai lama)" terpilih, bukan kosong', () => {
		const opts = optionsWithLegacy(YA_TIDAK_OPTIONS, 'Surat Jalan Standar EPI');
		expect(opts[0]).toEqual({ value: 'Surat Jalan Standar EPI', label: '(nilai lama) Surat Jalan Standar EPI' });
		expect(optionsWithLegacy(YA_TIDAK_OPTIONS, 'ADA')).toBe(YA_TIDAK_OPTIONS);
	});
	it('validateCharterForm: tanggal, format jam, lembur wajib jam', () => {
		const ok = { tanggal_mulai_project: '2026-10-01', selesai_project_target: '2026-10-31', jam_kerja_mulai: '08:00', jam_kerja_selesai: '17:00', waktu_lembur: 'tidak' };
		expect(validateCharterForm(ok)).toEqual([]);
		expect(validateCharterForm({ ...ok, selesai_project_target: '2026-09-01' })[0]).toContain('sebelum');
		expect(validateCharterForm({ ...ok, jam_kerja_mulai: '8' })[0]).toContain('HH:MM');
		expect(validateCharterForm({ ...ok, waktu_lembur: 'boleh' })[0]).toContain('Jam Lembur');
		expect(validateCharterForm({ ...ok, waktu_lembur: 'boleh', jam_lembur_mulai: '17:30', jam_lembur_selesai: '21:00' })).toEqual([]);
	});
	it('value identik dengan erp-epi (dilewati bila repo ERP tidak ada di sebelah)', () => {
		const erp = resolve(process.cwd(), '../erp-epi/src/lib/services/projectCharterApi.js');
		if (!existsSync(erp)) return;
		const src = readFileSync(erp, 'utf8');
		const arr = (name: string): string[] => {
			const m = src.match(new RegExp(`export const ${name} = (\\[[\\s\\S]*?\\]);`));
			if (!m) throw new Error('konstanta ERP tidak ditemukan: ' + name);
			return Function(`return (${m[1]})`)();
		};
		expect(WAKTU_KERJA_OPTIONS.map((o) => o.value).sort()).toEqual(arr('WAKTU_KERJA_OPTIONS').sort());
		expect(SHIFT_KERJA_OPTIONS.map((o) => o.value).sort()).toEqual(arr('SHIFT_KERJA_OPTIONS').sort());
		expect(LEMBUR_OPTIONS.map((o) => o.value).sort()).toEqual(arr('BOLEH_TIDAK_OPTIONS').sort());
		expect(YA_TIDAK_OPTIONS.map((o) => o.value).sort()).toEqual(arr('YA_TIDAK_OPTIONS').sort());
		expect(JENIS_MANPOWER_OPTIONS.map((o) => o.value).sort()).toEqual(arr('JENIS_MANPOWER_OPTIONS').sort());
		expect(VERIFIKASI_KONTRAK_OPTIONS.map((o) => o.value).sort()).toEqual(arr('VERIFIKASI_OPTIONS').sort());
		expect(PERSIAPAN_PERMUKAAN_OPTIONS.map((o) => o.value).sort()).toEqual(arr('PERSIAPAN_PERMUKAAN_OPTIONS').sort());
	});
});
