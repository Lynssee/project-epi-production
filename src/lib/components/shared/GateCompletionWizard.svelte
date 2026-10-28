<!-- src/lib/components/shared/GateCompletionWizard.svelte -->
<!-- "Popup Benahi Data" v2 (Gate Transparan & Popup Benahi Data, Fase 2 — 16 Sep 2026).
     Naik dari wizard "jalan buntu" (cuma teks + tombol Tutup) menjadi kartu per gate
     yang menjawab paham + navigasi: kenapa tertahan, akibatnya, langkah membenahi,
     siapa yang menolong, dan (bila berwenang) jalur darurat kalau memang tidak ada.
     Konten (consequence/checklist_items/owner_role/bypass_policy) ditempelkan dari
     gateHintClient.ts (gate_definitions erp-epi) lewat pemanggil — komponen ini TIDAK
     memanggil API sendiri dan TIDAK mengarang kalimat baru. Field itu semua opsional:
     gate tanpa hint tetap tampil dengan `message` bawaan (nol regresi untuk pemanggil
     lama yang belum diupgrade).
     Belum ada aksi tulis di sini (murni pemahaman + navigasi) — aksi Benahi Inline
     (isi KTP/NIK, usul tautan barang) menyusul di Fase 3. Tombol "Minta Bantuan"
     SENGAJA belum ada — targetnya (per-peran vs per-orang) belum diputuskan Lead. -->
<script lang="ts">
  import { fade, fly } from 'svelte/transition';

  interface BypassPolicy {
    method: string;
    who?: string;
    how?: string;
    trace?: string;
  }

  interface ChecklistItem {
    id: string;
    label: string;
    wajib?: boolean;
    kategori?: string;
    deskripsi?: string;
    tips?: string;
  }

  interface AffectedItem {
    id: number;
    label: string;
  }

  interface Gate {
    gate_key: string;
    label: string;
    severity: 'WAJIB' | 'SEMI';
    status: 'passed' | 'failed' | 'not_applicable';
    message: string;
    tab?: string;
    tab_label?: string;
    overridden?: boolean;
    // Ditempelkan gateHintClient.ts::applyGateHints() dari gate_definitions erp-epi —
    // semua opsional, wizard fallback ke `message` bawaan bila kosong.
    hint?: string | null;
    checklist_items?: ChecklistItem[] | null;
    consequence?: string | null;
    owner_role?: string | null;
    bypass_policy?: BypassPolicy | null;
    // Fase 3 (Aksi Benahi Inline) — baris konkret yang bisa dibenahi satu-per-satu dari
    // sini (mis. G_PKL_INVENTORY_LINK: tiap baris project_budgets belum tertaut).
    // Diisi server (plFieldGates.ts), BUKAN gateHintClient.
    affected_items?: AffectedItem[] | null;
    /** Gate disiplin proyek (plDisiplinFieldGates.ts) — tautan perbaikan cepat ke modul terkait. */
    fix_links?: Array<{ label: string; href: string }> | null;
  }

  let {
    open = false,
    gates = [],
    title = 'Wizard Kelengkapan Laporan',
    onClose = () => {},
    onGoToField = null,
    onRecheck = null,
    onFixItem = null,
    overrideAllowed = false,
    hintsUnavailable = false
  }: {
    open?: boolean;
    gates?: Gate[];
    title?: string;
    onClose?: () => void;
    onGoToField?: ((fieldHint: string, tab: string | undefined) => void) | null;
    /** Cek Ulang — evaluasi ulang gate tanpa menutup+membuka lagi wizard (D6). */
    onRecheck?: (() => void) | null;
    /** Aksi Benahi Inline per-baris (mis. usul tautan barang) — pemanggil membuka popup
     *  yang sesuai untuk gate_key + item ini. Wizard TIDAK menutup diri sendiri di sini
     *  (beda dari onGoToField) supaya user bisa membenahi beberapa baris berturut-turut. */
    onFixItem?: ((gateKey: string, item: AffectedItem) => void) | null;
    /** Tampilkan accordion "Butuh lanjut sekarang?" hanya bila user memang berwenang. */
    overrideAllowed?: boolean;
    /** Admin tak terjangkau saat memuat hint (fieldGateHints fail-soft) — tampilkan baris jujur. */
    hintsUnavailable?: boolean;
  } = $props();

  const SEVERITY_ORDER: Record<string, number> = { WAJIB: 0, SEMI: 1 };

  let activeFilter = $state<'semua' | 'wajib' | 'peringatan'>('semua');
  let expandedBypass = $state<Set<string>>(new Set());

  function toggleBypass(key: string) {
    const next = new Set(expandedBypass);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedBypass = next;
  }

  let actionableGates = $derived(
    [...(gates || [])]
      .filter((g) => g.status !== 'passed' && g.status !== 'not_applicable')
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2))
  );

  let filteredGates = $derived(
    activeFilter === 'wajib'
      ? actionableGates.filter((g) => g.severity === 'WAJIB')
      : activeFilter === 'peringatan'
        ? actionableGates.filter((g) => g.severity === 'SEMI')
        : actionableGates
  );

  let requiredGates = $derived((gates || []).filter((g) => g.severity === 'WAJIB' && g.status !== 'not_applicable'));
  let requiredDone = $derived(requiredGates.filter((g) => g.status === 'passed').length);
  let semiCount = $derived(actionableGates.filter((g) => g.severity === 'SEMI').length);
  let wajibCount = $derived(actionableGates.filter((g) => g.severity === 'WAJIB').length);

  function handleFieldAction(g: Gate) {
    onClose();
    if (onGoToField) onGoToField(g.gate_key, g.tab);
  }
</script>

{#if open}
  <div class="wizard-overlay" transition:fade={{ duration: 150 }} onclick={onClose} role="presentation">
    <div class="wizard-panel" transition:fly={{ y: 24, duration: 200 }} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="wizard-header">
        <div>
          <h2>{title}</h2>
          <p class="hint">
            Daftar ini disusun otomatis dari aturan perusahaan. Merah = wajib dibenahi dulu.
            Kuning = boleh lanjut, tapi sebaiknya dibenahi.
          </p>
        </div>
        <button class="close-btn" onclick={onClose} aria-label="Tutup">✕</button>
      </div>

      {#if hintsUnavailable}
        <div class="hints-warning">
          ⚠️ Panduan lengkap sedang tidak dapat dimuat — hubungi Admin kantor. Anda tetap bisa
          melihat syarat yang menahan di bawah.
        </div>
      {/if}

      <div class="progress-row">
        <div class="progress-bar">
          <div class="progress-fill" style="width: {requiredGates.length ? (requiredDone / requiredGates.length) * 100 : 100}%"></div>
        </div>
        <span class="progress-label">{requiredDone}/{requiredGates.length} wajib terpenuhi</span>
      </div>

      {#if actionableGates.length > 0}
        <div class="filter-tabs">
          <button type="button" class="filter-tab" class:active={activeFilter === 'semua'} onclick={() => (activeFilter = 'semua')}>
            Semua ({actionableGates.length})
          </button>
          <button type="button" class="filter-tab" class:active={activeFilter === 'wajib'} onclick={() => (activeFilter = 'wajib')}>
            Wajib ({wajibCount})
          </button>
          <button type="button" class="filter-tab" class:active={activeFilter === 'peringatan'} onclick={() => (activeFilter = 'peringatan')}>
            Peringatan ({semiCount})
          </button>
        </div>
      {/if}

      <div class="steps-list">
        {#if actionableGates.length === 0}
          <div class="all-clear">✅ Semua bagian sudah lengkap — silakan kirim.</div>
        {:else if filteredGates.length === 0}
          <div class="all-clear">Tidak ada gate pada filter ini.</div>
        {/if}
        {#each filteredGates as g (g.gate_key)}
          <div class="step" class:step-wajib={g.severity === 'WAJIB'} class:step-semi={g.severity === 'SEMI'}>
            <div class="step-top">
              <div class="step-badge">{g.severity === 'WAJIB' ? '✕' : '!'}</div>
              <div class="step-body">
                <span class="step-title">{g.label}</span>

                <div class="step-section">
                  <span class="step-section-label">KENAPA TERTAHAN</span>
                  <p class="step-message">{g.message}</p>
                </div>

                {#if g.consequence}
                  <div class="step-section">
                    <span class="step-section-label">AKIBATNYA KALAU DIBIARKAN</span>
                    <p class="step-message">{g.consequence}</p>
                  </div>
                {/if}

                {#if g.checklist_items?.length}
                  <div class="step-section">
                    <span class="step-section-label">LANGKAH MEMBENAHI</span>
                    <ol class="checklist">
                      {#each g.checklist_items as item, i (item.id || i)}
                        <li>{item.label}</li>
                      {/each}
                    </ol>
                  </div>
                {/if}

                {#if g.owner_role}
                  <div class="step-section owner-row">
                    <span class="step-section-label">SIAPA YANG MENOLONG</span>
                    <span class="owner-value">{g.owner_role}</span>
                  </div>
                {/if}

                {#if g.affected_items?.length && onFixItem}
                  <div class="step-section">
                    <span class="step-section-label">BENAHI PER BARIS</span>
                    <div class="affected-item-list">
                      {#each g.affected_items as item (item.id)}
                        <div class="affected-item-row">
                          <span class="affected-item-label">{item.label}</span>
                          <button type="button" class="btn-fix-item" onclick={() => onFixItem?.(g.gate_key, item)}>
                            Benahi →
                          </button>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}

                {#if g.fix_links?.length}
                  <div class="step-section">
                    <span class="step-section-label">AKSI PERBAIKAN CEPAT</span>
                    <div class="fix-links-list">
                      {#each g.fix_links as link}
                        <a href={link.href} target="_blank" rel="noopener noreferrer" class="btn-fix-link">
                          🔗 {link.label} →
                        </a>
                      {/each}
                    </div>
                  </div>
                {/if}

                {#if g.tab}<span class="step-link-static">Terkait bagian "{g.tab_label || g.tab}"</span>{/if}
              </div>
            </div>

            <div class="step-actions">
              {#if g.tab && onGoToField}
                <button type="button" class="btn-secondary" onclick={() => handleFieldAction(g)}>Buka Bagian Ini</button>
              {/if}
              {#if g.bypass_policy}
                <button type="button" class="btn-ghost-sm" onclick={() => toggleBypass(g.gate_key)}>
                  {expandedBypass.has(g.gate_key) ? '▾' : '▸'} Butuh lanjut sekarang?
                </button>
              {/if}
            </div>

            {#if g.bypass_policy && expandedBypass.has(g.gate_key)}
              <div class="bypass-box">
                {#if g.bypass_policy.method === 'none'}
                  <p class="bypass-none">Tidak ada jalur pengecualian untuk syarat ini.</p>
                {:else}
                  <p><strong>Siapa yang berwenang:</strong> {g.bypass_policy.who || '—'}</p>
                  <p><strong>Caranya:</strong> {g.bypass_policy.how || '—'}</p>
                  {#if !overrideAllowed}
                    <p class="bypass-note">Anda tidak berwenang menggunakan jalur ini — hubungi pihak di atas.</p>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="wizard-footer">
        {#if onRecheck}
          <button class="btn-secondary" onclick={onRecheck}>↻ Cek Ulang</button>
        {/if}
        <button class="btn-primary" onclick={onClose}>Tutup</button>
      </div>
      {#if actionableGates.length > 0 && onRecheck}
        <p class="footer-hint">Sudah dibenahi? Ketuk <strong>Cek Ulang</strong> — tidak perlu keluar dari halaman ini.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .wizard-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000;
    display: flex; align-items: center; justify-content: center; padding: 1rem;
  }
  .wizard-panel {
    background: #fff; border-radius: 12px; max-width: 640px; width: 100%;
    max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  }
  .wizard-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 1.25rem 1.25rem 0.75rem; gap: 0.75rem; }
  .wizard-header h2 { margin: 0 0 0.4rem; font-size: 1.05rem; font-weight: 700; }
  .hint { margin: 0; font-size: 0.78rem; color: #6b7280; line-height: 1.4; }
  .close-btn { background: none; border: none; font-size: 1rem; cursor: pointer; color: #9ca3af; padding: 0.25rem; }

  .hints-warning {
    margin: 0 1.25rem 0.75rem; padding: 0.6rem 0.75rem; background: #fffbeb; border: 1px solid #fde68a;
    border-radius: 8px; font-size: 0.75rem; color: #92400e; line-height: 1.4;
  }

  .progress-row { display: flex; align-items: center; gap: 0.75rem; padding: 0 1.25rem 0.75rem; }
  .progress-bar { flex: 1; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: #16a34a; transition: width 0.3s ease; }
  .progress-label { font-size: 0.72rem; color: #6b7280; white-space: nowrap; }

  .filter-tabs { display: flex; gap: 0.4rem; padding: 0 1.25rem 0.75rem; }
  .filter-tab {
    font-size: 0.72rem; font-weight: 600; color: #6b7280; background: #f3f4f6; border: none;
    border-radius: 999px; padding: 0.3rem 0.7rem; cursor: pointer;
  }
  .filter-tab.active { background: #111827; color: #fff; }

  .steps-list { overflow-y: auto; padding: 0 1.25rem; flex: 1; display: flex; flex-direction: column; gap: 0.6rem; }
  .all-clear { padding: 1.5rem; text-align: center; color: #16a34a; font-weight: 600; }

  .step {
    border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.75rem;
  }
  .step-wajib { border-color: #fecaca; background: #fef2f2; }
  .step-semi { border-color: #fde68a; background: #fffbeb; }

  .step-top { display: flex; gap: 0.7rem; }
  .step-badge {
    flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 0.7rem; font-weight: 700; color: #fff; margin-top: 0.1rem;
  }
  .step-wajib .step-badge { background: #dc2626; }
  .step-semi .step-badge { background: #d97706; }

  .step-body { flex: 1; min-width: 0; }
  .step-title { font-weight: 600; font-size: 0.85rem; }

  .step-section { margin-top: 0.5rem; }
  .step-section-label { display: block; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.03em; color: #6b7280; text-transform: uppercase; margin-bottom: 0.15rem; }
  .step-message { margin: 0; font-size: 0.78rem; color: #374151; line-height: 1.4; }
  .checklist { margin: 0; padding-left: 1.1rem; font-size: 0.78rem; color: #374151; line-height: 1.5; }
  .checklist li { margin-bottom: 0.15rem; }

  .owner-row { display: flex; align-items: center; gap: 0.4rem; }
  .owner-value { font-size: 0.78rem; font-weight: 600; color: #111827; text-transform: capitalize; }

  .step-link-static { display: inline-block; margin-top: 0.4rem; font-size: 0.7rem; color: #6b7280; font-style: italic; }

  .affected-item-list { display: flex; flex-direction: column; gap: 0.35rem; }
  .affected-item-row {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.4rem 0.6rem;
  }
  .affected-item-label { font-size: 0.76rem; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btn-fix-item {
    flex-shrink: 0; background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; font-size: 0.72rem;
    font-weight: 600; padding: 0.3rem 0.6rem; border-radius: 6px; cursor: pointer;
  }
  .btn-fix-item:hover { background: #dbeafe; }

  .fix-links-list { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.2rem; }
  .btn-fix-link {
    display: inline-flex; align-items: center; gap: 0.4rem; background: #eff6ff; border: 1px solid #bfdbfe;
    color: #1d4ed8; font-size: 0.74rem; font-weight: 600; padding: 0.35rem 0.65rem; border-radius: 6px;
    text-decoration: none; transition: background 0.15s; width: fit-content;
  }
  .btn-fix-link:hover { background: #dbeafe; }

  .step-actions { display: flex; gap: 0.5rem; margin-top: 0.6rem; flex-wrap: wrap; }
  .btn-secondary {
    background: #fff; border: 1px solid #d1d5db; color: #111827; font-size: 0.75rem; font-weight: 600;
    padding: 0.35rem 0.7rem; border-radius: 8px; cursor: pointer;
  }
  .btn-ghost-sm {
    background: none; border: none; color: #6b7280; font-size: 0.72rem; font-weight: 600;
    padding: 0.35rem 0.2rem; cursor: pointer;
  }

  .bypass-box {
    margin-top: 0.5rem; padding: 0.6rem 0.7rem; background: #fff; border: 1px dashed #d1d5db;
    border-radius: 8px; font-size: 0.75rem; color: #374151; line-height: 1.45;
  }
  .bypass-box p { margin: 0 0 0.3rem; }
  .bypass-box p:last-child { margin-bottom: 0; }
  .bypass-none { font-weight: 700; color: #b91c1c; }
  .bypass-note { color: #92400e; }

  .wizard-footer { display: flex; align-items: center; justify-content: flex-end; gap: 0.6rem; padding: 1rem 1.25rem 0.4rem; border-top: 1px solid #e5e7eb; }
  .btn-primary { background: #16a34a; color: #fff; padding: 0.5rem 1.2rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: none; }
  .footer-hint { margin: 0; padding: 0 1.25rem 1rem; font-size: 0.7rem; color: #9ca3af; text-align: right; }
</style>
