// src/lib/utils/trainingContent.js
// Pengolah konten modul Teks hasil Ingest AI untuk 3 mode belajar (Baca / Lihat / Tonton). MURNI — tanpa DOM, tanpa I/O.
//
// ⚠️ FILE INI DISALIN IDENTIK di erp-epi (src/lib/utils/) dan project-epi (src/lib/utils/). Ubah di KEDUA repo bersamaan.
//
// Konten modul = Markdown terstruktur (## Tujuan Belajar, ## Konsep Inti, …) + transkrip narasi. Tidak ada field "slide"
// di database, jadi deck "Lihat" DITURUNKAN dari heading `##`, dan narasi "Tonton" dibagi ke slide sesuai porsi teksnya.
// Markdown di-parse ke blok data (bukan HTML) supaya komponen merender lewat elemen Svelte — tanpa {@html}, tanpa risiko XSS.

export const VERIFY_MARKER = '[VERIFIKASI TDS]';

/** Pisahkan footer "---\nSumber materi: URL" yang ditambahkan Ingest AI. */
export function splitSourceFooter(md) {
	const text = String(md ?? '');
	const m = text.match(/\n-{3,}\s*\nSumber materi:\s*(\S+)\s*$/);
	if (!m) return { body: text.trim(), sourceUrl: null };
	return { body: text.slice(0, m.index).trim(), sourceUrl: m[1] };
}

/**
 * Markdown sederhana → blok: {type:'h',level,text} | {type:'p',text} | {type:'ul'|'ol', items:[{text, sub:string[]}]}
 * Mendukung heading #, bullet -/*, daftar bernomor, sub-daftar (indentasi), paragraf. Selain itu diperlakukan paragraf.
 */
export function parseBlocks(md) {
	const blocks = [];
	let para = [];
	let list = null; // blok ul/ol yang sedang berjalan
	const flushPara = () => {
		if (para.length) blocks.push({ type: 'p', text: para.join(' ').trim() });
		para = [];
	};
	const flushList = () => { list = null; };

	for (const raw of String(md ?? '').replace(/\r\n?/g, '\n').split('\n')) {
		const line = raw.replace(/\s+$/, '');
		if (!line.trim()) { flushPara(); flushList(); continue; }

		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			flushPara(); flushList();
			blocks.push({ type: 'h', level: heading[1].length, text: heading[2].trim() });
			continue;
		}
		const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
		const numbered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
		if (bullet || numbered) {
			flushPara();
			const m = bullet || numbered;
			const indent = m[1].length;
			const text = m[2].trim();
			const type = bullet ? 'ul' : 'ol';
			if (indent >= 2 && list && list.items.length) {
				list.items[list.items.length - 1].sub.push(text); // sub-item (mis. daftar bernomor di bawah bullet)
			} else if (list && list.type === type) {
				list.items.push({ text, sub: [] });
			} else {
				list = { type, items: [{ text, sub: [] }] };
				blocks.push(list);
			}
			continue;
		}
		flushList();
		para.push(line.trim());
	}
	flushPara();
	return blocks;
}

/** Teks inline → segmen: {t:'text'|'b'|'flag', v}. **tebal** dan penanda [VERIFIKASI TDS]. */
export function inlineSegments(text) {
	const out = [];
	const re = /\*\*([^*]+)\*\*|\[VERIFIKASI TDS\]/g;
	let last = 0;
	let m;
	const src = String(text ?? '');
	while ((m = re.exec(src))) {
		if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) });
		out.push(m[1] != null ? { t: 'b', v: m[1] } : { t: 'flag', v: VERIFY_MARKER });
		last = m.index + m[0].length;
	}
	if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
	return out;
}

/** Deck slide dari heading `##`. Teks sebelum `##` pertama (bila ada) menjadi slide "Pengantar". */
export function buildSlides(md) {
	const { body } = splitSourceFooter(md);
	const slides = [];
	let cur = null;
	const ensure = (title) => { if (!cur) { cur = { title, items: [] }; slides.push(cur); } return cur; };

	for (const b of parseBlocks(body)) {
		if (b.type === 'h') {
			if (b.level <= 2) {
				if (b.level === 1 && !cur && slides.length === 0) { cur = null; continue; } // judul dokumen, bukan slide
				cur = { title: b.text, items: [] };
				slides.push(cur);
			} else {
				ensure('Pengantar').items.push({ text: b.text, sub: [], strong: true });
			}
		} else if (b.type === 'p') {
			ensure('Pengantar').items.push({ text: b.text, sub: [] });
		} else {
			const target = ensure('Pengantar');
			for (const it of b.items) target.items.push({ text: it.text, sub: it.sub, ordered: b.type === 'ol' });
		}
	}
	return slides.filter((s) => s.items.length > 0);
}

/** Layak ditampilkan sebagai deck / mode Lihat & Tonton? (minimal 2 slide) */
export const hasStructuredSlides = (md) => buildSlides(md).length >= 2;

/** Bobot teks sebuah slide (untuk membagi narasi). */
export const slideWeight = (slide) =>
	Math.max(20, slide.title.length + slide.items.reduce((n, it) => n + it.text.length + it.sub.reduce((k, s) => k + s.length, 0), 0));

const MAX_SENTENCE = 220;

/** Naskah narasi → daftar kalimat pendek (stabil untuk text-to-speech). */
export function splitNarration(text) {
	const out = [];
	for (const para of String(text ?? '').replace(/\r\n?/g, '\n').split(/\n{1,}/)) {
		const p = para.replace(/\s+/g, ' ').trim();
		if (!p) continue;
		for (const s of p.split(/(?<=[.!?…])\s+(?=[A-Z0-9"“(])/)) {
			let rest = s.trim();
			while (rest.length > MAX_SENTENCE) {
				// potong di koma/titik koma terdekat sebelum batas; jika tak ada, di spasi
				const cut = Math.max(rest.lastIndexOf(', ', MAX_SENTENCE), rest.lastIndexOf('; ', MAX_SENTENCE), rest.lastIndexOf(' ', MAX_SENTENCE));
				const at = cut > 40 ? cut + 1 : MAX_SENTENCE;
				out.push(rest.slice(0, at).trim());
				rest = rest.slice(at).trim();
			}
			if (rest) out.push(rest);
		}
	}
	return out;
}

/**
 * Tentukan slide mana yang tampil untuk tiap kalimat narasi: pembagian proporsional terhadap bobot teks slide.
 * Hasil monoton naik (slide tidak pernah mundur saat narasi berjalan). @returns {number[]} indeks slide per kalimat
 */
export function assignNarrationToSlides(sentences, slides) {
	if (!sentences.length || !slides.length) return sentences.map(() => 0);
	const weights = slides.map(slideWeight);
	const totalW = weights.reduce((a, b) => a + b, 0);
	const totalS = sentences.reduce((n, s) => n + s.length, 0) || 1;
	const bounds = [];
	let acc = 0;
	for (const w of weights) { acc += w; bounds.push(acc / totalW); }
	let before = 0;
	return sentences.map((s) => {
		const mid = (before + s.length / 2) / totalS;
		before += s.length;
		const idx = bounds.findIndex((b) => mid <= b + 1e-9);
		return idx === -1 ? slides.length - 1 : idx;
	});
}

/** Perkiraan lama bicara (ms) sebuah kalimat — dipakai bila perangkat tak punya suara Indonesia (mode baca otomatis). */
export const estimateSpeakMs = (sentence, rate = 1) => Math.max(1500, Math.round((String(sentence).length * 65) / (rate || 1)));

/** URL sematan resmi Google untuk sumber materi, atau null bila bukan tautan Google yang dikenal. */
export function googleEmbedUrl(url) {
	const u = String(url ?? '');
	let m = u.match(/^https:\/\/docs\.google\.com\/presentation\/d\/([A-Za-z0-9_-]{10,})/);
	if (m) return `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false`;
	m = u.match(/^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{10,})/);
	if (m) return `https://docs.google.com/document/d/${m[1]}/preview`;
	m = u.match(/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})/);
	if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
	return null;
}
