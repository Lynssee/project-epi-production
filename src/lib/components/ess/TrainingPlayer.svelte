<script lang="ts">
	// Pemutar modul E-Learning lapangan: video YouTube anti-skip (IFrame API) + PDF/Teks/Link.
	// F2 Roadmap E-Learning: lacak segmen ditonton, cegah lompat maju untuk kursus wajib,
	// kunci "Tandai Selesai" sampai persen_ditonton >= min_persen_tonton modul.
	import { onDestroy, onMount } from 'svelte';
	import {
		saveModuleProgress,
		getModuleNotes,
		createModuleNote,
		deleteModuleNote,
		getModuleDiscussion,
		postModuleDiscussion,
		reportModuleDiscussion,
		type TrainingModuleRecord,
		type TrainingProgressRecord,
		type TrainingNoteRecord,
		type TrainingDiskusiRecord
	} from '$lib/services/ess/training';
	import { formatCountdown, isReadTimeType, remainingReadSeconds } from '$lib/utils/trainingGuards';
	import { IconCircleCheck, IconLock, IconPlayerPlay, IconArrowRight, IconNotes, IconFileText, IconInfoCircle, IconTrash, IconPencilPlus, IconMessageCircle, IconFlag, IconPin } from '@tabler/icons-svelte';

	let {
		modul,
		progress,
		minBacaDetik = 0,
		wajib,
		onSelesai,
		onNextModule = null,
		hasNextModule = false
	}: {
		modul: TrainingModuleRecord;
		progress: TrainingProgressRecord | null;
		/** Waktu baca minimum modul Teks (detik, dari server). 0 = langsung boleh ditandai selesai. */
		minBacaDetik?: number;
		wajib: boolean;
		onSelesai: () => void;
		onNextModule?: (() => void) | null;
		hasNextModule?: boolean;
	} = $props();

	let activeTab = $state<'ikhtisar' | 'catatan' | 'diskusi' | 'transkrip'>('ikhtisar');
	let notes = $state<TrainingNoteRecord[]>([]);
	let notingAt = $state<number | null>(null);
	let noteText = $state('');
	let savingNote = $state(false);
	let playbackRate = $state(1);

	let diskusi = $state<TrainingDiskusiRecord[]>([]);
	let pesanBaru = $state('');
	let balasKe = $state<number | null>(null);
	let balasanText = $state('');
	let postingDiskusi = $state(false);
	let dilaporkanIds = $state<Set<number>>(new Set());

	function loadNotes() {
		getModuleNotes(modul.id)
			.then((res) => (notes = res.notes))
			.catch(() => {});
	}

	function loadDiskusi() {
		getModuleDiscussion(modul.id)
			.then((res) => (diskusi = res.diskusi))
			.catch(() => {});
	}

	let diskusiUtama = $derived(diskusi.filter((d) => d.parent_id == null));
	function balasanUntuk(parentId: number): TrainingDiskusiRecord[] {
		return diskusi.filter((d) => d.parent_id === parentId);
	}

	async function kirimDiskusi() {
		if (!pesanBaru.trim()) return;
		postingDiskusi = true;
		try {
			const res = await postModuleDiscussion(modul.id, pesanBaru.trim(), null);
			diskusi = res.diskusi;
			pesanBaru = '';
		} catch {
			/* gagal kirim — biarkan pengguna coba lagi */
		} finally {
			postingDiskusi = false;
		}
	}

	async function kirimBalasan(parentId: number) {
		if (!balasanText.trim()) return;
		postingDiskusi = true;
		try {
			const res = await postModuleDiscussion(modul.id, balasanText.trim(), parentId);
			diskusi = res.diskusi;
			balasanText = '';
			balasKe = null;
		} catch {
			/* noop */
		} finally {
			postingDiskusi = false;
		}
	}

	async function laporkanDiskusi(id: number) {
		try {
			await reportModuleDiscussion(id);
			dilaporkanIds = new Set([...dilaporkanIds, id]);
		} catch {
			/* noop */
		}
	}

	function formatWaktuDiskusi(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	}

	let containerId = `yt-player-${modul.id}`;
	let ambang = $derived(modul.min_persen_tonton ?? 90);
	let persenTonton = $state(progress?.persen_ditonton ?? 0);
	let selesai = $state(progress?.status === 'Selesai');
	let apiGagal = $state(false);
	let apiSiap = $state(false);
	let saving = $state(false);

	// Modul Teks: waktu baca minimum. bacaDetik = akumulasi lintas sesi (dari progres tersimpan) + sesi ini;
	// hanya bertambah saat tab terlihat. Server menegakkan aturan yang sama di POST /progress.
	// Berlaku untuk Teks/PDF/Link, dan Video bila pemutar tak terlacak (apiGagal / non-YouTube → tombol manual).
	let modeBaca = $derived(isReadTimeType(modul.tipe_konten) || (modul.tipe_konten === 'Video' && (apiGagal || !isYoutube(modul.konten_url))));
	let bacaDetik = $state(progress?.detik_ditonton ?? 0);
	let sisaBaca = $derived(modeBaca && !selesai ? remainingReadSeconds(minBacaDetik, bacaDetik) : 0);
	let katalogAksi = $derived(modul.tipe_konten === 'Video' ? 'Tonton video' : modul.tipe_konten === 'Link' ? 'Pelajari materi di tautan' : 'Baca materi');
	let pesanSelesai = $state('');
	let bacaTimer: ReturnType<typeof setInterval> | null = null;

	// Set detik unik yang sudah ditonton (index = detik). Dipakai hitung % & cegah lompat.
	let watchedSeconds = new Set<number>();
	let furthestWatched = 0;
	let durasiVideo: number | null = progress?.durasi_video ?? (modul.durasi_menit ? modul.durasi_menit * 60 : null);
	let lastSampleTime = 0;
	let player: any = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let saveTimer: ReturnType<typeof setInterval> | null = null;

	function extractYoutubeId(url: string | null): string | null {
		if (!url) return null;
		const match = url.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{6,})/);
		return match ? match[1] : null;
	}

	function expandRangesToSet(ranges: number[][] | null): Set<number> {
		const set = new Set<number>();
		if (!ranges) return set;
		for (const [start, end] of ranges) {
			for (let s = Math.floor(start); s <= Math.ceil(end); s++) set.add(s);
		}
		return set;
	}

	function collapseSetToRanges(set: Set<number>): number[][] {
		const sorted = Array.from(set).sort((a, b) => a - b);
		const ranges: number[][] = [];
		for (const sec of sorted) {
			const last = ranges[ranges.length - 1];
			if (last && sec <= last[1] + 1) {
				last[1] = sec;
			} else {
				ranges.push([sec, sec]);
			}
		}
		return ranges;
	}

	function recomputePersen() {
		if (!durasiVideo || durasiVideo <= 0) return;
		persenTonton = Math.min(100, Math.round((watchedSeconds.size / durasiVideo) * 100));
	}

	async function persist(finalCall = false, tampilkanError = false) {
		if (saving && !finalCall) return;
		saving = true;
		try {
			const result = await saveModuleProgress({
				moduleId: modul.id,
				persenDitonton: persenTonton,
				detikDitonton: modeBaca ? bacaDetik : watchedSeconds.size,
				durasiVideo: modeBaca && modul.tipe_konten !== 'Video' ? null : durasiVideo,
				manual: modeBaca && modul.tipe_konten === 'Video',
				segmenDitonton: collapseSetToRanges(watchedSeconds),
				lastPosition: lastSampleTime
			});
			if (result.progress.status === 'Selesai' && !selesai) {
				selesai = true;
				onSelesai();
			}
		} catch (err: any) {
			// Simpan latar (throttled) tak fatal & dicoba lagi; hanya aksi "Tandai Selesai" menampilkan pesan.
			if (tampilkanError) pesanSelesai = err?.message || 'Gagal menyimpan progres. Coba lagi.';
		} finally {
			saving = false;
		}
	}

	function isYoutube(url: string | null) {
		return /youtube\.com|youtu\.be/.test(url || '');
	}

	function loadYoutubeApiScript(): Promise<void> {
		return new Promise((resolve, reject) => {
			if ((window as any).YT?.Player) return resolve();
			const timeout = setTimeout(() => reject(new Error('timeout')), 6000);
			(window as any).onYouTubeIframeAPIReady = () => {
				clearTimeout(timeout);
				resolve();
			};
			if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
				const tag = document.createElement('script');
				tag.src = 'https://www.youtube.com/iframe_api';
				tag.onerror = () => {
					clearTimeout(timeout);
					reject(new Error('load-failed'));
				};
				document.body.appendChild(tag);
			}
		});
	}

	function onPlayerStateChange(event: any) {
		const YT = (window as any).YT;
		if (event.data === YT.PlayerState.PLAYING) {
			startPolling();
		} else if (event.data === YT.PlayerState.PAUSED) {
			stopPolling();
			persist();
		} else if (event.data === YT.PlayerState.ENDED) {
			stopPolling();
			// Tandai seluruh durasi tertonton saat video selesai natural.
			if (durasiVideo) for (let s = 0; s <= durasiVideo; s++) watchedSeconds.add(s);
			recomputePersen();
			persist(true);
		}
	}

	function startPolling() {
		stopPolling();
		pollTimer = setInterval(() => {
			if (!player?.getCurrentTime) return;
			const current = Math.floor(player.getCurrentTime());
			const delta = current - lastSampleTime;

			// Cegah lompat maju untuk kursus wajib: delta wajar adalah playback normal (~1 dtk/tick).
			if (wajib && delta > 3 && lastSampleTime > 0) {
				player.seekTo(Math.max(furthestWatched, 0), true);
				lastSampleTime = furthestWatched;
				return;
			}

			for (let s = Math.max(0, lastSampleTime); s <= current; s++) watchedSeconds.add(s);
			lastSampleTime = current;
			furthestWatched = Math.max(furthestWatched, current);
			if (!durasiVideo && player.getDuration) durasiVideo = Math.round(player.getDuration());
			recomputePersen();
		}, 1000);

		saveTimer = setInterval(() => persist(), 5000);
	}

	function stopPolling() {
		if (pollTimer) clearInterval(pollTimer);
		if (saveTimer) clearInterval(saveTimer);
		pollTimer = null;
		saveTimer = null;
	}

	function handleBeforeUnload() {
		persist(true);
	}

	function seekTo(detik: number) {
		if (wajib && detik > furthestWatched + 1) return; // anti-skip: tak bisa lompat ke bagian belum ditonton
		if (player?.seekTo) {
			player.seekTo(detik, true);
			lastSampleTime = detik;
		}
	}

	function ubahKecepatan(rate: number) {
		if (wajib) return;
		playbackRate = rate;
		player?.setPlaybackRate?.(rate);
	}

	function catatDiSini() {
		if (player?.pauseVideo) player.pauseVideo();
		notingAt = player?.getCurrentTime ? Math.floor(player.getCurrentTime()) : 0;
		noteText = '';
		activeTab = 'catatan';
	}

	async function simpanCatatan() {
		if (!noteText.trim()) return;
		savingNote = true;
		try {
			await createModuleNote(modul.id, notingAt, noteText.trim());
			noteText = '';
			notingAt = null;
			loadNotes();
		} catch {
			/* gagal simpan catatan — biarkan pengguna coba lagi */
		} finally {
			savingNote = false;
		}
	}

	async function hapusCatatan(id: number) {
		try {
			await deleteModuleNote(id);
			notes = notes.filter((n) => n.id !== id);
		} catch {
			/* noop */
		}
	}

	function formatDetik(detik: number | null): string {
		if (detik == null) return '';
		const m = Math.floor(detik / 60);
		const s = detik % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	onMount(() => {
		loadNotes();
		loadDiskusi();
		watchedSeconds = expandRangesToSet(progress?.segmen_ditonton ?? null);
		furthestWatched = progress?.last_position ? Number(progress.last_position) : 0;
		recomputePersen();

		if (modul.tipe_konten === 'Video' && isYoutube(modul.konten_url)) {
			const videoId = modul.youtube_id || extractYoutubeId(modul.konten_url);
			if (videoId) {
				loadYoutubeApiScript()
					.then(() => {
						apiSiap = true;
						player = new (window as any).YT.Player(containerId, {
							videoId,
							playerVars: { enablejsapi: 1, modestbranding: 1, rel: 0 },
							events: {
								onReady: (e: any) => {
									durasiVideo = durasiVideo || Math.round(e.target.getDuration());
									if (furthestWatched > 0) e.target.seekTo(furthestWatched, true);
								},
								onStateChange: onPlayerStateChange
							}
						});
					})
					.catch(() => {
						apiGagal = true;
					});
			} else {
				apiGagal = true;
			}
		}

		if (!selesai) {
			// Link dibuka di tab lain → tetap dihitung saat halaman ini tersembunyi; lainnya hanya saat terlihat.
			const hitungSaatTersembunyi = modul.tipe_konten === 'Link';
			bacaTimer = setInterval(() => {
				if (hitungSaatTersembunyi || document.visibilityState === 'visible') bacaDetik += 1;
			}, 1000);
		}

		window.addEventListener('beforeunload', handleBeforeUnload);
	});

	onDestroy(() => {
		stopPolling();
		if (bacaTimer) clearInterval(bacaTimer);
		window.removeEventListener('beforeunload', handleBeforeUnload);
		persist(true);
		try {
			player?.destroy?.();
		} catch {
			/* noop */
		}
	});

	function toYoutubeEmbed(url: string | null): string {
		const id = extractYoutubeId(url);
		return id ? `https://www.youtube.com/embed/${id}` : url || '';
	}

	async function markManualComplete() {
		if (sisaBaca > 0) return; // tombol sudah dinonaktifkan; jaga-jaga untuk pemanggilan lain
		pesanSelesai = '';
		const persenSebelum = persenTonton;
		persenTonton = 100;
		if (modul.tipe_konten === 'Video' && durasiVideo) for (let s = 0; s <= durasiVideo; s++) watchedSeconds.add(s);
		await persist(true, true);
		if (!selesai) persenTonton = persenSebelum; // ditolak server → jangan kirim 100% lagi saat keluar halaman
		else if (bacaTimer) {
			clearInterval(bacaTimer);
			bacaTimer = null;
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if modul.tipe_konten === 'Video'}
		{#if isYoutube(modul.konten_url) && !apiGagal}
			<div class="aspect-video rounded-2xl overflow-hidden glass-panel">
				<div id={containerId} class="w-full h-full"></div>
			</div>
			<div class="flex items-center gap-3">
				<div class="flex-1 h-2.5 rounded-full bg-white/40 overflow-hidden">
					<div class="h-full rounded-full gradient-bg transition-all" style="width: {persenTonton}%"></div>
				</div>
				<span class="text-xs font-bold shrink-0" style="color: var(--sys-label3)">{persenTonton}% / {ambang}%</span>
			</div>
			{#if !apiSiap}
				<p class="text-xs font-medium" style="color: var(--sys-label4)">Memuat pemutar video...</p>
			{/if}

			<div class="flex items-center justify-between gap-3 flex-wrap">
				{#if modul.chapters && modul.chapters.length > 0}
					<div class="flex items-center gap-1.5 flex-wrap">
						{#each modul.chapters as ch}
							<button
								class="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40"
								style="background: var(--sys-fill2); color: var(--sys-label3)"
								disabled={wajib && ch.detik > furthestWatched + 1}
								onclick={() => seekTo(ch.detik)}
							>
								{formatDetik(ch.detik)} · {ch.judul}
							</button>
						{/each}
					</div>
				{/if}
				<div class="flex items-center gap-1.5 ml-auto">
					<span class="text-[11px] font-semibold" style="color: var(--sys-label4)">Kecepatan</span>
					{#if wajib}
						<span class="text-[11px] font-bold px-2 py-1 rounded-lg flex items-center gap-1" style="background: var(--sys-fill2); color: var(--sys-label4)">
							<IconLock size={11} /> 1x
						</span>
					{:else}
						{#each [0.75, 1, 1.25, 1.5, 2] as rate}
							<button
								class="text-[11px] font-bold px-2 py-1 rounded-lg transition-colors"
								style={playbackRate === rate ? 'background: var(--p, var(--g)); color: white' : 'background: var(--sys-fill2); color: var(--sys-label3)'}
								onclick={() => ubahKecepatan(rate)}
							>
								{rate}x
							</button>
						{/each}
					{/if}
				</div>
			</div>

			{#if !selesai && (apiSiap || apiGagal)}
				<button
					class="flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl w-fit hover-lift"
					style="background: var(--sys-fill2); color: var(--sys-label3)"
					onclick={catatDiSini}
				>
					<IconPencilPlus size={14} /> Catat di Waktu Ini
				</button>
			{/if}
		{:else}
			<div class="aspect-video rounded-2xl overflow-hidden glass-panel">
				<iframe src={toYoutubeEmbed(modul.konten_url)} title={modul.judul} class="w-full h-full" allowfullscreen></iframe>
			</div>
			<p class="text-xs font-semibold px-3 py-2 rounded-xl" style="background: var(--aml); color: var(--amd)">
				Pelacakan tonton otomatis tidak tersedia (jaringan/perangkat) — progres ditandai tidak-terverifikasi.
			</p>
		{/if}
	{:else if modul.tipe_konten === 'PDF'}
		<iframe src={modul.konten_url || ''} title={modul.judul} class="w-full h-96 rounded-2xl glass-panel"></iframe>
	{:else if modul.tipe_konten === 'Teks'}
		<div class="glass-panel rounded-2xl p-5 whitespace-pre-wrap text-sm" style="color: var(--sys-label)">{modul.konten_teks}</div>
	{:else if modul.tipe_konten === 'Link'}
		<a
			href={modul.konten_url || '#'}
			target="_blank"
			rel="noopener noreferrer"
			class="glass-panel hover-lift rounded-2xl p-5 flex items-center gap-3 font-bold"
			style="color: var(--sys-label)"
		>
			<IconPlayerPlay size={20} /> Buka Tautan Materi
		</a>
	{/if}

	<div class="flex items-center justify-between gap-3 flex-wrap">
		<div>
			{#if selesai}
				<span class="flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl" style="background: var(--gg); color: var(--ggd)">
					<IconCircleCheck size={18} /> Modul Selesai
				</span>
			{:else if modul.tipe_konten === 'Video' && isYoutube(modul.konten_url) && !apiGagal}
				<span class="flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl opacity-60" style="background: var(--sys-fill2); color: var(--sys-label3)">
					<IconLock size={18} /> Tonton hingga {ambang}% untuk membuka
				</span>
			{:else}
				<button
					class="px-5 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={sisaBaca > 0}
					onclick={markManualComplete}
				>
					{sisaBaca > 0 ? `Tandai Selesai (${formatCountdown(sisaBaca)})` : 'Tandai Selesai'}
				</button>
				{#if sisaBaca > 0}
					<p class="mt-2 text-xs font-medium flex items-center gap-1.5" style="color: var(--sys-label4)">
						<IconInfoCircle size={13} /> {katalogAksi} dulu — tombol aktif dalam {formatCountdown(sisaBaca)}. {modul.tipe_konten === 'Link' ? 'Waktu terus berjalan selama halaman ini terbuka.' : 'Waktu hanya berjalan saat halaman terbuka.'}
					</p>
				{/if}
				{#if pesanSelesai}
					<p class="mt-2 text-xs font-semibold text-red-500">{pesanSelesai}</p>
				{/if}
			{/if}
		</div>
		{#if selesai && hasNextModule && onNextModule}
			<button
				class="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg"
				onclick={onNextModule}
			>
				Modul Berikutnya <IconArrowRight size={16} />
			</button>
		{/if}
	</div>

	<div class="glass-panel rounded-2xl overflow-hidden">
		<div class="flex border-b" style="border-color: var(--sys-sep)">
			<button
				class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold transition-colors"
				style={activeTab === 'ikhtisar' ? 'background: var(--sys-fill2); color: var(--sys-label)' : 'color: var(--sys-label4)'}
				onclick={() => (activeTab = 'ikhtisar')}
			>
				<IconInfoCircle size={14} /> Ikhtisar
			</button>
			<button
				class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold transition-colors"
				style={activeTab === 'catatan' ? 'background: var(--sys-fill2); color: var(--sys-label)' : 'color: var(--sys-label4)'}
				onclick={() => (activeTab = 'catatan')}
			>
				<IconNotes size={14} /> Catatan Saya {#if notes.length > 0}({notes.length}){/if}
			</button>
			<button
				class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold transition-colors"
				style={activeTab === 'diskusi' ? 'background: var(--sys-fill2); color: var(--sys-label)' : 'color: var(--sys-label4)'}
				onclick={() => (activeTab = 'diskusi')}
			>
				<IconMessageCircle size={14} /> Diskusi {#if diskusiUtama.length > 0}({diskusiUtama.length}){/if}
			</button>
			{#if modul.transkrip}
				<button
					class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold transition-colors"
					style={activeTab === 'transkrip' ? 'background: var(--sys-fill2); color: var(--sys-label)' : 'color: var(--sys-label4)'}
					onclick={() => (activeTab = 'transkrip')}
				>
					<IconFileText size={14} /> Transkrip
				</button>
			{/if}
		</div>

		<div class="p-4">
			{#if activeTab === 'ikhtisar'}
				<p class="text-sm" style="color: var(--sys-label3)">
					{modul.durasi_menit ? `Durasi sekitar ${modul.durasi_menit} menit.` : ''}
					{modul.chapters && modul.chapters.length > 0 ? ` Terdiri dari ${modul.chapters.length} bagian — klik penanda bab di atas video untuk melompat.` : ''}
				</p>
			{:else if activeTab === 'catatan'}
				<div class="flex flex-col gap-3">
					{#if notingAt !== null}
						<div class="flex flex-col gap-2">
							<p class="text-xs font-bold" style="color: var(--sys-label3)">Catatan di {formatDetik(notingAt)}</p>
							<textarea
								bind:value={noteText}
								rows="2"
								class="w-full px-3 py-2 text-sm rounded-xl glass-panel"
								placeholder="Tulis catatan Anda..."
							></textarea>
							<div class="flex gap-2">
								<button
									class="px-4 py-2 rounded-xl text-xs font-bold text-white gradient-bg disabled:opacity-50"
									disabled={savingNote || !noteText.trim()}
									onclick={simpanCatatan}
								>
									{savingNote ? 'Menyimpan...' : 'Simpan Catatan'}
								</button>
								<button class="px-4 py-2 rounded-xl text-xs font-bold" style="color: var(--sys-label3)" onclick={() => (notingAt = null)}>
									Batal
								</button>
							</div>
						</div>
					{:else}
						<button
							class="flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl w-fit hover-lift"
							style="background: var(--sys-fill2); color: var(--sys-label3)"
							onclick={catatDiSini}
						>
							<IconPencilPlus size={14} /> Tambah Catatan
						</button>
					{/if}

					{#if notes.length === 0}
						<p class="text-xs font-medium" style="color: var(--sys-label4)">Belum ada catatan pada modul ini.</p>
					{:else}
						<div class="flex flex-col gap-2">
							{#each notes as n (n.id)}
								<div class="flex items-start gap-2 p-2.5 rounded-xl" style="background: var(--sys-fill2)">
									<button
										class="text-xs font-bold shrink-0 px-2 py-0.5 rounded-lg"
										style="background: var(--p, var(--g)); color: white"
										onclick={() => n.detik != null && seekTo(n.detik)}
									>
										{formatDetik(n.detik)}
									</button>
									<p class="text-sm flex-1" style="color: var(--sys-label)">{n.catatan}</p>
									<button onclick={() => hapusCatatan(n.id)} style="color: var(--sys-label4)">
										<IconTrash size={14} />
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{:else if activeTab === 'diskusi'}
				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-2">
						<textarea
							bind:value={pesanBaru}
							rows="2"
							class="w-full px-3 py-2 text-sm rounded-xl glass-panel"
							placeholder="Tanya atau bagikan pemahaman Anda tentang modul ini..."
						></textarea>
						<button
							class="px-4 py-2 rounded-xl text-xs font-bold text-white gradient-bg disabled:opacity-50 w-fit"
							disabled={postingDiskusi || !pesanBaru.trim()}
							onclick={kirimDiskusi}
						>
							{postingDiskusi ? 'Mengirim...' : 'Kirim'}
						</button>
					</div>

					{#if diskusiUtama.length === 0}
						<p class="text-xs font-medium" style="color: var(--sys-label4)">Belum ada diskusi pada modul ini. Jadilah yang pertama bertanya.</p>
					{:else}
						<div class="flex flex-col gap-3">
							{#each diskusiUtama as d (d.id)}
								<div class="p-3 rounded-xl" style="background: var(--sys-fill2)">
									<div class="flex items-center gap-2 mb-1">
										{#if d.pinned}<IconPin size={12} style="color: var(--p, var(--g))" />{/if}
										<span class="text-xs font-bold" style="color: var(--sys-label)">{d.karyawan_nama}</span>
										<span class="text-[11px]" style="color: var(--sys-label4)">{formatWaktuDiskusi(d.date_created)}</span>
									</div>
									<p class="text-sm" style="color: var(--sys-label)">{d.pesan}</p>
									<div class="flex items-center gap-3 mt-1.5">
										<button class="text-[11px] font-bold" style="color: var(--sys-label4)" onclick={() => (balasKe = balasKe === d.id ? null : d.id)}>
											Balas
										</button>
										{#if dilaporkanIds.has(d.id) || d.dilaporkan}
											<span class="text-[11px] font-semibold flex items-center gap-1" style="color: var(--sys-label4)">
												<IconFlag size={11} /> Dilaporkan
											</span>
										{:else}
											<button class="text-[11px] font-bold flex items-center gap-1" style="color: var(--sys-label4)" onclick={() => laporkanDiskusi(d.id)}>
												<IconFlag size={11} /> Lapor
											</button>
										{/if}
									</div>

									{#if balasKe === d.id}
										<div class="flex flex-col gap-2 mt-2 pl-3 border-l-2" style="border-color: var(--sys-sep)">
											<textarea bind:value={balasanText} rows="2" class="w-full px-3 py-2 text-sm rounded-xl glass-panel" placeholder="Tulis balasan..."></textarea>
											<div class="flex gap-2">
												<button
													class="px-3 py-1.5 rounded-xl text-xs font-bold text-white gradient-bg disabled:opacity-50"
													disabled={postingDiskusi || !balasanText.trim()}
													onclick={() => kirimBalasan(d.id)}
												>
													Kirim Balasan
												</button>
												<button class="px-3 py-1.5 rounded-xl text-xs font-bold" style="color: var(--sys-label3)" onclick={() => (balasKe = null)}>
													Batal
												</button>
											</div>
										</div>
									{/if}

									{#each balasanUntuk(d.id) as r (r.id)}
										<div class="flex flex-col gap-1 mt-2 pl-3 border-l-2" style="border-color: var(--sys-sep)">
											<div class="flex items-center gap-2">
												<span class="text-xs font-bold" style="color: var(--sys-label)">{r.karyawan_nama}</span>
												<span class="text-[11px]" style="color: var(--sys-label4)">{formatWaktuDiskusi(r.date_created)}</span>
											</div>
											<p class="text-sm" style="color: var(--sys-label)">{r.pesan}</p>
											{#if !(dilaporkanIds.has(r.id) || r.dilaporkan)}
												<button class="text-[11px] font-bold flex items-center gap-1 w-fit" style="color: var(--sys-label4)" onclick={() => laporkanDiskusi(r.id)}>
													<IconFlag size={11} /> Lapor
												</button>
											{:else}
												<span class="text-[11px] font-semibold flex items-center gap-1" style="color: var(--sys-label4)">
													<IconFlag size={11} /> Dilaporkan
												</span>
											{/if}
										</div>
									{/each}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{:else if activeTab === 'transkrip'}
				<div class="text-sm whitespace-pre-wrap" style="color: var(--sys-label3)">{modul.transkrip}</div>
			{/if}
		</div>
	</div>
</div>
