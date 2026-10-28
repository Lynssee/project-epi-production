<script lang="ts">
  interface Props {
    message?: string;
    actionLabel?: string;
    actionHref?: string;
    hints?: string[];
    /** Alternatif actionHref untuk aksi in-page (mis. membuka modal) alih-alih navigasi.
        Bila diisi, tombol dirender sebagai <button>; actionHref diabaikan. */
    onAction?: (() => void) | null;
  }

  let {
    message = 'Data tidak ditemukan',
    actionLabel = '',
    actionHref = '',
    hints = [],
    onAction = null
  }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center py-10 px-4 text-center bg-white dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
  <!-- Empty State Illustration -->
  <div class="w-16 h-16 mb-4 text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  </div>
  
  <h3 class="text-sm md:text-base font-semibold text-slate-800 dark:text-slate-200 mb-2">
    {message}
  </h3>
  
  {#if hints && hints.length > 0}
    <div class="max-w-xs mb-5">
      <ul class="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 text-left inline-block">
        {#each hints as hint}
          <li class="flex items-start gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand-blue-400">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
            </svg>
            <span>{hint}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  
  {#if actionLabel && onAction}
    <button
      type="button"
      onclick={onAction}
      class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-blue-600 hover:bg-brand-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-all focus:ring-2 focus:ring-brand-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 active:scale-95"
    >
      {actionLabel}
    </button>
  {:else if actionLabel && actionHref}
    <a
      href={actionHref}
      class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-blue-600 hover:bg-brand-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-all focus:ring-2 focus:ring-brand-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 active:scale-95"
    >
      {actionLabel}
    </a>
  {/if}
</div>
