<script>
  import { onMount } from 'svelte';
  import { createViolationReport } from '$lib/services/sanksi';
  import directus from '$lib/services/directus';
  import { uploadFiles } from '@directus/sdk';
  import { fade, slide } from 'svelte/transition';
  import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
  import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';

  let { manpower, project, reporterName, onClose, onSuccess } = $props();

  let loading = $state(false);
  let category = $state('Kedisiplinan');
  let sanctionRecommendation = $state('Teguran Lisan');
  let description = $state('');
  let chronology = $state('');
  let witnesses = $state('');
  let incidentDate = $state(new Date().toISOString().split('T')[0]);
  // Anotasi JSDoc perlu karena file ini <script> polos (bukan lang="ts"): tanpa itu
  // $state(null) ter-infer bertipe `null` dan pemulihan draf (File) ditolak.
  let selectedFile = $state(/** @type {File | null} */ (null));
  let uploadingFile = $state(false);

  const toast = {
    success: (m) => window.__showToast && window.__showToast(m, "success"),
    error: (m) => window.__showToast && window.__showToast(m, "error")
  };

  const CATEGORIES = [
    'Kedisiplinan',
    'Kinerja',
    'Perilaku & Etika',
    'Integritas',
    'Keselamatan Kerja',
    'Pelanggaran Kebijakan'
  ];

  const SANCTIONS = [
    'Teguran Lisan',
    'Teguran Tertulis',
    'SP1',
    'SP2',
    'SP3',
    'Skorsing',
    'PHK'
  ];

  // Jaring pengaman draf. Modal ini diisi panjang (kronologi + saksi) lalu dilampiri
  // bukti — di HP, membuka pemilih file/kamera bisa membuat OS membunuh tab dan
  // seluruh laporan hilang. Dikunci per karyawan supaya laporan untuk orang berbeda
  // tidak saling tertukar.
  const VIOLATION_FILE_KEY = 'bukti';
  let violationPersist = $derived(createFormPersist(`violation_report_${manpower?.id ?? 'none'}`));
  let draftSavedAt = $state(/** @type {Date | null} */ (null));
  let draftArmed = $state(false);

  function violationSnapshot() {
    return { category, sanctionRecommendation, description, chronology, witnesses, incidentDate };
  }

  onMount(async () => {
    const draft = violationPersist.restore();
    if (draft) {
      category = draft.category;
      sanctionRecommendation = draft.sanctionRecommendation;
      description = draft.description;
      chronology = draft.chronology;
      witnesses = draft.witnesses;
      incidentDate = draft.incidentDate;
      const blob = await violationPersist.restorePhoto(VIOLATION_FILE_KEY);
      if (blob) {
        // Lampiran boleh PDF — pertahankan tipe aslinya, jangan paksa jadi jpg.
        const ext = blob.type === 'application/pdf' ? 'pdf' : 'jpg';
        selectedFile = new File([blob], `bukti.${ext}`, { type: blob.type || 'image/jpeg' });
      }
      draftSavedAt = new Date();
    }
    draftArmed = true;
  });

  // Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
  $effect(() => {
    void violationSnapshot();
    if (!draftArmed) return;
    violationPersist.save(violationSnapshot());
    draftSavedAt = new Date();
  });

  $effect(() => registerFormPersistSaveTriggers(violationPersist, violationSnapshot));

  function handleFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (file) {
      selectedFile = file;
      violationPersist.savePhoto(VIOLATION_FILE_KEY, file);
    }
  }

  async function handleSubmit() {
    if (!description.trim() || !chronology.trim()) {
      toast.error("Deskripsi dan kronologi wajib diisi.");
      return;
    }

    loading = true;
    try {
      let fileId = null;

      // Upload file if selected
      if (selectedFile) {
        uploadingFile = true;
        const formData = new FormData();
        formData.append('title', `Bukti Pelanggaran - ${manpower.nama} - ${incidentDate}`);
        formData.append('file', selectedFile);
        
        try {
          const uploadRes = await directus.request(uploadFiles(formData));
          fileId = uploadRes.id;
        } catch (uploadErr) {
          console.error("Gagal mengunggah bukti:", uploadErr);
          toast.error("Gagal mengunggah file bukti. Melanjutkan tanpa file.");
        } finally {
          uploadingFile = false;
        }
      }

      // Construct payload compatible with Directus sanksi_karyawan collection
      const payload = {
        karyawan_id: manpower.id,
        karyawan_name: manpower.nama,
        nik: String(manpower.NIK || ''),
        posisi: manpower.posisi || 'Mekanik',
        departemen: 'Project',
        jenis_sanksi: sanctionRecommendation,
        kategori_pelanggaran: category,
        deskripsi_pelanggaran: description,
        kronologi: chronology,
        saksi: witnesses,
        tanggal_kejadian: incidentDate,
        bukti: fileId,
        diterbitkan_oleh: reporterName,
        jabatan_penerbit: 'Project Leader'
      };

      const res = await createViolationReport(payload);
      if (res.success) {
        // Terkirim — draf lokal (termasuk bukti di IndexedDB) sudah tidak relevan.
        violationPersist.clear();
        await violationPersist.clearPhotos();
        draftSavedAt = null;
        toast.success("Laporan pelanggaran berhasil diajukan ke HRD.");
        onSuccess && onSuccess(res.data);
      } else {
        toast.error(res.error || "Gagal mengajukan laporan.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Terjadi kesalahan: " + e.message);
    } finally {
      loading = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 text-left" in:fade={{ duration: 150 }}>
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col" in:slide={{ duration: 200 }}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-red-50/50">
      <div>
        <h3 class="text-lg font-bold text-red-700 flex items-center gap-1.5">
          ⚠️ Laporkan Pelanggaran Lapangan
        </h3>
        <p class="text-xs text-gray-500 mt-0.5">Untuk: <span class="font-semibold text-gray-700">{manpower.nama}</span> ({manpower.posisi || 'Manpower'})</p>
        <DraftIndicator savedAt={draftSavedAt} hasPhotos={!!selectedFile} />
      </div>
      <button onclick={onClose} class="text-gray-400 hover:text-gray-600 transition-colors">✕</button>
    </div>

    <!-- Body -->
    <div class="p-6 space-y-4 flex-1">
      
      <!-- Row 1: Kategori & Tanggal Kejadian -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="viol-category" class="block text-xs font-bold text-gray-700 uppercase mb-1">Kategori Pelanggaran *</label>
          <select id="viol-category" bind:value={category} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500">
            {#each CATEGORIES as cat}
              <option value={cat}>{cat}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="viol-incident-date" class="block text-xs font-bold text-gray-700 uppercase mb-1">Tanggal Kejadian *</label>
          <input id="viol-incident-date" type="date" bind:value={incidentDate} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" />
        </div>
      </div>

      <!-- Row 2: Rekomendasi Sanksi -->
      <div>
        <label for="viol-sanction" class="block text-xs font-bold text-gray-700 uppercase mb-1">Rekomendasi Eskalasi Sanksi *</label>
        <select id="viol-sanction" bind:value={sanctionRecommendation} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500">
          {#each SANCTIONS as sanc}
            <option value={sanc}>{sanc}</option>
          {/each}
        </select>
        <p class="text-[10px] text-gray-400 mt-1">HRD berhak menyesuaikan tingkat sanksi resmi setelah peninjauan berkas.</p>
      </div>

      <!-- Row 3: Deskripsi Pelanggaran -->
      <div>
        <label for="viol-desc" class="block text-xs font-bold text-gray-700 uppercase mb-1">Deskripsi Singkat Pelanggaran *</label>
        <input id="viol-desc" bind:value={description} placeholder="Contoh: Tidak menggunakan APD lengkap di area kerja" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" />
      </div>

      <!-- Row 4: Kronologi Kejadian Rinci -->
      <div>
        <label for="viol-chronology" class="block text-xs font-bold text-gray-700 uppercase mb-1">Kronologi Kejadian *</label>
        <textarea id="viol-chronology" bind:value={chronology} rows="3" placeholder="Tulis secara lengkap kronologi kejadian, jam, lokasi detail, dan situasi pelanggaran..." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"></textarea>
      </div>

      <!-- Row 5: Saksi-Saksi & Bukti -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="viol-witnesses" class="block text-xs font-bold text-gray-700 uppercase mb-1">Saksi-Saksi</label>
          <input id="viol-witnesses" bind:value={witnesses} placeholder="Nama saksi di lokasi" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" />
        </div>
        <div>
          <label for="viol-file" class="block text-xs font-bold text-gray-700 uppercase mb-1">Bukti Foto / Dokumen</label>
          <input id="viol-file" type="file" accept="image/*,application/pdf" onchange={handleFileChange} class="w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-gray-150 file:text-gray-700 hover:file:bg-gray-200" />
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50">
      <button onclick={onClose} class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Batal</button>
      <button onclick={handleSubmit} disabled={loading || uploadingFile} class="px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors">
        {uploadingFile ? "Mengunggah Bukti..." : loading ? "Mengirim Laporan..." : "Kirim Laporan"}
      </button>
    </div>

  </div>
</div>
