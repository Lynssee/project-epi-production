<script lang="ts">
  import Tooltip from '../ui/Tooltip.svelte';

  interface Props {
    text?: string;
  }

  let { text = '' }: Props = $props();
</script>

{#snippet icon()}
  <div class="inline-flex items-center justify-center w-3.5 h-3.5 ml-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-help">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" />
    </svg>
  </div>
{/snippet}

<Tooltip {text} position="top" children={icon} />
