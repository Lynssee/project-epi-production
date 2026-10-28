<script lang="ts">
  import { hintStore } from '../../stores/hintStore';
  import { slide } from 'svelte/transition';

  interface Props {
    id: string;
    title?: string;
    steps?: string[];
    dismissable?: boolean;
    defaultOpen?: boolean;
  }

  let { id, title = 'Panduan', steps = [], dismissable = true, defaultOpen = false }: Props = $props();

  let isOpen = $derived(hintStore.isHintOpen(id, defaultOpen) || $hintStore[id] || false);

  function dismiss() {
    if (dismissable) {
      hintStore.closeHint(id);
    }
  }

  function reopen() {
    if (dismissable) {
      hintStore.openHint(id);
    }
  }
</script>

{#if isOpen}
  <div transition:slide={{ duration: 300 }} class="mb-4 bg-brand-blue-50 dark:bg-brand-blue-900/20 border-l-4 border-brand-blue-500 rounded-r-lg shadow-sm overflow-hidden">
    <div class="p-4 relative">
      {#if dismissable}
        <button 
          onclick={dismiss}
          class="absolute top-2 right-2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none"
          aria-label="Tutup panduan"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}
      
      <h4 class="font-semibold text-slate-800 dark:text-slate-200 text-sm mb-2 pr-6 flex items-center gap-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-brand-blue-500">
          <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-1.5 0a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" clip-rule="evenodd" />
        </svg>
        {title}
      </h4>
      
      <ol class="list-decimal pl-5 space-y-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
        {#each steps as step}
          <li class="pl-1">{step}</li>
        {/each}
      </ol>
    </div>
  </div>
{:else if dismissable}
  <div transition:slide={{ duration: 300 }} class="mb-4">
    <button 
      onclick={reopen}
      class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-blue-600 dark:text-brand-blue-400 bg-brand-blue-50 hover:bg-brand-blue-100 dark:bg-brand-blue-900/30 dark:hover:bg-brand-blue-900/50 rounded-full transition-colors border border-brand-blue-200 dark:border-brand-blue-800/50 focus:outline-none"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
      Panduan
    </button>
  </div>
{/if}

