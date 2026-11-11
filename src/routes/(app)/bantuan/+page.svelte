<!-- src/routes/(app)/bantuan/+page.svelte -->
<!-- Pusat Bantuan & SOP Terpadu Lapangan, Mobile-First (Fase 3 Unifikasi):
     1. Tab "Untuk Anda": Checklist onboarding role, SOP khusus proyek hari ini, dan pencarian kendala.
     2. Tab "SOP Perusahaan & K3": Katalog SOP resmi terpusat, pembaca detail, dan konfirmasi baca 1-klik (ISO 9001 §7.3).
     3. Tab "Yang Baru": Catatan rilis dan update fitur aplikasi.
     Mendukung query parameter ?tab=sop / ?tab=untuk-anda / ?tab=update. -->
<script lang="ts">
  import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { modulDokumentasi, getModulById, type ModulPanduan } from '$lib/data/panduan';
  import { fetchTutorialForMe, fetchProjectSop, type TutorialForMe, type TutorialRoleMapRow, type ProjectSopNote } from '$lib/services/tutorialApi';
  import { cacheTutorialForMe, getCachedTutorialForMe } from '$lib/utils/offlinePanduanCache';
  import { fetchReleaseNotes, type ReleaseNoteItem } from '$lib/services/releaseNotesApi';
  import { fetchSopList, fetchSopDetail, confirmSopRead, type CompanySopItem } from '$lib/services/sopApi';
  import { startTour } from '$lib/stores/tourStore.svelte';
  import TutorialVideoPlayer from '$lib/components/shared/TutorialVideoPlayer.svelte';
  import KendalaSearch from '../panduan/alur/KendalaSearch.svelte';

  const toast = {
    success: (m: string) => typeof window !== 'undefined' && (window as any).__showToast?.(m, 'success'),
    error: (m: string) => typeof window !== 'undefined' && (window as any).__showToast?.(m, 'error'),
    info: (m: string) => typeof window !== 'undefined' && (window as any).__showToast?.(m, 'info')
  };

  /** Tab aktif: 'untuk-anda' | 'sop' | 'update' */
  let activeTab = $state<'untuk-anda' | 'sop' | 'update'>('untuk-anda');

  /** Hasil pencarian kendala → buka Alur Kerja tepat di langkah terkait (deep-link ?alur=&fokus=). */
  const bukaLangkah = (flowId: string, nodeId: string) =>
    goto(`/panduan/alur?alur=${encodeURIComponent(flowId)}&fokus=${encodeURIComponent(nodeId)}`);

  // ==================== RELEASE NOTES ====================
  let releaseNotes = $state<ReleaseNoteItem[]>([]);
  const TIPE_LABEL: Record<string, string> = { major: 'Besar', minor: 'Baru', patch: 'Perbaikan', hotfix: 'Mendesak' };

  async function loadReleaseNotes() {
    const res = await fetchReleaseNotes(10);
    if (res.success && res.data) releaseNotes = res.data;
  }

  function fmtTanggal(d?: string) {
    if (!d) return '-';
    try {
      return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return d;
    }
  }

  // ==================== SOP KHUSUS PROYEK HARI INI ====================
  let sopNotes = $state<ProjectSopNote[]>([]);
  let projectIdAktif = $state<number | null>(null);
  const KATEGORI_ICON: Record<string, string> = { keselamatan: '🦺', akses_lokasi: '🚪', kontak: '📞', lainnya: '📌' };

  async function loadProjectSop() {
    const res = await fetchProjectSop();
    if (res.success && res.data) {
      sopNotes = res.data.notes || [];
      projectIdAktif = res.data.projectId;
    }
  }

  // ==================== TUTORIAL ONBOARDING JABATAN ====================
  interface ChecklistItem {
    modul: ModulPanduan;
    roleMapRow: TutorialRoleMapRow;
    video: TutorialForMe['videos'][number] | undefined;
    status: 'belum' | 'proses' | 'selesai';
  }

  let loadingTutorial = $state(true);
  let errorMsgTutorial = $state('');
  let checklist = $state<ChecklistItem[]>([]);
  let offlineMode = $state(false);
  let offlineCachedAt = $state('');
  let selesaiCount = $derived(checklist.filter((c) => c.status === 'selesai').length);
  let videoAktif = $state<ChecklistItem['video'] | null>(null);

  function statusForRef(progress: TutorialForMe['progress'], ref: string, jenis: string) {
    const row = progress.find((p) => p.tutorial_ref === ref && p.jenis === jenis);
    return (row?.status as 'belum' | 'proses' | 'selesai') || 'belum';
  }

  function buildChecklist(roleMap: TutorialRoleMapRow[], videos: TutorialForMe['videos'], progress: TutorialForMe['progress']): ChecklistItem[] {
    return roleMap
      .map((row) => {
        const modul = getModulById(row.modul_slug);
        if (!modul) return null;
        const video = videos.find((v) => v.modul_slug === row.modul_slug);
        const status = statusForRef(progress, row.modul_slug, 'tour');
        return { modul, roleMapRow: row, video, status };
      })
      .filter((x): x is ChecklistItem => x !== null);
  }

  async function loadTutorial() {
    loadingTutorial = true;
    errorMsgTutorial = '';
    offlineMode = false;
    const res = await fetchTutorialForMe();
    if (!res.success || !res.data) {
      const cached = await getCachedTutorialForMe();
      if (cached) {
        offlineMode = true;
        offlineCachedAt = cached.cachedAt;
        checklist = buildChecklist(cached.roleMap, cached.videos, []);
        loadingTutorial = false;
        return;
      }
      errorMsgTutorial = res.error || 'Gagal memuat tutorial untuk Anda.';
      loadingTutorial = false;
      return;
    }
    const { roleMap, videos, progress } = res.data;
    checklist = buildChecklist(roleMap, videos, progress);
    cacheTutorialForMe(res.data);
    loadingTutorial = false;
  }

  function slugFromHref(href: string): string {
    return (href || '').split('/').filter(Boolean)[0] || '';
  }

  // ==================== KATALOG SOP PERUSAHAAN TERPUSAT ====================
  let companySops = $state<CompanySopItem[]>([]);
  let loadingSops = $state(false);
  let errorMsgSops = $state('');
  let sopSearchQuery = $state('');
  let activeCompanySop = $state<CompanySopItem | null>(null);
  let loadingDetailSop = $state(false);
  let confirmingSop = $state(false);

  let unconfirmedSopCount = $derived(companySops.filter((s) => !s.is_confirmed).length);

  async function loadCompanySops() {
    loadingSops = true;
    errorMsgSops = '';
    const res = await fetchSopList({ search: sopSearchQuery, includeContent: false });
    if (!res.success) {
      errorMsgSops = res.error || 'Gagal memuat SOP perusahaan';
    } else {
      companySops = res.data || [];
    }
    loadingSops = false;
  }

  let sopSearchTimeout: any = null;
  function handleSopSearchInput() {
    clearTimeout(sopSearchTimeout);
    sopSearchTimeout = setTimeout(() => {
      loadCompanySops();
    }, 350);
  }

  async function openCompanySopDetail(sop: CompanySopItem) {
    activeCompanySop = sop;
    loadingDetailSop = true;
    const res = await fetchSopDetail(sop.id);
    if (res.success && res.data) {
      activeCompanySop = res.data;
    }
    loadingDetailSop = false;
  }

  function closeCompanySopDetail() {
    activeCompanySop = null;
  }

  async function handleConfirmSopRead() {
    if (!activeCompanySop || confirmingSop) return;
    confirmingSop = true;
    const res = await confirmSopRead({ sopId: activeCompanySop.id });
    if (res.success) {
      toast.success(res.message || 'Konfirmasi baca SOP berhasil dicatat');
      activeCompanySop.is_confirmed = true;
      companySops = companySops.map((s) => (s.id === activeCompanySop!.id ? { ...s, is_confirmed: true } : s));
    } else {
      toast.error(res.error || 'Gagal mencatat konfirmasi baca');
    }
    confirmingSop = false;
  }

  // ==================== SIKLUS HIDUP & DEEP-LINK ====================
  onMount(() => {
    const tabParam = page.url.searchParams.get('tab');
    if (tabParam === 'sop' || tabParam === 'update' || tabParam === 'untuk-anda') {
      activeTab = tabParam;
    }

    loadTutorial();
    loadProjectSop();
    loadReleaseNotes();
    loadCompanySops();
  });

  function setTab(tab: 'untuk-anda' | 'sop' | 'update') {
    activeTab = tab;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    goto(url.pathname + url.search, { replaceState: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Pusat Bantuan & SOP — Project EPI</title>
</svelte:head>

<div class="flex flex-col min-h-screen bg-gray-50 pb-8">
  <!-- Topbar Header -->
  <div class="bg-white border-b border-gray-200 px-4 py-3.5 sticky top-0 z-20 shadow-2xs">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-base font-bold text-gray-900 flex items-center gap-1.5">
          <span>🛠️</span>
          <span>Pusat Bantuan &amp; SOP</span>
        </h1>
        <p class="text-[11px] text-gray-500">SOP resmi, instruksi proyek, kendala &amp; panduan</p>
      </div>

      <a
        href="/panduan"
        class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-[var(--p)] hover:bg-blue-100 transition-colors"
      >
        <span>📘 Panduan Modul →</span>
      </a>
    </div>

    <!-- Segmented Control Tabs -->
    <div class="flex items-center gap-1 mt-3 bg-gray-100 p-1 rounded-xl text-xs font-medium">
      <button
        type="button"
        onclick={() => setTab('untuk-anda')}
        class="flex-1 py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer flex items-center justify-center gap-1.5
          {activeTab === 'untuk-anda' ? 'bg-white text-gray-900 shadow-2xs font-bold' : 'text-gray-500 hover:text-gray-800'}"
      >
        <span>🎯</span>
        <span>Untuk Anda</span>
        {#if sopNotes.length > 0}
          <span class="w-2 h-2 rounded-full bg-teal-500"></span>
        {/if}
      </button>

      <button
        type="button"
        onclick={() => setTab('sop')}
        class="flex-1 py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer flex items-center justify-center gap-1.5
          {activeTab === 'sop' ? 'bg-white text-gray-900 shadow-2xs font-bold' : 'text-gray-500 hover:text-gray-800'}"
      >
        <span>📜</span>
        <span>SOP &amp; K3</span>
        {#if unconfirmedSopCount > 0}
          <span class="px-1.5 py-0.2 text-[9px] font-bold rounded-full bg-amber-500 text-white leading-tight">
            {unconfirmedSopCount}
          </span>
        {/if}
      </button>

      <button
        type="button"
        onclick={() => setTab('update')}
        class="flex-1 py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer flex items-center justify-center gap-1.5
          {activeTab === 'update' ? 'bg-white text-gray-900 shadow-2xs font-bold' : 'text-gray-500 hover:text-gray-800'}"
      >
        <span>🚀</span>
        <span>Yang Baru</span>
      </button>
    </div>
  </div>

  <!-- Konten Tab -->
  <div class="p-4 space-y-4">
    <!-- ==================== TAB 1: UNTUK ANDA & PROYEK ==================== -->
    {#if activeTab === 'untuk-anda'}
      <!-- Cari kendala / pesan gate → loncat ke langkah SOP beserta solusinya -->
      <KendalaSearch onjump={bukaLangkah} />

      <!-- Banner Link ke Alur Kerja Lapangan -->
      <a
        href="/panduan/alur"
        class="flex items-center gap-3 bg-white rounded-2xl border border-gray-200 p-4 shadow-2xs active:scale-[0.99] transition-transform"
      >
        <span class="text-2xl" aria-hidden="true">🗺️</span>
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-semibold text-gray-800">Peta Alur Kerja &amp; Syarat Gate</span>
          <span class="block text-xs text-gray-500 mt-0.5">Lihat tahapan alur lapangan, PIC penanggung jawab, dan checklist gate lolos</span>
        </span>
        <span class="text-gray-300">›</span>
      </a>

      <!-- Instruksi Khusus Proyek Hari Ini -->
      {#if sopNotes.length > 0}
        <div class="bg-teal-50 border border-teal-200 rounded-2xl p-4 shadow-2xs space-y-2.5">
          <div class="flex items-center justify-between">
            <p class="text-xs font-bold text-teal-900 flex items-center gap-1.5">
              <span>📌</span>
              <span>Instruksi Khusus Proyek #{projectIdAktif || 'Aktif'}</span>
            </p>
            <span class="text-[10px] bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full font-semibold">
              {sopNotes.length} instruksi
            </span>
          </div>
          <div class="space-y-2">
            {#each sopNotes as note (note.id)}
              <div class="bg-white rounded-xl p-3 border border-teal-100 shadow-2xs">
                <p class="text-xs font-bold text-gray-800">{KATEGORI_ICON[note.kategori] || '📌'} {note.judul}</p>
                {#if note.isi}
                  <p class="text-xs text-gray-600 mt-1 whitespace-pre-line leading-relaxed">{note.isi}</p>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Tutorial Onboarding Karyawan -->
      {#if loadingTutorial}
        <div class="py-10 flex justify-center">
          <CircularProgressGauge size={40} strokeWidth={3.5} label="Memuat tutorial jabatan Anda…" />
        </div>
      {:else if errorMsgTutorial}
        <div class="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-medium">
          {errorMsgTutorial}
        </div>
      {:else if checklist.length === 0}
        <div class="p-8 text-center text-gray-400 text-xs space-y-3 bg-white rounded-2xl border border-gray-200">
          <div>Belum ada jalur tutorial khusus untuk jabatan Anda saat ini.</div>
          <a
            href="/panduan"
            class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[var(--p)] bg-blue-50 rounded-full"
          >
            📘 Lihat Katalog Panduan Modul
          </a>
        </div>
      {:else}
        {#if offlineMode}
          <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 flex items-center gap-2">
            <span>📡</span>
            <span>Mode offline — menampilkan data tersimpan {offlineCachedAt ? new Date(offlineCachedAt).toLocaleDateString('id-ID') : ''}.</span>
          </div>
        {/if}

        <div class="bg-white rounded-2xl border border-gray-200 p-4 shadow-2xs">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-xs font-bold text-gray-700 uppercase tracking-wider">Tutorial Onboarding Jabatan</h2>
            <span class="text-xs font-bold text-[var(--p)]">{selesaiCount}/{checklist.length} Selesai</span>
          </div>
          <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              class="h-full bg-[var(--p)] transition-all"
              style="width: {checklist.length ? Math.round((selesaiCount / checklist.length) * 100) : 0}%"
            ></div>
          </div>
        </div>

        <div class="space-y-3">
          {#each checklist as item (item.roleMapRow.id)}
            <div class="bg-white rounded-2xl border border-gray-200 p-4 shadow-2xs">
              <div class="flex items-start gap-2.5 mb-2">
                <span class="text-xl flex-shrink-0">{item.status === 'selesai' ? '✅' : '⏳'}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-xs font-bold text-gray-900">{item.modul.nama}</span>
                    {#if item.roleMapRow.wajib}
                      <span class="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 text-amber-800">WAJIB</span>
                    {/if}
                  </div>
                  <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.modul.deskripsi}</p>
                </div>
              </div>
              <div class="grid grid-cols-3 gap-2 mt-3 pt-2 border-t border-gray-100">
                {#if item.video}
                  <button
                    type="button"
                    onclick={() => (videoAktif = item.video)}
                    class="flex flex-col items-center justify-center gap-1 py-2 rounded-xl border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 active:bg-gray-100"
                  >
                    🎬 Video
                  </button>
                {/if}
                <button
                  type="button"
                  onclick={() => startTour(slugFromHref(item.modul.href) || item.modul.id)}
                  class="flex flex-col items-center justify-center gap-1 py-2 rounded-xl border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 active:bg-gray-100 {item.video ? '' : 'col-span-1'}"
                >
                  🧭 Mulai Tur
                </button>
                <a
                  href={item.modul.href}
                  class="flex flex-col items-center justify-center gap-1 py-2 rounded-xl text-white text-xs font-bold bg-[var(--p)] hover:opacity-90 active:scale-[0.98] transition-transform {item.video ? '' : 'col-span-2'}"
                >
                  Buka Modul
                </a>
              </div>
            </div>
          {/each}
        </div>
      {/if}

    <!-- ==================== TAB 2: SOP PERUSAHAAN & K3 ==================== -->
    {:else if activeTab === 'sop'}
      <!-- Pencarian SOP Perusahaan -->
      <div class="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-2xs space-y-2.5">
        <div class="relative">
          <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
            🔍
          </span>
          <input
            type="text"
            bind:value={sopSearchQuery}
            oninput={handleSopSearchInput}
            placeholder="Cari kode SOP, K3, judul, atau kata kunci…"
            class="w-full pl-8 pr-3 py-2 text-xs border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50/50"
          />
        </div>

        <div class="flex items-center justify-between text-[11px] text-gray-500 px-0.5">
          <span>{companySops.length} dokumen SOP ditemukan</span>
          {#if unconfirmedSopCount > 0}
            <span class="text-amber-700 font-bold">⚠️ {unconfirmedSopCount} belum Anda konfirmasi</span>
          {:else}
            <span class="text-emerald-700 font-bold">✓ Semua SOP sudah dikonfirmasi</span>
          {/if}
        </div>
      </div>

      <!-- Daftar SOP -->
      {#if loadingSops}
        <div class="py-12 flex justify-center">
          <CircularProgressGauge size={38} strokeWidth={3} label="Memuat katalog SOP resmi…" />
        </div>
      {:else if errorMsgSops}
        <div class="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-medium text-center space-y-2">
          <p>{errorMsgSops}</p>
          <button
            type="button"
            onclick={loadCompanySops}
            class="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold"
          >
            Coba Lagi
          </button>
        </div>
      {:else if companySops.length === 0}
        <div class="p-8 text-center text-gray-400 text-xs bg-white rounded-2xl border border-gray-200 space-y-2">
          <div class="text-3xl">📂</div>
          <p class="font-bold text-gray-700">Tidak ada SOP ditemukan</p>
          <p class="text-gray-400">Coba ubah kata kunci pencarian Anda.</p>
        </div>
      {:else}
        <div class="space-y-3">
          {#each companySops as sop (sop.id)}
            <div
              tabindex="0"
              role="button"
              onclick={() => openCompanySopDetail(sop)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openCompanySopDetail(sop); }}
              class="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-2xs active:bg-gray-50 transition-colors cursor-pointer space-y-2 text-left"
            >
              <div class="flex items-start justify-between gap-2">
                <span class="px-2 py-0.5 text-[11px] font-mono font-bold rounded bg-slate-100 text-slate-800 border border-slate-200">
                  {sop.sop_code || `SOP-${sop.id}`}
                </span>
                <div class="flex items-center gap-1">
                  {#if sop.is_confirmed}
                    <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                      ✓ Sudah Dibaca
                    </span>
                  {:else}
                    <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 animate-pulse">
                      ⚠️ Wajib Dibaca
                    </span>
                  {/if}
                </div>
              </div>

              <h3 class="text-xs font-bold text-gray-900 leading-snug">
                {sop.title}
              </h3>

              {#if sop.ai_summary}
                <p class="text-[11px] text-gray-600 line-clamp-2 bg-slate-50 p-2 rounded-lg border border-slate-100">
                  {sop.ai_summary}
                </p>
              {/if}

              <div class="pt-1.5 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
                <span>🏷️ {sop.department || 'Umum'}</span>
                <span>v{sop.version_seq || 1} · Efektif {fmtTanggal(sop.effective_date)}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}

    <!-- ==================== TAB 3: YANG BARU (RELEASE NOTES) ==================== -->
    {:else if activeTab === 'update'}
      {#if releaseNotes.length === 0}
        <div class="p-8 text-center text-gray-400 text-xs bg-white rounded-2xl border border-gray-200">
          Belum ada catatan pembaruan sistem yang dirilis.
        </div>
      {:else}
        <div class="space-y-3">
          {#each releaseNotes as note (note.id)}
            <div class="bg-white rounded-2xl border border-gray-200 p-4 shadow-2xs space-y-2">
              <div class="flex items-center justify-between">
                <span class="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-[var(--p)]">
                  {TIPE_LABEL[note.tipe] || note.tipe}
                </span>
                <span class="text-[11px] text-gray-400">{fmtTanggal(note.tanggal_rilis)}</span>
              </div>
              <h3 class="text-xs font-bold text-gray-900">{note.judul}</h3>
              {#if note.ringkasan}
                <p class="text-xs text-gray-600 leading-relaxed">{note.ringkasan}</p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- ==================== MODAL DETAIL SOP LAPANGAN (MOBILE-FIRST) ==================== -->
{#if activeCompanySop}
  <div
    tabindex="0"
    role="button"
    class="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-2xs flex items-end sm:items-center justify-center p-0 sm:p-4 text-left"
    onclick={closeCompanySopDetail}
    onkeydown={(e) => { if (e.key === 'Escape') closeCompanySopDetail(); }}
  >
    <div
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      class="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden border border-gray-200"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- Modal Header -->
      <div class="p-4 border-b border-gray-200 bg-gray-50 flex items-start justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-2 py-0.5 text-[11px] font-mono font-bold bg-indigo-100 text-indigo-800 rounded">
              {activeCompanySop.sop_code || `SOP-${activeCompanySop.id}`}
            </span>
            <span class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-200 text-slate-700">
              v{activeCompanySop.version_seq || 1}
            </span>
            <span class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-indigo-50 text-indigo-700">
              {activeCompanySop.department || 'Umum'}
            </span>
          </div>
          <h2 class="text-sm font-bold text-gray-900 leading-snug">
            {activeCompanySop.title}
          </h2>
        </div>
        <button
          type="button"
          onclick={closeCompanySopDetail}
          class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 font-bold text-base cursor-pointer"
        >
          ✕
        </button>
      </div>

      <!-- Modal Body -->
      <div class="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {#if loadingDetailSop}
          <div class="py-10 flex justify-center">
            <CircularProgressGauge size={32} strokeWidth={3} label="Memuat teks prosedur…" />
          </div>
        {:else}
          <!-- Metadata Singkat -->
          <div class="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-slate-600">
            <div>
              <span class="text-[9px] uppercase tracking-wider text-slate-400 font-semibold block">Tanggal Efektif</span>
              <span class="font-medium text-slate-800">{fmtTanggal(activeCompanySop.effective_date)}</span>
            </div>
            <div>
              <span class="text-[9px] uppercase tracking-wider text-slate-400 font-semibold block">Status Anda</span>
              <span class="font-bold {activeCompanySop.is_confirmed ? 'text-emerald-700' : 'text-amber-700'}">
                {activeCompanySop.is_confirmed ? '✓ Sudah Dibaca' : '⚠️ Belum Dibaca'}
              </span>
            </div>
          </div>

          <!-- Ringkasan AI -->
          {#if activeCompanySop.ai_summary}
            <div class="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 space-y-1">
              <p class="font-bold text-indigo-900 flex items-center gap-1">
                <span>🤖</span>
                <span>Ringkasan Cepat:</span>
              </p>
              <p class="text-indigo-950 leading-relaxed text-[11px]">
                {activeCompanySop.ai_summary}
              </p>
            </div>
          {/if}

          <!-- Konten Teks Prosedur -->
          <div class="space-y-1.5">
            <h4 class="font-bold uppercase tracking-wider text-gray-500 text-[10px]">Langkah &amp; Instruksi Kerja</h4>
            {#if activeCompanySop.content}
              <div class="prose prose-xs max-w-none text-gray-800 bg-white border border-gray-200 p-3.5 rounded-xl leading-relaxed whitespace-pre-line text-xs">
                {activeCompanySop.content}
              </div>
            {:else}
              <div class="text-xs text-gray-400 italic p-4 bg-gray-50 rounded-xl text-center border border-dashed border-gray-200">
                Konten teks SOP tidak tersedia dalam bentuk ringkasan. Silakan merujuk ke dokumen lampiran atau alur kerja lapangan.
              </div>
            {/if}
          </div>

          <!-- Tautan Dokumen Luar -->
          {#if activeCompanySop.external_flowchart_url || activeCompanySop.external_doc_url}
            <div class="space-y-1.5 pt-2 border-t border-gray-200">
              <h4 class="font-bold text-gray-700 text-[11px]">Lampiran Dokumen</h4>
              <div class="flex flex-wrap gap-2">
                {#if activeCompanySop.external_flowchart_url}
                  <a
                    href={activeCompanySop.external_flowchart_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-indigo-700 flex items-center gap-1"
                  >
                    📊 Diagram Alir (Flowchart) ↗
                  </a>
                {/if}
                {#if activeCompanySop.external_doc_url}
                  <a
                    href={activeCompanySop.external_doc_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-indigo-700 flex items-center gap-1"
                  >
                    📄 Dokumen Lengkap (PDF) ↗
                  </a>
                {/if}
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="p-3.5 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-2">
        <button
          type="button"
          onclick={closeCompanySopDetail}
          class="px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-100 cursor-pointer"
        >
          Tutup
        </button>

        {#if !activeCompanySop.is_confirmed}
          <button
            type="button"
            onclick={handleConfirmSopRead}
            disabled={confirmingSop}
            class="px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {#if confirmingSop}
              <CircularProgressGauge size={14} strokeWidth={2} />
              <span>Mencatat…</span>
            {:else}
              <span>✓ Saya Sudah Membaca &amp; Paham</span>
            {/if}
          </button>
        {:else}
          <span class="text-xs text-emerald-700 font-bold flex items-center gap-1">
            ✓ Sudah Dikonfirmasi
          </span>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if videoAktif}
  <TutorialVideoPlayer video={videoAktif} onClose={() => (videoAktif = null)} />
{/if}
