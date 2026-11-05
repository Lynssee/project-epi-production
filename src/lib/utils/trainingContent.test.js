import { describe, it, expect } from 'vitest';
import {
	splitSourceFooter,
	parseBlocks,
	inlineSegments,
	buildSlides,
	hasStructuredSlides,
	splitNarration,
	assignNarrationToSlides,
	estimateSpeakMs,
	googleEmbedUrl
} from './trainingContent.js';

// Bentuk nyata hasil Ingest AI (modul #40 uji hidup 3 Nov 2026, dipersingkat)
const MD = `## Tujuan Belajar
- Memahami keterampilan utama manajer.
- Mengetahui 10 peran manajer.

## Konsep Inti
- Keterampilan konseptual: kemampuan membuat ide.

- 10 Peran Manajer menurut Mintzberg:
  1. Figur (Figurehead)
  2. Pemimpin (Leader)

## Cek Pemahaman
- Sebutkan tiga keterampilan utama?

---
Sumber materi: https://docs.google.com/document/d/1qHRdbZEtariJ6HdF-7QyzucPlX1c_3UA`;

describe('splitSourceFooter', () => {
	it('memisahkan footer sumber', () => {
		const r = splitSourceFooter(MD);
		expect(r.sourceUrl).toBe('https://docs.google.com/document/d/1qHRdbZEtariJ6HdF-7QyzucPlX1c_3UA');
		expect(r.body).not.toContain('Sumber materi');
		expect(splitSourceFooter('tanpa footer').sourceUrl).toBeNull();
		expect(splitSourceFooter(null)).toEqual({ body: '', sourceUrl: null });
	});
});

describe('parseBlocks', () => {
	it('heading, bullet, sub-daftar bernomor di bawah bullet, paragraf', () => {
		const b = parseBlocks('# Judul\nParagraf satu\nlanjut.\n\n- a\n- b\n  1. b1\n  2. b2\n\n1. x\n2. y');
		expect(b[0]).toEqual({ type: 'h', level: 1, text: 'Judul' });
		expect(b[1]).toEqual({ type: 'p', text: 'Paragraf satu lanjut.' });
		expect(b[2]).toMatchObject({ type: 'ul', items: [{ text: 'a', sub: [] }, { text: 'b', sub: ['b1', 'b2'] }] });
		expect(b[3]).toMatchObject({ type: 'ol', items: [{ text: 'x' }, { text: 'y' }] });
	});
	it('input kosong / null → []', () => {
		expect(parseBlocks('')).toEqual([]);
		expect(parseBlocks(null)).toEqual([]);
	});
	it('HTML mentah tetap menjadi teks biasa (tidak pernah dirender sebagai HTML)', () => {
		const b = parseBlocks('<script>alert(1)</script>');
		expect(b).toEqual([{ type: 'p', text: '<script>alert(1)</script>' }]);
	});
});

describe('inlineSegments', () => {
	it('**tebal** dan penanda VERIFIKASI TDS', () => {
		expect(inlineSegments('Tekanan **150 bar** [VERIFIKASI TDS] ya')).toEqual([
			{ t: 'text', v: 'Tekanan ' }, { t: 'b', v: '150 bar' }, { t: 'text', v: ' ' }, { t: 'flag', v: '[VERIFIKASI TDS]' }, { t: 'text', v: ' ya' }
		]);
		expect(inlineSegments('polos')).toEqual([{ t: 'text', v: 'polos' }]);
		expect(inlineSegments('')).toEqual([]);
	});
});

describe('buildSlides', () => {
	it('satu slide per heading ##, sub-daftar ikut, footer tidak jadi slide', () => {
		const s = buildSlides(MD);
		expect(s.map((x) => x.title)).toEqual(['Tujuan Belajar', 'Konsep Inti', 'Cek Pemahaman']);
		expect(s[1].items.at(-1)).toMatchObject({ text: '10 Peran Manajer menurut Mintzberg:', sub: ['Figur (Figurehead)', 'Pemimpin (Leader)'] });
		expect(JSON.stringify(s)).not.toContain('Sumber materi');
	});
	it('teks sebelum ## pertama → slide Pengantar; H1 judul dokumen diabaikan', () => {
		const s = buildSlides('# Dokumen\nPengantar singkat.\n\n## Bagian A\n- x');
		expect(s.map((x) => x.title)).toEqual(['Pengantar', 'Bagian A']);
	});
	it('teks polos tanpa heading → 1 slide, tidak dianggap terstruktur', () => {
		expect(buildSlides('hanya paragraf biasa')).toHaveLength(1);
		expect(hasStructuredSlides('hanya paragraf biasa')).toBe(false);
		expect(hasStructuredSlides(MD)).toBe(true);
		expect(hasStructuredSlides(null)).toBe(false);
	});
});

describe('splitNarration', () => {
	it('memecah per kalimat dan per paragraf', () => {
		const r = splitNarration('Halo semua. Kita belajar hari ini! Siap?\n\nParagraf dua dimulai.');
		expect(r).toEqual(['Halo semua.', 'Kita belajar hari ini!', 'Siap?', 'Paragraf dua dimulai.']);
	});
	it('kalimat sangat panjang dipotong ≤ 220 karakter (stabil untuk TTS)', () => {
		const long = ('kata yang sangat panjang sekali, ').repeat(30).trim();
		const r = splitNarration(long);
		expect(r.length).toBeGreaterThan(1);
		expect(r.every((s) => s.length <= 221)).toBe(true);
		expect(r.join(' ').replace(/\s+/g, ' ')).toContain('kata yang sangat panjang sekali');
	});
	it('kosong → []', () => {
		expect(splitNarration('')).toEqual([]);
		expect(splitNarration(null)).toEqual([]);
	});
});

describe('assignNarrationToSlides', () => {
	const slides = buildSlides(MD);
	const sentences = splitNarration('Satu dua tiga empat lima. Enam tujuh delapan sembilan sepuluh. Sebelas dua belas tiga belas. Empat belas lima belas. Enam belas tujuh belas delapan belas. Sembilan belas dua puluh.');
	it('monoton naik, mulai di slide 0, berakhir di slide terakhir', () => {
		const a = assignNarrationToSlides(sentences, slides);
		expect(a).toHaveLength(sentences.length);
		expect(a[0]).toBe(0);
		expect(a.at(-1)).toBe(slides.length - 1);
		for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
	});
	it('kasus tepi: tanpa kalimat / tanpa slide / satu kalimat', () => {
		expect(assignNarrationToSlides([], slides)).toEqual([]);
		expect(assignNarrationToSlides(['a'], [])).toEqual([0]);
		expect(assignNarrationToSlides(['satu kalimat saja'], slides)).toHaveLength(1);
	});
});

describe('estimateSpeakMs & googleEmbedUrl', () => {
	it('lebih cepat pada rate lebih tinggi, minimal 1,5 dtk', () => {
		const s = 'x'.repeat(200);
		expect(estimateSpeakMs(s, 1.5)).toBeLessThan(estimateSpeakMs(s, 1));
		expect(estimateSpeakMs('a', 1)).toBe(1500);
	});
	it('hanya tautan Google yang dikenal yang bisa disematkan', () => {
		expect(googleEmbedUrl('https://docs.google.com/presentation/d/1VvkJfz4LT_PLSIF4IeA56x6HD3kbFoFC')).toContain('/embed');
		expect(googleEmbedUrl('https://docs.google.com/document/d/1qHRdbZEtariJ6HdF-7QyzucPlX1c_3UA')).toContain('/preview');
		expect(googleEmbedUrl('https://drive.google.com/file/d/1co6bozOIhviMPeW8MMqY_YjXcwDVIHgP/view')).toBe('https://drive.google.com/file/d/1co6bozOIhviMPeW8MMqY_YjXcwDVIHgP/preview');
		expect(googleEmbedUrl('https://evil.com/presentation/d/1VvkJfz4LT_PLSIF4IeA56x6HD3kbFoFC')).toBeNull();
		expect(googleEmbedUrl('javascript:alert(1)')).toBeNull();
		expect(googleEmbedUrl(null)).toBeNull();
	});
});
