<!-- src/lib/components/shared/GateFixTautanBarang.svelte -->
<!-- Gate Transparan & Popup Benahi Data, Fase 3 — Aksi Benahi Inline C. Popup pencarian
     barang master untuk mengusulkan tautan pada baris project_budgets yang belum
     tertaut identitas_barang_id. Dipanggil dari GateCompletionWizard begitu Fase 5
     membuat gate G_PKL_INVENTORY_LINK dan mengisi action_config.field_actions.
     Pencarian pakai searchMasterCatalog() yang SUDAH ADA (dipakai juga di form
     Packing List) -- bukan mesin fuzzy baru. Usulan TIDAK langsung menautkan barang;
     Admin Logistik yang konfirmasi (lihat /api/gates/fix/usul-tautan-barang). -->
<script lang="ts">
  import { searchMasterCatalog, type MasterCatalogItem } from '$lib/services/packingList';

  let {
    open = false,
    projectBudgetId,
    itemLabel = '',
    onClose = () => {},
    onSuccess = () => {}
  }: {
    open?: boolean;
    projectBudgetId: number;
    itemLabel?: string;
    onClose?: () => void;
    onSuccess?: () => void;
  } = $props();

  let query = $state('');
  let results = $state<MasterCatalogItem[]>([]);
  let searching = $state(false);
  let selected = $state<MasterCatalogItem | null>(null);
  let catatan = $state('');
  let submitting = $state(false);
  let errorMsg = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function handleQueryInput() {
    selected = null;
    if (searchTimer) clearTimeout(searchTimer);
    const q = query;
    searchTimer = setTimeout(async () => {
      searching = true;
      results = await searchMasterCatalog(q);
      searching = false;
    }, 300);
  }

  function pick(item: MasterCatalogItem) {
    selected = item;
    results = [];
  }

  async function handleSubmit() {
    errorMsg = '';
    if (!selected) { errorMsg = 'Pilih salah satu barang dari hasil pencarian.'; return; }

    submitting = true;
    try {
      const res = await fetch('/api/gates/fix/usul-tautan-barang', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectBudgetId, usulanIdentitasBarangId: selected.id, catatan })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorMsg = body?.message || 'Gagal mengirim usulan. Coba lagi.';
        submitting = false;
        return;
      }
      query = '';
      selected = null;
      catatan = '';
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
      <h3>Usulkan Tautan Barang{itemLabel ? ` — ${itemLabel}` : ''}</h3>
      <p class="hint">Cari barang master yang paling mirip. Admin Logistik akan mengonfirmasi tautan ini (± 1 jam kerja), bukan langsung aktif.</p>

      <label class="field-label">Cari barang
        <input type="text" bind:value={query} oninput={handleQueryInput} placeholder="Ketik nama barang..." />
      </label>

      {#if searching}
        <p class="muted">Mencari...</p>
      {:else if results.length > 0}
        <ul class="result-list">
          {#each results as item (item.id)}
            <li>
              <button type="button" onclick={() => pick(item)}>
                {item.nama_barang_lengkap} <span class="muted">({item.kode_item || '-'})</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if selected}
        <div class="selected-box">
          Dipilih: <strong>{selected.nama_barang_lengkap}</strong>
          <button type="button" class="link-btn" onclick={() => (selected = null)}>Ganti</button>
        </div>
      {/if}

      <label class="field-label">Catatan (opsional)
        <textarea bind:value={catatan} rows="2" placeholder="Kenapa Anda pilih barang ini?"></textarea>
      </label>

      {#if errorMsg}<p class="error">{errorMsg}</p>{/if}

      <div class="actions">
        <button type="button" class="btn-secondary" onclick={onClose} disabled={submitting}>Batal</button>
        <button type="button" class="btn-primary" onclick={handleSubmit} disabled={submitting || !selected}>
          {submitting ? 'Mengirim...' : 'Kirim Usulan'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .panel { background: #fff; border-radius: 12px; max-width: 420px; width: 100%; padding: 1.25rem; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-height: 85vh; overflow-y: auto; }
  h3 { margin: 0 0 0.4rem; font-size: 0.95rem; font-weight: 700; }
  .hint { margin: 0 0 0.9rem; font-size: 0.75rem; color: #6b7280; line-height: 1.4; }
  .field-label { display: block; font-size: 0.75rem; font-weight: 600; color: #374151; margin-bottom: 0.75rem; }
  .field-label input, .field-label textarea { display: block; width: 100%; margin-top: 0.3rem; padding: 0.5rem 0.6rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.85rem; box-sizing: border-box; font-family: inherit; }
  .muted { color: #9ca3af; font-size: 0.75rem; }
  .result-list { list-style: none; margin: 0 0 0.75rem; padding: 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .result-list li button { width: 100%; text-align: left; background: none; border: none; padding: 0.5rem 0.6rem; font-size: 0.8rem; cursor: pointer; border-bottom: 1px solid #f3f4f6; }
  .result-list li:last-child button { border-bottom: none; }
  .result-list li button:hover { background: #f9fafb; }
  .selected-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 0.5rem 0.6rem; font-size: 0.8rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center; }
  .link-btn { background: none; border: none; color: #2563eb; font-size: 0.72rem; font-weight: 600; cursor: pointer; }
  .error { color: #dc2626; font-size: 0.75rem; margin: 0 0 0.5rem; }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  .btn-secondary { background: #fff; border: 1px solid #d1d5db; color: #111827; font-size: 0.8rem; font-weight: 600; padding: 0.45rem 0.9rem; border-radius: 8px; cursor: pointer; }
  .btn-primary { background: #16a34a; color: #fff; border: none; font-size: 0.8rem; font-weight: 600; padding: 0.45rem 0.9rem; border-radius: 8px; cursor: pointer; }
  .btn-primary:disabled, .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
