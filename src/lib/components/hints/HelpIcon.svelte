<script lang="ts">
  import Tooltip from '../ui/Tooltip.svelte';

  interface Props {
    text?: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
    /** Pecah `text` per baris baru menjadi daftar berpoin di dalam balon. */
    rich?: boolean;
  }

  let { text = '', position = 'top', rich = false }: Props = $props();

  let lines = $derived(text ? text.split('\n').filter((l) => l.trim() !== '') : []);
  let useRich = $derived(rich && lines.length > 0);
</script>

{#snippet icon()}
  <div class="inline-flex items-center justify-center w-4 h-4 md:w-5 md:h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer shrink-0">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 md:w-3.5 md:h-3.5">
      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
    </svg>
  </div>
{/snippet}

{#snippet richContent()}
  <ul class="list-disc pl-3 m-0 space-y-1 text-left">
    {#each lines as line}
      <li>{line}</li>
    {/each}
  </ul>
{/snippet}

{#if useRich}
  <Tooltip {text} {position} children={icon} content={richContent} />
{:else}
  <Tooltip {text} {position} children={icon} />
{/if}
