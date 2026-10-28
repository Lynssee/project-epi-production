<script lang="ts">
	// Fase 5 (rencana "Package & Fitur Addons" §3/§5) — anotasi foto (panah/lingkaran/
	// teks) sebelum kirim laporan. Canvas murni, nol package baru. Nilai tinggi untuk
	// laporan kerusakan/temuan (punch list, komplain, maintenance) — menandai lokasi
	// kerusakan langsung di foto jauh lebih jelas daripada deskripsi teks saja.
	//
	// Semua koordinat shape disimpan dalam SATUAN PIKSEL GAMBAR ASLI (bukan piksel CSS
	// tampilan), supaya export tetap full-resolusi walau canvas ditampilkan lebih kecil
	// di layar HP. `scale()` mengonversi event pointer (CSS px) balik ke piksel gambar.

	import IconArrowUpRight from '@tabler/icons-svelte/icons/arrow-up-right';
	import IconCircle from '@tabler/icons-svelte/icons/circle';
	import IconLetterT from '@tabler/icons-svelte/icons/letter-t';
	import IconArrowBackUp from '@tabler/icons-svelte/icons/arrow-back-up';
	import IconTrash from '@tabler/icons-svelte/icons/trash';
	import IconX from '@tabler/icons-svelte/icons/x';
	import IconCheck from '@tabler/icons-svelte/icons/check';

	type Tool = 'arrow' | 'circle' | 'text';

	type Shape =
		| { tool: 'arrow'; x1: number; y1: number; x2: number; y2: number }
		| { tool: 'circle'; x1: number; y1: number; x2: number; y2: number }
		| { tool: 'text'; x: number; y: number; text: string };

	let { file, onSave, onCancel }: { file: File; onSave: (annotated: File) => void; onCancel: () => void } = $props();

	const STROKE_COLOR = '#EF4444'; // merah — kontras di foto lapangan mana pun
	const STROKE_WIDTH = 6;
	const FONT_SIZE = 40;

	let canvasEl: HTMLCanvasElement | null = $state(null);
	let img = $state<HTMLImageElement | null>(null);
	let shapes = $state<Shape[]>([]);
	let activeTool = $state<Tool>('arrow');
	let dragStart: { x: number; y: number } | null = null;
	let dragCurrent: { x: number; y: number } | null = null;
	let pendingTextPoint: { x: number; y: number } | null = $state(null);
	let textInputValue = $state('');
	let saving = $state(false);

	$effect(() => {
		const url = URL.createObjectURL(file);
		const el = new Image();
		el.onload = () => {
			img = el;
			redraw();
		};
		el.src = url;
		return () => URL.revokeObjectURL(url);
	});

	function redraw() {
		const canvas = canvasEl;
		if (!canvas || !img) return;
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.drawImage(img, 0, 0);
		ctx.strokeStyle = STROKE_COLOR;
		ctx.fillStyle = STROKE_COLOR;
		ctx.lineWidth = STROKE_WIDTH;
		ctx.lineCap = 'round';
		for (const shape of shapes) drawShape(ctx, shape);
		if (dragStart && dragCurrent) {
			drawShape(ctx, previewShape(dragStart, dragCurrent));
		}
	}

	function previewShape(start: { x: number; y: number }, current: { x: number; y: number }): Shape {
		return activeTool === 'circle'
			? { tool: 'circle', x1: start.x, y1: start.y, x2: current.x, y2: current.y }
			: { tool: 'arrow', x1: start.x, y1: start.y, x2: current.x, y2: current.y };
	}

	function drawShape(ctx: CanvasRenderingContext2D, shape: Shape) {
		if (shape.tool === 'arrow') {
			const { x1, y1, x2, y2 } = shape;
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
			const angle = Math.atan2(y2 - y1, x2 - x1);
			const headLen = STROKE_WIDTH * 4;
			ctx.beginPath();
			ctx.moveTo(x2, y2);
			ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
			ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
			ctx.closePath();
			ctx.fill();
		} else if (shape.tool === 'circle') {
			const { x1, y1, x2, y2 } = shape;
			const cx = (x1 + x2) / 2;
			const cy = (y1 + y2) / 2;
			const rx = Math.abs(x2 - x1) / 2;
			const ry = Math.abs(y2 - y1) / 2;
			ctx.beginPath();
			ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
			ctx.stroke();
		} else if (shape.tool === 'text') {
			ctx.font = `bold ${FONT_SIZE}px sans-serif`;
			ctx.textBaseline = 'top';
			// Outline putih tipis supaya teks merah tetap terbaca di foto gelap.
			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = 3;
			ctx.strokeText(shape.text, shape.x, shape.y);
			ctx.fillStyle = STROKE_COLOR;
			ctx.fillText(shape.text, shape.x, shape.y);
			ctx.strokeStyle = STROKE_COLOR;
			ctx.lineWidth = STROKE_WIDTH;
		}
	}

	/** Konversi koordinat pointer (piksel CSS tampilan) ke piksel gambar asli. */
	function toImageCoords(e: PointerEvent): { x: number; y: number } {
		const canvas = canvasEl!;
		const rect = canvas.getBoundingClientRect();
		const scaleX = canvas.width / rect.width;
		const scaleY = canvas.height / rect.height;
		return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
	}

	function handlePointerDown(e: PointerEvent) {
		if (activeTool === 'text') {
			pendingTextPoint = toImageCoords(e);
			textInputValue = '';
			return;
		}
		dragStart = toImageCoords(e);
		dragCurrent = dragStart;
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragStart) return;
		dragCurrent = toImageCoords(e);
		redraw();
	}

	function handlePointerUp() {
		if (dragStart && dragCurrent) {
			const dx = dragCurrent.x - dragStart.x;
			const dy = dragCurrent.y - dragStart.y;
			// Klik tanpa drag berarti (hampir) tak ada gerakan — jangan simpan shape kosong.
			if (Math.hypot(dx, dy) > 4) {
				shapes = [...shapes, previewShape(dragStart, dragCurrent)];
			}
		}
		dragStart = null;
		dragCurrent = null;
		redraw();
	}

	function confirmText() {
		if (pendingTextPoint && textInputValue.trim()) {
			shapes = [...shapes, { tool: 'text', x: pendingTextPoint.x, y: pendingTextPoint.y, text: textInputValue.trim() }];
		}
		pendingTextPoint = null;
		textInputValue = '';
		redraw();
	}

	function undo() {
		shapes = shapes.slice(0, -1);
		redraw();
	}

	function clearAll() {
		shapes = [];
		redraw();
	}

	async function handleSave() {
		if (!canvasEl) return;
		saving = true;
		const blob: Blob | null = await new Promise((resolve) => canvasEl!.toBlob(resolve, 'image/jpeg', 0.9));
		saving = false;
		if (!blob) return;
		onSave(new File([blob], file.name, { type: 'image/jpeg' }));
	}
</script>

<div class="fixed inset-0 z-[200] flex flex-col bg-black">
	<div class="flex items-center justify-between px-4 py-3 text-white">
		<button type="button" class="flex items-center gap-1.5 text-[13px] font-medium" onclick={onCancel}>
			<IconX size={16} /> Batal
		</button>
		<span class="text-[12px] font-semibold opacity-80">Anotasi Foto</span>
		<button
			type="button"
			class="flex items-center gap-1.5 text-[13px] font-bold disabled:opacity-40"
			disabled={saving}
			onclick={handleSave}
		>
			<IconCheck size={16} /> Simpan
		</button>
	</div>

	<div class="relative flex-1 overflow-hidden flex items-center justify-center touch-none">
		<canvas
			bind:this={canvasEl}
			class="max-h-full max-w-full touch-none"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
		></canvas>

		{#if pendingTextPoint}
			<!-- svelte-ignore a11y-click-events-have-key-events -->
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<div class="absolute inset-0 flex items-center justify-center bg-black/60 px-6" onclick={() => (pendingTextPoint = null)}>
				<div class="w-full max-w-sm rounded-xl bg-white p-4" onclick={(e) => e.stopPropagation()}>
					<p class="mb-2 text-[12px] font-semibold text-gray-700">Teks anotasi</p>
					<input
						type="text"
						autofocus
						class="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px]"
						placeholder="Contoh: Retak di sini"
						bind:value={textInputValue}
						onkeydown={(e) => e.key === 'Enter' && confirmText()}
					/>
					<div class="mt-3 flex justify-end gap-2">
						<button type="button" class="px-3 py-1.5 text-[12px] font-semibold text-gray-500" onclick={() => (pendingTextPoint = null)}>
							Batal
						</button>
						<button type="button" class="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-bold text-white" onclick={confirmText}>
							Tambah
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<div class="flex items-center justify-center gap-2 px-4 py-3">
		<button
			type="button"
			class="flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 text-white {activeTool === 'arrow' ? 'bg-white/20' : ''}"
			onclick={() => (activeTool = 'arrow')}
		>
			<IconArrowUpRight size={20} />
			<span class="text-[9px] font-semibold">Panah</span>
		</button>
		<button
			type="button"
			class="flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 text-white {activeTool === 'circle' ? 'bg-white/20' : ''}"
			onclick={() => (activeTool = 'circle')}
		>
			<IconCircle size={20} />
			<span class="text-[9px] font-semibold">Lingkaran</span>
		</button>
		<button
			type="button"
			class="flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 text-white {activeTool === 'text' ? 'bg-white/20' : ''}"
			onclick={() => (activeTool = 'text')}
		>
			<IconLetterT size={20} />
			<span class="text-[9px] font-semibold">Teks</span>
		</button>
		<div class="mx-2 h-8 w-px bg-white/20"></div>
		<button type="button" class="flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 text-white disabled:opacity-30" disabled={shapes.length === 0} onclick={undo}>
			<IconArrowBackUp size={20} />
			<span class="text-[9px] font-semibold">Undo</span>
		</button>
		<button type="button" class="flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 text-white disabled:opacity-30" disabled={shapes.length === 0} onclick={clearAll}>
			<IconTrash size={20} />
			<span class="text-[9px] font-semibold">Hapus</span>
		</button>
	</div>
</div>
