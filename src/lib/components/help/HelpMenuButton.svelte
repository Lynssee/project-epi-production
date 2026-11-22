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

  let { placement = 'bottom' }: { placement?: 'top' | 'bottom' } = $props();

  let open = $state(false);
  let containerEl: HTMLDivElement | undefined = $state();
  let videosByModulSlug: Record<string, TutorialForMe['videos'][number]> = $state({});
  let videoAktif: TutorialForMe['videos'][number] | null = $state(null);

  // Pemetaan modul ke alur bisnis lapangan
  const MODUL_TO_FLOW: Record<string, string> = {
    project: 'pelaksanaan_proyek_lapangan',
    'manpower-borongan': 'pelaksanaan_proyek_lapangan',
    qa: 'pelaksanaan_proyek_lapangan',
    maintenance: 'maintenance_wo',
    'maintenance-komponen': 'maintenance_wo',
    fleet: 'maintenance_wo',
    driver: 'maintenance_wo',
    equipment: 'maintenance_wo',
    preventive: 'maintenance_wo',
    workshop: 'maintenance_wo',
    sales: 'sales_to_inventory',
    inventory: 'sales_to_inventory',
    requisition: 'sales_to_inventory',
    procurement: 'procurement_to_pay',
    pengajuan: 'pengajuan_anggaran',
    anggaran: 'pengajuan_anggaran',
    'kasbon-terpusat': 'pengajuan_anggaran',
    production: 'produksi_cat',
    rnd: 'produksi_cat',
    rmc: 'produksi_cat',
    finance: 'penagihan_piutang_ar',
    hse: 'pelaksanaan_proyek_lapangan',
    laporan: 'pelaksanaan_proyek_lapangan'
  };

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
  let flowKonteks = $derived(modulKonteks ? MODUL_TO_FLOW[modulKonteks.id] || null : null);
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
    title="Pusat Bantuan Cepat"
    aria-label="Pusat Bantuan Cepat"
    aria-expanded={open}
    class="relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all bg-[var(--sys-fill)] hover:bg-[var(--sys-fill2)] text-[var(--sys-label2)]"
  >
    <IconHelpCircle size={16} />
  </button>

  {#if open}
    <div
      class="absolute z-50 w-72 max-w-[85vw] overflow-hidden bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800
        {placement === 'top' ? 'top-full right-0 mt-2' : 'bottom-full left-0 mb-2'}"
    >
      <div class="bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base">❓</span>
          <h3 class="text-sm font-extrabold text-slate-900 dark:text-white">Pusat Bantuan Lapangan</h3>
        </div>
        <button
          type="button"
          onclick={() => (open = false)}
          class="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Tutup"
        >
          ✕
        </button>
      </div>

      {#if modulKonteks}
        <div class="p-3 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Modul: {modulKonteks.nama}
            </span>
            {#if flowKonteks}
              <span class="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                Ada Alur
              </span>
            {/if}
          </div>

          {#if flowKonteks}
            <button
              onclick={() => go(`/panduan/alur?alur=${flowKonteks}`)}
              class="w-full text-left px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800 transition-colors flex items-center gap-2.5"
            >
              <span class="text-lg">🗺️</span>
              <div class="min-w-0 flex-1">
                <span class="block text-xs font-bold text-emerald-900 dark:text-emerald-200 truncate">Peta Alur & Buku Saku</span>
                <span class="block text-[10px] text-emerald-600 dark:text-emerald-400 truncate">Alur kerja & tanggung jawab tim</span>
              </div>
            </button>
          {/if}

          <button
            onclick={() => go(`/panduan?modul=${modulKonteks!.id}`)}
            class="w-full text-left px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 transition-colors flex items-center gap-2.5"
          >
            <IconBook2 size={16} class="text-indigo-600 dark:text-indigo-400 shrink-0" />
            <div class="min-w-0 flex-1">
              <span class="block text-xs font-bold text-indigo-900 dark:text-indigo-200 truncate">Panduan: {modulKonteks.nama}</span>
              <span class="block text-[10px] text-indigo-600 dark:text-indigo-400 truncate">Instruksi form & checklist langkah</span>
            </div>
          </button>

          {#if videoKonteks}
            <button
              onclick={bukaVideoKonteks}
              class="w-full text-left px-3 py-2 rounded-xl bg-teal-50 dark:bg-teal-950/30 hover:bg-teal-100 dark:hover:bg-teal-900/40 border border-teal-200 dark:border-teal-800 transition-colors flex items-center gap-2.5"
            >
              <IconPlayerPlay size={16} class="text-teal-600 dark:text-teal-400 shrink-0" />
              <div class="min-w-0 flex-1">
                <span class="block text-xs font-bold text-teal-900 dark:text-teal-200 truncate">{videoKonteks.judul}</span>
                <span class="block text-[10px] text-teal-600 dark:text-teal-400 truncate">Putar video tutorial</span>
              </div>
            </button>
          {/if}
        </div>
      {/if}

      <ul class="py-1.5 text-xs text-slate-700 dark:text-slate-300">
        <li>
          <button
            onclick={() => go('/panduan/alur')}
            class="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
          >
            <span>🗺️</span>
            <span class="font-medium">Semua Peta Alur Kerja & Buku Saku</span>
          </button>
        </li>
        <li>
          <button
            onclick={() => go('/bantuan?tab=sop')}
            class="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
          >
            <span>📜</span>
            <span class="font-medium">Direktori SOP Resmi & K3</span>
          </button>
        </li>
        <li>
          <button
            onclick={() => go('/bantuan?tab=tugas')}
            class="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
          >
            <span>🎯</span>
            <span class="font-medium">Checklist Tugas Saya</span>
          </button>
        </li>
        <li>
          <button
            onclick={() => go('/panduan')}
            class="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
          >
            <span>📘</span>
            <span class="font-medium">Pusat Bantuan & Panduan Lengkap</span>
          </button>
        </li>
      </ul>
    </div>
  {/if}
</div>

{#if videoAktif}
  <TutorialVideoPlayer video={videoAktif} onClose={() => (videoAktif = null)} />
{/if}
