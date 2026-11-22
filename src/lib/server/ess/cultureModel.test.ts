import { describe, it, expect } from 'vitest';
import { pickToday, toClientItem, gradeAck, shouldWriteAck, hasKuis, matchesAudience, isActiveOn, resolveCultureSettings, formatQuoteLine, CULTURE_DEFAULTS } from './cultureModel';

const kuis = { id: 1, isi_pesan: 'Pesan', pertanyaan_kuis: 'Apa?', opsi_kuis: ['A', 'B', 'C'], jawaban_benar_idx: 1 };

describe('cultureModel (salinan setia erp-epi)', () => {
	it('pickToday deterministik, prioritas, rotasi, audiens', () => {
		const items = [
			{ id: 1, isi_pesan: 'a', prioritas: 0 },
			{ id: 2, isi_pesan: 'b', prioritas: 5 },
			{ id: 3, isi_pesan: 'c', prioritas: 5 },
			{ id: 4, isi_pesan: 'k', prioritas: 9, target_audiens: 'kiosk' }
		];
		const a = pickToday(items, '2026-11-13', { audience: 'lapangan' });
		expect([2, 3]).toContain(a.id);
		expect(pickToday(items, '2026-11-13', { audience: 'lapangan' }).id).toBe(a.id);
		expect(pickToday(items, '2026-11-14', { audience: 'lapangan' }).id).not.toBe(a.id);
		expect(pickToday(items, '2026-11-13', { audience: 'kiosk' }).id).toBe(4);
		expect(pickToday(null, '2026-11-13')).toBeNull();
	});
	it('jendela tanggal & divisi', () => {
		expect(isActiveOn({ tanggal_mulai: '2026-11-14' }, '2026-11-13')).toBe(false);
		expect(isActiveOn({ aktif: false }, '2026-11-13')).toBe(false);
		expect(matchesAudience({ target_divisi: ['Produksi'] }, 'lapangan', 'produksi')).toBe(true);
		expect(matchesAudience({ target_divisi: ['Produksi'] }, 'lapangan', 'QC')).toBe(false);
	});
	it('kuis dinilai server & kunci tidak bocor', () => {
		expect(hasKuis(kuis)).toBe(true);
		expect(toClientItem(kuis)).not.toHaveProperty('jawaban_benar_idx');
		expect(gradeAck(kuis, 'kuis', 1)).toBe('kuis_benar');
		expect(gradeAck(kuis, 'kuis', 0)).toBe('kuis_salah');
		expect(gradeAck(kuis, 'komitmen')).toBeNull();
		expect(gradeAck({ id: 2, isi_pesan: 'x' }, 'komitmen')).toBe('paham_komitmen');
	});
	it('shouldWriteAck', () => {
		expect(shouldWriteAck(null, 'kuis_salah')).toBe(true);
		expect(shouldWriteAck('kuis_salah', 'kuis_benar')).toBe(true);
		expect(shouldWriteAck('kuis_benar', 'kuis_salah')).toBe(false);
	});
	it('setelan & kutipan', () => {
		expect(resolveCultureSettings(null)).toEqual(CULTURE_DEFAULTS);
		expect(resolveCultureSettings([{ setting_key: 'culture.kiosk_banner_enabled', setting_value: 'false' }])['culture.kiosk_banner_enabled']).toBe(false);
		expect(formatQuoteLine({ isi_pesan: ' a   b ' })).toBe('📢 Budaya Hari Ini: a b');
	});
});
