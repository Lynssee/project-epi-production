<!-- ProjectCharterTab.svelte — Project Charter Form & Detail for Project Leader -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { authStore } from '$lib/stores/auth';
  import { auth } from '$lib/firebase';
  import {
    loadFullCharter,
    createProjectCharter,
    updateProjectCharter,
    submitCharter,
    getSurveyGate,
    WAKTU_KERJA_OPTIONS,
    SHIFT_KERJA_OPTIONS,
    LEMBUR_OPTIONS,
    YA_TIDAK_OPTIONS,
    IJIN_BARANG_OPTIONS,
    ALAT_LOADING_OPTIONS,
    JENIS_MANPOWER_OPTIONS,
    VERIFIKASI_KONTRAK_OPTIONS,
    PERSIAPAN_PERMUKAAN_OPTIONS,
    SATUAN_UKURAN_OPTIONS
  } from '$lib/services/projectCharter';
  import {
    optionsWithLegacy,
    normalizeCharterValue,
    isLembur,
    validateCharterForm
  } from '$lib/shared/charterOptions';
  import TimeSelect from '$lib/components/ui/TimeSelect.svelte';
  import { WORK_PRESETS, LEMBUR_PRESETS, analyzeWorkHours, formatDuration } from '$lib/shared/charterWorkHours';
  import {
    IconCalendarTime,
    IconTruck,
    IconUsers,
    IconTool,
    IconCheck,
    IconDeviceFloppy,
    IconSend,
    IconEdit,
    IconInfoCircle,
    IconClock,
    IconShieldCheck,
    IconLoader2,
    IconFileDescription
  } from '@tabler/icons-svelte';

  let { project } = $props<{ project: any }>();

  let loading = $state(true);
  let saving = $state(false);
  let submitting = $state(false);
  let isEditing = $state(false);
  let charter = $state<any>(null);
  let manpower = $state<any[]>([]);
  let specItems = $state<any[]>([]);
  let budgetItems = $state<any[]>([]);
  let survey = $state<any>(null);
  let saveSuccessMessage = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let starting = $state(false);
  let loadWarnings = $state<string[]>([]);

  let soId = $derived((() => {
    const so = project?.so_customer_id;
    return typeof so === 'object' ? so?.id : so;
  })());

  let form = $state<Record<string, any>>({
    tanggal_mulai_project: '',
    selesai_project_target: '',
    waktu_kerja: WAKTU_KERJA_OPTIONS[0].value,
    shift_kerja: SHIFT_KERJA_OPTIONS[0].value,
    jam_kerja_mulai: '08:00',
    jam_kerja_selesai: '17:00',
    waktu_lembur: 'tidak',
    jam_lembur_mulai: '',
    jam_lembur_selesai: '',
    ijin_barang_masuk: IJIN_BARANG_OPTIONS[1].value,
    alat_loading_unloading: ALAT_LOADING_OPTIONS[1].value,
    syarat_packing_list: 'ADA',
    jenis_manpower: JENIS_MANPOWER_OPTIONS[0].value,
    verifikasi_kontrak: VERIFIKASI_KONTRAK_OPTIONS[0].value,
    syarat_mcu: false,
    syarat_skck: false,
    syarat_sertifikat: false,
    syarat_surat_sehat: false,
    persiapan_permukaan: PERSIAPAN_PERMUKAAN_OPTIONS[0].value,
    target_ketebalan: '',
    satuan_ketebalan: 'MICRON',
    target_luas_area: '',
    satuan_luas: 'm²',
    catatan_teknis: ''
  });

  const workSummary = $derived(
    analyzeWorkHours({
      mulai: form.jam_kerja_mulai,
      selesai: form.jam_kerja_selesai,
      lemburOn: isLembur(form.waktu_lembur),
      lemburMulai: form.jam_lembur_mulai,
      lemburSelesai: form.jam_lembur_selesai
    })
  );

  onMount(() => {
    if (soId) {
      loadAll();
    } else {
      loading = false;
    }
  });

  async function loadAll() {
    loading = true;
    errorMessage = null;
    try {
      if (!soId) {
        loading = false;
        return;
      }
      const [charterResult, surveyResult] = await Promise.all([
        loadFullCharter(Number(soId)),
        getSurveyGate(Number(soId))
      ]);

      charter = charterResult.charter || null;
      manpower = charterResult.manpower || [];
      specItems = charterResult.specItems || [];
      budgetItems = charterResult.budgetItems || [];
      survey = surveyResult.survey || null;
      loadWarnings = (charterResult as any).loadErrors || [];

      // PRJ-16: membuka tab TIDAK lagi membuat draft (PM/Admin/viewer yang sekadar melihat ikut melahirkan charter
      // atas nama mereka). Draft dibuat eksplisit lewat tombol "Mulai isi Charter" (startCharter).

      if (charter) {
        const dftSpec = specItems.find((s: any) => s.keterangan === 'Target DFT (lapangan)');
        // nilai_luasan disimpan sebagai "<angka> <satuan>"
        const luasanMatch = String(charter.nilai_luasan || '').trim().match(/^([\d.,]+)\s*(\S*)$/);
        const luasan = luasanMatch
          ? { value: luasanMatch[1], unit: luasanMatch[2] || 'm²' }
          : { value: charter.nilai_luasan || '', unit: 'm²' };
        // Sync data ke form
        form = {
          tanggal_mulai_project: charter.tanggal_mulai_project ? String(charter.tanggal_mulai_project).split('T')[0] : (project?.start_date ? String(project.start_date).split('T')[0] : ''),
          selesai_project_target: charter.selesai_project_target ? String(charter.selesai_project_target).split('T')[0] : (project?.end_date ? String(project.end_date).split('T')[0] : ''),
          // Nilai lama (kosakata lapangan lama / ERP) dipetakan ke kosakata resmi; yang tak dikenal tampil "(nilai lama)".
          waktu_kerja: normalizeCharterValue('waktu_kerja', charter.waktu_kerja) || WAKTU_KERJA_OPTIONS[0].value,
          shift_kerja: normalizeCharterValue('shift_kerja', charter.shift_kerja) || SHIFT_KERJA_OPTIONS[0].value,
          jam_kerja_mulai: charter.jam_kerja_mulai || '08:00',
          jam_kerja_selesai: charter.jam_kerja_selesai || '17:00',
          waktu_lembur: normalizeCharterValue('waktu_lembur', charter.waktu_lembur),
          jam_lembur_mulai: charter.jam_lembur_mulai || '',
          jam_lembur_selesai: charter.jam_lembur_selesai || '',
          ijin_barang_masuk: normalizeCharterValue('ijin_barang_masuk', charter.ijin_barang_masuk) || IJIN_BARANG_OPTIONS[1].value,
          alat_loading_unloading: normalizeCharterValue('alat_loading_unloading', charter.alat_loading_unloading) || ALAT_LOADING_OPTIONS[1].value,
          syarat_packing_list: charter.syarat_packing_list || 'ADA',
          jenis_manpower: normalizeCharterValue('jenis_manpower', charter.jenis_manpower) || JENIS_MANPOWER_OPTIONS[0].value,
          verifikasi_kontrak: normalizeCharterValue('verifikasi_kontrak', charter.verifikasi_kontrak) || VERIFIKASI_KONTRAK_OPTIONS[0].value,
          syarat_mcu: !!charter.syarat_mcu,
          syarat_skck: !!charter.syarat_skck,
          syarat_sertifikat: !!charter.syarat_sertifikat,
          syarat_surat_sehat: !!charter.syarat_surat_sehat,
          persiapan_permukaan: normalizeCharterValue('persiapan_permukaan', charter.persiapan_permukaan) || PERSIAPAN_PERMUKAAN_OPTIONS[0].value,
          // Kolom target_* / catatan_teknis tidak ada di Directus (PRJ-04): baca balik dari kolom ERP
          target_ketebalan: dftSpec?.tebal ?? '',
          satuan_ketebalan: dftSpec?.satuan_ukuran || 'MICRON',
          target_luas_area: luasan.value,
          satuan_luas: luasan.unit,
          catatan_teknis: charter.lain_lain_keterangan || ''
        };

        // Jika status masih draft, default ke mode edit
        isEditing = !charter.status || charter.status === 'draft';
      }
    } catch (err: any) {
      console.error('ProjectCharterTab loadAll error:', err);
      errorMessage = err.message || 'Gagal memuat Project Charter';
    } finally {
      loading = false;
    }
  }

  // PRJ-16: pembuatan draft eksplisit & idempoten (createProjectCharter mengecek ulang sebelum POST).
  // project_leader = LEADER proyek, bukan orang yang kebetulan menekan tombol.
  async function startCharter() {
    if (!soId || starting) return;
    starting = true;
    errorMessage = null;
    try {
      const res = await createProjectCharter(Number(soId), project?.id, project?.leader || null);
      if (res.success && res.data) {
        await loadAll();
        isEditing = true;
      } else {
        errorMessage = res.error || 'Gagal memulai Project Charter';
      }
    } finally {
      starting = false;
    }
  }

  function showTemporarySuccess(msg: string) {
    saveSuccessMessage = msg;
    setTimeout(() => {
      saveSuccessMessage = null;
    }, 4000);
  }

  async function handleSaveDraft() {
    if (!charter?.id || saving) return;
    saving = true;
    errorMessage = null;
    try {
      const res = await updateProjectCharter(charter.id, form, project?.id);
      if (res.success) {
        charter = { ...charter, ...res.data };
        showTemporarySuccess('Draft Project Charter berhasil disimpan!');
      } else {
        errorMessage = res.error || 'Gagal menyimpan draft';
      }
    } catch (err: any) {
      errorMessage = err.message || 'Terjadi kesalahan saat menyimpan draft';
    } finally {
      saving = false;
    }
  }

  async function handleSubmitCharter() {
    if (!charter?.id || submitting) return;

    const problems = validateCharterForm(form);
    if (problems.length) {
      errorMessage = problems.join(' ');
      return;
    }

    if (!confirm('Kirim Project Charter ke Admin Project untuk diperiksa? Charter baru aktif setelah disetujui, dan tidak bisa diedit selama menunggu.')) {
      return;
    }

    submitting = true;
    errorMessage = null;
    try {
      const s = get(authStore);
      const submitterName = s.karyawanName || s.user?.displayName || project?.leader || 'Project Leader';
      
      const res = await submitCharter(charter.id, submitterName, project?.id, form);
      if (res.success) {
        charter = { ...charter, ...res.data, status: 'submitted' };
        isEditing = false;
        showTemporarySuccess('✅ Charter terkirim — menunggu persetujuan Admin Project.');
        // PRJ-35: beri tahu Admin Project & PM (fire-and-forget; gagal notif tidak menggagalkan kirim charter).
        auth.currentUser
          ?.getIdToken()
          .then((idToken) =>
            fetch('/api/project-charter/notify-submitted', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
              body: JSON.stringify({ charterId: charter.id, projectName: project?.name || '' })
            })
          )
          .catch((e) => console.warn('notif charter gagal (diabaikan):', e));
      } else {
        errorMessage = res.error || 'Gagal mengirim Project Charter';
      }
    } catch (err: any) {
      errorMessage = err.message || 'Terjadi kesalahan saat mengirim Project Charter';
    } finally {
      submitting = false;
    }
  }

  function formatDate(d: string | null | undefined) {
    if (!d) return '-';
    try {
      return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return d;
    }
  }

  function formatCurrency(v: number | string | null | undefined) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(v || 0));
  }

  let isApproved = $derived(charter?.status === 'approved');
  let isSubmitted = $derived(charter?.status === 'submitted');
  // Terkunci (tampilan ringkas): aktif ATAU menunggu persetujuan, selama tidak sedang mengedit.
  let isLocked = $derived((isApproved || isSubmitted) && !isEditing);
  let totalBudgetItems = $derived(budgetItems.reduce((s, b) => s + (parseFloat(b.budget) || 0), 0));
</script>

<div class="space-y-6">
  {#if !soId}
    <div class="glass-panel p-8 text-center rounded-2xl border border-slate-200/80 dark:border-slate-800">
      <div class="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto mb-3">
        <IconInfoCircle size={24} />
      </div>
      <h3 class="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">Project belum terhubung ke SO</h3>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        Hubungkan project ini ke Sales Order (SO) Jasa terlebih dahulu untuk mengakses Project Charter.
      </p>
    </div>

  {:else if loading}
    <CircularProgressGauge size={54} strokeWidth={4} label="Memuat data Project Charter..." />

  {:else}
    <!-- Status / Notification Banner -->
    {#if !charter}
      <div class="p-6 rounded-2xl bg-slate-500/10 border border-slate-400/30 text-center">
        <div class="text-sm font-black text-slate-800 dark:text-slate-100">Project Charter belum dibuat</div>
        <p class="text-xs text-slate-600 dark:text-slate-400 mt-1 mb-3">Charter berisi jadwal, logistik, manpower, dan spesifikasi proyek. Setelah Anda kirim, Admin Project memeriksanya sebelum aktif.</p>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-all active:scale-95"
          disabled={starting}
          onclick={startCharter}
        >
          {#if starting}<IconLoader2 size={15} class="animate-spin" />{:else}<IconEdit size={15} />{/if}
          <span>Mulai isi Charter</span>
        </button>
      </div>
    {:else if isSubmitted && !isEditing}
      <div class="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-blue-500 text-white flex items-center justify-center shrink-0"><IconClock size={20} /></div>
        <div>
          <div class="text-sm font-black text-blue-900 dark:text-blue-300">Menunggu persetujuan Admin Project</div>
          <div class="text-xs text-blue-800/80 dark:text-blue-400/80 mt-0.5">Dikirim oleh <span class="font-semibold">{charter?.submitted_by || 'Leader'}</span>{#if charter?.submitted_at} • {formatDate(charter.submitted_at)}{/if}. Charter belum aktif dan tidak bisa diedit selama menunggu.</div>
        </div>
      </div>
    {:else if isApproved && !isEditing}
      <div class="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold shrink-0 shadow-xs">
            <IconCheck size={20} />
          </div>
          <div>
            <div class="text-sm font-black text-emerald-800 dark:text-emerald-300">
              Project Charter Aktif & Terverifikasi
            </div>
            <div class="text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
              Diisi oleh: <span class="font-semibold">{charter?.submitted_by || project?.leader || 'Leader'}</span>
              {#if charter?.approved_at}
                • {formatDate(charter.approved_at)}
              {/if}
            </div>
          </div>
        </div>
        <span class="text-[11px] text-emerald-800/80 dark:text-emerald-400/80 max-w-[16rem]">Perubahan pada Charter yang sudah aktif diajukan lewat Admin Project (ERP) agar tercatat revisinya.</span>
      </div>
    {:else}
      <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold shrink-0 shadow-xs">
            <IconFileDescription size={20} />
          </div>
          <div>
            <div class="text-sm font-black text-amber-900 dark:text-amber-300">
              {isApproved ? 'Mode Pengeditan Charter' : 'Project Charter Perlu Dilengkapi'}
            </div>
            <p class="text-xs text-amber-800/80 dark:text-amber-400/80 mt-0.5">
              {isApproved
                ? 'Anda sedang mengedit Project Charter yang sudah aktif.'
                : 'Silakan isi detail jadwal, logistik, manpower, dan spesifikasi di bawah, lalu klik "Submit Charter".'}
            </p>
          </div>
        </div>
        {#if isApproved}
          <button
            type="button"
            class="px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800 rounded-lg transition-colors"
            onclick={() => isEditing = false}
          >
            Batal Edit
          </button>
        {/if}
      </div>
    {/if}

    {#if loadWarnings.length}
      <div class="p-3 bg-amber-500/15 border border-amber-500/40 text-amber-900 dark:text-amber-300 text-xs font-bold rounded-xl flex items-center gap-2">
        <IconInfoCircle size={16} />
        <span>{loadWarnings.join('. ')}. Muat ulang halaman; bila berulang, laporkan ke Admin.</span>
      </div>
    {/if}

    <!-- Feedback messages -->
    {#if saveSuccessMessage}
      <div class="p-3 bg-emerald-500/15 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 text-xs font-bold rounded-xl flex items-center gap-2">
        <IconCheck size={16} />
        <span>{saveSuccessMessage}</span>
      </div>
    {/if}

    {#if errorMessage}
      <div class="p-3 bg-rose-500/15 border border-rose-500/40 text-rose-800 dark:text-rose-300 text-xs font-bold rounded-xl flex items-center gap-2">
        <IconInfoCircle size={16} />
        <span>{errorMessage}</span>
      </div>
    {/if}

    <!-- Quick Stats Cards (Readonly Summary) -->
    {#if isLocked}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div class="glass-panel p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Target Periode</span>
          <div class="text-xs font-bold text-slate-800 dark:text-white">
            {formatDate(form.tanggal_mulai_project)} – {formatDate(form.selesai_project_target)}
          </div>
        </div>
        <div class="glass-panel p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Hari & Shift</span>
          <div class="text-xs font-bold text-slate-800 dark:text-white truncate">
            {form.waktu_kerja} • {form.shift_kerja}
          </div>
        </div>
        <div class="glass-panel p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Tipe Manpower</span>
          <div class="text-xs font-bold text-slate-800 dark:text-white truncate">
            {form.jenis_manpower} ({manpower.length} Terdaftar)
          </div>
        </div>
        <div class="glass-panel p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Spesifikasi Permukaan</span>
          <div class="text-xs font-bold text-slate-800 dark:text-white truncate">
            {form.persiapan_permukaan}
          </div>
        </div>
      </div>
    {/if}

    <!-- FORM SECTIONS -->
    <div class="space-y-6">
      <!-- Section 1: Jadwal & Waktu Kerja -->
      <div class="glass-panel rounded-2xl p-5 md:p-6 border border-slate-200/80 dark:border-slate-800 space-y-4">
        <div class="flex items-center gap-2.5 pb-3 border-b border-slate-200/80 dark:border-slate-800">
          <div class="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
            <IconCalendarTime size={18} />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-900 dark:text-white">Jadwal & Waktu Kerja</h3>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">Atur periode mulai, target selesai, sistem shift, dan jam operasional</p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <!-- Tanggal Mulai -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="tgl-mulai">
              Tanggal Mulai Proyek <span class="text-rose-500">*</span>
            </label>
            <input
              id="tgl-mulai"
              type="date"
              bind:value={form.tanggal_mulai_project}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          <!-- Target Selesai -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="tgl-selesai">
              Target Selesai Proyek <span class="text-rose-500">*</span>
            </label>
            <input
              id="tgl-selesai"
              type="date"
              bind:value={form.selesai_project_target}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          <!-- Hari Kerja -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="waktu-kerja">
              Hari Kerja Operasional
            </label>
            <select
              id="waktu-kerja"
              bind:value={form.waktu_kerja}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {#each optionsWithLegacy(WAKTU_KERJA_OPTIONS, form.waktu_kerja) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>

          <!-- Shift Kerja -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="shift-kerja">
              Sistem Shift Kerja
            </label>
            <select
              id="shift-kerja"
              bind:value={form.shift_kerja}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {#each optionsWithLegacy(SHIFT_KERJA_OPTIONS, form.shift_kerja) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>

          <!-- Preset jam kerja (klik mengisi mulai & selesai sekaligus) -->
          {#if isEditing}
            <div class="sm:col-span-2 flex flex-wrap items-center gap-1.5" title="Klik untuk mengisi Jam Kerja Mulai/Selesai sekaligus. Tetap bisa diubah manual.">
              <span class="text-[11px] text-slate-500 dark:text-slate-400">Preset jam kerja:</span>
              {#each WORK_PRESETS as p}
                <button type="button" class="text-[11px] px-2.5 py-1 rounded-full border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-blue-500/10 hover:border-blue-500"
                  onclick={() => { form.jam_kerja_mulai = p.mulai; form.jam_kerja_selesai = p.selesai; }}>
                  {p.label} ({p.mulai}–{p.selesai})
                </button>
              {/each}
            </div>
          {/if}

          <!-- Jam Kerja Normal -->
          <div class="sm:col-span-2 grid grid-cols-2 gap-2">
            <div>
              <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="jam-mulai">
                Jam Kerja Mulai
              </label>
              <TimeSelect id="jam-mulai" bind:value={form.jam_kerja_mulai} disabled={!isEditing} ariaLabel="jam kerja mulai" class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed" />
            </div>
            <div>
              <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="jam-selesai">
                Jam Kerja Selesai
              </label>
              <TimeSelect id="jam-selesai" bind:value={form.jam_kerja_selesai} disabled={!isEditing} ariaLabel="jam kerja selesai" class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed" />
            </div>
          </div>

          <!-- Lembur -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="lembur">
              Ketentuan Lembur
            </label>
            <select
              id="lembur"
              bind:value={form.waktu_lembur}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {#each optionsWithLegacy(LEMBUR_OPTIONS, form.waktu_lembur) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>

          <!-- Jam Lembur jika ada -->
          {#if isLembur(form.waktu_lembur)}
            {#if isEditing}
              <div class="sm:col-span-2 flex flex-wrap items-center gap-1.5" title="Klik untuk mengisi Jam Lembur Mulai/Selesai sekaligus.">
                <span class="text-[11px] text-slate-500 dark:text-slate-400">Preset lembur:</span>
                {#each LEMBUR_PRESETS as p}
                  <button type="button" class="text-[11px] px-2.5 py-1 rounded-full border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-blue-500/10 hover:border-blue-500"
                    onclick={() => { form.jam_lembur_mulai = p.mulai; form.jam_lembur_selesai = p.selesai; }}>
                    {p.label} ({p.mulai}–{p.selesai})
                  </button>
                {/each}
              </div>
            {/if}
            <div class="sm:col-span-2 grid grid-cols-2 gap-2">
              <div>
                <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="lembur-mulai">
                  Jam Lembur Mulai
                </label>
                <TimeSelect id="lembur-mulai" bind:value={form.jam_lembur_mulai} disabled={!isEditing} ariaLabel="jam lembur mulai" class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed" />
              </div>
              <div>
                <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="lembur-selesai">
                  Jam Lembur Selesai
                </label>
                <TimeSelect id="lembur-selesai" bind:value={form.jam_lembur_selesai} disabled={!isEditing} ariaLabel="jam lembur selesai" class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed" />
              </div>
            </div>
          {/if}

          {#if workSummary.normalMin > 0 || workSummary.warnings.length > 0}
            <div class="sm:col-span-2 rounded-xl px-3 py-2 text-[11px] border {workSummary.warnings.length > 0 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'} text-slate-700 dark:text-slate-200">
              {#if workSummary.normalMin > 0}
                Jam kerja normal: <b>{formatDuration(workSummary.normalMin)}</b>
                {#if workSummary.lemburMin > 0} · Lembur: <b>{formatDuration(workSummary.lemburMin)}</b> · Total/hari: <b>{formatDuration(workSummary.totalMin)}</b>{/if}
              {/if}
              {#each workSummary.warnings as w}<div>⚠ {w}</div>{/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- Section 2: Logistik & Akses Lapangan -->
      <div class="glass-panel rounded-2xl p-5 md:p-6 border border-slate-200/80 dark:border-slate-800 space-y-4">
        <div class="flex items-center gap-2.5 pb-3 border-b border-slate-200/80 dark:border-slate-800">
          <div class="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
            <IconTruck size={18} />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-900 dark:text-white">Logistik & Akses Lokasi</h3>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">Prosedur ijin masuk material/alat dan fasilitas bongkar muat</p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <!-- Ijin Barang Masuk -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="ijin-masuk">
              Ijin Masuk Material & Peralatan
            </label>
            <select
              id="ijin-masuk"
              bind:value={form.ijin_barang_masuk}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {#each optionsWithLegacy(IJIN_BARANG_OPTIONS, form.ijin_barang_masuk) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>

          <!-- Alat Loading/Unloading -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="alat-loading">
              Fasilitas Loading / Unloading
            </label>
            <select
              id="alat-loading"
              bind:value={form.alat_loading_unloading}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {#each optionsWithLegacy(ALAT_LOADING_OPTIONS, form.alat_loading_unloading) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>

          <!-- Syarat Packing List -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="syarat-packing" title="Pilih Ada bila proyek membawa barang/alat dari gudang. Dicek sebagai syarat kesiapan sebelum proyek dimulai.">
              Syarat Packing List
            </label>
            <select
              id="syarat-packing"
              bind:value={form.syarat_packing_list}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {#each YA_TIDAK_OPTIONS as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
            <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Default Ada. Pilih Tidak ada bila tidak membawa barang/alat dari gudang.</p>
          </div>
        </div>
      </div>

      <!-- Section 3: Manpower & Persyaratan HSE -->
      <div class="glass-panel rounded-2xl p-5 md:p-6 border border-slate-200/80 dark:border-slate-800 space-y-4">
        <div class="flex items-center gap-2.5 pb-3 border-b border-slate-200/80 dark:border-slate-800">
          <div class="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
            <IconUsers size={18} />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-900 dark:text-white">Manpower & Persyaratan HSE / Kepatuhan</h3>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">Skema pengupahan dan dokumen legal/medis tenaga kerja lapangan</p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <!-- Jenis Manpower -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="jenis-manpower">
              Skema Manpower
            </label>
            <select
              id="jenis-manpower"
              bind:value={form.jenis_manpower}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {#each optionsWithLegacy(JENIS_MANPOWER_OPTIONS, form.jenis_manpower) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>

          <!-- Verifikasi Kontrak -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="verifikasi-kontrak">
              Verifikasi & Kontrak Kerja
            </label>
            <select
              id="verifikasi-kontrak"
              bind:value={form.verifikasi_kontrak}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {#each optionsWithLegacy(VERIFIKASI_KONTRAK_OPTIONS, form.verifikasi_kontrak) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <!-- Checklist Persyaratan HSE -->
        <div class="pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
          <span class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
            Persyaratan Dokumen & Medis (Checklist HSE):
          </span>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <label class="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={form.syarat_mcu}
                disabled={!isEditing}
                class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 disabled:opacity-60"
              />
              <span class="font-semibold text-slate-800 dark:text-slate-200">Wajib MCU (Medical Check-Up)</span>
            </label>

            <label class="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={form.syarat_skck}
                disabled={!isEditing}
                class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 disabled:opacity-60"
              />
              <span class="font-semibold text-slate-800 dark:text-slate-200">Wajib SKCK Kepolisian</span>
            </label>

            <label class="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={form.syarat_sertifikat}
                disabled={!isEditing}
                class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 disabled:opacity-60"
              />
              <span class="font-semibold text-slate-800 dark:text-slate-200">Wajib Sertifikat Keahlian / K3</span>
            </label>

            <label class="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={form.syarat_surat_sehat}
                disabled={!isEditing}
                class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 disabled:opacity-60"
              />
              <span class="font-semibold text-slate-800 dark:text-slate-200">Wajib Surat Keterangan Dokter / Sehat</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Section 4: Spesifikasi Teknis & Ruang Lingkup -->
      <div class="glass-panel rounded-2xl p-5 md:p-6 border border-slate-200/80 dark:border-slate-800 space-y-4">
        <div class="flex items-center gap-2.5 pb-3 border-b border-slate-200/80 dark:border-slate-800">
          <div class="w-8 h-8 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
            <IconTool size={18} />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-900 dark:text-white">Spesifikasi Teknis & Ruang Lingkup</h3>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">Standar persiapan permukaan, target ketebalan (DFT), target volume, dan catatan teknis</p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <!-- Persiapan Permukaan -->
          <div class="lg:col-span-3">
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="surface-prep">
              Standar Persiapan Permukaan (Surface Prep)
            </label>
            <select
              id="surface-prep"
              bind:value={form.persiapan_permukaan}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {#each optionsWithLegacy(PERSIAPAN_PERMUKAAN_OPTIONS, form.persiapan_permukaan) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>

          <!-- Target Ketebalan DFT -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="target-dft">
              Target Ketebalan (DFT)
            </label>
            <div class="flex gap-2">
              <input
                id="target-dft"
                type="text"
                placeholder="Misal: 150 - 200"
                bind:value={form.target_ketebalan}
                disabled={!isEditing}
                class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <select
                bind:value={form.satuan_ketebalan}
                disabled={!isEditing}
                class="px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 shrink-0"
              >
                <option value="micron">micron (µm)</option>
                <option value="mil">mil</option>
                <option value="mm">mm</option>
              </select>
            </div>
          </div>

          <!-- Target Luas Volume -->
          <div>
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="target-luas">
              Target Luas / Volume
            </label>
            <div class="flex gap-2">
              <input
                id="target-luas"
                type="text"
                placeholder="Misal: 500"
                bind:value={form.target_luas_area}
                disabled={!isEditing}
                class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <select
                bind:value={form.satuan_luas}
                disabled={!isEditing}
                class="px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 shrink-0"
              >
                {#each SATUAN_UKURAN_OPTIONS as u}
                  <option value={u}>{u}</option>
                {/each}
              </select>
            </div>
          </div>

          <!-- Catatan Teknis / Ruang Lingkup -->
          <div class="lg:col-span-3">
            <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1.5" for="catatan-teknis">
              Catatan Teknis & Ruang Lingkup Lapangan
            </label>
            <textarea
              id="catatan-teknis"
              rows={3}
              placeholder="Tuliskan catatan khusus terkait kondisi lapangan, spesifikasi produk cat, atau instruksi keselamatan kerja..."
              bind:value={form.catatan_teknis}
              disabled={!isEditing}
              class="w-full px-3 py-2 bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed text-xs"
            ></textarea>
            <p class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Isian ini tersinkron dengan Charter di ERP (Admin Project).</p>
          </div>
        </div>
      </div>

      <!-- ACTION BUTTONS BAR (When in Edit Mode) -->
      {#if isEditing}
        <div class="sticky bottom-4 z-20 glass-panel p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
          <div class="text-xs text-slate-500 dark:text-slate-400">
            Pastikan seluruh data sudah terisi dengan benar sebelum menyelesaikan Project Charter.
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all disabled:opacity-60"
              disabled={saving || submitting}
              onclick={handleSaveDraft}
            >
              {#if saving}
                <IconLoader2 size={15} class="animate-spin text-blue-500" />
                <span>Menyimpan...</span>
              {:else}
                <IconDeviceFloppy size={15} />
                <span>Simpan Draft</span>
              {/if}
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-60"
              disabled={saving || submitting}
              onclick={handleSubmitCharter}
            >
              {#if submitting}
                <IconLoader2 size={15} class="animate-spin text-white" />
                <span>Mengirim...</span>
              {:else}
                <IconSend size={15} />
                <span>Selesaikan &amp; Submit Charter</span>
              {/if}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
