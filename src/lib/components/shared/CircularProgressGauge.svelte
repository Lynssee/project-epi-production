<!-- src/lib/components/shared/CircularProgressGauge.svelte -->
<!-- Ultra-lightweight progress indicator: No GPU filters, no bounce/ping animations, zero lag -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    percent?: number;
    step?: number;
    totalSteps?: number;
    stepLabel?: string;
    label?: string;
    subLabel?: string;
    sublabel?: string;
    hint?: string;
    timeoutSeconds?: number;
    onRetry?: (() => void) | null;
    onCancel?: (() => void) | null;
    showTimer?: boolean;
    compact?: boolean;
    size?: number;
    strokeWidth?: number;
  }

  let {
    percent = 0,
    step = 1,
    totalSteps = 4,
    stepLabel = 'Memuat data...',
    label,
    subLabel = '',
    sublabel,
    hint = '',
    timeoutSeconds = 25,
    onRetry = null,
    onCancel = null,
    showTimer = true,
    compact = false,
    size,
    strokeWidth
  }: Props = $props();

  const RADIUS = 38;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  // Resolusi alias prop
  const effectiveLabel = $derived(label ?? stepLabel);
  const effectiveSublabel = $derived(sublabel ?? subLabel);
  const effectiveSize = $derived(size ?? (compact ? 80 : 104));
  const effectiveStroke = $derived(strokeWidth ?? (compact ? 5 : 6));

  let elapsedSeconds = $state(0);
  let timerInterval: any = null;
  let tickInterval: any = null;
  let isTimeout = $state(false);
  let internalPercent = $state(18);
  let internalStep = $state(1);
  let internalStepLabel = $state('');

  const isAutoSimulated = $derived(!percent || Number(percent) === 0);
  const activePercent = $derived(isAutoSimulated ? internalPercent : percent);
  const boundedPercent = $derived(Math.max(0, Math.min(100, Math.round(Number(activePercent) || 0))));
  const strokeDashoffset = $derived(CIRCUMFERENCE - (boundedPercent / 100) * CIRCUMFERENCE);
  const activeStep = $derived(isAutoSimulated ? internalStep : step);
  const activeStepLabel = $derived((isAutoSimulated && internalStepLabel) ? internalStepLabel : effectiveLabel);

  onMount(() => {
    elapsedSeconds = 0;
    isTimeout = false;
    internalPercent = 18;
    internalStep = 1;
    internalStepLabel = effectiveLabel || 'Menghubungkan ke Directus API...';

    tickInterval = setInterval(() => {
      if (isAutoSimulated) {
        if (internalPercent < 45) {
          internalPercent += 6;
          internalStep = 2;
          if (!effectiveSublabel && !effectiveLabel) internalStepLabel = 'Memuat skema relasi...';
        } else if (internalPercent < 75) {
          internalPercent += 4;
          internalStep = 3;
          if (!effectiveSublabel && !effectiveLabel) internalStepLabel = 'Mengambil data Directus SSOT...';
        } else if (internalPercent < 92) {
          internalPercent += 1.5;
          internalStep = 4;
          if (!effectiveSublabel && !effectiveLabel) internalStepLabel = 'Menyusun komponen tampilan...';
        }
      }
    }, 280);

    timerInterval = setInterval(() => {
      elapsedSeconds += 1;
      if (elapsedSeconds >= timeoutSeconds && !isTimeout) {
        isTimeout = true;
      }
    }, 1000);
  });

  onDestroy(() => {
    if (tickInterval) clearInterval(tickInterval);
    if (timerInterval) clearInterval(timerInterval);
  });
</script>

<div class="flex flex-col items-center justify-center {compact ? 'py-4 px-2' : 'py-8 px-4'} text-center select-none">
  <!-- Ultra-clean Circular Ring (No filters, no glow, no blur) -->
  <div 
    class="relative flex items-center justify-center"
    style="width: {effectiveSize}px; height: {effectiveSize}px;"
  >
    <svg class="w-full h-full -rotate-90" viewBox="0 0 96 96">
      <!-- Background Circle Track -->
      <circle
        cx="48"
        cy="48"
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        stroke-width={effectiveStroke}
        class="text-slate-100 dark:text-slate-800"
      />

      <!-- Crisp Active Progress Stroke -->
      <circle
        cx="48"
        cy="48"
        r={RADIUS}
        fill="none"
        stroke="#2563eb"
        stroke-width={effectiveStroke}
        stroke-dasharray={CIRCUMFERENCE}
        stroke-dashoffset={strokeDashoffset}
        stroke-linecap="round"
      />
    </svg>

    <!-- Percentage Display in Center (Instant, Crisp) -->
    <div class="absolute inset-0 flex flex-col items-center justify-center leading-none">
      <div class="flex items-baseline justify-center">
        <span class="{compact ? 'text-lg' : 'text-2xl'} font-bold text-slate-800 dark:text-slate-100 font-mono">
          {boundedPercent}
        </span>
        <span class="{compact ? 'text-[11px]' : 'text-xs'} font-semibold text-blue-600 dark:text-blue-400 ml-0.5">%</span>
      </div>
      {#if showTimer}
        <span class="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
          {elapsedSeconds}s
        </span>
      {/if}
    </div>
  </div>

  <!-- Mini Linear Progress Bar -->
  <div class="w-full {compact ? 'max-w-[140px]' : 'max-w-xs'} bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-2.5 overflow-hidden">
    <div
      class="bg-blue-600 h-1.5 rounded-full"
      style="width: {boundedPercent}%"
    ></div>
  </div>

  <!-- Status & Step Details -->
  <div class="mt-2.5 max-w-md flex flex-col items-center">
    {#if totalSteps > 1}
      <div class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 mb-1">
        Tahap {activeStep} dari {totalSteps}
      </div>
    {/if}

    <!-- Main Step Description -->
    <p class="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-0.5">
      {activeStepLabel}
    </p>

    <!-- Sub-label / Collection Details if any -->
    {#if effectiveSublabel}
      <p class="text-[11px] text-slate-400 dark:text-slate-500 font-mono mb-1">
        {effectiveSublabel}
      </p>
    {/if}

    <!-- User Friendly Hint -->
    {#if hint}
      <p class="text-[11px] text-slate-400 dark:text-slate-500 max-w-sm">
        {hint}
      </p>
    {/if}

    <!-- Slow Network Warning & Retry Action -->
    {#if isTimeout}
      <div class="mt-2.5 p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 rounded-lg text-xs text-amber-800 dark:text-amber-200 flex flex-col sm:flex-row items-center gap-2">
        <span>Respon server memakan waktu {elapsedSeconds}s.</span>
        <div class="flex items-center gap-1.5">
          {#if onRetry}
            <button
              type="button"
              onclick={onRetry}
              class="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-medium"
            >
              Coba Ulang
            </button>
          {/if}
          {#if onCancel}
            <button
              type="button"
              onclick={onCancel}
              class="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[11px] font-medium"
            >
              Tutup
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
