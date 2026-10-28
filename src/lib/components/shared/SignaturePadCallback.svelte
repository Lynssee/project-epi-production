<script lang="ts">
	let { onSign }: { onSign: (file: File | null) => void } = $props();

	let canvasEl: HTMLCanvasElement;
	let drawing = false;
	let hasDrawn = $state(false);

	function pointerPos(e: PointerEvent) {
		const rect = canvasEl.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	function start(e: PointerEvent) {
		drawing = true;
		const ctx = canvasEl.getContext('2d')!;
		const { x, y } = pointerPos(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
	}

	function move(e: PointerEvent) {
		if (!drawing) return;
		const ctx = canvasEl.getContext('2d')!;
		const { x, y } = pointerPos(e);
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		ctx.strokeStyle = '#111827';
		ctx.lineTo(x, y);
		ctx.stroke();
		hasDrawn = true;
	}

	function end() {
		if (!drawing) return;
		drawing = false;
		emit();
	}

	function emit() {
		canvasEl.toBlob((blob) => {
			onSign(blob ? new File([blob], 'ttd.png', { type: 'image/png' }) : null);
		}, 'image/png');
	}

	function clear() {
		const ctx = canvasEl.getContext('2d')!;
		ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
		hasDrawn = false;
		onSign(null);
	}
</script>

<div>
	<canvas
		bind:this={canvasEl}
		width="320"
		height="140"
		class="w-full rounded-lg touch-none"
		style="background: #ffffff !important; border: 1px solid var(--sys-sep)"
		onpointerdown={start}
		onpointermove={move}
		onpointerup={end}
		onpointerleave={end}
	></canvas>
	<div class="flex items-center justify-between mt-1">
		<p class="text-[10px]" style="color: var(--sys-label3)">Minta penerima tanda tangan di area ini</p>
		{#if hasDrawn}
			<button type="button" class="text-[10px] font-semibold" style="color: var(--red)" onclick={clear}>Hapus</button>
		{/if}
	</div>
</div>
