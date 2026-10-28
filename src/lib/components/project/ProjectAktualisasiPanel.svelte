<!-- ProjectAktualisasiPanel.svelte — Aktualisasi biaya lapangan per project, dengan perbandingan vs RAB -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
  import { canAddManualAktualisasi } from '$lib/shared/moneyRouting';
  import { authStore } from '$lib/stores/auth';
  import { unitOptionsFor } from '$lib/shared/unitMaster';
  import { buildRabRows } from '$lib/shared/rabRows';
  import { onMount } from 'svelte';
  import {
    getAktualisasiByCategory,
    addAktualisasi,
    updateAktualisasi,
    deleteAktualisasi,
    getRABvsAktualisasi,
    AKTUALISASI_CATEGORIES,
    loadAktualisasiCategories,
    getPriceBySJAndMaterial,
    flushAktualisasiQueue,
    getPendingAktualisasiCount,
    findPossibleDuplicateOutflows
  } from '$lib/services/projectAktualisasiApi';
  import { getRabItems, loadFullRab } from '$lib/services/soRabApi';
  import { secureDirectusJson } from '$lib/services/secureDirectus';
  import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
  import FieldSafeSpend from '$lib/components/project/FieldSafeSpend.svelte';
  import { 
    IconReceipt2, 
    IconPackages, 
    IconUsersGroup, 
    IconTools, 
    IconBottle, 
    IconShieldCheck, 
    IconBox,
    IconChartBar,
    IconCash,
    IconCheck,
    IconAlertTriangle,
    IconLayoutGrid,
    IconChartDots,
    IconPlus,
    IconX,
    IconEdit,
    IconTrash,
    IconLock,
    IconLoader2,
    IconSparkles,
    IconTrendingUp,
    IconTrendingDown,
    IconCalendar,
    IconArrowUpRight,
    IconInfoCircle
  } from '@tabler/icons-svelte';

  const toast = {
    success: (m: string) => (window as any).__showToast && (window as any).__showToast(m, 'success'),
    error: (m: string) => (window as any).__showToast && (window as any).__showToast(m, 'error'),
    info: (m: string) => (window as any).__showToast && (window as any).__showToast(m, 'info')
  };

  let { project = null } = $props<{ project?: any }>();

  let budgetThresholds = $state<{ cost_pct_watch?: number; cost_pct_warning: number; cost_pct_critical: number }>({ cost_pct_watch: 70, cost_pct_warning: 90, cost_pct_critical: 100 });
  // PRJ-29 §4.5: input manual boleh dibatasi per role lewat setelan (bawaan 'warn' = semua boleh, ada peringatan + cek duplikat).
  let manualSetting = $state<unknown>({ mode: 'warn', allowed_roles: [] });
  const manualPolicy = $derived(canAddManualAktualisasi(manualSetting, $authStore.roleId));
  loadProjectSettings().then(() => {
    budgetThresholds = { ...budgetThresholds, ...(getProjectSetting('project.monitor.thresholds') || {}) };
    manualSetting = getProjectSetting('project.aktualisasi.manual') ?? manualSetting;
  });

  function burnStatus(actual: number, rab: number) {
    if (!rab || rab <= 0) return 'ok';
    const pct = (actual / rab) * 100;
    if (pct >= budgetThresholds.cost_pct_critical) return 'critical';
    if (pct >= budgetThresholds.cost_pct_warning) return 'warning';
    return 'ok';
  }

  const CATEGORY_ICONS: Record<string, any> = {
    operasional: IconReceipt2,
    supplier: IconPackages,
    jasa: IconUsersGroup,
    sewa_alat: IconTools,
    consumable: IconBottle,
    safety: IconShieldCheck,
    lain_lain: IconBox
  };

  let activeCategory = $state('operasional');
  let items = $state<any[]>([]);
  let rabItems = $state<any[]>([]);
  let comparison = $state<any>(null);
  let loading = $state(false);
  let loadingComp = $state(false);
  let viewMode = $state<'kartu' | 'grafik' | 'baris'>('kartu');

  let showAddForm = $state(false);
  let editingId = $state<string | number | null>(null);
  let saving = $state(false);

  // Offline resilience (Fase 5, Penajaman Finance Project v2, 10 Agustus 2026) — input
  // aktualisasi tidak boleh hilang saat sinyal lapangan lemah.
  let pendingOfflineCount = $state(0);
  function refreshPendingCount() {
    pendingOfflineCount = getPendingAktualisasiCount();
  }
  async function retryOfflineQueue() {
    const { sent } = await flushAktualisasiQueue();
    refreshPendingCount();
    if (sent > 0) {
      toast.success(`${sent} aktualisasi offline berhasil terkirim.`);
      await loadItems();
      await loadComparison();
    }
  }

  // PRJ-26: satu master satuan (bukan daftar sendiri); ejaan lama pada data tetap terlihat via unitOptionsFor.

  function emptyForm() {
    return {
      aktualisasi_date: new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000).toISOString().split('T')[0],
      budget_category: activeCategory,
      description: '',
      material_name: '',
      material_color: '',
      pic: '',
      reference_number: '',
      qty: '',
      unit: '',
      unit_price: '',
      actual_amount: '',
      catatan: ''
    };
  }
  let form = $state(emptyForm());

  let computedAmount = $derived((() => {
    const q = parseFloat(form.qty) || 0;
    const p = parseFloat(form.unit_price) || 0;
    return q && p ? q * p : parseFloat(form.actual_amount) || 0;
  })());

  let categoryItems = $derived(items.filter(i => (i.budget_category || 'operasional') === activeCategory));
  let categoryActual = $derived(categoryItems.reduce((s, i) => s + (parseFloat(i.actual_amount) || 0), 0));
  let categoryRAB = $derived(comparison?.categories?.[activeCategory]?.rab ?? 0);
  let categoryVariance = $derived(categoryRAB - categoryActual);
  let categoryBurnPct = $derived(categoryRAB > 0 ? (categoryActual / categoryRAB) * 100 : 0);
  // R8 (Audit Konfigurabilitas Lifecycle, 16 Sep 2026): kategori dimuat dari Directus di
  // onMount (loadAktualisasiCategories mutasi AKTUALISASI_CATEGORIES in-place) — `categories`
  // di-reassign SETELAH load supaya Svelte 5 rune ini ikut reaktif (mutasi array yang diimpor
  // langsung tidak memicu re-render). Sebelum load selesai, categories = fallback statis.
  let categories = $state([...AKTUALISASI_CATEGORIES]);

  let maxScale = $derived(comparison
    ? Math.max(...categories.map(c => Math.max(comparison.categories[c.id]?.rab ?? 0, comparison.categories[c.id]?.actual ?? 0)), 1)
    : 1);

  let mounted = $state(false);
  $effect(() => {
    if (mounted && activeCategory && project?.id) {
      loadItems();
    }
  });

  onMount(() => {
    refreshPendingCount();
    loadAktualisasiCategories().then(() => (categories = [...AKTUALISASI_CATEGORIES]));
    // Satu jalur auto-flush saja (bukan registerAktualisasiAutoFlush() JUGA — dua listener
    // 'online' terpisah bisa memicu flushQueue() dua kali bersamaan dan mengirim entri offline
    // yang sama dua kali sebelum salah satunya sempat menghapusnya dari antrian).
    // Listener dilepas saat komponen dibongkar (PRJ-05) — {#key} per proyek membuat ulang komponen.
    const onOnline = () => setTimeout(retryOfflineQueue, 1500);
    window.addEventListener('online', onOnline);
    if (project?.id) {
      // RAB harus selesai dimuat SEBELUM perbandingan dihitung (kalau tidak Total RAP = Rp0).
      // `mounted` terakhir: $effect di atas yang memanggil loadItems() — sekali saja.
      (async () => {
        await loadRABItems();
        await loadComparison();
        mounted = true;
      })();
    }
    return () => window.removeEventListener('online', onOnline);
  });

  async function loadItems() {
    loading = true;
    try {
      const res = await getAktualisasiByCategory(project.id, activeCategory);
      if (res.success) {
        items = [
          ...items.filter(i => (i.budget_category || 'operasional') !== activeCategory),
          ...res.data
        ];
      }
    } finally {
      loading = false;
    }
  }

  async function loadRABItems() {
    try {
      let fetchedItems: any[] = [];
      const soId = typeof project.so_customer_id === 'object' ? project.so_customer_id?.id : project.so_customer_id;
      if (soId) {
        const res = await loadFullRab(soId);
        if (res.success && res.rab) {
          const itemsRes = await getRabItems(res.rab.id);
          if (itemsRes.success) {
            fetchedItems = [...fetchedItems, ...itemsRes.data];
          }
        }
      }

      if (project?.id) {
        const directData = await secureDirectusJson(`/items/project_budgets?filter[project_id][_eq]=${project.id}&fields=id,budget_category,planned_amount,is_category_header,material_name,description,qty,unit,unit_price,so_rab_id,project_id&limit=-1`).catch(() => null);
        if (directData?.data) {
          const existingIds = new Set(fetchedItems.map(i => i.id));
          const newItems = directData.data.filter((i: any) => !existingIds.has(i.id));
          fetchedItems = [...fetchedItems, ...newItems];
        }
      }

      rabItems = fetchedItems;
    } catch (e) {
      console.error("Failed to load RAB items:", e);
    }
  }

  async function loadComparison() {
    loadingComp = true;
    const res = await getRABvsAktualisasi(project.id, rabItems);
    if (res.success) comparison = res.data;
    loadingComp = false;
  }

  async function handleAdd() {
    if (!project?.id || saving) return;
    saving = true;
    try {
      // PRJ-29: biaya manual dengan nominal & tanggal sama dengan PA/Biaya tercatat (±7 hari) kemungkinan dobel.
      const dup = await findPossibleDuplicateOutflows(project.id, Number(computedAmount) || 0, form.aktualisasi_date || new Date().toISOString().slice(0, 10));
      if (dup.length > 0 && !confirm(['Biaya dengan nominal sama sudah tercatat:', ...dup.map((x) => '- ' + x.label), '', 'Biaya sebaiknya lewat Keluar Uang agar ada approval dan tidak tercatat dua kali. Tetap simpan sebagai aktualisasi manual?'].join('\n'))) return;
      const res = await addAktualisasi(project.id, { ...form, budget_category: activeCategory, actual_amount: computedAmount });
      if (res.success && res.queued) {
        // Offline — belum ada id server, jangan dimasukkan ke `items` (nanti dobel saat sync).
        form = emptyForm();
        showAddForm = false;
        refreshPendingCount();
        toast.info(res.message);
      } else if (res.success) {
        items = [...items, res.data];
        form = emptyForm();
        showAddForm = false;
        await loadComparison();
        toast.success(res.message);
      } else {
        toast.error(res.error || 'Gagal menyimpan');
      }
    } finally {
      saving = false;
    }
  }

  function handleEdit(item: any) {
    editingId = item.id;
    form = {
      aktualisasi_date: item.aktualisasi_date || '',
      budget_category: item.budget_category || 'operasional',
      description: item.description || '',
      material_name: item.material_name || '',
      material_color: item.material_color || '',
      pic: item.pic || '',
      reference_number: item.reference_number || '',
      qty: item.qty || '',
      unit: item.unit || '',
      unit_price: item.unit_price || '',
      actual_amount: item.actual_amount || '',
      catatan: item.catatan || ''
    };
    showAddForm = true;
  }

  async function handleUpdate() {
    if (!editingId || saving) return;
    saving = true;
    try {
      const res = await updateAktualisasi(editingId, { ...form, actual_amount: computedAmount });
      if (res.success) {
        items = items.map(i => i.id === editingId ? { ...i, ...res.data } : i);
        cancelForm();
        await loadComparison();
        toast.success('Aktualisasi berhasil diupdate');
      } else {
        toast.error(res.error || 'Gagal update');
      }
    } finally {
      saving = false;
    }
  }

  async function handleDelete(itemId: string | number) {
    if (!confirm('Hapus data aktualisasi ini?')) return;
    const res = await deleteAktualisasi(itemId);
    if (res.success) {
      items = items.filter(i => i.id !== itemId);
      await loadComparison();
      toast.success(res.message);
    } else {
      toast.error(res.error || 'Gagal menghapus');
    }
  }

  function cancelForm() {
    editingId = null;
    form = emptyForm();
    showAddForm = false;
  }

  async function lookupPrice() {
    if (activeCategory === 'supplier' && form.reference_number && form.material_name) {
      try {
        const price = await getPriceBySJAndMaterial(form.reference_number, form.material_name);
        if (price > 0) {
          form.unit_price = price;
          toast.success(`Harga otomatis diisi: ${formatRp(price)}`);
        }
      } catch (err) {
        console.error('Failed to lookup price:', err);
      }
    }
  }

  function formatRp(v: number) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v || 0);
  }

  function formatDate(d: string) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  let activeCatMeta = $derived(categories.find(c => c.id === activeCategory));
  let ActiveIconComponent = $derived(CATEGORY_ICONS[activeCategory] || IconBox);
</script>

<div class="flex flex-col gap-6">

  <!-- 1. Top KPI Summary Metric Cards -->
  {#if !comparison && loadingComp}
    <div class="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/60 animate-pulse" aria-label="Memuat perbandingan RAP vs Aktual"></div>
  {/if}
  {#if comparison}
    {@const overallBurnPct = comparison.grand_rab > 0 ? ((comparison.grand_actual / comparison.grand_rab) * 100).toFixed(1) : '0.0'}

    <!-- PRJ-06/10: definisi Total RAP + info data yang tidak ikut terhitung (tidak dibuang diam-diam) -->
    <p class="text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
      <IconInfoCircle size={13} class="shrink-0 mt-0.5" />
      <span>
        Total RAP = jumlah RAP proyek ini (tidak termasuk budget Packing List). Kategori Man Power dihitung di Jasa; Reimbursement di Operasional.
        {#if (comparison.packing_outside_rap ?? 0) > 0}
          Kebutuhan Packing List di luar RAP: <strong>{formatRp(comparison.packing_outside_rap)}</strong>.
        {/if}
        {#if (comparison.akrual_belum_final ?? 0) > 0}
          Realisasi sudah termasuk <strong>akrual gaji dari absensi {formatRp(comparison.akrual_belum_final)}</strong> yang belum difinalkan lewat Payroll Run; bila gaji periode yang sama juga dibayar lewat Pengajuan Anggaran, biayanya bisa terhitung dua kali — Finance akan merekonsiliasi.
        {/if}
        {#if Object.keys(comparison.unknown_categories ?? {}).length > 0}
          Kategori tak dikenal dimasukkan ke Lain-lain: {Object.entries(comparison.unknown_categories ?? {}).map(([k, n]) => `${k || '(kosong)'} (${n} baris)`).join(', ')}.
        {/if}
      </span>
    </p>

    <!-- F6.3 — Burn Rate Alert (ambang dari setelan project.monitor.thresholds: watch/warning/critical) -->
    {@const burnNum = comparison.grand_rab > 0 ? (comparison.grand_actual / comparison.grand_rab) * 100 : 0}
    {#if burnNum >= (budgetThresholds.cost_pct_watch ?? 70)}
      {@const lvl = burnNum >= budgetThresholds.cost_pct_critical ? 'kritis' : burnNum >= budgetThresholds.cost_pct_warning ? 'tinggi' : 'pantau'}
      <div class="rounded-xl border p-3.5 flex items-start gap-3
        {lvl === 'kritis'
          ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60'
          : lvl === 'tinggi'
            ? 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800/60'
            : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60'}">
        <div class="shrink-0 mt-0.5
          {lvl === 'kritis' ? 'text-rose-600 dark:text-rose-400' : lvl === 'tinggi' ? 'text-orange-600 dark:text-orange-400' : 'text-amber-600 dark:text-amber-400'}">
          <IconAlertTriangle size={20} />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-bold
            {lvl === 'kritis' ? 'text-rose-800 dark:text-rose-200' : lvl === 'tinggi' ? 'text-orange-800 dark:text-orange-200' : 'text-amber-800 dark:text-amber-200'}">
            {lvl === 'kritis'
              ? '🔴 Anggaran proyek hampir / sudah habis'
              : lvl === 'tinggi'
                ? '🟠 Burn rate tinggi — segera rem pengeluaran'
                : '🟡 Burn rate perlu dipantau ketat'}
            — {burnNum.toFixed(1)}% terpakai
          </p>
          <p class="text-xs mt-0.5
            {lvl === 'kritis' ? 'text-rose-700 dark:text-rose-300' : lvl === 'tinggi' ? 'text-orange-700 dark:text-orange-300' : 'text-amber-700 dark:text-amber-300'}">
            Realisasi {formatRp(comparison.grand_actual)} dari RAP {formatRp(comparison.grand_rab)} · sisa {formatRp(comparison.grand_rab - comparison.grand_actual)}.
            {lvl === 'pantau' ? '' : ' Koordinasikan dengan Project Leader & Project Manager sebelum pengeluaran berikutnya.'}
          </p>
        </div>
      </div>
    {/if}

    <!-- Safe-Spend: apakah pagu aman dipakai, termasuk dana yang masih tertahan di pusat (persen saja) -->
    <FieldSafeSpend projectId={project?.id} />

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <!-- Card Total RAP -->
      <div class="bg-gray-50/70 dark:bg-[#121A22] border border-gray-200/80 dark:border-[#2B3844] rounded-xl p-4 transition-all hover:shadow-xs">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total RAP</span>
          <div class="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <IconChartBar size={18} />
          </div>
        </div>
        <div class="text-xl font-extrabold text-gray-900 dark:text-white">
          {formatRp(comparison.grand_rab)}
        </div>
        <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1">
          <IconInfoCircle size={12} class="text-blue-500" />
          Rencana Anggaran Biaya Proyek
        </p>
      </div>

      <!-- Card Total Aktualisasi -->
      <div class="bg-gray-50/70 dark:bg-[#121A22] border border-gray-200/80 dark:border-[#2B3844] rounded-xl p-4 transition-all hover:shadow-xs">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Realisasi</span>
          <div class="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <IconCash size={18} />
          </div>
        </div>
        <div class="text-xl font-extrabold text-gray-900 dark:text-white">
          {formatRp(comparison.grand_actual)}
        </div>
        <div class="mt-1 flex items-center gap-2">
          <div class="flex-1 h-1.5 bg-gray-200 dark:bg-[#232F3B] rounded-full overflow-hidden">
            <div 
              class="h-full transition-all duration-500 rounded-full {parseFloat(overallBurnPct) >= 100 ? 'bg-rose-500' : parseFloat(overallBurnPct) >= 90 ? 'bg-amber-500' : 'bg-emerald-500'}" 
              style="width: {Math.min(parseFloat(overallBurnPct), 100)}%"
            ></div>
          </div>
          <span class="text-[11px] font-bold text-gray-600 dark:text-gray-300">{overallBurnPct}%</span>
        </div>
      </div>

      <!-- Card Selisih Budget -->
      <div class="bg-gray-50/70 dark:bg-[#121A22] border border-gray-200/80 dark:border-[#2B3844] rounded-xl p-4 transition-all hover:shadow-xs">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Selisih Budget</span>
          <div class="w-8 h-8 rounded-lg flex items-center justify-center {comparison.grand_variance >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}">
            {#if comparison.grand_variance >= 0}
              <IconTrendingUp size={18} />
            {:else}
              <IconTrendingDown size={18} />
            {/if}
          </div>
        </div>
        <div class="text-xl font-extrabold {comparison.grand_variance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          {formatRp(Math.abs(comparison.grand_variance))}
        </div>
        <p class="text-[11px] font-semibold mt-1 flex items-center gap-1 {comparison.grand_variance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          {#if comparison.grand_variance >= 0}
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span> Sisa Anggaran Aman
          {:else}
            <span class="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block animate-pulse"></span> Over Budget (Melebihi RAP)
          {/if}
        </p>
      </div>
    </div>

    <!-- View Mode Switcher -->
    <div class="flex items-center justify-between border-b border-gray-200/80 dark:border-[#2B3844] pb-3">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Kategori Biaya</span>
      </div>
      <div class="inline-flex p-1 bg-gray-100 dark:bg-[#121A22] rounded-xl border border-gray-200/80 dark:border-[#2B3844]">
        <button 
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer {viewMode === 'kartu' ? 'bg-white dark:bg-[#1B2530] text-blue-600 dark:text-blue-400 shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}"
          onclick={() => (viewMode = 'kartu')}
        >
          <IconLayoutGrid size={14} /> Kartu Kategori
        </button>
        <button 
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer {viewMode === 'grafik' ? 'bg-white dark:bg-[#1B2530] text-blue-600 dark:text-blue-400 shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}"
          onclick={() => (viewMode = 'grafik')}
        >
          <IconChartDots size={14} /> Grafik Komparasi
        </button>
        <button 
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer {viewMode === 'baris' ? 'bg-white dark:bg-[#1B2530] text-blue-600 dark:text-blue-400 shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}"
          onclick={() => (viewMode = 'baris')}
          title="Lihat terpakai & sisa per pos RAP (barang). Realisasi yang belum dipilihkan pos RAP-nya ada di baris 'Belum ditautkan'."
        >
          <IconReceipt2 size={14} /> Per Baris RAP
        </button>
      </div>
    </div>

    {#if viewMode === 'kartu'}
      <!-- Interactive Category Cards -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {#each categories as cat}
          {@const d = comparison.categories[cat.id]}
          {@const burn = burnStatus(d?.actual ?? 0, d?.rab ?? 0)}
          {@const CatIcon = CATEGORY_ICONS[cat.id] || IconBox}
          {@const catPct = (d?.rab ?? 0) > 0 ? Math.min(((d?.actual ?? 0) / d.rab) * 100, 100) : 0}
          
          <button
            type="button"
            class="flex flex-col justify-between p-3 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden group
              {activeCategory === cat.id 
                ? 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-500 dark:border-blue-500/80 ring-2 ring-blue-500/20 shadow-xs' 
                : 'bg-white dark:bg-[#121A22] border-gray-200/80 dark:border-[#2B3844] hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50/50 dark:hover:bg-[#18232F]'}"
            onclick={() => { activeCategory = cat.id; cancelForm(); }}
          >
            <!-- Card Header -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <div class="w-7 h-7 rounded-lg flex items-center justify-center transition-colors
                  {activeCategory === cat.id ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-[#232F3B] text-gray-600 dark:text-gray-300 group-hover:bg-gray-200 dark:group-hover:bg-[#2B3844]'}">
                  <CatIcon size={16} />
                </div>
                {#if burn === 'critical'}
                  <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping" title="Over budget"></span>
                {:else if burn === 'warning'}
                  <span class="w-2 h-2 rounded-full bg-amber-500" title="Mendekati limit"></span>
                {/if}
              </div>
              
              <div class="text-[12px] font-bold text-gray-800 dark:text-gray-200 line-clamp-1 mb-2">
                {cat.label}
              </div>
            </div>

            <!-- Card Body & Amounts -->
            <div class="space-y-1 mt-1">
              <div class="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                <span>RAP</span>
                <span class="font-semibold text-gray-700 dark:text-gray-300">{formatRp(d?.rab)}</span>
              </div>
              <div class="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                <span>Aktual</span>
                <span class="font-semibold text-gray-900 dark:text-white">{formatRp(d?.actual)}</span>
              </div>

              <!-- Mini Progress Bar -->
              <div class="w-full h-1 bg-gray-100 dark:bg-[#232F3B] rounded-full overflow-hidden my-1.5">
                <div 
                  class="h-full rounded-full transition-all duration-300 {burn === 'critical' ? 'bg-rose-500' : burn === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}"
                  style="width: {catPct}%"
                ></div>
              </div>

              <!-- Variance Status -->
              <div class="text-[10px] font-bold text-right pt-0.5 { (d?.variance ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400' }">
                {(d?.variance ?? 0) >= 0 ? 'Sisa ' : 'Over '}{formatRp(Math.abs(d?.variance ?? 0))}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {:else if viewMode === 'baris'}
      {@const rr = buildRabRows(rabItems, comparison.per_rab ?? {}, comparison.unlinked_actual ?? 0)}
      <div class="rounded-xl border border-gray-200/80 dark:border-[#2B3844] overflow-hidden">
        <div class="px-3 py-2 bg-gray-50 dark:bg-[#121A22] text-[11px] text-gray-500 dark:text-gray-400">
          Pilih pos RAP saat mengajukan anggaran agar sisa per barang terlihat di sini. Terpakai dihitung dari realisasi yang sudah ditautkan ke pos RAP.
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="bg-gray-50/70 dark:bg-[#121A22]/70 text-gray-500 dark:text-gray-400">
              <tr><th class="text-left px-3 py-2">Pos RAP</th><th class="text-right px-3 py-2">RAP</th><th class="text-right px-3 py-2">Terpakai</th><th class="text-right px-3 py-2">Sisa</th><th class="text-right px-3 py-2">%</th></tr>
            </thead>
            <tbody>
              {#each rr.rows as r (r.id)}
                <tr class="border-t border-gray-100 dark:border-[#2B3844] {r.over ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}">
                  <td class="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{r.label}<span class="ml-1.5 text-[10px] text-gray-400">{r.bucket}</span></td>
                  <td class="px-3 py-2 text-right">{formatRp(r.rap)}</td>
                  <td class="px-3 py-2 text-right">{formatRp(r.terpakai)}</td>
                  <td class="px-3 py-2 text-right font-semibold {r.sisa < 0 ? 'text-rose-600' : 'text-emerald-600'}">{formatRp(r.sisa)}</td>
                  <td class="px-3 py-2 text-right">{r.pct === null ? '-' : r.pct.toFixed(0) + '%'}</td>
                </tr>
              {:else}
                <tr><td colspan="5" class="px-3 py-6 text-center text-gray-400">Belum ada baris RAP barang untuk proyek ini.</td></tr>
              {/each}
              <tr class="border-t-2 border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20">
                <td class="px-3 py-2 font-semibold text-amber-800 dark:text-amber-300">Belum ditautkan ke pos RAP</td>
                <td class="px-3 py-2 text-right">-</td>
                <td class="px-3 py-2 text-right font-semibold">{formatRp(rr.unlinkedActual)}</td>
                <td class="px-3 py-2 text-right" colspan="2"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    {:else}
      <!-- Bar Chart View -->
      <div class="bg-gray-50/70 dark:bg-[#121A22] border border-gray-200/80 dark:border-[#2B3844] rounded-xl p-4 sm:p-5 space-y-4">
        <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#2B3844] pb-3">
          <span class="font-semibold text-gray-700 dark:text-gray-300">Perbandingan RAP vs Realisasi Per Kategori</span>
          <div class="flex items-center gap-4">
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-xs bg-blue-500"></span> RAP</span>
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-xs bg-emerald-500"></span> Aktual (Aman)</span>
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-xs bg-rose-500"></span> Aktual (Over)</span>
          </div>
        </div>

        <div class="space-y-4">
          {#each categories as cat}
            {@const d = comparison.categories[cat.id]}
            {@const rabPct = maxScale > 0 ? Math.min(((d?.rab ?? 0) / maxScale) * 100, 100) : 0}
            {@const actualPct = maxScale > 0 ? Math.min(((d?.actual ?? 0) / maxScale) * 100, 100) : 0}
            {@const isOver = (d?.actual ?? 0) > (d?.rab ?? 0)}
            {@const CatIcon = CATEGORY_ICONS[cat.id] || IconBox}

            <button
              type="button"
              class="w-full flex items-center gap-3 p-3 rounded-xl border border-transparent hover:border-gray-200 dark:hover:border-[#2B3844] hover:bg-white dark:hover:bg-[#1B2530] transition-all text-left group cursor-pointer"
              onclick={() => { activeCategory = cat.id; viewMode = 'kartu'; cancelForm(); }}
            >
              <div class="w-8 h-8 rounded-lg bg-gray-200/60 dark:bg-[#232F3B] text-gray-700 dark:text-gray-300 flex items-center justify-center shrink-0">
                <CatIcon size={18} />
              </div>
              <div class="w-32 shrink-0">
                <p class="text-xs font-bold text-gray-800 dark:text-gray-200 line-clamp-1">{cat.label}</p>
                <p class="text-[10px] text-gray-400">Klik detail</p>
              </div>

              <div class="flex-1 space-y-1.5 min-w-0">
                <!-- RAP Bar -->
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-semibold text-gray-400 w-10 text-right shrink-0">RAP</span>
                  <div class="flex-1 h-2 bg-gray-200/80 dark:bg-[#232F3B] rounded-full overflow-hidden">
                    <div class="h-full bg-blue-500 rounded-full transition-all duration-500" style="width: {rabPct}%"></div>
                  </div>
                  <span class="text-[11px] font-medium text-gray-700 dark:text-gray-300 w-28 text-right shrink-0">{formatRp(d?.rab ?? 0)}</span>
                </div>
                <!-- Actual Bar -->
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-semibold text-gray-400 w-10 text-right shrink-0">Aktual</span>
                  <div class="flex-1 h-2 bg-gray-200/80 dark:bg-[#232F3B] rounded-full overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-500 {isOver ? 'bg-rose-500' : 'bg-emerald-500'}" style="width: {actualPct}%"></div>
                  </div>
                  <span class="text-[11px] font-bold w-28 text-right shrink-0 {isOver ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}">
                    {formatRp(d?.actual ?? 0)}
                  </span>
                </div>
              </div>

              <div class="w-28 text-right shrink-0">
                <span class="text-xs font-bold px-2.5 py-1 rounded-lg inline-block { (d?.variance ?? 0) >= 0 ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50' }">
                  {(d?.variance ?? 0) >= 0 ? '✅ ' : '⚠️ '}{formatRp(Math.abs(d?.variance ?? 0))}
                </span>
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}

  <!-- 2. Active Category Header & Action Bar -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/80 dark:bg-[#121A22] border border-gray-200/80 dark:border-[#2B3844] p-4 rounded-xl">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
        <ActiveIconComponent size={20} />
      </div>
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-base font-extrabold text-gray-900 dark:text-white leading-tight">
            {activeCatMeta?.label}
          </h2>
          {#if categoryRAB > 0}
            <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              RAP: {formatRp(categoryRAB)}
            </span>
          {/if}
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Total Aktualisasi Terdaftar: <strong class="text-gray-900 dark:text-white font-bold">{formatRp(categoryActual)}</strong>
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2 shrink-0">
      {#if pendingOfflineCount > 0}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 cursor-pointer"
          onclick={retryOfflineQueue}
          title="Klik untuk coba kirim sekarang"
        >
          📡 {pendingOfflineCount} menunggu sinyal
        </button>
      {/if}
      {#if manualPolicy.allowed}
      <button
        type="button"
        class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-orange-600 hover:bg-orange-700 text-white transition-all shadow-xs cursor-pointer active:scale-95"
        onclick={() => { cancelForm(); showAddForm = !showAddForm; }}
      >
        {#if showAddForm && !editingId}
          <IconX size={16} /> Batal
        {:else}
          <IconPlus size={16} /> Tambah Aktualisasi
        {/if}
      </button>
      {:else}
        <!-- Input manual dibatasi (setelan project.aktualisasi.manual): arahkan ke pintu yang benar. -->
        <a href={`/procurement/keluar-uang?project_id=${project?.id ?? ''}`} class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white" title="Input manual dibatasi untuk role tertentu. Catat biaya lewat Keluar Uang agar ada approval dan tidak tercatat dua kali.">
          💸 Catat lewat Keluar Uang
        </a>
      {/if}
    </div>
  </div>

  <!-- Budget Warning Banner if Critical or Warning -->
  {#if categoryRAB > 0 && categoryBurnPct >= budgetThresholds.cost_pct_warning}
    {@const burn = burnStatus(categoryActual, categoryRAB)}
    <div class="p-3.5 rounded-xl border flex items-center gap-3 text-xs font-semibold
      {burn === 'critical' ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-300'}">
      <IconAlertTriangle size={18} class="shrink-0" />
      <div class="flex-1">
        {#if burn === 'critical'}
          <strong>Peringatan Over Budget!</strong> Pengeluaran kategori {activeCatMeta?.label} telah melebihi batas RAP ({categoryBurnPct.toFixed(1)}%).
        {:else}
          <strong>Perhatian:</strong> Pengeluaran kategori {activeCatMeta?.label} telah mencapai {categoryBurnPct.toFixed(1)}% dari RAP.
        {/if}
      </div>
    </div>
  {/if}

  <!-- 3. Add/Edit Form Collapsible -->
  {#if showAddForm}
    {#if !editingId}
      <!-- PRJ-29: input manual hanya untuk biaya yang BELUM lewat kanal lain; cek duplikat berjalan saat Simpan. -->
      <div class="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
        💡 Biaya ini sebaiknya lewat <a href="/procurement/keluar-uang?project_id={project?.id}" class="underline font-semibold">Keluar Uang</a> agar ada approval dan tidak tercatat dua kali. Pakai input manual hanya bila biaya belum dicatat di Pengajuan Anggaran, Beli Lokal, atau Biaya Lapangan.
      </div>
    {/if}
    <div class="bg-gray-50/90 dark:bg-[#121A22] border-2 border-orange-500/30 rounded-2xl p-4 sm:p-6 space-y-4 shadow-sm transition-all">
      <div class="flex items-center justify-between border-b border-gray-200 dark:border-[#2B3844] pb-3">
        <h3 class="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          {#if editingId}
            <IconEdit size={16} class="text-orange-500" /> Edit Data Aktualisasi
          {:else}
            <IconPlus size={16} class="text-orange-500" /> Form Input Aktualisasi Baru ({activeCatMeta?.label})
          {/if}
        </h3>
        <span class="text-[11px] text-gray-500 dark:text-gray-400">Kategori: <strong>{activeCatMeta?.label}</strong></span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <!-- Tanggal -->
        <div class="space-y-1.5">
          <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Tanggal Pengeluaran</label>
          <input 
            type="date" 
            bind:value={form.aktualisasi_date}
            class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>

        <!-- Conditional Fields based on Category -->
        {#if activeCategory === 'operasional' || activeCategory === 'jasa' || activeCategory === 'lain_lain'}
          <div class="space-y-1.5">
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Nama PIC</label>
            <input 
              type="text" 
              bind:value={form.pic} 
              placeholder="Contoh: Budi (Mekanik)..." 
              class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div class="sm:col-span-2 space-y-1.5">
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Keterangan / Uraian</label>
            <input 
              type="text" 
              bind:value={form.description} 
              placeholder="Rincian pengeluaran operasional..." 
              class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
            />
          </div>
        {:else if activeCategory === 'supplier'}
          <div class="space-y-1.5">
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">No. SJ / Faktur / PO</label>
            <input 
              type="text" 
              bind:value={form.reference_number} 
              onblur={lookupPrice} 
              placeholder="SJ/2026/..." 
              class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div class="sm:col-span-2 space-y-1.5">
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Nama Material</label>
            <input 
              type="text" 
              bind:value={form.material_name} 
              onblur={lookupPrice} 
              placeholder="Cat Epoxy Primer..." 
              class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div class="space-y-1.5">
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Warna / Tipe</label>
            <input 
              type="text" 
              bind:value={form.material_color} 
              placeholder="Abu-abu / RAL 7035..." 
              class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
            />
          </div>
        {:else if activeCategory === 'sewa_alat'}
          <div class="space-y-1.5">
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">No. Surat Internal</label>
            <input 
              type="text" 
              bind:value={form.reference_number} 
              placeholder="SURAT/SEWA/..." 
              class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div class="sm:col-span-2 space-y-1.5">
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Nama Alat Internal</label>
            <input 
              type="text" 
              bind:value={form.description} 
              placeholder="Kompresor High Pressure..." 
              class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
            />
          </div>
        {:else}
          <div class="sm:col-span-3 space-y-1.5">
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Uraian Pengeluaran</label>
            <input 
              type="text" 
              bind:value={form.description} 
              placeholder="Penjelasan item..." 
              class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
            />
          </div>
        {/if}

        <!-- Qty -->
        <div class="space-y-1.5">
          <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Jumlah (Qty)</label>
          <input 
            type="number" 
            bind:value={form.qty} 
            min="0" 
            step="0.01" 
            placeholder="0" 
            class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
          />
        </div>

        <!-- Satuan -->
        <div class="space-y-1.5">
          <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Satuan</label>
          <select 
            bind:value={form.unit}
            class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500 cursor-pointer"
          >
            <option value="">— Pilih Satuan —</option>
            {#each unitOptionsFor(form.unit) as u}
              <option value={u}>{u}</option>
            {/each}
          </select>
        </div>

        <!-- Harga Satuan -->
        <div class="space-y-1.5">
          <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Harga Satuan (Rp)</label>
          <input 
            type="number" 
            bind:value={form.unit_price} 
            min="0" 
            placeholder="0" 
            class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
          />
        </div>

        <!-- Total Calculated Amount Display -->
        <div class="space-y-1.5 bg-orange-500/10 border border-orange-500/30 rounded-xl p-2.5 flex flex-col justify-center">
          <span class="block text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">Total Aktualisasi</span>
          <span class="text-base font-extrabold text-orange-600 dark:text-orange-400 truncate">
            {formatRp(computedAmount)}
          </span>
        </div>

        <!-- Catatan tambahan -->
        <div class="col-span-full space-y-1.5">
          <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">Catatan Tambahan (Opsional)</label>
          <input 
            type="text" 
            bind:value={form.catatan} 
            placeholder="Catatan internal..." 
            class="w-full bg-white dark:bg-[#1B2530] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-orange-500"
          />
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center justify-end gap-3 pt-2 border-t border-gray-200 dark:border-[#2B3844]">
        <button
          type="button"
          class="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#232F3B] transition-colors cursor-pointer"
          onclick={cancelForm}
        >
          Batal
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white transition-all cursor-pointer shadow-xs active:scale-95 disabled:opacity-50"
          onclick={editingId ? handleUpdate : handleAdd}
          disabled={saving}
        >
          {#if saving}
            <IconLoader2 size={14} class="animate-spin" /> Menyimpan...
          {:else if editingId}
            <IconEdit size={14} /> Update Data
          {:else}
            <IconCheck size={14} /> Simpan Data
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- 4. Table / List Data -->
  {#if loading}
    <CircularProgressGauge size={52} strokeWidth={4} label="Memuat rincian data aktualisasi..." />
  {:else if categoryItems.length === 0}
    <div class="flex flex-col items-center justify-center py-12 bg-gray-50/50 dark:bg-[#121A22] rounded-xl border border-dashed border-gray-200 dark:border-[#2B3844] text-center px-4">
      <div class="w-12 h-12 bg-gray-100 dark:bg-[#232F3B] text-gray-400 dark:text-gray-500 rounded-xl flex items-center justify-center mb-3">
        <IconBox size={24} />
      </div>
      <p class="text-sm font-bold text-gray-700 dark:text-gray-300">Belum Ada Data Aktualisasi</p>
      <p class="text-xs text-gray-400 dark:text-gray-500 max-w-xs mt-0.5">Belum ada catatan pengeluaran aktual untuk kategori {activeCatMeta?.label}.</p>
    </div>
  {:else}
    <div class="overflow-x-auto rounded-xl border border-gray-200/80 dark:border-[#2B3844]">
      <table class="w-full text-left text-xs">
        <thead class="bg-gray-100/80 dark:bg-[#121A22] text-gray-600 dark:text-gray-400 font-bold border-b border-gray-200 dark:border-[#2B3844] uppercase tracking-wider text-[10px]">
          <tr>
            <th class="py-3 px-3.5 w-10 text-center">No</th>
            <th class="py-3 px-3.5 whitespace-nowrap">Tanggal</th>
            {#if activeCategory === 'operasional' || activeCategory === 'jasa' || activeCategory === 'lain_lain'}
              <th class="py-3 px-3.5">PIC</th>
            {/if}
            <th class="py-3 px-3.5">Uraian / Material</th>
            {#if activeCategory === 'supplier'}<th class="py-3 px-3.5">Warna</th>{/if}
            {#if activeCategory !== 'operasional' && activeCategory !== 'jasa'}
              <th class="py-3 px-3.5 text-right">Qty</th>
              <th class="py-3 px-3.5">Satuan</th>
            {/if}
            <th class="py-3 px-3.5 text-right">Harga Satuan</th>
            <th class="py-3 px-3.5 text-right">Total Aktual</th>
            {#if activeCategory === 'supplier' || activeCategory === 'sewa_alat'}
              <th class="py-3 px-3.5">Ref / No. SJ</th>
            {/if}
            <th class="py-3 px-3.5 text-center w-20">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200/60 dark:divide-[#2B3844] text-gray-800 dark:text-gray-200">
          {#each categoryItems as item, i}
            <tr class="hover:bg-gray-50/70 dark:hover:bg-[#18232F] transition-colors {editingId === item.id ? 'bg-orange-50/50 dark:bg-orange-950/20' : ''}">
              <td class="py-3 px-3.5 text-center text-gray-400 font-medium">{i + 1}</td>
              <td class="py-3 px-3.5 whitespace-nowrap font-medium">{formatDate(item.aktualisasi_date)}</td>
              {#if activeCategory === 'operasional' || activeCategory === 'jasa' || activeCategory === 'lain_lain'}
                <td class="py-3 px-3.5 font-semibold text-gray-700 dark:text-gray-300">{item.pic || '-'}</td>
              {/if}
              <td class="py-3 px-3.5">
                <div class="font-bold text-gray-900 dark:text-white">{item.material_name || item.description || '-'}</div>
                {#if item.catatan}
                  <div class="text-[10px] text-gray-400 dark:text-gray-500 italic mt-0.5">{item.catatan}</div>
                {/if}
              </td>
              {#if activeCategory === 'supplier'}
                <td class="py-3 px-3.5 text-gray-600 dark:text-gray-400">{item.material_color || '-'}</td>
              {/if}
              {#if activeCategory !== 'operasional' && activeCategory !== 'jasa'}
                <td class="py-3 px-3.5 text-right font-medium">{item.qty ? parseFloat(item.qty).toFixed(2) : '-'}</td>
                <td class="py-3 px-3.5 text-gray-500">{item.unit || '-'}</td>
              {/if}
              <td class="py-3 px-3.5 text-right font-medium text-gray-600 dark:text-gray-400">{formatRp(item.unit_price)}</td>
              <td class="py-3 px-3.5 text-right font-extrabold text-orange-600 dark:text-orange-400">{formatRp(item.actual_amount)}</td>
              {#if activeCategory === 'supplier' || activeCategory === 'sewa_alat'}
                <td class="py-3 px-3.5 font-mono text-[11px] text-gray-600 dark:text-gray-400">{item.reference_number || '-'}</td>
              {/if}
              <td class="py-3 px-3.5 text-center">
                {#if item.is_manual}
                  <div class="inline-flex items-center gap-1">
                    <button 
                      type="button"
                      class="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-[#232F3B] text-gray-500 hover:text-blue-600 transition-colors cursor-pointer" 
                      onclick={() => handleEdit(item)}
                      title="Edit"
                    >
                      <IconEdit size={15} />
                    </button>
                    <button 
                      type="button"
                      class="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/50 text-gray-500 hover:text-rose-600 transition-colors cursor-pointer" 
                      onclick={() => handleDelete(item.id)}
                      title="Hapus"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                {:else}
                  <span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#232F3B] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-[#2B3844]" title="Dibuat otomatis oleh system (SJ / Petty Cash)">
                    <IconLock size={11} /> Auto
                  </span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
        <tfoot class="bg-gray-50 dark:bg-[#121A22] border-t-2 border-gray-200 dark:border-[#2B3844] font-bold text-gray-800 dark:text-gray-200">
          <tr>
            <td colspan="100" class="py-3 px-4">
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span class="text-gray-500 dark:text-gray-400 font-semibold">
                  Subtotal Realisasi {activeCatMeta?.label}:
                </span>
                <div class="flex items-center gap-3">
                  <strong class="text-sm font-extrabold text-orange-600 dark:text-orange-400">{formatRp(categoryActual)}</strong>
                  {#if categoryRAB > 0}
                    <span class="text-gray-300 dark:text-gray-600">•</span>
                    <span class="text-gray-500 dark:text-gray-400">RAP: {formatRp(categoryRAB)}</span>
                    <span class="text-gray-300 dark:text-gray-600">•</span>
                    <span class="{ (categoryVariance >= 0) ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400' } font-bold">
                      {categoryVariance >= 0 ? 'Sisa: ' : 'Over: '}{formatRp(Math.abs(categoryVariance))}
                    </span>
                  {/if}
                </div>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  {/if}
</div>

