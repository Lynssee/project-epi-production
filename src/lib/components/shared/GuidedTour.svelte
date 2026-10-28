<!-- src/lib/components/shared/GuidedTour.svelte -->
<!--
  Overlay guided tour (wizard) ringan tanpa dependency — port dari
  erp-epi-1 (src/lib/components/shared/GuidedTour.svelte) ke Svelte 5 runes
  (project-epi = runes-only, tidak bisa compile export let/on:click Svelte 4).
  Fase 2, implementation_plan_tutorial aplikasi per role.md.

  Props:
    open     : boolean (kontrol tampil)
    steps    : array { target?, title, body, placement?, href? }
    onFinish : callback saat tur ditutup/selesai/dilewati
  Step dengan `target` (CSS selector) -> spotlight elemen + tooltip.
  Step tanpa target -> kartu di tengah layar (intro/outro/penjelasan).
-->
<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { TourStep } from '$lib/data/tours';

  interface Props {
    open?: boolean;
    steps?: TourStep[];
    onFinish?: () => void;
  }
  let { open = false, steps = [], onFinish = () => {} }: Props = $props();

  let current = $state(0);
  let rect = $state<DOMRect | null>(null); // bounding rect target aktif (viewport coords)
  const PAD = 6; // padding spotlight di sekitar elemen
  const CARD_W = 360;

  let step = $derived<TourStep | null>(steps[current] || null);
  let total = $derived(steps.length);
  let dots = $derived(steps.map((_, i) => i));

  // Mulai dari awal setiap kali tur dibuka; bersihkan saat ditutup.
  let prevOpen = false;
  $effect(() => {
    if (open && !prevOpen) {
      current = 0;
      bindListeners();
      measureStep();
    } else if (!open && prevOpen) {
      unbindListeners();
      rect = null;
    }
    prevOpen = open;
  });

  onDestroy(unbindListeners);

  async function measureStep() {
    await tick();
    if (!open || !step) return;
    if (step.target) {
      const el = document.querySelector(step.target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        // beri waktu sedikit untuk scroll sebelum mengukur
        await new Promise((r) => setTimeout(r, 220));
        const el2 = document.querySelector(step.target);
        rect = el2 ? el2.getBoundingClientRect() : null;
        return;
      }
    }
    rect = null; // kartu tengah
  }

  function reposition() {
    if (!open || !step || !step.target) return;
    const el = document.querySelector(step.target);
    rect = el ? el.getBoundingClientRect() : null;
  }

  function bindListeners() {
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
    window.addEventListener('keydown', onKeydown);
  }
  function unbindListeners() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, { capture: true });
    window.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') finish();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  }

  function next() {
    if (current < total - 1) {
      current += 1;
      measureStep();
    } else {
      finish();
    }
  }
  function prev() {
    if (current > 0) {
      current -= 1;
      measureStep();
    }
  }
  function finish() {
    rect = null;
    unbindListeners();
    onFinish();
  }

  // Posisi kartu tooltip (fixed, viewport coords).
  let cardPos = $derived(computeCardPos(rect, step));
  function computeCardPos(r: DOMRect | null, s: TourStep | null) {
    if (typeof window === 'undefined') return { centered: true as const };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!r) {
      return { centered: true as const };
    }
    const placement = s?.placement || 'bottom';
    let top: number, left: number;
    const gap = 14;
    if (placement === 'right') {
      left = r.right + gap;
      top = r.top;
    } else if (placement === 'left') {
      left = r.left - CARD_W - gap;
      top = r.top;
    } else if (placement === 'top') {
      left = r.left;
      top = r.top - gap; // akan di-translate ke atas via CSS
    } else {
      left = r.left;
      top = r.bottom + gap;
    }
    // Clamp ke dalam viewport (mobile-first: card lebar penuh minus margin)
    left = Math.max(12, Math.min(left, vw - Math.min(CARD_W, vw - 24) - 12));
    top = Math.max(12, Math.min(top, vh - 40));
    return { centered: false, top, left, placement };
  }
</script>

{#if open && step}
  <!-- Overlay + spotlight -->
  <div class="fixed inset-0 z-[9998]" transition:fade={{ duration: 150 }}>
    {#if rect}
      <!-- Lubang spotlight memakai trik box-shadow besar -->
      <div
        class="absolute rounded-xl ring-2 ring-indigo-400/80 transition-all duration-200 pointer-events-none"
        style="
          top: {rect.top - PAD}px;
          left: {rect.left - PAD}px;
          width: {rect.width + PAD * 2}px;
          height: {rect.height + PAD * 2}px;
          box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.6);
        "
      ></div>
    {:else}
      <div class="absolute inset-0 bg-slate-900/60"></div>
    {/if}

    <!-- Kartu tooltip -->
    <div
      class="fixed z-[9999] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col"
      style="width: {CARD_W}px; max-width: calc(100vw - 24px); max-height: 80vh;
        {cardPos.centered
          ? 'top: 50%; left: 50%; transform: translate(-50%, -50%);'
          : cardPos.placement === 'top'
            ? `top: ${cardPos.top}px; left: ${cardPos.left}px; transform: translateY(-100%);`
            : `top: ${cardPos.top}px; left: ${cardPos.left}px;`}"
    >
      <!-- Header -->
      <div class="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
        <h3 class="text-base font-extrabold text-slate-900 leading-snug">
          {step.title}
        </h3>
        <button
          onclick={finish}
          class="shrink-0 -mr-1 -mt-1 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="Tutup tur"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body (scrollable) -->
      <div class="px-5 pb-3 overflow-y-auto text-sm text-slate-600 leading-relaxed whitespace-pre-line flex-1">
        {step.body}
      </div>

      <!-- Link ke halaman terkait -->
      {#if step.href}
        <div class="px-5 pb-3">
          <a
            href={step.href}
            class="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] hover:text-indigo-800 hover:underline transition-colors"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Buka halaman
          </a>
        </div>
      {/if}

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
        <div class="flex items-center gap-1.5">
          {#each dots as i (i)}
            <span
              class="h-1.5 rounded-full transition-all {i === current
                ? 'w-5 bg-[var(--color-primary)]'
                : 'w-1.5 bg-slate-300'}"
            ></span>
          {/each}
        </div>
        <div class="flex items-center gap-2">
          <button
            onclick={finish}
            class="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
          >
            Lewati
          </button>
          {#if current > 0}
            <button
              onclick={prev}
              class="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Sebelumnya
            </button>
          {/if}
          <button
            onclick={next}
            class="px-4 py-2 text-xs font-bold text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] rounded-lg shadow-sm transition-colors"
          >
            {current < total - 1 ? `Selanjutnya (${current + 1}/${total})` : 'Selesai'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
