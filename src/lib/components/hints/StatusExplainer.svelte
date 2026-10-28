<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    status?: string;
    explain?: string;
    flow?: string[];
    /** Posisi aktif di `flow`; -1 = tebak dari `status`. */
    currentIndex?: number;
    /** Badge/elemen yang dibungkus dan memicu popover. */
    children?: Snippet;
  }

  let {
    status = '',
    explain = '',
    flow = [],
    currentIndex = -1,
    children
  }: Props = $props();

  let show = $state(false);
  let wrapperRef: HTMLDivElement | undefined = $state();

  /** Perangkat sentuh mensintesis mouseenter saat di-tap; tanpa penjaga ini popover
      terbuka oleh mouseenter lalu langsung ditutup lagi oleh toggle, sehingga tap
      tidak menghasilkan apa-apa. Selaras dgn versi admin (erp-epi-1). */
  const canHover = () =>
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

  function toggle() {
    show = !show;
  }
  
  function handleOutsideClick(e: MouseEvent | TouchEvent) {
    if (show && wrapperRef && !wrapperRef.contains(e.target as Node)) {
      show = false;
    }
  }

  onMount(() => {
    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick, { passive: true });
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    }
  });

  // Calculate currentIndex automatically if not provided but flow and status exist
  let activeIndex = $derived(
    currentIndex !== -1
      ? currentIndex
      : flow.findIndex((f) => f.toLowerCase() === status.toLowerCase())
  );
</script>

<div
  class="relative inline-flex items-center"
  bind:this={wrapperRef}
  onmouseenter={() => { if (canHover()) show = true; }}
  onmouseleave={() => { if (canHover()) show = false; }}
  onclick={(e) => { e.stopPropagation(); toggle(); }}
  onkeydown={(e) => { if (e.key === 'Enter') toggle(); }}
  role="button"
  tabindex="0"
>
  {@render children?.()}

  {#if show}
    <div 
      class="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 p-3 bg-slate-800 dark:bg-slate-700 text-white rounded-lg shadow-xl pointer-events-none transition-opacity duration-200"
    >
      <div class="text-xs font-medium mb-1.5 text-slate-200">
        Status: <span class="text-white font-semibold">{status}</span>
      </div>
      <p class="text-[11px] leading-relaxed text-slate-300 mb-3">
        {explain}
      </p>

      {#if flow && flow.length > 0}
        <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-600">
          {#each flow as step, i}
            <div class="flex flex-col items-center flex-1 relative">
              <!-- Line connector -->
              {#if i < flow.length - 1}
                <div 
                  class="absolute top-[5px] left-[50%] w-full h-[2px] z-0"
                  class:bg-emerald-500={activeIndex > i}
                  class:bg-slate-600={activeIndex <= i}
                ></div>
              {/if}
              
              <!-- Dot -->
              <div 
                class="w-2.5 h-2.5 rounded-full z-10 mb-1"
                class:bg-emerald-500={activeIndex > i}
                class:bg-brand-blue-400={activeIndex === i}
                class:ring-2={activeIndex === i}
                class:ring-brand-blue-200={activeIndex === i}
                class:bg-slate-500={activeIndex < i}
              ></div>
              
              <!-- Label -->
              <span 
                class="text-[9px] text-center w-full truncate"
                class:text-emerald-400={activeIndex > i}
                class:text-brand-blue-300={activeIndex === i}
                class:font-bold={activeIndex === i}
                class:text-slate-400={activeIndex < i}
              >
                {step}
              </span>
            </div>
          {/each}
        </div>
      {/if}
      
      <!-- Arrow -->
      <div class="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800 dark:bg-slate-700 rotate-45"></div>
    </div>
  {/if}
</div>
