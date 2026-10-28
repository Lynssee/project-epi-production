<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import {
    modulDokumentasi as modulDokumentasiHardcoded,
    kategoriModul as kategoriModulHardcoded,
    type ModulPanduan
  } from '$lib/data/panduan';
  import { sendPanduanFeedback, recordTutorialProgress } from '$lib/services/tutorialApi';
  import { fetchPanduanContent, fetchPanduanBookmarks, addPanduanBookmark, removePanduanBookmark } from '$lib/services/panduanApi';
  import { sanitizeRichHtml, resolveRichImages } from '$lib/utils/richContent';
  import PanduanBlocks from '$lib/components/help/PanduanBlocks.svelte';

  // §6 Fase 1 wiring baca (implementation_plan_panduan pertajam.md): coba
  // Directus dulu (diisi editor §6 Fase 2 di erp-epi-1), fallback ke
  // panduan.ts hardcoded kalau gagal/kosong — pola fallback WAJIB.
  // getModulById/searchModul diimplementasikan ulang di bawah (bukan
  // diimpor) supaya membaca sumber yang sedang aktif ($state reaktif),
  // bukan closure lama ke array hardcoded panduan.ts.
  let modulDokumentasi = $state<ModulPanduan[]>(modulDokumentasiHardcoded);
  let kategoriModul = $state<{ id: string; label: string; emoji: string }[]>(kategoriModulHardcoded);

  function getModulById(id: string): ModulPanduan | undefined {
    return modulDokumentasi.find((m) => m.id === id);
  }

  function searchModul(kw: string): ModulPanduan[] {
    if (!kw) return [];
    const lowerKw = kw.toLowerCase();
    return modulDokumentasi.filter(
      (m) =>
        m.nama.toLowerCase().includes(lowerKw) ||
        m.deskripsi.toLowerCase().includes(lowerKw) ||
        m.langkah.some((l) => l.judul.toLowerCase().includes(lowerKw) || l.isi.toLowerCase().includes(lowerKw))
    );
  }

  async function loadPanduanFromDirectus() {
    const res = await fetchPanduanContent();
    if (!res.success || !res.data?.modulDokumentasi?.length) return; // fallback: biarkan hardcoded aktif

    const modulAktifId = modulAktif?.id;
    modulDokumentasi = res.data.modulDokumentasi;
    kategoriModul = res.data.kategoriModul?.length ? res.data.kategoriModul : kategoriModulHardcoded;

    kategoriModul.forEach((k) => {
      if (!(k.id in kategoriTerbuka)) kategoriTerbuka[k.id] = true;
    });

    if (modulAktifId) {
      const found = getModulById(modulAktifId);
      if (found) modulAktif = found;
    } else if (!modulAktif && modulDokumentasi.length > 0) {
      modulAktif = modulDokumentasi[0];
    }
  }

  let keyword = $state('');
  let modulAktif = $state<ModulPanduan | null>(null);
  let langkahTerbuka = $state<Record<string, boolean>>({});
  let faqTerbuka = $state<Record<string, boolean>>({});
  let kategoriTerbuka = $state<Record<string, boolean>>({});
  let mobileSidebarOpen = $state(false);

  // §7B #4: feedback "Membantu/Tidak" + komentar per artikel, direset tiap ganti modul.
  let feedbackHelpful = $state<boolean | null>(null);
  let feedbackKomentar = $state('');
  let feedbackSubmitting = $state(false);
  let feedbackSubmitted = $state(false);

  function resetFeedback() {
    feedbackHelpful = null;
    feedbackKomentar = '';
    feedbackSubmitting = false;
    feedbackSubmitted = false;
  }

  function pilihFeedback(helpful: boolean) {
    feedbackHelpful = helpful;
  }

  async function kirimFeedback() {
    if (!modulAktif || feedbackHelpful === null) return;
    feedbackSubmitting = true;
    const res = await sendPanduanFeedback({ modulSlug: modulAktif.id, helpful: feedbackHelpful, komentar: feedbackKomentar });
    feedbackSubmitting = false;
    if (res.success) feedbackSubmitted = true;
  }

  // Init semua kategori terbuka
  kategoriModul.forEach((k) => (kategoriTerbuka[k.id] = true));

  let modulFiltered = $derived(searchModul(keyword));

  $effect(() => {
    if (keyword) {
      // Buka semua accordion saat pencarian aktif
      modulFiltered.forEach((m) => {
        m.langkah.forEach((_, i) => (langkahTerbuka[`${m.id}-${i}`] = true));
      });
    }
  });

  // §6 Fase 3 (analytics "artikel paling dibaca"): catat sekali per sesi per
  // modul, fire-and-forget.
  const modulSudahDicatat = new Set<string>();
  function catatDibaca(modul: ModulPanduan | null) {
    if (!modul || modulSudahDicatat.has(modul.id)) return;
    modulSudahDicatat.add(modul.id);
    recordTutorialProgress({ tutorialRef: modul.id, jenis: 'panduan', persen: 100, status: 'selesai' });
  }

  // §6 Fase 3: bookmark/pin panduan favorit.
  let bookmarkedSlugs = $state(new Set<string>());
  let isBookmarked = $derived(modulAktif ? bookmarkedSlugs.has(modulAktif.id) : false);

  async function loadBookmarks() {
    const res = await fetchPanduanBookmarks();
    if (res.success && res.data) bookmarkedSlugs = new Set(res.data.map((b) => b.modul_slug));
  }

  async function toggleBookmark(modul: ModulPanduan | null) {
    if (!modul) return;
    const sudah = bookmarkedSlugs.has(modul.id);
    const next = new Set(bookmarkedSlugs);
    if (sudah) next.delete(modul.id);
    else next.add(modul.id);
    bookmarkedSlugs = next;
    const res = sudah ? await removePanduanBookmark(modul.id) : await addPanduanBookmark(modul.id);
    if (!res.success) {
      const revert = new Set(bookmarkedSlugs);
      if (sudah) revert.add(modul.id);
      else revert.delete(modul.id);
      bookmarkedSlugs = revert;
    }
  }

  function pilihModul(modul: ModulPanduan) {
    modulAktif = modul;
    langkahTerbuka = {};
    faqTerbuka = {};
    mobileSidebarOpen = false;
    resetFeedback();
    catatDibaca(modul);
    goto(`/panduan?modul=${modul.id}`, { replaceState: true, noScroll: true });
    // Di mobile: scroll ke konten
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setTimeout(() => {
        document.getElementById('konten-panduan')?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  }

  function toggleLangkah(key: string) {
    langkahTerbuka[key] = !langkahTerbuka[key];
  }

  function toggleFaq(key: string) {
    faqTerbuka[key] = !faqTerbuka[key];
  }

  function toggleKategori(id: string) {
    kategoriTerbuka[id] = !kategoriTerbuka[id];
  }

  onMount(() => {
    const modulId = page.url.searchParams.get('modul');
    if (modulId) {
      modulAktif = getModulById(modulId) || null;
      // Link langsung (mis. dari notifikasi "panduan baru") = niat baca sungguhan.
      if (modulAktif) catatDibaca(modulAktif);
    }
    if (!modulAktif && modulDokumentasi.length > 0) {
      modulAktif = modulDokumentasi[0];
    }

    loadPanduanFromDirectus();
    loadBookmarks();
  });
</script>

<svelte:head>
  <title>Panduan Pengguna — Project EPI</title>
</svelte:head>

<div class="flex flex-col h-full min-h-screen bg-gray-50">
  <!-- Header -->
  <div class="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0">
    <div class="flex items-center justify-between">
      <div>
        <div class="flex items-center gap-2 text-xs sm:text-sm text-gray-500 mb-0.5">
          <a href="/" class="hover:text-[var(--p)]">Dashboard</a>
          <span>/</span>
          <span class="text-gray-800 font-medium">Panduan Pengguna</span>
          {#if modulAktif}
            <span class="hidden sm:inline">/</span>
            <span class="text-[var(--p)] font-medium hidden sm:inline">{modulAktif.nama}</span>
          {/if}
        </div>
        <h1 class="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 sm:w-6 sm:h-6 text-[var(--p)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          Panduan Pengguna
        </h1>
        <p class="text-xs sm:text-sm text-gray-500 mt-0.5 hidden sm:block">Panduan lengkap penggunaan aplikasi Dashboard Lapangan</p>
      </div>
      <!-- Hamburger untuk sidebar di mobile -->
      <button
        onclick={() => mobileSidebarOpen = !mobileSidebarOpen}
        class="md:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-600"
        aria-label="Buka menu panduan"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Mobile sidebar backdrop -->
  {#if mobileSidebarOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-40 bg-black/30 md:hidden" onclick={() => mobileSidebarOpen = false}></div>
  {/if}

  <div class="flex flex-1 overflow-hidden relative">
    <!-- Sidebar kiri: drawer di mobile, static di md+ -->
    <aside class="
      {mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      md:translate-x-0 transition-transform duration-300
      fixed md:relative inset-y-0 left-0 z-50 md:z-auto
      w-72 md:w-64 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden
      h-full
    ">
      <!-- Search -->
      <div class="p-3 border-b border-gray-100">
        <div class="relative">
          <svg xmlns="http://www.w3.org/2000/svg" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Cari panduan..."
            bind:value={keyword}
            class="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--p)] focus:border-transparent"
          />
          {#if keyword}
            <button
              onclick={() => (keyword = '')}
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          {/if}
        </div>
      </div>

      {#if bookmarkedSlugs.size > 0 && !keyword}
        <div class="px-3 pt-2 pb-1 border-b border-gray-100">
          <p class="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-amber-500">⭐ Favorit</p>
          <div class="flex flex-wrap gap-1.5 pb-2">
            {#each [...bookmarkedSlugs] as slug}
              {@const modul = getModulById(slug)}
              {#if modul}
                <button onclick={() => pilihModul(modul)} class="px-2.5 py-1 text-[11px] font-medium rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                  ★ {modul.nama}
                </button>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <!-- Daftar modul -->
      <nav class="flex-1 overflow-y-auto py-2">
        {#if keyword}
          <!-- Mode pencarian: tampilkan flat list -->
          <div class="px-3 py-1 text-xs text-gray-400 font-medium uppercase tracking-wide">
            {modulFiltered.length} hasil ditemukan
          </div>
          {#each modulFiltered as modul}
            <button
              onclick={() => pilihModul(modul)}
              class="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors
                {modulAktif?.id === modul.id
                  ? 'bg-blue-50 text-[var(--p)] font-medium border-l-2 border-[var(--p)]'
                  : 'text-gray-700 hover:bg-gray-50'}"
            >
              <span class="truncate">{modul.nama}</span>
            </button>
          {/each}
          {#if modulFiltered.length === 0}
            <div class="px-4 py-6 text-center text-sm text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Tidak ada modul yang cocok
            </div>
          {/if}
        {:else}
          <!-- Mode normal: tampilkan per kategori -->
          {#each kategoriModul as kat}
            {@const modulKat = modulDokumentasi.filter((m) => m.kategori === kat.id)}
            {#if modulKat.length > 0}
              <div class="mb-1">
                <button
                  onclick={() => toggleKategori(kat.id)}
                  class="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors"
                >
                  <span class="flex items-center gap-1.5">
                    <span>{kat.emoji}</span>
                    <span>{kat.label}</span>
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-3.5 h-3.5 transition-transform {kategoriTerbuka[kat.id] ? '' : '-rotate-90'}"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {#if kategoriTerbuka[kat.id]}
                  {#each modulKat as modul}
                    <button
                      onclick={() => pilihModul(modul)}
                      class="w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors
                        {modulAktif?.id === modul.id
                          ? 'bg-blue-50 text-[var(--p)] font-semibold border-l-2 border-[var(--p)]'
                          : 'text-gray-700 hover:bg-gray-50 border-l-2 border-transparent'}"
                    >
                      <span class="truncate">{modul.nama}</span>
                    </button>
                  {/each}
                {/if}
              </div>
            {/if}
          {/each}
        {/if}
      </nav>
    </aside>

    <!-- Konten utama -->
    <main id="konten-panduan" class="flex-1 overflow-y-auto">
      {#if modulAktif}
        <div class="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <!-- Header modul -->
          <div class="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 mb-5 shadow-sm">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-[var(--p)]">
                    {kategoriModul.find((k) => k.id === modulAktif?.kategori)?.emoji}
                    {kategoriModul.find((k) => k.id === modulAktif?.kategori)?.label}
                  </span>
                </div>
                <h2 class="text-xl sm:text-2xl font-bold text-gray-900 mt-2">{modulAktif.nama}</h2>
                <p class="text-gray-600 mt-1 text-sm leading-relaxed">{modulAktif.deskripsi}</p>
              </div>
              <div class="flex-shrink-0 flex gap-2">
                <a
                  href={modulAktif.href}
                  class="flex items-center justify-center gap-1.5 px-4 py-2 bg-[var(--p)] text-white text-sm font-medium rounded-lg hover:bg-[var(--p-hover, var(--p))] transition-colors"
                >
                  Buka Modul
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <button
                  onclick={() => toggleBookmark(modulAktif)}
                  title={isBookmarked ? 'Hapus dari Favorit' : 'Tandai Favorit'}
                  class="flex items-center justify-center w-9 h-9 rounded-lg border transition-colors {isBookmarked ? 'bg-amber-50 border-amber-300 text-amber-500' : 'border-gray-200 text-gray-400'}"
                >
                  {isBookmarked ? '★' : '☆'}
                </button>
              </div>
            </div>
          </div>

          <!-- Langkah-langkah -->
          <div class="mb-5">
            <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Panduan Langkah demi Langkah
            </h3>

            <div class="space-y-2">
              {#each modulAktif.langkah as langkah, i}
                {@const key = `${modulAktif.id}-${i}`}
                <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                  <button
                    onclick={() => toggleLangkah(key)}
                    class="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span class="font-semibold text-gray-800 text-sm pr-4">{langkah.judul}</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="w-5 h-5 flex-shrink-0 text-gray-400 transition-transform {langkahTerbuka[key] ? 'rotate-180' : ''}"
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {#if langkahTerbuka[key]}
                    <div class="px-5 pb-5 border-t border-gray-100">
                      {#if langkah.blocks?.length}
                        <!-- Fase 1 — Rencana v2 §3: blok terstruktur menggantikan HTML mentah. -->
                        <div class="pt-4"><PanduanBlocks blocks={langkah.blocks} /></div>
                      {:else}
                        <!-- Fallback: langkah belum dimigrasi ke blok — tampil persis seperti sebelumnya. -->
                        <div class="pt-4 text-sm text-gray-700 leading-relaxed" use:resolveRichImages={langkah.isi}>
                          {@html sanitizeRichHtml(langkah.isi)}
                        </div>
                        {#if langkah.tips}
                          <div class="mt-4 flex gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0 text-amber-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p class="text-xs text-amber-800 leading-relaxed"><strong>Tips:</strong> {langkah.tips}</p>
                          </div>
                        {/if}
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>

          <!-- FAQ -->
          {#if modulAktif.faq && modulAktif.faq.length > 0}
            <div>
              <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Pertanyaan yang Sering Ditanyakan
              </h3>

              <div class="space-y-2">
                {#each modulAktif.faq as faq, fi}
                  {@const key = `${modulAktif.id}-faq-${fi}`}
                  <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <button
                      onclick={() => toggleFaq(key)}
                      class="w-full flex items-start justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors gap-4"
                    >
                      <span class="font-medium text-gray-800 text-sm">{faq.tanya}</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="w-5 h-5 flex-shrink-0 text-gray-400 transition-transform {faqTerbuka[key] ? 'rotate-180' : ''}"
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {#if faqTerbuka[key]}
                      <div class="px-5 pb-4 border-t border-gray-100 pt-3 text-sm text-gray-700 leading-relaxed" use:resolveRichImages={faq.jawab}>
                        {@html sanitizeRichHtml(faq.jawab)}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Feedback "Membantu/Tidak" (§7B #4) -->
          <div class="mt-6 bg-white rounded-xl border border-gray-200 p-4 sm:p-5 shadow-sm">
            {#if feedbackSubmitted}
              <p class="text-sm text-center text-green-700">✅ Terima kasih atas masukannya!</p>
            {:else}
              <p class="text-sm font-semibold text-gray-700 text-center mb-3">Apakah panduan ini membantu?</p>
              <div class="flex items-center justify-center gap-3">
                <button
                  onclick={() => pilihFeedback(true)}
                  class="px-4 py-2 rounded-full text-sm font-medium border transition-colors {feedbackHelpful === true ? 'bg-green-50 border-green-400 text-green-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}"
                >
                  👍 Membantu
                </button>
                <button
                  onclick={() => pilihFeedback(false)}
                  class="px-4 py-2 rounded-full text-sm font-medium border transition-colors {feedbackHelpful === false ? 'bg-red-50 border-red-400 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}"
                >
                  👎 Tidak Membantu
                </button>
              </div>
              {#if feedbackHelpful !== null}
                <div class="mt-3">
                  <textarea
                    bind:value={feedbackKomentar}
                    rows="2"
                    placeholder="Komentar (opsional) — apa yang bisa diperbaiki?"
                    class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--p)] focus:border-transparent"
                  ></textarea>
                  <button
                    onclick={kirimFeedback}
                    disabled={feedbackSubmitting}
                    class="mt-2 w-full py-2 rounded-lg text-sm font-bold text-white bg-[var(--p)] disabled:opacity-50"
                  >
                    {feedbackSubmitting ? 'Mengirim…' : 'Kirim Feedback'}
                  </button>
                </div>
              {/if}
            {/if}
          </div>

          <!-- Navigasi antar modul -->
          <div class="mt-8 pt-6 border-t border-gray-200">
            <p class="text-xs text-gray-400 mb-3 text-center">Modul lain dalam kategori yang sama</p>
            <div class="flex flex-wrap gap-2 justify-center">
              {#each modulDokumentasi.filter((m) => m.kategori === modulAktif?.kategori && m.id !== modulAktif?.id) as lain}
                <button
                  onclick={() => pilihModul(lain)}
                  class="px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-[var(--p)] hover:bg-blue-50 transition-colors"
                >
                  {lain.nama}
                </button>
              {/each}
            </div>
          </div>
        </div>
      {:else}
        <!-- State kosong / sambutan -->
        <div class="flex items-center justify-center h-full min-h-96">
          <div class="text-center max-w-md px-6">
            <div class="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-[var(--p)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <h2 class="text-lg font-bold text-gray-900 mb-2">Selamat datang di Panduan Lapangan</h2>
            <p class="text-sm text-gray-500 leading-relaxed">
              Pilih modul di sebelah kiri untuk melihat panduan penggunaan step-by-step.
              Gunakan kotak pencarian untuk mencari topik tertentu.
            </p>
          </div>
        </div>
      {/if}
    </main>
  </div>
</div>
