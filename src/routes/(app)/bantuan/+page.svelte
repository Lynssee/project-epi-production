<!-- src/routes/(app)/bantuan/+page.svelte -->
<!-- Pusat Bantuan lapangan, mobile-first: checklist tutorial sesuai jabatan
     ("Untuk Anda"), tombol Mulai Tur, kartu video, dan tautan ke Panduan
     lengkap. Fase 2, implementation_plan_tutorial aplikasi per role.md. -->
<script lang="ts">
  import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
  import { onMount } from 'svelte';
  import { modulDokumentasi, getModulById, type ModulPanduan } from '$lib/data/panduan';
  import { fetchTutorialForMe, fetchProjectSop, type TutorialForMe, type TutorialRoleMapRow, type ProjectSopNote } from '$lib/services/tutorialApi';
  import { cacheTutorialForMe, getCachedTutorialForMe } from '$lib/utils/offlinePanduanCache';
  import { fetchReleaseNotes, type ReleaseNoteItem } from '$lib/services/releaseNotesApi';
  import { startTour } from '$lib/stores/tourStore.svelte';
  import TutorialVideoPlayer from '$lib/components/shared/TutorialVideoPlayer.svelte';

  // Fase 3 (implementation_plan_Help System): widget "Yang Baru" — release
  // notes published untuk project-epi/both. Gagal fetch = diam-diam kosong,
  // BUKAN error yang mengganggu halaman utama (fitur pelengkap, bukan inti).
  let releaseNotes = $state<ReleaseNoteItem[]>([]);
  const TIPE_LABEL: Record<string, string> = { major: 'Besar', minor: 'Baru', patch: 'Perbaikan', hotfix: 'Mendesak' };

  async function loadReleaseNotes() {
    const res = await fetchReleaseNotes(5);
    if (res.success && res.data) releaseNotes = res.data;
  }

  function fmtTanggal(d: string) {
    try {
      return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    } catch {
      return d;
    }
  }

  // §7B #3: instruksi SOP khusus proyek tempat user absen hari ini.
  let sopNotes = $state<ProjectSopNote[]>([]);
  const KATEGORI_ICON: Record<string, string> = { keselamatan: '🦺', akses_lokasi: '🚪', kontak: '📞', lainnya: '📌' };

  async function loadProjectSop() {
    const res = await fetchProjectSop();
    if (res.success && res.data) sopNotes = res.data.notes;
  }

  interface ChecklistItem {
    modul: ModulPanduan;
    roleMapRow: TutorialRoleMapRow;
    video: TutorialForMe['videos'][number] | undefined;
    status: 'belum' | 'proses' | 'selesai';
  }

  let loading = $state(true);
  let errorMsg = $state('');
  let checklist = $state<ChecklistItem[]>([]);
  // §7B #1: sinyal lapangan sering buruk/putus — kalau fetch gagal, tampilkan
  // cache IndexedDB terakhir daripada layar merah kosong. Progress SENGAJA
  // tidak dicache (lihat offlinePanduanCache.ts), jadi mode offline selalu
  // menampilkan status "belum" — tidak menyesatkan, hanya kurang mutakhir.
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

  async function load() {
    loading = true;
    errorMsg = '';
    offlineMode = false;
    const res = await fetchTutorialForMe();
    if (!res.success || !res.data) {
      const cached = await getCachedTutorialForMe();
      if (cached) {
        offlineMode = true;
        offlineCachedAt = cached.cachedAt;
        checklist = buildChecklist(cached.roleMap, cached.videos, []);
        loading = false;
        return;
      }
      errorMsg = res.error || 'Gagal memuat tutorial untuk Anda.';
      loading = false;
      return;
    }
    const { roleMap, videos, progress } = res.data;
    checklist = buildChecklist(roleMap, videos, progress);
    cacheTutorialForMe(res.data);
    loading = false;
  }

  function slugFromHref(href: string): string {
    return (href || '').split('/').filter(Boolean)[0] || '';
  }

  onMount(() => {
    load();
    loadProjectSop();
    loadReleaseNotes();
  });
</script>

<svelte:head>
  <title>Bantuan — Project EPI</title>
</svelte:head>

<div class="flex flex-col min-h-screen bg-gray-50 pb-6">
  <div class="bg-white border-b border-gray-200 px-4 py-4">
    <h1 class="text-lg font-bold text-gray-900">Bantuan</h1>
    <p class="text-xs text-gray-500 mt-0.5">Tutorial cara pakai aplikasi sesuai jabatan Anda</p>
  </div>

  <div class="p-4 space-y-4">
    <a href="/panduan/alur" class="flex items-center gap-3 bg-white rounded-2xl border border-gray-200 p-4 shadow-sm active:scale-[0.99] transition-transform">
      <span class="text-2xl" aria-hidden="true">🗺️</span>
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-semibold text-gray-800">Alur Kerja</span>
        <span class="block text-xs text-gray-500 mt-0.5">Dari survey, penawaran, PO, sampai barang siap kirim — siapa mengerjakan apa dan ke mana lanjutnya</span>
      </span>
      <span class="text-gray-300">›</span>
    </a>

    {#if sopNotes.length > 0}
      <div class="bg-teal-50 border border-teal-200 rounded-2xl p-4">
        <p class="text-xs font-bold text-teal-800 mb-2">📌 Instruksi Khusus Proyek Ini</p>
        <div class="space-y-2">
          {#each sopNotes as note (note.id)}
            <div class="bg-white rounded-xl p-3 border border-teal-100">
              <p class="text-sm font-semibold text-gray-800">{KATEGORI_ICON[note.kategori] || '📌'} {note.judul}</p>
              {#if note.isi}<p class="text-xs text-gray-600 mt-1 whitespace-pre-line">{note.isi}</p>{/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if releaseNotes.length > 0}
      <div class="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
        <p class="text-xs font-bold text-gray-700 mb-2">🚀 Yang Baru</p>
        <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {#each releaseNotes as note (note.id)}
            <div class="shrink-0 w-56 bg-gray-50 rounded-xl border border-gray-100 p-3">
              <div class="flex items-center gap-1.5 mb-1">
                <span class="px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-[var(--p)]">{TIPE_LABEL[note.tipe] || note.tipe}</span>
                <span class="text-[10px] text-gray-400">{fmtTanggal(note.tanggal_rilis)}</span>
              </div>
              <p class="text-xs font-semibold text-gray-800 line-clamp-2">{note.judul}</p>
              {#if note.ringkasan}<p class="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{note.ringkasan}</p>{/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if loading}
      <CircularProgressGauge size={48} strokeWidth={4} label="Memuat materi bantuan & SOP..." />
    {:else if errorMsg}
      <div class="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{errorMsg}</div>
    {:else if checklist.length === 0}
      <div class="p-8 text-center text-gray-400 text-sm space-y-3">
        <div>Belum ada jalur tutorial khusus untuk jabatan Anda.</div>
        <a href="/panduan" class="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-[var(--p)] bg-blue-50 rounded-full">
          📘 Lihat Semua Panduan
        </a>
      </div>
    {:else}
      {#if offlineMode}
        <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 flex items-center gap-2">
          <span>📡</span>
          <span>Mode offline — menampilkan data tersimpan {offlineCachedAt ? new Date(offlineCachedAt).toLocaleString('id-ID') : ''}. Progress terbaru tidak tersedia sampai tersambung lagi.</span>
        </div>
      {/if}
      <div class="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold text-gray-700">Onboarding Anda</h2>
          <span class="text-sm font-bold text-[var(--p)]">{selesaiCount}/{checklist.length} selesai</span>
        </div>
        <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full bg-[var(--p)] transition-all" style="width: {checklist.length ? Math.round((selesaiCount / checklist.length) * 100) : 0}%"></div>
        </div>
      </div>

      <div class="space-y-3">
        {#each checklist as item (item.roleMapRow.id)}
          <div class="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
            <div class="flex items-start gap-2 mb-2">
              <span class="text-xl flex-shrink-0">{item.status === 'selesai' ? '✅' : '⏳'}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-semibold text-gray-800">{item.modul.nama}</span>
                  {#if item.roleMapRow.wajib}
                    <span class="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-700">WAJIB</span>
                  {/if}
                </div>
                <p class="text-xs text-gray-500 mt-0.5">{item.modul.deskripsi}</p>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-2 mt-3">
              {#if item.video}
                <button onclick={() => (videoAktif = item.video)} class="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium">
                  🎬 Video
                </button>
              {/if}
              <button
                onclick={() => startTour(slugFromHref(item.modul.href) || item.modul.id)}
                class="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium {item.video ? '' : 'col-span-1'}"
              >
                🧭 Mulai Tur
              </button>
              <a
                href={item.modul.href}
                class="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-white text-xs font-bold bg-[var(--p)] {item.video ? '' : 'col-span-2'}"
              >
                Buka Modul
              </a>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <a href="/panduan" class="block text-center py-3 text-sm font-medium text-[var(--p)]">
      📘 Lihat Semua Panduan &amp; FAQ →
    </a>
    <a href="/atribusi" class="block text-center pb-3 text-xs text-zinc-400">
      Atribusi Open Source
    </a>
  </div>
</div>

{#if videoAktif}
  <TutorialVideoPlayer video={videoAktif} onClose={() => (videoAktif = null)} />
{/if}
