<!-- Penugasan & SPK manpower per-proyek (sistem manpower terpadu). -->
<script>
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
  import { onMount } from "svelte";
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { fade, slide } from "svelte/transition";
  import { getAllManpower as getManpowerList, createManpower, createManpowerDokumen, findManpowerByNama } from "$lib/services/manpower";
  import {
    getAssignments, createAssignment, signAssignment, updateAssignment,
    setAssignmentStatus, deleteAssignment
  } from "$lib/services/manpowerAssignment";
  import { printSpkAssignment } from "$lib/utils/printSPKManpower";
  import SignaturePad from "$lib/components/shared/SignaturePad.svelte";
  import { getActiveSanctions } from "$lib/services/sanksi";
  import ReportViolationModal from "./ReportViolationModal.svelte";
  import { getProjects } from "$lib/services/projects";
  import ManpowerComplianceBoard from "./ManpowerComplianceBoard.svelte";
  import { uploadEvidencePhoto } from "$lib/services/stockLapangan";
  import { compressPhoto } from "$lib/utils/photoCompress";

  const toast = { success: (m) => window.__showToast && window.__showToast(m, "success"), error: (m) => window.__showToast && window.__showToast(m, "error"), info: (m) => window.__showToast && window.__showToast(m, "info") };

  let { project = null, actorName = "" } = $props();

  let assignments = $state([]);
  let registeredManpower = $state([]);
  let activeSanctions = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let saving = $state(false);

  // ── Pelanggaran / Sanksi ──
  let showViolationModal = $state(false);
  let violationTarget = $state(null);

  // ── Tambah penugasan ──
  let showModal = $state(false);
  let form = $state(emptyForm());
  let isNewManpower = $state(false);
  // GPA-10: peringatan nama kembar saat mendaftarkan pekerja baru dari form penugasan.
  /** @type {any[]} */
  let namaMirip = $state([]);
  let namaBedaOrang = $state(false);
  async function checkNamaKembar() {
    namaBedaOrang = false;
    namaMirip = await findManpowerByNama(newManpowerForm.nama);
  }
  let newManpowerForm = $state({ nama: "", domisili: "", NIK: "", no_telpon: "", ktpFile: null, ktpPreview: "" });
  function emptyForm() {
    return {
      manpower_id: "",
      jabatan: "",
      rate_tipe: "harian",
      rate_harian: "",
      nilai_borongan: "",
      tanggal_mulai: project?.start_date ? String(project.start_date).split("T")[0] : "",
      tanggal_selesai: project?.end_date ? String(project.end_date).split("T")[0] : "",
      jenis_pekerjaan: project?.jenis_project || "",
      lokasi: project?.lokasi || "",
      catatan: "",
    };
  }

  function onKtpFileSelected(e) {
    const file = e.target.files?.[0];
    if (file) {
      newManpowerForm.ktpFile = file;
      newManpowerForm.ktpPreview = URL.createObjectURL(file);
    }
  }

  // ── Tanda tangan ──
  let showSignModal = $state(false);
  let signTarget = $state(null);
  let signNama = $state("");
  let signPad;
  let signing = $state(false);

  // ── Edit Rate ──
  let showEditRateModal = $state(false);
  let editRateTarget = $state(null);
  let editRateForm = $state({ rate_tipe: "harian", rate_harian: "", nilai_borongan: "", rate_lembur: "", rate_standby: "", rate_uang_makan: "" });
  let editRateSaving = $state(false);

  // ── Mutasi ──
  let showMutasiModal = $state(false);
  let mutasiTarget = $state(null);
  let mutasiProjects = $state([]);
  let mutasiForm = $state({ project_id: "", rate_harian: "", tanggal_mulai: "", tanggal_selesai: "" });
  let mutasiSaving = $state(false);

  // ── Search Manpower ──
  let searchManpowerQuery = $state("");
  let showManpowerDropdown = $state(false);
  let manpowerDropdownRef = $state(null);

  function handleWindowClick(e) {
    if (showManpowerDropdown && manpowerDropdownRef && !manpowerDropdownRef.contains(e.target)) {
      showManpowerDropdown = false;
    }
  }

  let activeNames = $derived(new Set(
    assignments.filter((a) => ["aktif", "menunggu_ttd", "menunggu_validasi"].includes(a.status))
      .map((a) => (typeof a.manpower_id === "object" ? a.manpower_id?.id : a.manpower_id))
  ));
  let availableManpower = $derived(
    registeredManpower.filter((m) => {
      if (activeNames.has(m.id)) return false;
      // Filter out if manpower has active suspension (Skorsing) or termination (PHK)
      const hasSevereSanction = activeSanctions.some(
        (s) => s.karyawan_id === m.id && ["Skorsing", "PHK"].includes(s.jenis_sanksi)
      );
      return !hasSevereSanction;
    })
  );

  let filteredManpower = $derived(
    searchManpowerQuery
      ? availableManpower.filter((m) =>
          (m.nama || "").toLowerCase().includes(searchManpowerQuery.toLowerCase()) ||
          (m.posisi || "").toLowerCase().includes(searchManpowerQuery.toLowerCase())
        )
      : availableManpower
  );

  let selectedManpowerLabel = $derived((() => {
    if (!form.manpower_id) return "-- Pilih dari master manpower --";
    const mp = registeredManpower.find((m) => String(m.id) === String(form.manpower_id));
    if (!mp) return "-- Pilih dari master manpower --";
    const spSanction = activeSanctions.find(s => s.karyawan_id === mp.id && ['SP1', 'SP2', 'SP3'].includes(s.jenis_sanksi));
    return `${mp.nama} (${mp.posisi || "-"}) ${spSanction ? `[⚠️ SP Aktif: ${spSanction.jenis_sanksi}]` : ''}`;
  })());

  onMount(load);

  async function load() {
    loading = true; error = null;
    try {
      if (!project?.id) { error = "Project tidak valid."; return; }
      const [aRes, mRes, sRes] = await Promise.all([
        getAssignments({ project_id: project.id }),
        getManpowerList(),
        getActiveSanctions(),
      ]);
      if (aRes.success) assignments = aRes.data; else error = aRes.error;
      registeredManpower = Array.isArray(mRes) ? mRes : (mRes?.data || []);
      activeSanctions = sRes || [];
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function openAdd() {
    form = emptyForm();
    isNewManpower = false;
    newManpowerForm = { nama: "", domisili: "", NIK: "", no_telpon: "", ktpFile: null, ktpPreview: "" };
    namaMirip = [];
    namaBedaOrang = false;
    showModal = true;
  }

  function onPickManpower() {
    const mp = registeredManpower.find((m) => String(m.id) === String(form.manpower_id));
    if (mp && !form.jabatan) form.jabatan = mp.posisi || "";
  }

  async function handleCreate() {
    if (isNewManpower) {
      if (!newManpowerForm.nama?.trim()) { toast.error("Nama manpower wajib diisi"); return; }
      if (namaMirip.length && !namaBedaOrang) {
        toast.error("Nama ini sudah terdaftar. Pilih pekerja yang ada, atau centang \"orang berbeda\" bila memang berbeda.");
        return;
      }
      // GPA-06: NIK opsional di sini, tapi bila diisi harus 16 digit angka (tanpa spasi/titik).
      if (newManpowerForm.NIK && !/^d{16}$/.test(String(newManpowerForm.NIK).trim())) {
        toast.error("NIK harus 16 digit angka sesuai KTP, tanpa spasi/titik.");
        return;
      }
      if (form.rate_tipe === "harian" && !form.rate_harian) { toast.error("Isi rate harian"); return; }
      if (form.rate_tipe === "borongan" && !form.nilai_borongan) { toast.error("Isi nilai borongan"); return; }
      saving = true;
      try {
        const mpRes = await createManpower({
          nama: newManpowerForm.nama.trim(),
          domisili: newManpowerForm.domisili?.trim() || null,
          NIK: newManpowerForm.NIK ? String(newManpowerForm.NIK).trim() : null, // string — Number() merusak presisi 16 digit
          no_telpon: newManpowerForm.no_telpon ? Number(newManpowerForm.no_telpon) : null,
          posisi: form.jabatan || "Manpower",
          kategori: form.rate_tipe,
        });
        const createdMp = mpRes && (mpRes.success ? mpRes.data : mpRes);
        if (!createdMp || !createdMp.id) {
          toast.error("Gagal membuat data master manpower");
          saving = false;
          return;
        }

        // Unggah foto KTP jika disertakan
        if (newManpowerForm.ktpFile) {
          try {
            const compressed = await compressPhoto(newManpowerForm.ktpFile);
            const fileId = await uploadEvidencePhoto(compressed, `manpower_dokumen:ktp`);
            if (!fileId) throw new Error("unggah foto gagal");
            await createManpowerDokumen({
              manpowerId: createdMp.id,
              jenisDokumen: 'ktp',
              fileId,
              projectId: project.id
            });
          } catch (ktpErr) {
            // GPA-05: jangan diam — data manpower tetap dibuat, tapi pengguna wajib tahu KTP belum tersimpan.
            console.error("Gagal simpan foto KTP:", ktpErr);
            toast.error("Foto KTP belum tersimpan ke berkas HRD. Coba unggah ulang di Manpower › Dokumen.");
          }
        }

        form.manpower_id = String(createdMp.id);
        registeredManpower = [...registeredManpower, createdMp];
      } catch (err) {
        toast.error("Error: " + err.message);
        saving = false;
        return;
      }
    } else {
      if (!form.manpower_id) { toast.error("Pilih manpower terlebih dahulu"); return; }
      if (form.rate_tipe === "harian" && !form.rate_harian) { toast.error("Isi rate harian"); return; }
      if (form.rate_tipe === "borongan" && !form.nilai_borongan) { toast.error("Isi nilai borongan"); return; }
      saving = true;
    }
    
    // Delegasi Peran Fase 0.3 — SPK open-ended (tanpa tanggal_selesai) membuat
    // ketersediaan manpower tak terhitung. Wajib diisi mulai sekarang.
    if (!form.tanggal_selesai) {
      toast.error("Tanggal selesai SPK wajib diisi — tidak boleh open-ended.");
      saving = false;
      return;
    }

    try {
      // Delegasi Peran Fase 1 — status TIDAK dipaksa 'menunggu_ttd' lagi; createAssignment()
      // default ke 'menunggu_validasi' dan mengajukannya ke Approval Center (resource.spk).
      // TTD baru bisa dilakukan setelah admin approve di Dashboard Admin.
      const res = await createAssignment({
        ...form,
        project_id: project.id,
        dibuat_oleh: actorName,
      });
      if (res.success) {
        toast.success(res.message || "Penugasan dibuat, menunggu validasi admin.");
        showModal = false;
        await load();
      } else {
        toast.error(res.error || "Gagal membuat penugasan");
      }
    } finally {
      saving = false;
    }
  }

  function openSign(a) {
    signTarget = a;
    signNama = typeof a.manpower_id === "object" ? a.manpower_id?.nama || "" : "";
    showSignModal = true;
  }

  async function handleSign() {
    if (!signPad || signPad.isEmpty()) { toast.error("Tanda tangan belum diisi"); return; }
    signing = true;
    try {
      const dataUrl = signPad.toDataURL();
      const res = await signAssignment(signTarget.id, dataUrl, signNama);
      if (res.success) {
        toast.success("SPK ditandatangani — penugasan aktif");
        showSignModal = false;
        signTarget = null;
        await load();
      } else {
        toast.error(res.error || "Gagal menyimpan tanda tangan");
      }
    } finally {
      signing = false;
    }
  }

  async function handleStatus(a, status) {
    const labels = { selesai: "menyelesaikan", batal: "membatalkan" };
    if (!confirm(`Yakin ${labels[status]} penugasan ${nama(a)}?`)) return;
    const res = await setAssignmentStatus(a.id, status);
    if (res.success) { toast.success("Status diperbarui"); await load(); }
    else toast.error(res.error || "Gagal");
  }

  async function handleDelete(a) {
    if (!confirm(`Hapus penugasan ${nama(a)}? Tindakan ini permanen.`)) return;
    const res = await deleteAssignment(a.id);
    if (res.success) { toast.success("Penugasan dihapus"); await load(); }
    else toast.error(res.error || "Gagal menghapus");
  }

  async function doPrint(a) {
    await printSpkAssignment(a, project, typeof a.manpower_id === "object" ? a.manpower_id : null);
  }

  

  function openEditRate(a) {
    editRateTarget = a;
    editRateForm = {
      rate_tipe: a.rate_tipe || "harian",
      rate_harian: a.rate_harian ?? "",
      nilai_borongan: a.nilai_borongan ?? "",
      rate_lembur: a.rate_lembur ?? "",
      rate_standby: a.rate_standby ?? "",
      rate_uang_makan: a.rate_uang_makan ?? "",
    };
    showEditRateModal = true;
  }

  async function handleEditRate() {
    if (editRateForm.rate_tipe === "harian" && !editRateForm.rate_harian) { toast.error("Isi rate harian"); return; }
    if (editRateForm.rate_tipe === "borongan" && !editRateForm.nilai_borongan) { toast.error("Isi nilai borongan"); return; }
    editRateSaving = true;
    try {
      const res = await updateAssignment(editRateTarget.id, {
        rate_tipe: editRateForm.rate_tipe,
        rate_harian: editRateForm.rate_tipe === "harian" ? Number(editRateForm.rate_harian) : null,
        nilai_borongan: editRateForm.rate_tipe === "borongan" ? Number(editRateForm.nilai_borongan) : null,
        rate_lembur: editRateForm.rate_lembur !== "" ? Number(editRateForm.rate_lembur) : null,
        rate_standby: editRateForm.rate_standby !== "" ? Number(editRateForm.rate_standby) : null,
        rate_uang_makan: editRateForm.rate_uang_makan !== "" ? Number(editRateForm.rate_uang_makan) : null,
      });
      if (res.success) {
        toast.success("Rate berhasil diperbarui");
        showEditRateModal = false;
        editRateTarget = null;
        await load();
      } else {
        toast.error(res.error || "Gagal memperbarui rate");
      }
    } finally {
      editRateSaving = false;
    }
  }

  // ── Mutasi ──
  async function openMutasi(a) {
    mutasiTarget = a;
    mutasiForm = { project_id: "", rate_harian: a.rate_harian || "", tanggal_mulai: "", tanggal_selesai: "" };
    showMutasiModal = true;
    if (mutasiProjects.length === 0) {
      const res = await getProjects();
      if (res.success) mutasiProjects = res.data.filter((p) => String(p.id) !== String(project?.id));
    }
  }

  async function handleMutasi() {
    if (!mutasiForm.project_id) { toast.error("Pilih project tujuan"); return; }
    if (!mutasiForm.tanggal_selesai) { toast.error("Tanggal selesai SPK wajib diisi — tidak boleh open-ended."); return; }
    mutasiSaving = true;
    try {
      const dest = mutasiProjects.find((p) => String(p.id) === String(mutasiForm.project_id));
      const mpId = typeof mutasiTarget.manpower_id === "object" ? mutasiTarget.manpower_id.id : mutasiTarget.manpower_id;
      const res = await createAssignment({
        manpower_id: mpId,
        project_id: mutasiForm.project_id,
        jabatan: mutasiTarget.jabatan,
        rate_tipe: "harian",
        rate_harian: mutasiForm.rate_harian,
        tanggal_mulai: mutasiForm.tanggal_mulai || null,
        tanggal_selesai: mutasiForm.tanggal_selesai,
        jenis_pekerjaan: dest?.jenis_project || "",
        lokasi: dest?.lokasi || "",
        dibuat_oleh: actorName,
      });
      if (!res.success) { toast.error(res.error || "Gagal mutasi"); return; }
      // tandai penugasan lama selesai
      await setAssignmentStatus(mutasiTarget.id, "selesai");
      toast.success(`${nama(mutasiTarget)} dimutasi ke ${dest?.name}. SPK baru menunggu validasi admin sebelum bisa ditandatangani.`);
      showMutasiModal = false;
      mutasiTarget = null;
      await load();
    } finally {
      mutasiSaving = false;
    }
  }

  // ── helpers ──
  function nama(a) { return typeof a.manpower_id === "object" ? a.manpower_id?.nama || "-" : `#${a.manpower_id}`; }
  function fmtRp(v) {
    if (v == null || v === "" || isNaN(v)) return "-";
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(v);
  }
  function fmtDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }
  const STATUS = {
    draft: { l: "Draft", c: "bg-gray-100 text-gray-600" },
    menunggu_validasi: { l: "Menunggu Validasi Admin", c: "bg-orange-100 text-orange-700" },
    menunggu_ttd: { l: "Menunggu TTD", c: "bg-yellow-100 text-yellow-800" },
    aktif: { l: "Aktif", c: "bg-green-100 text-green-700" },
    selesai: { l: "Selesai", c: "bg-blue-100 text-blue-700" },
    batal: { l: "Batal", c: "bg-red-100 text-red-600" },
  };
</script>

<svelte:window on:click={handleWindowClick} />

<div class="space-y-5">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <h2 class="text-xl font-bold text-gray-900">Penugasan & SPK</h2>
      <p class="text-sm text-gray-500">Delegasi manpower ke project ini dengan rate khusus + SPK bertanda tangan</p>
    </div>
    <button on:click={openAdd}
      class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-2">
      ➕ Tambah Penugasan
    </button>
  </div>

  {#if project?.id}
    <ManpowerComplianceBoard projectId={project.id} />
  {/if}

  {#if loading}
    <CircularProgressGauge size={52} strokeWidth={4} label="Memuat penugasan manpower..." />
  {:else if error}
    <div class="py-12 text-center bg-white rounded-xl border border-gray-200"><p class="text-red-600 text-sm">{error}</p><button on:click={load} class="mt-3 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold">Coba Lagi</button></div>
  {:else}
    <div class="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
      {#if assignments.length === 0}
        <div class="py-16 text-center"><div class="text-4xl mb-3">📋</div><h3 class="text-base font-semibold text-gray-700">Belum ada penugasan</h3><p class="text-sm text-gray-500 mt-1">Klik "Tambah Penugasan" untuk mendelegasikan manpower ke project ini.</p></div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Manpower</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Jabatan</th>
                <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Rate</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Periode</th>
                <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {#each assignments as a (a.id)}
                {@const mpId = typeof a.manpower_id === "object" ? a.manpower_id?.id : a.manpower_id}
                {@const spSanction = activeSanctions.find(s => s.karyawan_id === mpId && ['SP1', 'SP2', 'SP3'].includes(s.jenis_sanksi))}
                <tr class="hover:bg-gray-50" in:fade={{ duration: 120 }}>
                  <td class="px-4 py-3 font-medium text-gray-900">
                    <div class="flex items-center gap-1.5">
                      <span>{nama(a)}</span>
                      {#if spSanction}
                        <Tooltip text="Manpower memiliki sanksi aktif: {spSanction.jenis_sanksi} s/d {spSanction.tanggal_berakhir || '-'}" position="bottom">
                          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                            ⚠️ {spSanction.jenis_sanksi}
                          </span>
                        </Tooltip>
                      {/if}
                    </div>
                  </td>
                  <td class="px-4 py-3 text-gray-600">{a.jabatan || "-"}</td>
                  <td class="px-4 py-3 text-right text-gray-800 whitespace-nowrap">
                    {a.rate_tipe === "borongan" ? `${fmtRp(a.nilai_borongan)} (borongan)` : `${fmtRp(a.rate_harian)}/hari`}
                  </td>
                  <td class="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{fmtDate(a.tanggal_mulai)} – {fmtDate(a.tanggal_selesai)}</td>
                  <td class="px-4 py-3 text-center">
                    <span class="px-2.5 py-1 rounded-full text-xs font-semibold {(STATUS[a.status]||STATUS.draft).c}">{(STATUS[a.status]||STATUS.draft).l}</span>
                    {#if a.ttd_manpower}<span title="Sudah ditandatangani" class="ml-1 text-green-600">✍️</span>{/if}
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center justify-center gap-1 flex-wrap">
                      {#if a.status === "menunggu_ttd"}
                        <button on:click={() => openSign(a)} class="px-2 py-1 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded" title="Tanda tangani SPK">✍️ TTD</button>
                      {/if}
                      <button on:click={() => doPrint(a)} class="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="Cetak SPK">🖨️</button>
                      {#if a.status !== "batal"}
                        <button on:click={() => openEditRate(a)} class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded" title="Edit Rate Gaji">✏️</button>
                      {/if}
                      {#if a.status === "aktif"}
                        <button on:click={() => openMutasi(a)} class="p-1.5 text-sky-600 hover:bg-sky-50 rounded" title="Mutasi ke project lain">🔀</button>
                        <button on:click={() => handleStatus(a, "selesai")} class="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Tandai selesai">✅</button>
                      {/if}
                      {#if a.status === "aktif" || a.status === "menunggu_ttd"}
                        <button on:click={() => { violationTarget = typeof a.manpower_id === "object" ? a.manpower_id : { id: a.manpower_id, nama: nama(a) }; showViolationModal = true; }} class="p-1.5 text-red-500 hover:bg-red-50 rounded" title="Laporkan Pelanggaran Lapangan">⚠️</button>
                      {/if}
                      {#if a.status !== "batal" && a.status !== "selesai"}
                        <button on:click={() => handleStatus(a, "batal")} class="p-1.5 text-orange-600 hover:bg-orange-50 rounded" title="Batalkan">🚫</button>
                      {/if}
                      <button on:click={() => handleDelete(a)} class="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Hapus">🗑️</button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="px-4 py-2.5 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">{assignments.length} penugasan</div>
      {/if}
    </div>
  {/if}
</div>

<!-- ── Tambah Penugasan Modal ── -->
{#if showModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" in:fade={{ duration: 150 }}>
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" in:slide={{ duration: 200 }}>
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h3 class="text-lg font-bold text-gray-900">Tambah Penugasan</h3>
        <button on:click={() => (showModal = false)} class="text-gray-400 hover:text-gray-600">✕</button>
      </div>
      <div class="p-6 space-y-4">
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-xs font-bold text-gray-700 uppercase">Manpower *</label>
            <label class="flex items-center gap-1.5 text-xs font-semibold text-blue-600 cursor-pointer">
              <input type="checkbox" bind:checked={isNewManpower} class="rounded text-blue-600 focus:ring-blue-500" />
              <span>Buat Baru (Master)</span>
            </label>
          </div>
          {#if isNewManpower}
            <div class="p-3.5 bg-blue-50/70 border border-blue-100 rounded-xl mb-2 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-blue-900">Data Pekerja Baru</span>
                <span class="text-[11px] text-blue-600 bg-blue-100/80 px-2 py-0.5 rounded-full font-medium">Status: Calon Terverifikasi</span>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div class="col-span-2">
                  <label class="block text-[11px] font-semibold text-gray-700 mb-1">Nama Lengkap *</label>
                  <input bind:value={newManpowerForm.nama} on:blur={checkNamaKembar} placeholder="Nama lengkap sesuai KTP..." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500" />
                  {#if namaMirip.length}
                    <div class="mt-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                      <strong>Pekerja bernama "{namaMirip[0].nama}" sudah terdaftar:</strong>
                      {#each namaMirip as m (m.id)}<div>• #{m.id} — {m.posisi || "posisi -"} ({m.status_pekerja || "status -"})</div>{/each}
                      Bila orangnya sama, batalkan "Daftarkan pekerja baru" lalu pilih pekerja yang ada dari daftar.
                      <label class="mt-1 flex items-center gap-1.5 font-medium">
                        <input type="checkbox" bind:checked={namaBedaOrang} /> Ini orang yang berbeda, lanjut daftar baru
                      </label>
                    </div>
                  {/if}
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-gray-700 mb-1">No. WhatsApp / HP</label>
                  <input bind:value={newManpowerForm.no_telpon} placeholder="08xxxxxxxxxx" type="tel" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <div class="flex justify-between items-center mb-1">
                    <label class="block text-[11px] font-semibold text-gray-700">NIK KTP</label>
                    <span class="text-[10px] {String(newManpowerForm.NIK || '').length === 16 ? 'text-green-600 font-bold' : 'text-gray-400'}">
                      {String(newManpowerForm.NIK || '').length}/16 digit
                    </span>
                  </div>
                  <input bind:value={newManpowerForm.NIK} placeholder="16 digit NIK..." maxlength="16" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 font-mono" />
                </div>
                <div class="col-span-2">
                  <label class="block text-[11px] font-semibold text-gray-700 mb-1">Domisili / Kota Asal</label>
                  <input bind:value={newManpowerForm.domisili} placeholder="Kota/Kabupaten domisili..." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500" />
                </div>
                <div class="col-span-2 pt-1 border-t border-blue-200/60">
                  <label class="block text-[11px] font-semibold text-gray-700 mb-1">Foto KTP (Opsional - Kamera/Galeri)</label>
                  <div class="flex items-center gap-3">
                    <input type="file" accept="image/*" capture="environment" on:change={onKtpFileSelected} class="text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer" />
                    {#if newManpowerForm.ktpPreview}
                      <img src={newManpowerForm.ktpPreview} alt="Preview KTP" class="h-10 w-16 object-cover rounded border border-gray-300 shadow-sm" />
                    {/if}
                  </div>
                </div>
              </div>
              <p class="text-[11px] text-blue-700/80 leading-relaxed">
                💡 Manpower baru otomatis tercatat di master data dan dokumen KTP diteruskan ke HRD untuk verifikasi berkas.
              </p>
            </div>
          {:else}
            <div class="relative" bind:this={manpowerDropdownRef}>
              <button
                type="button"
                on:click|stopPropagation={() => {
                  showManpowerDropdown = !showManpowerDropdown;
                  if (showManpowerDropdown) {
                    searchManpowerQuery = "";
                    setTimeout(() => {
                      document.getElementById("manpower-search-input")?.focus();
                    }, 50);
                  }
                }}
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 text-left flex justify-between items-center cursor-pointer shadow-sm hover:border-gray-400 transition"
              >
                <span class={form.manpower_id ? "text-gray-900" : "text-gray-400"}>
                  {selectedManpowerLabel}
                </span>
                <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {#if showManpowerDropdown}
                <div
                  class="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-xl max-h-60 overflow-hidden flex flex-col"
                  transition:slide={{ duration: 120 }}
                >
                  <!-- Search Input -->
                  <div class="p-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                    <svg class="h-4 w-4 text-gray-400 shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      id="manpower-search-input"
                      type="text"
                      bind:value={searchManpowerQuery}
                      placeholder="Cari nama atau jabatan..."
                      class="w-full bg-transparent border-0 p-0 text-sm focus:ring-0 text-gray-800 placeholder-gray-400"
                      on:click|stopPropagation
                      on:keydown={(e) => {
                        if (e.key === "Escape") {
                          showManpowerDropdown = false;
                        }
                      }}
                    />
                    {#if searchManpowerQuery}
                      <button
                        type="button"
                        on:click|stopPropagation={() => searchManpowerQuery = ""}
                        class="text-gray-400 hover:text-gray-600 p-0.5 rounded-full hover:bg-gray-200 transition"
                      >
                        ✕
                      </button>
                    {/if}
                  </div>

                  <!-- Options List -->
                  <div class="overflow-y-auto max-h-48 divide-y divide-gray-50">
                    {#if filteredManpower.length === 0}
                      <div class="p-3 text-center text-sm text-gray-500 italic">
                        Manpower tidak ditemukan
                      </div>
                    {:else}
                      {#each filteredManpower as m}
                        {@const spSanction = activeSanctions.find(s => s.karyawan_id === m.id && ['SP1', 'SP2', 'SP3'].includes(s.jenis_sanksi))}
                        <button
                          type="button"
                          on:click={() => {
                            form.manpower_id = String(m.id);
                            onPickManpower();
                            showManpowerDropdown = false;
                          }}
                          class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-900 cursor-pointer flex flex-col transition {String(m.id) === String(form.manpower_id) ? 'bg-blue-50 text-blue-900 font-semibold' : 'text-gray-700'}"
                        >
                          <span class="font-medium">
                            {m.nama}
                            {#if spSanction}
                              <span class="ml-1 text-xs text-red-600 font-bold">[⚠️ SP Aktif: {spSanction.jenis_sanksi}]</span>
                            {/if}
                          </span>
                          <span class="text-xs text-gray-500">{m.posisi || "-"}</span>
                        </button>
                      {/each}
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
            <p class="text-xs text-gray-400 mt-1">Manpower yang sudah aktif/menunggu TTD di project ini tidak ditampilkan.</p>
          {/if}
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Jabatan</label>
            <input bind:value={form.jabatan} placeholder="Blaster / Painter / Leader" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Tipe Upah</label>
            <select bind:value={form.rate_tipe} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500">
              <option value="harian">Harian</option>
              <option value="borongan">Borongan</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          {#if form.rate_tipe === "harian"}
            <div>
              <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Rate Harian (Rp) *</label>
              <input type="number" bind:value={form.rate_harian} placeholder="100000" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
          {:else}
            <div>
              <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Nilai Borongan (Rp) *</label>
              <input type="number" bind:value={form.nilai_borongan} placeholder="5000000" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
          {/if}
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Jenis Pekerjaan</label>
            <input bind:value={form.jenis_pekerjaan} placeholder="Sandblasting" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Tanggal Mulai</label>
            <input type="date" bind:value={form.tanggal_mulai} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Tanggal Selesai</label>
            <input type="date" bind:value={form.tanggal_selesai} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Lokasi Kerja</label>
          <input bind:value={form.lokasi} placeholder="Lokasi proyek" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Catatan</label>
          <textarea bind:value={form.catatan} rows="2" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none"></textarea>
        </div>
      </div>
      <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
        <button on:click={() => (showModal = false)} class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Batal</button>
        <button on:click={handleCreate} disabled={saving} class="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
          {saving ? "Menyimpan..." : "Buat & Lanjut TTD"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Edit Rate Modal ── -->
{#if showEditRateModal && editRateTarget}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" in:fade={{ duration: 150 }}>
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" in:slide={{ duration: 200 }}>
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-indigo-50">
        <div>
          <h3 class="text-lg font-bold text-gray-900">Edit Rate Gaji</h3>
          <p class="text-xs text-indigo-700">{nama(editRateTarget)} — {editRateTarget.jabatan || "-"}</p>
        </div>
        <button on:click={() => (showEditRateModal = false)} class="text-gray-400 hover:text-gray-600">✕</button>
      </div>
      <div class="p-6 space-y-4">
        <div>
          <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Tipe Upah</label>
          <select bind:value={editRateForm.rate_tipe} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500">
            <option value="harian">Harian</option>
            <option value="borongan">Borongan</option>
          </select>
        </div>
        {#if editRateForm.rate_tipe === "harian"}
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Rate Harian (Rp) *</label>
            <input type="number" bind:value={editRateForm.rate_harian} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
          </div>
        {:else}
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Nilai Borongan (Rp) *</label>
            <input type="number" bind:value={editRateForm.nilai_borongan} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
          </div>
        {/if}
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Lembur (Rp/jam)</label>
            <input type="number" bind:value={editRateForm.rate_lembur} placeholder="0" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Standby (Rp/hari)</label>
            <input type="number" bind:value={editRateForm.rate_standby} placeholder="0" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Uang Makan (Rp/hari)</label>
            <input type="number" bind:value={editRateForm.rate_uang_makan} placeholder="0" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <p class="text-xs text-gray-400">Perubahan rate berlaku untuk perhitungan gaji berikutnya, tidak mengubah biaya yang sudah tercatat.</p>
      </div>
      <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
        <button on:click={() => (showEditRateModal = false)} class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Batal</button>
        <button on:click={handleEditRate} disabled={editRateSaving} class="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">
          {editRateSaving ? "Menyimpan..." : "Simpan Rate"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Tanda Tangan SPK Modal ── -->
{#if showSignModal && signTarget}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" in:fade={{ duration: 150 }}>
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" in:slide={{ duration: 200 }}>
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-amber-50">
        <div>
          <h3 class="text-lg font-bold text-gray-900">Tanda Tangan SPK</h3>
          <p class="text-xs text-amber-700">{signTarget.nomor_spk} — {nama(signTarget)}</p>
        </div>
        <button on:click={() => (showSignModal = false)} class="text-gray-400 hover:text-gray-600">✕</button>
      </div>
      <div class="p-6 space-y-4">
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm space-y-1">
          <div class="flex justify-between"><span class="text-gray-500">Project</span><span class="font-medium text-gray-800">{project?.name}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Jabatan</span><span class="font-medium text-gray-800">{signTarget.jabatan || "-"}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Upah</span><span class="font-medium text-gray-800">{signTarget.rate_tipe === "borongan" ? `${fmtRp(signTarget.nilai_borongan)} borongan` : `${fmtRp(signTarget.rate_harian)}/hari`}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Periode</span><span class="font-medium text-gray-800">{fmtDate(signTarget.tanggal_mulai)} – {fmtDate(signTarget.tanggal_selesai)}</span></div>
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Nama Penanda Tangan</label>
          <input bind:value={signNama} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Tanda Tangan Manpower *</label>
          <SignaturePad bind:this={signPad} />
        </div>
        <p class="text-xs text-gray-500">Dengan menandatangani, manpower menyetujui perintah kerja & rate di atas. Penugasan otomatis menjadi <strong>Aktif</strong>.</p>
      </div>
      <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
        <button on:click={() => (showSignModal = false)} class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Batal</button>
        <button on:click={handleSign} disabled={signing} class="px-5 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
          {signing ? "Menyimpan..." : "Simpan TTD & Aktifkan"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Mutasi Modal ── -->
{#if showMutasiModal && mutasiTarget}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" in:fade={{ duration: 150 }}>
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md" in:slide={{ duration: 200 }}>
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-blue-50">
        <div>
          <h3 class="text-base font-bold text-gray-900">Mutasi Manpower</h3>
          <p class="text-sm text-blue-700">{nama(mutasiTarget)}</p>
        </div>
        <button on:click={() => (showMutasiModal = false)} class="text-gray-400 hover:text-gray-600">✕</button>
      </div>
      <div class="p-6 space-y-4">
        <p class="text-sm text-gray-600">Penugasan di project ini akan ditandai <strong>selesai</strong>, dan dibuat penugasan + SPK baru di project tujuan (perlu tanda tangan ulang).</p>
        <div>
          <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Project Tujuan *</label>
          <select bind:value={mutasiForm.project_id} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500">
            <option value="">-- Pilih project --</option>
            {#each mutasiProjects as p}<option value={String(p.id)}>{p.name}</option>{/each}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Rate Harian Baru (Rp)</label>
            <input type="number" bind:value={mutasiForm.rate_harian} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Tanggal Mulai</label>
            <input type="date" bind:value={mutasiForm.tanggal_mulai} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Tanggal Selesai *</label>
            <input type="date" bind:value={mutasiForm.tanggal_selesai} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>
      <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
        <button on:click={() => (showMutasiModal = false)} class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Batal</button>
        <button on:click={handleMutasi} disabled={mutasiSaving} class="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
          {mutasiSaving ? "Memproses..." : "Mutasi"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Report Violation Modal ── -->
{#if showViolationModal && violationTarget}
  <ReportViolationModal
    manpower={violationTarget}
    project={project}
    reporterName={actorName}
    onClose={() => { showViolationModal = false; violationTarget = null; }}
    onSuccess={() => { showViolationModal = false; violationTarget = null; load(); }}
  />
{/if}
