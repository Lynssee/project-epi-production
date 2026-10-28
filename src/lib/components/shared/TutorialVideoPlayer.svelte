<!-- src/lib/components/shared/TutorialVideoPlayer.svelte -->
<!-- Modal pemutar video tutorial (YouTube unlisted / self-hosted) untuk
     lapangan — hemat data: tampilkan thumbnail dulu, putar hanya saat
     disentuh (L3, implementation_plan_tutorial aplikasi per role.md). Lacak
     % tonton, "Tandai Selesai" terkunci sampai ambang tercapai. Port dari
     erp-epi-1 (components/help/TutorialVideoPlayer.svelte) ke Svelte 5 runes. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { recordTutorialProgress } from '$lib/services/tutorialApi';

  interface VideoRow {
    id: number;
    judul: string;
    deskripsi?: string;
    modul_slug: string;
    video_type: 'youtube' | 'self-hosted' | 'none';
    video_url: string;
  }

  let { video, onClose = () => {} }: { video: VideoRow; onClose?: () => void } = $props();

  const SELESAI_THRESHOLD = 90;
  let persen = $state(0);
  let selesai = $derived(persen >= SELESAI_THRESHOLD);
  let started = $state(false); // hemat data: putar hanya setelah disentuh
  let playerEl: HTMLDivElement | undefined = $state();
  let ytPlayer: any = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastReported = -1;

  function extractYoutubeId(url: string): string | null {
    const m = String(url || '').match(/(?:v=|youtu\.be\/|embed\/)([\w-]+)/);
    return m ? m[1] : null;
  }

  function youtubeThumb(url: string): string | null {
    const id = extractYoutubeId(url);
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
  }

  function loadYoutubeApi(): Promise<any> {
    return new Promise((resolve) => {
      // @ts-expect-error - global YT dimuat dari script eksternal
      if (window.YT && window.YT.Player) return resolve(window.YT);
      if (!document.getElementById('youtube-iframe-api')) {
        const tag = document.createElement('script');
        tag.id = 'youtube-iframe-api';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      // @ts-expect-error - callback global wajib dari YouTube IFrame API
      const prevReady = window.onYouTubeIframeAPIReady;
      // @ts-expect-error - callback global wajib dari YouTube IFrame API
      window.onYouTubeIframeAPIReady = () => {
        if (prevReady) prevReady();
        // @ts-expect-error
        resolve(window.YT);
      };
    });
  }

  function report(newPersen: number, force = false) {
    persen = Math.max(persen, Math.round(newPersen));
    const bucket = Math.floor(persen / 10);
    if (!force && bucket === lastReported) return;
    lastReported = bucket;
    recordTutorialProgress({
      tutorialRef: video.modul_slug || String(video.id),
      jenis: 'video',
      persen,
      status: persen >= SELESAI_THRESHOLD ? 'selesai' : persen > 0 ? 'proses' : 'belum'
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (!ytPlayer || typeof ytPlayer.getDuration !== 'function') return;
      const duration = ytPlayer.getDuration();
      const current = ytPlayer.getCurrentTime();
      if (duration > 0) report((current / duration) * 100);
    }, 3000);
  }

  async function playVideo() {
    started = true;
    if (video.video_type !== 'youtube') return;
    const YT = await loadYoutubeApi();
    const videoId = extractYoutubeId(video.video_url);
    if (!videoId || !playerEl) return;
    ytPlayer = new YT.Player(playerEl, {
      videoId,
      playerVars: { autoplay: 1 },
      events: {
        onStateChange: (e: any) => {
          if (e.data === YT.PlayerState.PLAYING) startPolling();
          if (e.data === YT.PlayerState.ENDED) report(100, true);
        }
      }
    });
  }

  function markSelesai() {
    if (!selesai) return;
    report(100, true);
  }

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (ytPlayer?.destroy) ytPlayer.destroy();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
  <div class="bg-white rounded-2xl w-full max-w-lg p-4 space-y-3">
    <div class="flex justify-between items-start gap-3">
      <div>
        <h3 class="text-sm font-bold text-gray-800">{video.judul}</h3>
        {#if video.deskripsi}<p class="text-xs text-gray-500 mt-0.5">{video.deskripsi}</p>{/if}
      </div>
      <button onclick={onClose} class="text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0 p-1" aria-label="Tutup">✕</button>
    </div>

    {#if video.video_type === 'none' || !video.video_url}
      <div class="p-6 text-center text-sm text-gray-400 bg-gray-50 rounded-lg">Video belum tersedia untuk modul ini.</div>
    {:else if !started}
      <!-- Hemat data: thumbnail dulu, putar on-demand -->
      <button onclick={playVideo} class="relative block w-full aspect-video bg-black rounded-lg overflow-hidden">
        {#if video.video_type === 'youtube' && youtubeThumb(video.video_url)}
          <img src={youtubeThumb(video.video_url)} alt={video.judul} class="w-full h-full object-cover opacity-80" />
        {/if}
        <span class="absolute inset-0 flex items-center justify-center">
          <span class="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center text-2xl">▶</span>
        </span>
      </button>
    {:else if video.video_type === 'youtube'}
      <div class="aspect-video bg-black rounded-lg overflow-hidden">
        <div bind:this={playerEl} class="w-full h-full"></div>
      </div>
    {:else if video.video_type === 'self-hosted'}
      <div class="aspect-video bg-black rounded-lg overflow-hidden">
        <video
          src={video.video_url}
          controls
          autoplay
          class="w-full h-full"
          ontimeupdate={(e) => {
            const el = e.currentTarget;
            if (el.duration > 0) report((el.currentTime / el.duration) * 100);
          }}
          onended={() => report(100, true)}
        >
          <track kind="captions" />
        </video>
      </div>
    {/if}

    {#if started}
      <div class="flex items-center justify-between gap-3">
        <div class="flex-1">
          <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-[var(--p)] transition-all" style="width: {persen}%"></div>
          </div>
          <p class="text-[11px] text-gray-400 mt-1">{persen}% ditonton{selesai ? '' : ` (min ${SELESAI_THRESHOLD}%)`}</p>
        </div>
        <button
          onclick={markSelesai}
          disabled={!selesai}
          class="px-4 py-2.5 text-xs font-bold text-white bg-[var(--p)] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          ✅ Selesai
        </button>
      </div>
    {/if}
  </div>
</div>
