<script lang="ts">
  // Fase 1 — Rencana v2 "Panduan Auto-Sync & Blok Visual Terstruktur" (§3 Lapis 1).
  // Merender panduan_steps.blocks (JSON, 12 tipe) sebagai pengganti HTML mentah.
  // KEMBAR dari src/lib/components/help/PanduanBlocks.svelte di erp-epi — satu
  // definisi blok, dua aplikasi, disalin sebagai berkas kembar (§3, tanpa
  // shared package lintas repo). Jaga tetap sinkron manual bila salah satu diubah.
  //
  // Token warna: SENGAJA memakai token semantik GLOBAL yang sudah ada di
  // layout.css (--color-surface/-soft, --color-border, --color-text/-2,
  // --color-primary/-accent, --color-success/-warning/-error(-text)) — bukan
  // namespace --panduan-* terpisah seperti draf awal §8.1. Token ini SUDAH
  // punya pasangan terang/gelap terpusat di layout.css (:root vs
  // :root[data-theme='dark']), jadi mode gelap otomatis ikut tanpa duplikasi
  // definisi token. Tidak ada satu pun warna literal di berkas ini (§8.1).
  //
  // alur_mermaid: TIDAK dirender sebagai diagram (butuh library mermaid, berat
  // — dilewati sesuai instruksi umum "maksimalkan package, kalau memberatkan
  // tidak perlu"). Ditampilkan sebagai blok kode biasa berlabel.

  import { sanitizeRichHtml, resolveRichImages } from '$lib/utils/richContent';
  import { getSecureAssetUrl } from '$lib/actions/secureAsset';

  let { blocks = [] }: { blocks?: any[] } = $props();

  const NADA_CLASS: Record<string, string> = {
    info: 'pb-nada-info',
    sukses: 'pb-nada-sukses',
    peringatan: 'pb-nada-peringatan',
    bahaya: 'pb-nada-bahaya',
    netral: 'pb-nada-netral'
  };
  function nadaClass(nada: string) {
    return NADA_CLASS[nada] || NADA_CLASS.netral;
  }

  let copiedKode: number | null = $state(null);
  async function salinKode(teks: string, key: number) {
    try {
      await navigator.clipboard.writeText(teks || '');
      copiedKode = key;
      setTimeout(() => { if (copiedKode === key) copiedKode = null; }, 1500);
    } catch (e) {
      console.warn('[PanduanBlocks] gagal menyalin kode:', e);
    }
  }

  function gambarSrc(node: HTMLImageElement, assetId: string) {
    let cancelled = false;
    async function load(id: string) {
      if (!id) return;
      try {
        const url = await getSecureAssetUrl(`/assets/${id}`);
        if (!cancelled) node.src = url;
      } catch (e) {
        console.warn('[PanduanBlocks] gagal memuat gambar blok:', e);
      }
    }
    load(assetId);
    return {
      update(newId: string) { load(newId); },
      destroy() { cancelled = true; }
    };
  }
</script>

{#if blocks && blocks.length}
  <div class="pb-root space-y-4">
    {#each blocks as blok, bi (bi)}
      {#if blok.type === 'ringkasan'}
        <div class="pb-ringkasan" use:resolveRichImages={blok.teks}>{@html sanitizeRichHtml(blok.teks)}</div>

      {:else if blok.type === 'badges'}
        <div class="flex flex-wrap gap-1.5">
          {#each blok.items || [] as b}
            <span class="pb-badge {nadaClass(b.nada)}">{b.teks}</span>
          {/each}
        </div>

      {:else if blok.type === 'komparasi'}
        <div class="pb-kartu p-3">
          {#if blok.judul}<h4 class="pb-heading mb-2">{blok.judul}</h4>{/if}
          <!-- Desktop/tablet: tabel dengan overflow-x. HP (<640px): mode kartu per-baris (§3, nilai tambah v2). -->
          <div class="hidden sm:block overflow-x-auto rounded-lg border pb-border">
            <table class="w-full text-xs text-left">
              <thead class="pb-thead">
                <tr>
                  {#each blok.kolom || [] as k}<th class="p-2.5">{k}</th>{/each}
                </tr>
              </thead>
              <tbody class="pb-tbody-divide">
                {#each blok.baris || [] as baris}
                  <tr>
                    {#each baris as sel, ci}<td class="p-2.5" class:pb-kol-highlight={ci === (blok.kolom?.length || 0) - 1}>{@html sanitizeRichHtml(sel)}</td>{/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="sm:hidden space-y-2">
            {#each blok.baris || [] as baris}
              <div class="pb-mini-kartu p-2.5 space-y-1">
                <div class="font-semibold pb-text text-xs">{baris[0]}</div>
                {#each (blok.kolom || []).slice(1) as k, ci}
                  <div class="text-xs">
                    <span class="pb-text-soft">{k}:</span>
                    <span class="pb-text" class:pb-kol-highlight={ci === (blok.kolom?.length || 0) - 2}>{@html sanitizeRichHtml(baris[ci + 1])}</span>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        </div>

      {:else if blok.type === 'peran'}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          {#each [['kantor', blok.kantor], ['lapangan', blok.lapangan]] as [k, p] (k)}
            {#if p}
              <div class="pb-mini-kartu p-3">
                <div class="font-semibold pb-text text-sm mb-1">{p.judul}</div>
                <div class="text-xs pb-text-soft leading-relaxed" use:resolveRichImages={p.isi}>{@html sanitizeRichHtml(p.isi)}</div>
                {#if p.menu}<div class="mt-2 text-[11px] pb-text-soft">📍 {p.menu}</div>{/if}
              </div>
            {/if}
          {/each}
        </div>

      {:else if blok.type === 'langkah_alur'}
        <div class="space-y-2.5">
          {#if blok.judul}<h4 class="pb-heading">{blok.judul}</h4>{/if}
          {#each blok.langkah || [] as l}
            <div class="pb-mini-kartu p-3">
              <div class="font-bold pb-text text-xs mb-1 flex items-center gap-2">
                <span class="pb-step-no">{l.no}</span>
                <span>{l.judul}</span>
              </div>
              {#if l.isi}<p class="pb-text-soft text-xs mb-1" use:resolveRichImages={l.isi}>{@html sanitizeRichHtml(l.isi)}</p>{/if}
              {#if l.bullets?.length}
                <ul class="list-disc pl-4 space-y-0.5 pb-text-soft text-xs">
                  {#each l.bullets as b}<li>{@html sanitizeRichHtml(b)}</li>{/each}
                </ul>
              {/if}
              {#if l.hasil}<p class="text-xs pb-text mt-1"><strong>Hasil:</strong> {l.hasil}</p>{/if}
            </div>
          {/each}
        </div>

      {:else if blok.type === 'tips'}
        <div class="pb-callout pb-nada-peringatan flex gap-3 p-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-xs leading-relaxed"><strong>Tips:</strong> {blok.teks}</p>
        </div>

      {:else if blok.type === 'penting'}
        <div class="pb-callout pb-nada-bahaya flex gap-3 p-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p class="text-xs leading-relaxed"><strong>Penting:</strong> {blok.teks}</p>
        </div>

      {:else if blok.type === 'cta'}
        <a href={blok.href} class="pb-cta">
          {#if blok.ikon}<span>{blok.ikon}</span>{/if}
          <span>{blok.label}</span>
          {#if !blok.ikon}<span>→</span>{/if}
        </a>

      {:else if blok.type === 'kode'}
        <div class="pb-kode relative">
          {#if blok.bahasa}<div class="pb-kode-lang">{blok.bahasa}</div>{/if}
          <pre class="text-xs overflow-x-auto p-3 pr-16"><code>{blok.teks}</code></pre>
          <button
            type="button"
            onclick={() => salinKode(blok.teks, bi)}
            class="pb-kode-copy"
          >
            {copiedKode === bi ? '✓ Disalin' : 'Salin'}
          </button>
        </div>

      {:else if blok.type === 'checklist'}
        <ul class="pb-kartu p-3 space-y-1.5">
          {#each blok.items || [] as it}
            <li class="flex items-start gap-2 text-xs pb-text">
              <span class="pb-check">☐</span>
              <span>{it.teks}</span>
            </li>
          {/each}
        </ul>

      {:else if blok.type === 'gambar'}
        <figure class="pb-kartu p-2">
          <img use:gambarSrc={blok.asset_id} alt={blok.keterangan || ''} class="w-full rounded-lg" />
          {#if blok.keterangan}<figcaption class="text-xs pb-text-soft mt-1.5 text-center">{blok.keterangan}</figcaption>{/if}
        </figure>

      {:else if blok.type === 'alur_mermaid'}
        <div class="pb-kode relative">
          <div class="pb-kode-lang">diagram (mermaid)</div>
          <pre class="text-xs overflow-x-auto p-3"><code>{blok.teks}</code></pre>
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .pb-root { color: var(--color-text); }
  .pb-text { color: var(--color-text); }
  .pb-text-soft { color: var(--color-text-2); }
  .pb-heading { font-weight: 700; font-size: 0.875rem; color: var(--color-text); display: flex; align-items: center; gap: 0.375rem; }
  .pb-border { border-color: var(--color-border); }
  .pb-ringkasan { color: var(--color-text-2); line-height: 1.625; font-size: 0.875rem; }
  .pb-ringkasan :global(p) { margin-bottom: 0.5rem; }

  .pb-kartu, .pb-mini-kartu {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
  }
  .pb-mini-kartu { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); }

  .pb-thead { background: var(--color-surface-soft); border-bottom: 1px solid var(--color-border); color: var(--color-text); font-weight: 600; }
  .pb-tbody-divide tr:not(:last-child) { border-bottom: 1px solid var(--color-border); }
  .pb-tbody-divide td { color: var(--color-text-2); }
  .pb-kol-highlight { background: color-mix(in srgb, var(--color-primary) 8%, transparent); color: var(--color-text); font-weight: 500; }

  .pb-step-no {
    width: 1.25rem; height: 1.25rem; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    border-radius: 9999px; background: var(--color-primary); color: white;
    font-size: 0.6875rem; font-weight: 700;
  }

  .pb-badge {
    display: inline-flex; align-items: center;
    padding: 0.125rem 0.5rem; border-radius: 0.25rem;
    font-size: 0.6875rem; font-weight: 600; border: 1px solid;
  }
  .pb-callout { border-radius: 0.5rem; border: 1px solid; }

  .pb-nada-info { background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface)); color: var(--color-primary); border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border)); }
  .pb-nada-sukses { background: color-mix(in srgb, var(--color-success) 12%, var(--color-surface)); color: var(--color-success-text); border-color: color-mix(in srgb, var(--color-success) 30%, var(--color-border)); }
  .pb-nada-peringatan { background: color-mix(in srgb, var(--color-warning) 14%, var(--color-surface)); color: var(--color-warning-text); border-color: color-mix(in srgb, var(--color-warning) 30%, var(--color-border)); }
  .pb-nada-bahaya { background: color-mix(in srgb, var(--color-error) 12%, var(--color-surface)); color: var(--color-error-text); border-color: color-mix(in srgb, var(--color-error) 30%, var(--color-border)); }
  .pb-nada-netral { background: var(--color-surface-soft); color: var(--color-text-2); border-color: var(--color-border); }

  .pb-cta {
    display: inline-flex; align-items: center; gap: 0.375rem;
    padding: 0.375rem 0.75rem; border-radius: 0.5rem;
    background: var(--color-primary); color: white;
    font-size: 0.75rem; font-weight: 600; text-decoration: none;
    transition: background-color 0.15s;
  }
  .pb-cta:hover { background: var(--color-primary-hover); }

  .pb-kode { background: var(--color-surface-soft); border: 1px solid var(--color-border); border-radius: 0.5rem; }
  .pb-kode-lang { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-2); padding: 0.375rem 0.75rem 0; }
  .pb-kode pre { color: var(--color-text); font-family: var(--font-mono, monospace); margin: 0; }
  .pb-kode-copy {
    position: absolute; top: 0.5rem; right: 0.5rem;
    font-size: 0.625rem; padding: 0.25rem 0.5rem; border-radius: 0.25rem;
    background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-2);
    cursor: pointer;
  }
  .pb-kode-copy:hover { color: var(--color-text); }

  .pb-check { color: var(--color-text-2); }
</style>
