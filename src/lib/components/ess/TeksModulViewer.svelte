<script lang="ts">
	// Penampil modul Teks E-Learning lapangan dengan 3 mode belajar:
	//   📖 Baca   — materi tertulis terstruktur (Markdown → elemen Svelte, tanpa {@html})
	//   🖼️ Lihat  — kartu slide ringkas (geser di HP) + opsi menyematkan dokumen asli Google
	//   🎧 Tonton — slide berjalan otomatis mengikuti naskah narasi, dibacakan suara Bahasa Indonesia (Web Speech API)
	// Deck & pembagian narasi DITURUNKAN dari konten_teks/transkrip (lib/utils/trainingContent.js) — tidak ada field slide di DB.
	// Tanpa suara Indonesia di perangkat → slide tetap berjalan otomatis sesuai perkiraan waktu baca (tanpa audio).
	// Waktu baca minimum modul tetap dihitung oleh TrainingPlayer (timer halaman terbuka), tidak bergantung mode yang dipilih.
	import { onDestroy, onMount } from 'svelte';
	import {
		splitSourceFooter,
		parseBlocks,
		inlineSegments,
		buildSlides,
		splitNarration,
		assignNarrationToSlides,
		estimateSpeakMs,
		googleEmbedUrl
	} from '$lib/utils/trainingContent.js';
	import { IconBook, IconPresentation, IconHeadphones, IconPlayerPlay, IconPlayerPause, IconChevronLeft, IconChevronRight, IconPlayerSkipBack, IconPlayerSkipForward, IconExternalLink, IconInfoCircle } from '@tabler/icons-svelte';

	let { modul }: { modul: { judul: string; konten_teks: string | null; transkrip?: string | null; konten_url?: string | null } } = $props();

	type Mode = 'baca' | 'lihat' | 'tonton';
	let mode = $state<Mode>('baca');

	let split = $derived(splitSourceFooter(modul.konten_teks));
	let blocks = $derived(parseBlocks(split.body));
	let slides = $derived(buildSlides(modul.konten_teks));
	let structured = $derived(slides.length >= 2);
	let embedUrl = $derived(googleEmbedUrl(modul.konten_url) ?? googleEmbedUrl(split.sourceUrl));
	let sourceLink = $derived(embedUrl ? (modul.konten_url || split.sourceUrl) : null);

	// ── Lihat ──
	let slideIdx = $state(0);
	let showOriginal = $state(false);
	let touchX = 0;
	function gotoSlide(i: number) {
		slideIdx = Math.max(0, Math.min(slides.length - 1, i));
	}
	function onTouchStart(e: TouchEvent) {
		touchX = e.changedTouches[0].clientX;
	}
	function onTouchEnd(e: TouchEvent) {
		const dx = e.changedTouches[0].clientX - touchX;
		if (Math.abs(dx) < 50) return;
		if (mode === 'tonton') jumpToSlide(slideIdx + (dx < 0 ? 1 : -1));
		else gotoSlide(slideIdx + (dx < 0 ? 1 : -1));
	}

	// ── Tonton (narasi) ──
	// Tanpa transkrip: bacakan isi slide itu sendiri.
	let narrationText = $derived(
		(modul.transkrip ?? '').trim() ||
			slides.map((s) => `${s.title}. ${s.items.map((it) => [it.text, ...it.sub].join('. ')).join('. ')}`).join('\n')
	);
	let sentences = $derived(splitNarration(narrationText));
	let slideOf = $derived(assignNarrationToSlides(sentences, slides));

	let synth: SpeechSynthesis | null = null;
	let voice = $state<SpeechSynthesisVoice | null>(null);
	let ttsTersedia = $state(false);
	let sentIdx = $state(0);
	let playing = $state(false);
	let selesaiNarasi = $state(false);
	let rate = $state(1);
	let pesanSuara = $state('');
	let token = 0; // membatalkan callback utterance/timer usang
	let timer: ReturnType<typeof setTimeout> | null = null;

	function pickVoice() {
		if (!synth) return;
		const vs = synth.getVoices();
		voice = vs.find((v) => /^id([-_]|$)/i.test(v.lang)) ?? vs.find((v) => /indones/i.test(v.name)) ?? null;
	}

	onMount(() => {
		if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
			synth = window.speechSynthesis;
			ttsTersedia = true;
			pickVoice();
			synth.addEventListener?.('voiceschanged', pickVoice);
		}
	});

	function stopEngine() {
		token++;
		if (timer) clearTimeout(timer);
		timer = null;
		synth?.cancel();
	}

	onDestroy(() => {
		stopEngine();
		synth?.removeEventListener?.('voiceschanged', pickVoice);
	});

	function advance() {
		if (sentIdx + 1 >= sentences.length) {
			playing = false;
			selesaiNarasi = true;
			return;
		}
		sentIdx += 1;
		speakCurrent();
	}

	function speakCurrent() {
		const s = sentences[sentIdx];
		if (!s) {
			playing = false;
			return;
		}
		const mine = ++token;
		if (timer) clearTimeout(timer);
		slideIdx = slideOf[sentIdx] ?? slideIdx;
		if (voice && synth) {
			synth.cancel();
			const u = new SpeechSynthesisUtterance(s);
			u.voice = voice;
			u.lang = voice.lang;
			u.rate = rate;
			u.onend = () => {
				if (mine === token && playing) advance();
			};
			u.onerror = (e) => {
				if (mine !== token) return;
				if (e.error === 'canceled' || e.error === 'interrupted') return;
				// Suara gagal diputar → jangan macet: lanjut mode otomatis tanpa audio.
				pesanSuara = 'Suara tidak dapat diputar di perangkat ini — slide berjalan otomatis tanpa audio.';
				voice = null;
				if (playing) speakCurrent();
			};
			synth.speak(u);
		} else {
			timer = setTimeout(() => {
				if (mine === token && playing) advance();
			}, estimateSpeakMs(s, rate));
		}
	}

	function play() {
		if (sentences.length === 0) return;
		if (selesaiNarasi) {
			sentIdx = 0;
			selesaiNarasi = false;
		}
		playing = true;
		speakCurrent();
	}
	function pause() {
		playing = false;
		stopEngine();
	}
	function jumpToSentence(i: number) {
		sentIdx = Math.max(0, Math.min(sentences.length - 1, i));
		selesaiNarasi = false;
		slideIdx = slideOf[sentIdx] ?? slideIdx;
		if (playing) speakCurrent();
	}
	function jumpToSlide(i: number) {
		const target = Math.max(0, Math.min(slides.length - 1, i));
		const first = slideOf.findIndex((s) => s === target);
		if (first >= 0) jumpToSentence(first);
		else gotoSlide(target);
	}
	function setRate(r: number) {
		rate = r;
		if (playing) speakCurrent(); // ulang kalimat berjalan dengan kecepatan baru
	}

	// Pindah mode: hentikan narasi supaya suara tidak berjalan di mode lain.
	function pilihMode(m: Mode) {
		if (m !== 'tonton' && playing) pause();
		mode = m;
		if (m === 'lihat' || m === 'tonton') slideIdx = Math.min(slideIdx, Math.max(0, slides.length - 1));
	}

	let progressNarasi = $derived(sentences.length ? Math.round(((sentIdx + (selesaiNarasi ? 1 : 0)) / sentences.length) * 100) : 0);
	const MODES: Array<{ id: Mode; label: string; icon: typeof IconBook; hint: string }> = [
		{ id: 'baca', label: 'Baca', icon: IconBook, hint: 'Materi lengkap tertulis' },
		{ id: 'lihat', label: 'Lihat', icon: IconPresentation, hint: 'Kartu slide ringkas — geser kiri/kanan' },
		{ id: 'tonton', label: 'Tonton', icon: IconHeadphones, hint: 'Slide jalan otomatis + suara narator' }
	];
</script>

{#snippet inline(text: string)}
	{#each inlineSegments(text) as seg}
		{#if seg.t === 'b'}<strong>{seg.v}</strong>
		{:else if seg.t === 'flag'}<span class="text-[10px] font-bold px-1.5 py-0.5 rounded align-middle" style="background: var(--aml); color: var(--amd)" title="Angka ini belum terverifikasi di dokumen sumber — cek TDS/pengawas sebelum dipakai di lapangan">{seg.v}</span>
		{:else}{seg.v}{/if}
	{/each}
{/snippet}

{#snippet slideCard()}
	{@const s = slides[slideIdx]}
	{#if s}
		<div class="rounded-2xl p-5 md:p-7 min-h-56 flex flex-col gap-3" style="background: var(--sys-fill2)">
			<div class="flex items-center justify-between gap-2">
				<h3 class="text-base md:text-lg font-extrabold" style="color: var(--sys-label)">{s.title}</h3>
				<span class="text-[11px] font-bold shrink-0" style="color: var(--sys-label4)">{slideIdx + 1} / {slides.length}</span>
			</div>
			<ul class="flex flex-col gap-2 text-sm md:text-base" style="color: var(--sys-label2)">
				{#each s.items as it}
					<li class="flex gap-2">
						<span class="mt-2 w-1.5 h-1.5 rounded-full shrink-0 gradient-bg"></span>
						<span>
							{@render inline(it.text)}
							{#if it.sub.length}
								<ol class="mt-1 ml-1 text-sm flex flex-col gap-0.5 list-decimal list-inside" style="color: var(--sys-label3)">
									{#each it.sub as sub}<li>{@render inline(sub)}</li>{/each}
								</ol>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
{/snippet}

<div class="flex flex-col gap-3">
	{#if structured}
		<div class="flex gap-2" role="tablist" aria-label="Mode belajar">
			{#each MODES as m}
				{@const Ico = m.icon}
				<button
					role="tab"
					aria-selected={mode === m.id}
					title={m.hint}
					class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs md:text-sm font-bold transition-colors"
					style={mode === m.id ? 'background: var(--p, var(--g)); color: white' : 'background: var(--sys-fill2); color: var(--sys-label3)'}
					onclick={() => pilihMode(m.id)}
				>
					<Ico size={16} /> {m.label}
				</button>
			{/each}
		</div>
		<p class="text-[11px] font-medium flex items-center gap-1.5" style="color: var(--sys-label4)">
			<IconInfoCircle size={12} /> {MODES.find((m) => m.id === mode)?.hint}. Waktu belajar tetap terhitung di mode mana pun.
		</p>
	{/if}

	{#if !structured || mode === 'baca'}
		<article class="glass-panel rounded-2xl p-5 text-sm flex flex-col gap-2.5 leading-relaxed" style="color: var(--sys-label)">
			{#each blocks as b}
				{#if b.type === 'h'}
					<h4 class="text-sm md:text-base font-extrabold mt-2" style="color: var(--sys-label)">{b.text}</h4>
				{:else if b.type === 'p'}
					<p>{@render inline(b.text)}</p>
				{:else if b.type === 'ul'}
					<ul class="flex flex-col gap-1.5">
						{#each b.items as it}
							<li class="flex gap-2">
								<span class="mt-2 w-1.5 h-1.5 rounded-full shrink-0 gradient-bg"></span>
								<span>
									{@render inline(it.text)}
									{#if it.sub.length}
										<ol class="mt-1 ml-1 flex flex-col gap-0.5 list-decimal list-inside" style="color: var(--sys-label3)">
											{#each it.sub as sub}<li>{@render inline(sub)}</li>{/each}
										</ol>
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				{:else}
					<ol class="flex flex-col gap-1 list-decimal list-inside">
						{#each b.items as it}<li>{@render inline(it.text)}</li>{/each}
					</ol>
				{/if}
			{/each}
			{#if blocks.length === 0}<p style="color: var(--sys-label4)">Belum ada konten.</p>{/if}
			{#if sourceLink}
				<a href={sourceLink} target="_blank" rel="noopener noreferrer" class="text-xs font-bold flex items-center gap-1 w-fit mt-2" style="color: var(--p, var(--g))">
					<IconExternalLink size={13} /> Buka dokumen asli
				</a>
			{/if}
		</article>
	{:else if mode === 'lihat'}
		<div role="group" aria-label="Kartu slide" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
			{@render slideCard()}
		</div>
		<div class="flex items-center justify-between gap-2">
			<button class="p-2.5 rounded-xl disabled:opacity-40" style="background: var(--sys-fill2); color: var(--sys-label3)" disabled={slideIdx === 0} onclick={() => gotoSlide(slideIdx - 1)} aria-label="Slide sebelumnya"><IconChevronLeft size={18} /></button>
			<div class="flex gap-1.5 flex-wrap justify-center">
				{#each slides as _, i}
					<button class="w-2.5 h-2.5 rounded-full transition-colors" style={i === slideIdx ? 'background: var(--p, var(--g))' : 'background: var(--sys-fill2)'} aria-label="Ke slide {i + 1}" onclick={() => gotoSlide(i)}></button>
				{/each}
			</div>
			<button class="p-2.5 rounded-xl disabled:opacity-40" style="background: var(--sys-fill2); color: var(--sys-label3)" disabled={slideIdx === slides.length - 1} onclick={() => gotoSlide(slideIdx + 1)} aria-label="Slide berikutnya"><IconChevronRight size={18} /></button>
		</div>
		{#if embedUrl}
			<button class="text-xs font-bold flex items-center gap-1.5 w-fit" style="color: var(--p, var(--g))" onclick={() => (showOriginal = !showOriginal)}>
				<IconPresentation size={14} /> {showOriginal ? 'Sembunyikan dokumen asli' : 'Lihat dokumen asli (Google)'}
			</button>
			{#if showOriginal}
				<div class="aspect-video rounded-2xl overflow-hidden glass-panel">
					<iframe src={embedUrl} title="Dokumen asli: {modul.judul}" class="w-full h-full" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer"></iframe>
				</div>
				<p class="text-[11px]" style="color: var(--sys-label4)">Dokumen asli tampil lewat Google. Bila kosong, buka lewat tautan "Buka dokumen asli" di mode Baca.</p>
			{/if}
		{/if}
	{:else}
		<div role="group" aria-label="Slide narasi" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
			{@render slideCard()}
		</div>

		<div class="rounded-xl px-4 py-3 text-sm min-h-14" style="background: var(--sys-fill2); color: var(--sys-label)" aria-live="polite">
			{#if sentences.length === 0}
				<span style="color: var(--sys-label4)">Belum ada naskah narasi untuk modul ini.</span>
			{:else if selesaiNarasi}
				<span class="font-bold">Narasi selesai.</span> <span style="color: var(--sys-label3)">Tekan ▶ untuk mengulang dari awal.</span>
			{:else}
				<span class="text-[10px] font-bold uppercase tracking-wider block mb-0.5" style="color: var(--sys-label4)">{playing ? 'Sedang dibacakan' : 'Siap diputar'}</span>
				{sentences[sentIdx]}
			{/if}
		</div>

		<div class="h-1.5 rounded-full overflow-hidden" style="background: var(--sys-fill2)"><div class="h-full gradient-bg transition-all" style="width: {progressNarasi}%"></div></div>

		<div class="flex items-center justify-between gap-3 flex-wrap">
			<div class="flex items-center gap-2">
				<button class="p-2.5 rounded-xl disabled:opacity-40" style="background: var(--sys-fill2); color: var(--sys-label3)" disabled={sentences.length === 0} onclick={() => jumpToSlide(slideIdx - 1)} aria-label="Slide sebelumnya"><IconPlayerSkipBack size={18} /></button>
				{#if playing}
					<button class="px-5 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg flex items-center gap-2" onclick={pause}><IconPlayerPause size={18} /> Jeda</button>
				{:else}
					<button class="px-5 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg flex items-center gap-2 disabled:opacity-50" disabled={sentences.length === 0} onclick={play}><IconPlayerPlay size={18} /> {selesaiNarasi ? 'Ulangi' : sentIdx > 0 ? 'Lanjut' : 'Putar'}</button>
				{/if}
				<button class="p-2.5 rounded-xl disabled:opacity-40" style="background: var(--sys-fill2); color: var(--sys-label3)" disabled={sentences.length === 0} onclick={() => jumpToSlide(slideIdx + 1)} aria-label="Slide berikutnya"><IconPlayerSkipForward size={18} /></button>
			</div>
			<div class="flex items-center gap-1" role="group" aria-label="Kecepatan narasi">
				{#each [1, 1.25, 1.5] as r}
					<button class="text-[11px] font-bold px-2.5 py-1.5 rounded-lg" style={rate === r ? 'background: var(--p, var(--g)); color: white' : 'background: var(--sys-fill2); color: var(--sys-label3)'} onclick={() => setRate(r)}>{r}x</button>
				{/each}
			</div>
		</div>

		{#if pesanSuara}
			<p class="text-xs font-semibold px-3 py-2 rounded-xl" style="background: var(--aml); color: var(--amd)">{pesanSuara}</p>
		{:else if !ttsTersedia}
			<p class="text-xs font-semibold px-3 py-2 rounded-xl" style="background: var(--aml); color: var(--amd)">Browser ini tidak mendukung suara narator — slide berjalan otomatis tanpa audio.</p>
		{:else if !voice}
			<p class="text-xs font-semibold px-3 py-2 rounded-xl" style="background: var(--aml); color: var(--amd)">Suara Bahasa Indonesia belum ada di perangkat ini — slide berjalan otomatis tanpa audio. Aktifkan lewat Pengaturan HP › Teks-ke-ucapan (Text-to-speech) › Bahasa Indonesia.</p>
		{/if}
	{/if}
</div>
