<!-- src/lib/components/help/HelpMenuButton.svelte -->
<!-- Tombol "?" kontekstual di sidebar (mobile drawer + desktop, satu markup) —
     §7B #2 (implementation_plan_panduan + video generator.md), port dari
     erp-epi-1 HelpMenuButton.svelte. Mendeteksi modul dari path URL saat ini
     dan menonjolkan link langsung ke panduan + video modul itu di atas
     dropdown, alih-alih hanya tautan generik ke /panduan. -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { modulDokumentasi as modulDokumentasiHardcoded, type ModulPanduan } from '$lib/data/panduan';
  import { fetchTutorialForMe, type TutorialForMe } from '$lib/services/tutorialApi';
  import { fetchPanduanContent } from '$lib/services/panduanApi';
  import TutorialVideoPlayer from '$lib/components/shared/TutorialVideoPlayer.svelte';
  import IconHelpCircle from '@tabler/icons-svelte/icons/help-circle';
  import IconPlayerPlay from '@tabler/icons-svelte/icons/player-play';
  import IconBook2 from '@tabler/icons-svelte/icons/book-2';

  let open = $state(false);
  let containerEl: HTMLDivElement | undefined = $state();
  let videosByModulSlug: Record<string, TutorialForMe['videos'][number]> = $state({});
  let videoAktif: TutorialForMe['videos'][number] | null = $state(null);

  // §6 Fase 1 wiring baca (implementation_plan_panduan pertajam.md) — sama
  // pola fallback dgn panduan/+page.svelte: hardcoded dulu, ganti ke Directus
  // kalau fetch sukses & non-kosong. `resolveModulByPathname` DITULIS ULANG
  // lokal (bukan diimpor dari panduan.ts) supaya baca `modulDokumentasi` yang
  // sedang aktif.
  let modulDokumentasi = $state<ModulPanduan[]>(modulDokumentasiHardcoded);

  function resolveModulByPathname(pathname: string, modules: ModulPanduan[]): ModulPanduan | null {
    if (!pathname) return null;
    let terbaik: ModulPanduan | null = null;
    for (const m of modules) {
      if (!m.href) continue;
      if (pathname === m.href || pathname.startsWith(m.href + '/')) {
        if (!terbaik || m.href.length > terbaik.href.length) terbaik = m;
      }
    }
    return terbaik;
  }

  async function muatPanduanDariDirectus() {
    const res = await fetchPanduanContent();
    if (!res.success || !res.data?.modulDokumentasi?.length) return; // fallback: biarkan hardcoded aktif
    modulDokumentasi = res.data.modulDokumentasi;
  }

  let modulKonteks = $derived(browser ? resolveModulByPathname(page.url.pathname, modulDokumentasi) : null);
  let videoKonteks = $derived(modulKonteks ? videosByModulSlug[modulKonteks.id] : undefined);

  function toggle() {
    open = !open;
  }

  function go(href: string) {
    open = false;
    goto(href);
  }

  function bukaVideoKonteks() {
    if (!videoKonteks) return;
    open = false;
    videoAktif = videoKonteks;
  }

  async function muatVideoKonteks() {
    const res = await fetchTutorialForMe();
    if (res.success && res.data) {
      const byModul: Record<string, TutorialForMe['videos'][number]> = {};
      for (const v of res.data.videos || []) {
        if (!byModul[v.modul_slug]) byModul[v.modul_slug] = v;
      }
      videosByModulSlug = byModul;
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (open && containerEl && !containerEl.contains(event.target as Node)) {
      open = false;
    }
  }

  onMount(() => {
    if (browser) document.addEventListener('click', handleClickOutside, true);
    muatVideoKonteks();
    muatPanduanDariDirectus();
  });
  onDestroy(() => {
    if (browser) document.removeEventListener('click', handleClickOutside, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative shrink-0" bind:this={containerEl} onclick={(e) => e.stopPropagation()}>
  <button
    onclick={toggle}
    title="Pusat Bantuan"
    aria-label="Pusat Bantuan"
    aria-expanded={open}
    class="relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all bg-[var(--sys-fill)] hover:bg-[var(--sys-fill2)] text-[var(--sys-label2)]"
  >
    <IconHelpCircle size={16} />
  </button>

  {#if open}
    <div class="absolute bottom-full left-0 mb-2 w-64 max-w-[85vw] overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-100 z-50">
      <div class="sticky top-0 bg-white/95 backdrop-blur px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <span class="text-base">❓</span>
        <h3 class="text-sm font-extrabold text-slate-900">Pusat Bantuan</h3>
      </div>

      {#if modulKonteks}
        <div class="px-3 pt-3 pb-1">
          <p class="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-indigo-400">Halaman ini</p>
          <button
            onclick={() => go(`/panduan?modul=${modulKonteks!.id}`)}
            class="w-full text-left px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 transition-colors flex items-center gap-2"
          >
            <IconBook2 size={16} class="text-indigo-500 shrink-0" />
            <span class="min-w-0">
              <span class="block text-sm font-bold text-indigo-800 truncate">Panduan: {modulKonteks.nama}</span>
              <span class="block text-[11px] text-indigo-500">Langkah-langkah &amp; FAQ modul ini</span>
            </span>
          </button>
          {#if videoKonteks}
            <button
              onclick={bukaVideoKonteks}
              class="w-full text-left px-3 py-2 mt-1 rounded-xl bg-teal-50 hover:bg-teal-100 transition-colors flex items-center gap-2"
            >
              <IconPlayerPlay size={16} class="text-teal-600 shrink-0" />
              <span class="min-w-0">
                <span class="block text-sm font-bold text-teal-800 truncate">{videoKonteks.judul}</span>
                <span class="block text-[11px] text-teal-500">Video panduan modul ini</span>
              </span>
            </button>
          {/if}
        </div>
      {/if}

      <ul class="py-1.5">
        <li>
          <button onclick={() => go('/bantuan')} class="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
            🏠 Untuk Anda (Onboarding)
          </button>
        </li>
        <li>
          <button onclick={() => go('/panduan')} class="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
            📘 Semua Panduan
          </button>
        </li>
      </ul>
    </div>
  {/if}
</div>

{#if videoAktif}
  <TutorialVideoPlayer video={videoAktif} onClose={() => (videoAktif = null)} />
{/if}
