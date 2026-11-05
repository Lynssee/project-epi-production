// @ts-nocheck — test DOM (props & mock Web Speech dinamis)
// @vitest-environment jsdom
// TeksModulViewer (lapangan): 3 mode (Baca/Lihat/Tonton) untuk modul Teks hasil Ingest AI. Narasi dijalankan tanpa suara
// (jsdom tak punya speechSynthesis) → jalur timer otomatis; ini juga jalur fallback perangkat tanpa suara Indonesia.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const { default: Viewer } = await import('./TeksModulViewer.svelte');

const MD = `## Tujuan Belajar
- Memahami tekanan **150 bar** pada airless

## Konsep Inti
- Rasio campuran 4:1 [VERIFIKASI TDS]
- <img src=x onerror="window.__xss=1">

## Cek Pemahaman
- Apa fungsi after cooler?

---
Sumber materi: https://docs.google.com/presentation/d/1EXFMjKC87BMxDsBnygP80LswKxH8utdt`;
const TRANSKRIP = 'Kita mulai dari tujuan belajar hari ini. Tekanan airless harus tepat. Sekarang konsep inti tentang rasio campuran. Rasio harus sesuai lembar data. Terakhir cek pemahaman Anda. Selamat belajar.';

let box;
let inst;
function render(modul) {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Viewer, { target: box, props: { modul } });
	flushSync();
}
const tab = (label) => [...box.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes(label));
const click = (el) => { el.click(); flushSync(); };
const btn = (text) => [...box.querySelectorAll('button')].find((b) => b.textContent.includes(text));

beforeEach(() => { vi.useFakeTimers(); delete window.__xss; });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = null; vi.useRealTimers(); });

describe('TeksModulViewer', () => {
	it('modul terstruktur → 3 tab; mode Baca tampil default dengan tautan dokumen asli', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP, konten_url: 'https://docs.google.com/presentation/d/1EXFMjKC87BMxDsBnygP80LswKxH8utdt' });
		expect(box.querySelectorAll('[role="tab"]')).toHaveLength(3);
		expect(box.textContent).toContain('Tujuan Belajar');
		expect(box.querySelector('strong').textContent).toBe('150 bar');
		expect(box.textContent).toContain('Buka dokumen asli');
		expect(box.textContent).not.toContain('Sumber materi'); // footer dipisah dari isi
	});

	it('HTML mentah di konten TIDAK dirender (tidak ada elemen img / handler dieksekusi)', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
		expect(box.querySelector('img')).toBeNull();
		expect(box.textContent).toContain('<img src=x');
		expect(window.__xss).toBeUndefined();
	});

	it('penanda [VERIFIKASI TDS] disorot sebagai lencana (gaya tema)', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
		const flag = [...box.querySelectorAll('span')].find((s) => s.textContent === '[VERIFIKASI TDS]');
		expect(flag?.getAttribute('style')).toContain('--aml'); // lencana kuning (token tema lapangan)
	});

	it('mode Lihat: satu slide + navigasi; dokumen asli hanya disematkan setelah diminta', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP, konten_url: 'https://docs.google.com/presentation/d/1EXFMjKC87BMxDsBnygP80LswKxH8utdt' });
		click(tab('Lihat'));
		expect(box.textContent).toContain('1 / 3');
		expect(box.querySelector('iframe')).toBeNull();
		click(box.querySelector('[aria-label="Slide berikutnya"]'));
		expect(box.textContent).toContain('2 / 3');
		expect(box.textContent).toContain('Konsep Inti');
		click(btn('Lihat dokumen asli'));
		expect(box.querySelector('iframe').getAttribute('src')).toContain('/embed');
		expect(box.querySelector('iframe').getAttribute('sandbox')).toBeTruthy();
	});

	it('mode Tonton tanpa suara: Putar → kalimat maju otomatis & slide mengikuti; selesai di slide terakhir', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
		click(tab('Tonton'));
		expect(box.textContent).toContain('Siap diputar');
		expect(box.textContent).toContain('tanpa audio'); // jsdom tak punya speechSynthesis → fallback otomatis
		click(btn('Putar'));
		expect(box.textContent).toContain('Sedang dibacakan');
		expect(box.textContent).toContain('1 / 3');
		vi.advanceTimersByTime(60_000);
		flushSync();
		expect(box.textContent).toContain('Narasi selesai');
		expect(box.textContent).toContain('3 / 3');
		click(btn('Ulangi'));
		expect(box.textContent).toContain('1 / 3');
	});

	it('Jeda menghentikan kemajuan; ganti mode ke Baca menjeda narasi', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
		click(tab('Tonton'));
		click(btn('Putar'));
		vi.advanceTimersByTime(3000);
		flushSync();
		click(btn('Jeda'));
		const before = box.textContent;
		vi.advanceTimersByTime(60_000);
		flushSync();
		expect(box.textContent).toBe(before);
		click(btn('Lanjut'));
		click(tab('Baca'));
		expect(btn('Jeda')).toBeUndefined();
		vi.advanceTimersByTime(60_000); // timer lama tak boleh menggerakkan apa pun setelah pindah mode
	});

	it('kecepatan 1.5x membuat narasi selesai lebih cepat daripada 1x', () => {
		const run = (rateLabel) => {
			render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
			click(tab('Tonton'));
			click(btn(rateLabel));
			click(btn('Putar'));
			let ms = 0;
			while (!box.textContent.includes('Narasi selesai') && ms < 120_000) { vi.advanceTimersByTime(500); flushSync(); ms += 500; }
			unmount(inst); box.remove(); inst = null;
			return ms;
		};
		const slow = run('1x');
		const fast = run('1.5x');
		expect(fast).toBeLessThan(slow);
	});

	it('tanpa transkrip → membacakan isi slide; teks polos tanpa ## → tanpa tab (hanya Baca)', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: '' });
		click(tab('Tonton'));
		expect(box.textContent).toContain('Tujuan Belajar');
		unmount(inst); box.remove(); inst = null;
		render({ judul: 'M', konten_teks: 'Hanya satu paragraf biasa.', transkrip: '' });
		expect(box.querySelectorAll('[role="tab"]')).toHaveLength(0);
		expect(box.textContent).toContain('Hanya satu paragraf biasa.');
	});
});

describe('TeksModulViewer — dengan suara Indonesia (Web Speech API dipalsukan)', () => {
	let spoken;
	let synth;
	beforeEach(() => {
		spoken = [];
		class Utt { constructor(text) { this.text = text; } }
		window.SpeechSynthesisUtterance = Utt;
		globalThis.SpeechSynthesisUtterance = Utt;
		synth = {
			getVoices: () => [{ lang: 'en-US', name: 'English' }, { lang: 'id-ID', name: 'Damayanti' }],
			speak: vi.fn((u) => spoken.push(u)),
			cancel: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		};
		Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
	});
	afterEach(() => { delete window.speechSynthesis; delete window.SpeechSynthesisUtterance; delete globalThis.SpeechSynthesisUtterance; });

	it('memilih suara id-ID, membacakan kalimat berurutan (maju saat onend), rate sesuai pilihan', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
		click(tab('Tonton'));
		expect(box.textContent).not.toContain('tanpa audio');
		click(btn('1.25x'));
		click(btn('Putar'));
		expect(spoken).toHaveLength(1);
		expect(spoken[0].voice.lang).toBe('id-ID');
		expect(spoken[0].lang).toBe('id-ID');
		expect(spoken[0].rate).toBe(1.25);
		expect(spoken[0].text).toBe('Kita mulai dari tujuan belajar hari ini.');
		spoken[0].onend();
		flushSync();
		expect(spoken).toHaveLength(2);
		expect(spoken[1].text).toBe('Tekanan airless harus tepat.');
	});

	it('Jeda membatalkan suara; onend usang setelah jeda tidak memajukan narasi', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
		click(tab('Tonton'));
		click(btn('Putar'));
		const first = spoken[0];
		click(btn('Jeda'));
		expect(synth.cancel).toHaveBeenCalled();
		first.onend();
		flushSync();
		expect(spoken).toHaveLength(1);
	});

	it('onerror bukan "canceled" → beralih otomatis ke mode tanpa audio dengan pesan jelas (tidak macet)', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
		click(tab('Tonton'));
		click(btn('Putar'));
		spoken[0].onerror({ error: 'synthesis-failed' });
		flushSync();
		expect(box.textContent).toContain('tidak dapat diputar');
		vi.advanceTimersByTime(60_000);
		flushSync();
		expect(box.textContent).toContain('Narasi selesai');
	});

	it('onerror "canceled" (akibat cancel() kita sendiri) diabaikan', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
		click(tab('Tonton'));
		click(btn('Putar'));
		spoken[0].onerror({ error: 'canceled' });
		flushSync();
		expect(box.textContent).not.toContain('tidak dapat diputar');
	});

	it('komponen dihancurkan → suara dihentikan', () => {
		render({ judul: 'M', konten_teks: MD, transkrip: TRANSKRIP });
		click(tab('Tonton'));
		click(btn('Putar'));
		synth.cancel.mockClear();
		unmount(inst); inst = null;
		expect(synth.cancel).toHaveBeenCalled();
	});
});
