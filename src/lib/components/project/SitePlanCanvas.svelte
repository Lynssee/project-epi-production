<!-- src/lib/components/project/SitePlanCanvas.svelte -->
<!-- Kanvas Interaktif Khusus Site Plan di Dashboard Lapangan (Svelte 5 Runes):
     - Touch & Mouse pan/zoom leluasa di smartphone/tablet & desktop
     - Pinning multi-kategori (Zona Kerja, QC, HSE, Alat, Staging, Akses)
     - Drag & Drop reposisi titik
     - Popover inspeksi & aksi cepat ubah status di lokasi proyek -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { secureAssetSrc } from '$lib/actions/secureAsset';

	// Pola toast global repo ini: Toast.svelte lewat window.__showToast (bukan svelte-sonner)
	const toast = {
		success: (m: string) => (window as any).__showToast?.(m, 'success'),
		error: (m: string) => (window as any).__showToast?.(m, 'error'),
		info: (m: string) => (window as any).__showToast?.(m, 'info')
	};
	import {
		SITE_PLAN_PIN_TYPES,
		SITE_PLAN_STATUS_OPTIONS,
		type SitePlanPin,
		type SitePlanDenah,
		updatePinCoordinates
	} from '$lib/services/sitePlanApi';

	interface Props {
		denah?: SitePlanDenah | null;
		pins?: SitePlanPin[];
		canEdit?: boolean;
		editMode?: boolean;
		onaddpin?: (coords: { x_pct: number; y_pct: number; denah_id?: number }) => void;
		onselectpin?: (pin: SitePlanPin) => void;
		oneditpin?: (pin: SitePlanPin) => void;
		ondeletepin?: (pin: SitePlanPin) => void;
		onchangestatus?: (data: { pin: SitePlanPin; status: string }) => void;
		onuploadrequest?: () => void;
	}

	let {
		denah = null,
		pins = [],
		canEdit = false,
		editMode = $bindable(false),
		onaddpin,
		onselectpin,
		oneditpin,
		ondeletepin,
		onchangestatus,
		onuploadrequest
	}: Props = $props();

	// Viewport State
	let canvasContainer = $state<HTMLDivElement | null>(null);
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isPanning = $state(false);
	let startPanX = $state(0);
	let startPanY = $state(0);
	let isFullscreen = $state(false);
	let showGrid = $state(false);
	let showLabels = $state(true);

	// Search & Filter State
	let searchQuery = $state('');
	let selectedCategoryFilter = $state('all');
	let selectedStatusFilter = $state('all');
	let selectedPin = $state<SitePlanPin | null>(null);
	let hoveredCoords = $state<{ x: number; y: number } | null>(null);

	// Dragging Pin
	let draggingPin = $state<SitePlanPin | null>(null);
	let dragMoved = $state(false);

	// Filtered Pins
	let filteredPins = $derived(
		pins.filter((p) => {
			if (selectedCategoryFilter !== 'all' && p.tipe !== selectedCategoryFilter) return false;
			if (selectedStatusFilter !== 'all' && p.status !== selectedStatusFilter) return false;
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				const matchLabel = (p.label || '').toLowerCase().includes(q);
				const matchCatatan = (p.catatan || '').toLowerCase().includes(q);
				if (!matchLabel && !matchCatatan) return false;
			}
			return true;
		})
	);

	// Metrics
	let stats = $derived({
		total: pins.length,
		done: pins.filter((p) => p.status === 'done').length,
		progress: pins.filter((p) => p.status === 'progress').length,
		issue: pins.filter((p) => p.status === 'issue').length,
		planned: pins.filter((p) => p.status === 'planned').length,
		pctDone: pins.length ? Math.round((pins.filter((p) => p.status === 'done').length / pins.length) * 100) : 0
	});

	// Touch & Mouse Handlers
	function handleMouseDown(e: MouseEvent) {
		if (e.button === 0 && !draggingPin) {
			isPanning = true;
			startPanX = e.clientX - panX;
			startPanY = e.clientY - panY;
		}
	}

	function handleMouseMove(e: MouseEvent) {
		if (isPanning) {
			panX = e.clientX - startPanX;
			panY = e.clientY - startPanY;
			return;
		}

		if (draggingPin && editMode && canEdit) {
			dragMoved = true;
			const imgEl = canvasContainer?.querySelector('.site-plan-image') as HTMLImageElement | null;
			if (!imgEl) return;
			const rect = imgEl.getBoundingClientRect();
			const x_pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
			const y_pct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
			draggingPin.x_pct = Math.round(x_pct * 100) / 100;
			draggingPin.y_pct = Math.round(y_pct * 100) / 100;
		}
	}

	function handleMouseUp() {
		if (isPanning) isPanning = false;

		if (draggingPin) {
			const pinId = draggingPin.id;
			if (dragMoved && pinId) {
				const p = draggingPin;
				updatePinCoordinates(pinId, p.x_pct, p.y_pct)
					.then(() => {
						toast.success(`Posisi "${p.label}" diperbarui`);
					})
					.catch((err) => {
						toast.error('Gagal memperbarui posisi: ' + err.message);
					});
			}
			draggingPin = null;
			dragMoved = false;
		}
	}

	// Touch Support for Mobile
	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length === 1 && !draggingPin) {
			const touch = e.touches[0];
			isPanning = true;
			startPanX = touch.clientX - panX;
			startPanY = touch.clientY - panY;
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (isPanning && e.touches.length === 1) {
			const touch = e.touches[0];
			panX = touch.clientX - startPanX;
			panY = touch.clientY - startPanY;
		}
	}

	function handleTouchEnd() {
		isPanning = false;
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const zoomFactor = 1.15;
		const oldZoom = zoom;
		let newZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
		newZoom = Math.min(5, Math.max(0.25, newZoom));

		if (canvasContainer) {
			const rect = canvasContainer.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;
			panX = mouseX - (mouseX - panX) * (newZoom / oldZoom);
			panY = mouseY - (mouseY - panY) * (newZoom / oldZoom);
		}
		zoom = newZoom;
	}

	function zoomIn() {
		zoom = Math.min(5, Math.round((zoom + 0.25) * 100) / 100);
	}

	function zoomOut() {
		zoom = Math.max(0.25, Math.round((zoom - 0.25) * 100) / 100);
	}

	function resetView() {
		zoom = 1;
		panX = 0;
		panY = 0;
		selectedPin = null;
	}

	function toggleFullscreen() {
		if (!canvasContainer) return;
		if (!document.fullscreenElement) {
			canvasContainer.requestFullscreen().catch(() => {});
			isFullscreen = true;
		} else {
			document.exitFullscreen().catch(() => {});
			isFullscreen = false;
		}
	}

	function handleImageClick(e: MouseEvent) {
		if (dragMoved) return;
		if (!canEdit || !editMode) {
			selectedPin = null;
			return;
		}

		const imgEl = e.currentTarget as HTMLImageElement;
		const rect = imgEl.getBoundingClientRect();
		const x_pct = Math.round((((e.clientX - rect.left) / rect.width) * 100) * 100) / 100;
		const y_pct = Math.round((((e.clientY - rect.top) / rect.height) * 100) * 100) / 100;

		onaddpin?.({ x_pct, y_pct, denah_id: denah?.id });
	}

	function handlePinClick(pin: SitePlanPin, e: MouseEvent) {
		e.stopPropagation();
		if (dragMoved) return;
		selectedPin = pin;
		onselectpin?.(pin);
	}

	function startDragPin(pin: SitePlanPin, e: MouseEvent) {
		if (!editMode || !canEdit) return;
		e.stopPropagation();
		draggingPin = pin;
		dragMoved = false;
	}

	function handleQuickStatusChange(pin: SitePlanPin, newStatus: string) {
		pin.status = newStatus;
		onchangestatus?.({ pin, status: newStatus });
	}
</script>

<div class="site-plan-canvas-root flex flex-col gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 md:p-4 shadow-sm">
	<!-- Top Toolbar -->
	<div class="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-slate-100 dark:border-slate-800">
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex items-center gap-2">
				<span class="text-xl">🗺️</span>
				<div>
					<h2 class="text-sm md:text-base font-bold text-slate-900 dark:text-white leading-tight">
						{denah?.nama || 'Site Plan Proyek'}
					</h2>
					<p class="text-xs text-slate-500 dark:text-slate-400">
						{stats.total} Titik terplot • {stats.pctDone}% Selesai
					</p>
				</div>
			</div>

			<div class="hidden sm:flex items-center gap-1.5 ml-2 pl-3 border-l border-slate-200 dark:border-slate-700 text-xs">
				<span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-medium border border-emerald-200">
					✓ {stats.done} Selesai
				</span>
				<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 font-medium border border-amber-200">
					⏳ {stats.progress} Progress
				</span>
				{#if stats.issue > 0}
					<span class="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-medium border border-rose-200 animate-pulse">
						⚠️ {stats.issue} Isu
					</span>
				{/if}
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<!-- Search -->
			<div class="relative">
				<input
					type="text"
					placeholder="Cari titik..."
					bind:value={searchQuery}
					class="w-32 sm:w-44 pl-7 pr-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
				/>
				<span class="absolute left-2 top-1.5 text-xs text-slate-400">🔍</span>
			</div>

			<!-- Category Filter -->
			<select
				bind:value={selectedCategoryFilter}
				class="text-xs py-1 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
			>
				<option value="all">Semua Kategori</option>
				{#each Object.entries(SITE_PLAN_PIN_TYPES) as [k, t]}
					<option value={k}>{t.icon} {t.label}</option>
				{/each}
			</select>

			<!-- Edit Mode -->
			{#if canEdit}
				<button
					type="button"
					onclick={() => (editMode = !editMode)}
					class="px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 {editMode
						? 'bg-amber-500 text-white shadow-xs'
						: 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'}"
				>
					<span>{editMode ? '✏️ Mode Edit' : '✍️ Edit'}</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- Canvas Viewport -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={canvasContainer}
		class="relative w-full h-[580px] md:h-[650px] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-900 select-none {isPanning ? 'cursor-grabbing' : editMode ? 'cursor-crosshair' : 'cursor-grab'}"
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}
		onwheel={handleWheel}
		role="region"
		aria-label="Kanvas Interaktif Site Plan"
	>
		<!-- Floating Controls -->
		<div class="absolute top-3 right-3 z-30 flex flex-col items-center gap-1 bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-xl p-1 shadow-xl text-white">
			<button type="button" onclick={zoomIn} class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 font-bold text-sm" title="Zoom In">➕</button>
			<span class="text-[10px] font-mono text-slate-300 select-none">{Math.round(zoom * 100)}%</span>
			<button type="button" onclick={zoomOut} class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 font-bold text-sm" title="Zoom Out">➖</button>
			<div class="w-full h-px bg-slate-700 my-0.5"></div>
			<button type="button" onclick={resetView} class="px-1.5 py-0.5 text-[9px] font-semibold hover:bg-slate-800 rounded text-slate-300" title="Reset">Reset</button>
			<button type="button" onclick={() => (showLabels = !showLabels)} class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 text-xs {showLabels ? 'text-blue-400' : 'text-slate-500'}" title="Labels">🏷️</button>
			<button type="button" onclick={toggleFullscreen} class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 text-xs text-slate-300" title="Fullscreen">⛶</button>
		</div>

		<!-- North Indicator -->
		<div class="absolute top-3 left-3 z-30 pointer-events-none flex items-center gap-1 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-200">
			<span class="text-rose-400">🧭</span>
			<span>UTARA</span>
		</div>

		<!-- Canvas Surface with Transform -->
		<div
			class="w-full h-full flex items-center justify-center transition-transform duration-75 ease-out"
			style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: center center;"
		>
			{#if denah?.gambar}
				<div class="relative inline-block max-w-none shadow-2xl rounded-lg">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<img
						use:secureAssetSrc={denah.gambar}
						alt={denah.nama}
						class="site-plan-image block max-w-none max-h-[85vh] object-contain select-none pointer-events-auto"
						onclick={handleImageClick}
						draggable="false"
					/>

					<!-- Pin Markers -->
					{#each filteredPins as pin (pin.id ?? `${pin.x_pct}-${pin.y_pct}`)}
						{@const typeMeta = SITE_PLAN_PIN_TYPES[pin.tipe] || SITE_PLAN_PIN_TYPES.zona_kerja}
						{@const statusMeta = SITE_PLAN_STATUS_OPTIONS[pin.status || 'planned'] || SITE_PLAN_STATUS_OPTIONS.planned}
						{@const isSelected = selectedPin?.id === pin.id}

						<div
							class="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer z-20 {isSelected ? 'z-30' : ''}"
							style="left: {pin.x_pct}%; top: {pin.y_pct}%;"
							onclick={(e) => handlePinClick(pin, e)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handlePinClick(pin, e);
								}
							}}
							onmousedown={(e) => startDragPin(pin, e)}
							role="button"
							tabindex="0"
						>
							<div
								class="relative flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-transform duration-150 transform hover:scale-125 {isSelected ? 'scale-125 ring-4 ring-blue-400' : ''}"
								style="background-color: {typeMeta.bgColor}; border: 2.5px solid {statusMeta.color};"
								title="{pin.label} ({statusMeta.label})"
							>
								<span class="text-sm">{typeMeta.icon}</span>
								<span
									class="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white shadow-xs"
									style="background-color: {statusMeta.color};"
								></span>
							</div>

							{#if showLabels && pin.label}
								<div class="mt-1 px-1.5 py-0.5 max-w-[130px] truncate text-[10px] font-bold rounded-md bg-white/95 dark:bg-slate-900/95 text-slate-800 dark:text-slate-100 shadow-sm border border-slate-200 pointer-events-none">
									{pin.label}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center p-8 text-center text-slate-400 max-w-md">
					<span class="text-5xl mb-3">📐</span>
					<p class="text-base font-semibold text-slate-200 mb-1">Belum Ada Gambar Site Plan</p>
					<p class="text-xs text-slate-400 mb-4">Unggah denah lokasi untuk mulai memetakan titik pekerjaan lapangan.</p>
					{#if canEdit}
						<button
							type="button"
							onclick={() => onuploadrequest?.()}
							class="px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow"
						>
							Unggah Site Plan
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Popover Detail Pin -->
		{#if selectedPin}
			{@const typeMeta = SITE_PLAN_PIN_TYPES[selectedPin.tipe] || SITE_PLAN_PIN_TYPES.zona_kerja}
			{@const statusMeta = SITE_PLAN_STATUS_OPTIONS[selectedPin.status || 'planned'] || SITE_PLAN_STATUS_OPTIONS.planned}

			<div class="absolute bottom-4 right-4 z-40 w-72 md:w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-4 text-xs animate-in fade-in">
				<div class="flex items-start justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
					<div class="flex items-center gap-2">
						<span class="text-2xl p-1 rounded-lg" style="background-color: {typeMeta.bgColor};">{typeMeta.icon}</span>
						<div>
							<p class="font-bold text-sm text-slate-900 dark:text-white leading-tight">{selectedPin.label}</p>
							<p class="text-[11px] text-slate-500">{typeMeta.label}</p>
						</div>
					</div>
					<button type="button" onclick={() => (selectedPin = null)} class="text-slate-400 hover:text-slate-600 p-1">✕</button>
				</div>

				<div class="py-2 space-y-2">
					<div>
						<span class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Ubah Status Cepat</span>
						<div class="flex flex-wrap gap-1">
							{#each Object.entries(SITE_PLAN_STATUS_OPTIONS) as [k, s]}
								<button
									type="button"
									onclick={() => handleQuickStatusChange(selectedPin!, k)}
									class="px-2 py-0.5 rounded text-[10px] font-semibold border {selectedPin.status === k ? 'ring-2 ring-blue-500 ' + s.badge : 'bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200'}"
								>
									{s.label}
								</button>
							{/each}
						</div>
					</div>

					{#if selectedPin.catatan}
						<div class="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg text-[11px] text-slate-700 dark:text-slate-300">
							{selectedPin.catatan}
						</div>
					{/if}
				</div>

				{#if canEdit}
					<div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
						<button
							type="button"
							onclick={() => ondeletepin?.(selectedPin!)}
							class="px-2.5 py-1 text-rose-600 hover:bg-rose-50 font-semibold rounded-lg"
						>
							Hapus
						</button>
						<button
							type="button"
							onclick={() => oneditpin?.(selectedPin!)}
							class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
						>
							Ubah Data
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
