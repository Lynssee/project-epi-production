<script lang="ts">
  interface Props {
    text?: string;
    type?: 'info' | 'warning' | 'success';
    collapsible?: boolean;
  }

  let { text = '', type = 'info', collapsible = false }: Props = $props();

  let expanded = $state(false);

  // Ambang 80 karakter: perkiraan kasar kapan hint mulai memakan lebih dari dua baris
  // di layar HP. Bukan line-clamp CSS supaya tombol "Selengkapnya" bisa dikontrol.
  let shouldCollapse = $derived(collapsible && text.length > 80);
  let displayText = $derived(shouldCollapse && !expanded ? text.slice(0, 80) + '...' : text);

  function toggle() {
    expanded = !expanded;
  }
</script>

{#if text}
  <div class="flex items-start gap-1.5 mt-1.5 text-[11px] sm:text-xs leading-relaxed transition-colors duration-200 {type === 'warning' ? 'text-amber-600 dark:text-amber-400' : type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}"
  >
    <div class="mt-[2px] shrink-0">
      {#if type === 'info'}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
          <path fill-rule="evenodd" d="M19 10a9 9 0 11-18 0 9 9 0 0118 0zm-8-3a1 1 0 100-2 1 1 0 000 2zm1 10.5a1 1 0 01-2 0v-5a1 1 0 112 0v5z" clip-rule="evenodd" />
        </svg>
      {:else if type === 'warning'}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
          <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
        </svg>
      {:else if type === 'success'}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
        </svg>
      {/if}
    </div>
    
    <div class="flex-1">
      {displayText}
      {#if shouldCollapse}
        <button 
          type="button" 
          class="inline-block ml-1 font-semibold underline decoration-dotted underline-offset-2 hover:text-slate-700 dark:hover:text-slate-300 focus:outline-none"
          onclick={toggle}
        >
          {expanded ? 'Tutup' : 'Selengkapnya'}
        </button>
      {/if}
    </div>
  </div>
{/if}
