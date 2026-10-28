<!-- Reusable canvas signature pad. Tanda tangan layar (pointer/touch). -->
<script>
  import { onMount } from 'svelte';

  let { height = 180 } = $props();
  let canvas;
  let ctx;
  let drawing = false;
  let dirty = false;

  onMount(() => {
    resize();
    ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  });

  function resize() {
    if (!canvas) return;
    // Pertahankan resolusi tajam (devicePixelRatio) tanpa menghapus gambar bila kosong.
    const ratio = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    canvas.width = w * ratio;
    canvas.height = height * ratio;
    const c = canvas.getContext('2d');
    c.scale(ratio, ratio);
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#111827';
    ctx = c;
  }

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty = true;
  }
  function end() {
    drawing = false;
  }

  export function clear() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty = false;
  }

  export function isEmpty() {
    return !dirty;
  }

  /** Kembalikan PNG dataURL dengan latar putih (agar TTD terbaca saat dicetak). */
  export function toDataURL() {
    if (isEmpty()) return null;
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const c = out.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(canvas, 0, 0);
    return out.toDataURL('image/png');
  }
</script>

<div class="space-y-2">
  <div class="relative border-2 border-dashed border-gray-300 rounded-lg bg-white overflow-hidden">
    <canvas
      bind:this={canvas}
      style="width:100%; height:{height}px; touch-action:none; cursor:crosshair; display:block;"
      on:mousedown={start} on:mousemove={move} on:mouseup={end} on:mouseleave={end}
      on:touchstart={start} on:touchmove={move} on:touchend={end}
    ></canvas>
    {#if isEmpty()}
      <span class="pointer-events-none absolute inset-0 flex items-center justify-center text-gray-300 text-sm select-none">
        Tanda tangan di sini
      </span>
    {/if}
  </div>
  <button
    type="button"
    on:click={clear}
    class="text-xs text-gray-500 hover:text-red-600 underline"
  >
    Hapus & ulangi
  </button>
</div>
