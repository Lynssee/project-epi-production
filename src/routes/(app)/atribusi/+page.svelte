<script lang="ts">
  let { data } = $props();

  function isCopyleft(license: string | null) {
    return /gpl/i.test(license || '');
  }
</script>

<div class="p-4 max-w-2xl mx-auto space-y-4 pb-24">
  <div>
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Atribusi Open Source</h1>
    <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
      Aplikasi ini dibangun menggunakan {data.items.length} library open source berikut.
    </p>
  </div>

  <div class="space-y-2">
    {#each data.items as item}
      <div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium text-zinc-900 dark:text-white">{item.name}</span>
          <span class="text-xs text-zinc-400">{item.version_current || ''}</span>
        </div>
        <div class="flex items-center gap-2 mt-1">
          <span
            class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase {isCopyleft(
              item.license
            )
              ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}"
          >
            {item.license || 'Tidak diketahui'}
          </span>
          {#if item.npm_url || item.github_url}
            <a
              href={item.npm_url || item.github_url}
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-blue-600 hover:underline"
            >
              Sumber
            </a>
          {/if}
        </div>
      </div>
    {/each}

    {#if data.items.length === 0}
      <p class="text-sm text-zinc-500 italic text-center py-8">Belum ada data.</p>
    {/if}
  </div>
</div>
