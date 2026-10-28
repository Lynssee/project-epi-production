<script lang="ts" module>
  // Listener "tap di luar menutup" dipakai BERSAMA oleh semua instance (sebelumnya 2 listener dokumen per instance —
  // berat di halaman dengan ratusan badge, mis. timeline subtask).
  type Closer = (target: Node) => void;
  const closers = new Set<Closer>();
  let bound = false;

  function onDocPointer(e: Event) {
    const t = e.target as Node;
    for (const c of closers) c(t);
  }
  function register(c: Closer) {
    closers.add(c);
    if (!bound && typeof document !== 'undefined') {
      document.addEventListener('click', onDocPointer);
      document.addEventListener('touchstart', onDocPointer, { passive: true });
      bound = true;
    }
  }
  function unregister(c: Closer) {
    closers.delete(c);
    if (bound && closers.size === 0 && typeof document !== 'undefined') {
      document.removeEventListener('click', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
      bound = false;
    }
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    text?: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
    children?: Snippet;
    /** Isi kaya (mis. daftar berpoin) yang menggantikan `text` di dalam balon. */
    content?: Snippet;
    /** Kelas tambahan untuk pembungkus (mis. `absolute top-0 bottom-0` untuk batang timeline). Bila memuat absolute/fixed/sticky, `relative` dihilangkan. */
    class?: string;
    /** Style inline pembungkus (mis. `left:10%;width:30%`). */
    style?: string;
  }

  let { text = '', position = 'top', children, content, class: wrapperClass = '', style = '' }: Props = $props();

  let show = $state(false);
  let wrapperRef: HTMLSpanElement | undefined = $state();

  /** Perangkat sentuh mensintesis mouseenter saat di-tap; tanpa penjaga ini tooltip
      terbuka oleh mouseenter lalu langsung ditutup lagi oleh toggle, sehingga tap
      tidak menghasilkan apa-apa. Selaras dgn pola matchMedia di komponen hints/. */
  const canHover = () =>
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

  function toggle() {
    show = !show;
  }

  const closeIfOutside: Closer = (target) => {
    if (show && wrapperRef && !wrapperRef.contains(target)) {
      show = false;
    }
  };

  onMount(() => register(closeIfOutside));
  onDestroy(() => unregister(closeIfOutside));

  const positioned = $derived(/\b(absolute|fixed|sticky)\b/.test(wrapperClass));

  // Kelas posisi disusun sebagai string, bukan direktif `class:top-1/2={...}`:
  // parser Svelte 5 menolak nama kelas ber-"/" di dalam direktif class:.
  const balloonPos: Record<NonNullable<Props['position']>, string> = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2'
  };
  const arrowPos: Record<NonNullable<Props['position']>, string> = {
    top: 'bottom-[-4px] left-1/2 -translate-x-1/2',
    bottom: 'top-[-4px] left-1/2 -translate-x-1/2',
    left: 'right-[-4px] top-1/2 -translate-y-1/2',
    right: 'left-[-4px] top-1/2 -translate-y-1/2'
  };
</script>

<!-- Akar <span> (bukan <div>): valid di dalam <p>/<h4>/<span>; tampilan tetap inline-flex. -->
<span
  class="{positioned ? '' : 'relative'} inline-flex items-center justify-center {wrapperClass}"
  {style}
  bind:this={wrapperRef}
  onmouseenter={() => { if (canHover()) show = true; }}
  onmouseleave={() => { if (canHover()) show = false; }}
  onclick={(e) => { e.stopPropagation(); toggle(); }}
  onkeydown={(e) => { if (e.key === 'Enter') toggle(); }}
  role="button"
  tabindex="0"
>
  {@render children?.()}

  {#if show && (text || content)}
    <span
      class="absolute block z-50 px-3 py-1.5 text-xs font-medium text-white bg-slate-800 dark:bg-slate-700 rounded-md shadow-lg pointer-events-none min-w-[max-content] max-w-[200px] whitespace-normal text-left leading-tight transition-opacity duration-200 {balloonPos[position]}"
    >
      {#if content}
        {@render content()}
      {:else}
        {text}
      {/if}
      <!-- Arrow -->
      <span class="absolute block w-2 h-2 bg-slate-800 dark:bg-slate-700 rotate-45 {arrowPos[position]}"></span>
    </span>
  {/if}
</span>
