<!-- src/lib/components/shared/GateFixKtpNik.svelte -->
<!-- Gate Transparan & Popup Benahi Data, Fase 3 — Aksi Benahi Inline A. Popup kecil
     untuk mengisi NIK + foto KTP pekerja langsung dari HP lapangan, dipanggil dari
     GateCompletionWizard (field_actions) begitu Fase 5 membuat gate G_MANPOWER_IDENTITAS.
     Menulis lewat /api/gates/fix/ktp-nik (jalur tervalidasi manpower_dokumen + NIK yang
     sudah ada, bukan write baru). TIDAK ada jalur bypass (keputusan Q2) -- kalau leader
     tidak punya foto/NIK, wizard cuma bisa menampilkan langkahnya, tidak melewatkannya. -->
<script lang="ts">
  import { compressPhoto } from '$lib/utils/photoCompress';
  import { uploadEvidencePhoto } from '$lib/services/stockLapangan';

  let {
    open = false,
    manpowerId,
    manpowerName = '',
    onClose = () => {},
    onSuccess = () => {}
  }: {
    open?: boolean;
    manpowerId: number;
    manpowerName?: string;
    onClose?: () => void;
    onSuccess?: () => void;
  } = $props();

  let nik = $state('');
  let selectedFile = $state<File | null>(null);
  let previewUrl = $state<string | null>(null);
  let submitting = $state(false);
  let errorMsg = $state('');

  let nikValid = $derived(/^\d{16}$/.test(nik));

  // Anti Aturan #5 (CLAUDE.md): TIDAK ADA await sebelum membuka kamera/file picker.
  // <input type="file" capture> dipicu langsung oleh klik user, sinkron.
  function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    selectedFile = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
  }

  async function handleSubmit() {
    errorMsg = '';
    if (!nikValid) { errorMsg = 'NIK wajib 16 digit angka.'; return; }
    if (!selectedFile) { errorMsg = 'Foto KTP wajib diunggah.'; return; }

    submitting = true;
    try {
      const compressed = await compressPhoto(selectedFile);
      const fileId = await uploadEvidencePhoto(compressed, `manpower_dokumen:ktp:${manpowerId}`);
      if (!fileId) { errorMsg = 'Gagal mengunggah foto KTP. Coba lagi.'; submitting = false; return; }

      const res = await fetch('/api/gates/fix/ktp-nik', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manpowerId, nik, fotoKtpFileId: fileId })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorMsg = body?.message || 'Gagal menyimpan. Coba lagi.';
        submitting = false;
        return;
      }

      nik = '';
      selectedFile = null;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      onSuccess();
      onClose();
    } catch (e) {
      errorMsg = (e as Error)?.message || 'Terjadi kesalahan.';
    } finally {
      submitting = false;
    }
  }
</script>

{#if open}
  <div class="overlay" onclick={onClose} role="presentation">
    <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <h3>Benahi Identitas{manpowerName ? ` — ${manpowerName}` : ''}</h3>
      <p class="hint">Isi NIK dan unggah foto KTP. Setelah tersimpan, HRD akan memverifikasi dalam waktu dekat — ini belum langsung meloloskan syarat.</p>

      <label class="field-label">NIK (16 digit)
        <input type="text" inputmode="numeric" maxlength="16" bind:value={nik} placeholder="3301230107760002" />
      </label>

      <label class="field-label">Foto KTP
        <input type="file" accept="image/*" capture="environment" onchange={handleFileChange} />
      </label>

      {#if previewUrl}
        <img src={previewUrl} alt="Pratinjau KTP" class="preview" />
      {/if}

      {#if errorMsg}<p class="error">{errorMsg}</p>{/if}

      <div class="actions">
        <button type="button" class="btn-secondary" onclick={onClose} disabled={submitting}>Batal</button>
        <button type="button" class="btn-primary" onclick={handleSubmit} disabled={submitting || !nikValid || !selectedFile}>
          {submitting ? 'Menyimpan...' : 'Simpan'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .panel { background: #fff; border-radius: 12px; max-width: 420px; width: 100%; padding: 1.25rem; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
  h3 { margin: 0 0 0.4rem; font-size: 0.95rem; font-weight: 700; }
  .hint { margin: 0 0 0.9rem; font-size: 0.75rem; color: #6b7280; line-height: 1.4; }
  .field-label { display: block; font-size: 0.75rem; font-weight: 600; color: #374151; margin-bottom: 0.75rem; }
  .field-label input { display: block; width: 100%; margin-top: 0.3rem; padding: 0.5rem 0.6rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.85rem; box-sizing: border-box; }
  .preview { width: 100%; max-height: 160px; object-fit: contain; border-radius: 8px; margin-bottom: 0.75rem; background: #f3f4f6; }
  .error { color: #dc2626; font-size: 0.75rem; margin: 0 0 0.5rem; }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  .btn-secondary { background: #fff; border: 1px solid #d1d5db; color: #111827; font-size: 0.8rem; font-weight: 600; padding: 0.45rem 0.9rem; border-radius: 8px; cursor: pointer; }
  .btn-primary { background: #16a34a; color: #fff; border: none; font-size: 0.8rem; font-weight: 600; padding: 0.45rem 0.9rem; border-radius: 8px; cursor: pointer; }
  .btn-primary:disabled, .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
