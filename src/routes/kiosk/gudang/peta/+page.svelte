<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/gudang/peta/+page.svelte
	// Peta Gudang di terminal Kiosk: tab "Denah" (gambar + pin rak, tap → detail rak) dan tab
	// "Daftar Rak" (pohon gudang induk → rak). Fase 2 penajaman kiosk.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		IconArrowLeft, IconLoader2, IconRefresh, IconMap2, IconListTree,
		IconChevronRight, IconChevronDown, IconMapPin, IconZoomIn, IconZoomOut,
		IconZoomReset, IconX, IconExternalLink, IconSearch
	} from '@tabler/icons-svelte';

	interface Pin {
		pin_id: number;
		gudang_id: number;
		gudang_nama: string;
		gudang_kode: string | null;
		x_pct: number;
		y_pct: number;
		label: string | null;
		status_verifikasi: 'match' | 'selisih' | 'mismatch' | null;
	}
	interface Denah { id: number; nama: string; gambar_id: string; pins: Pin[]; }
	interface TreeNode { id: number; nama_gudang: string; kode_gudang: string | null; jenis: string | null; parent_gudang_id: number | null; }

	let loading = $state(true);
	let loadError = $state('');
	let denah = $state<Denah[]>([]);
	let tree = $state<TreeNode[]>([]);
	let tab = $state<'denah' | 'daftar'>('denah');
	let collapsed = $state<Set<number>>(new Set());

	// Filter & preview pin
	let statusFilter = $state<'semua' | 'match' | 'selisih' | 'mismatch' | 'unverified'>('semua');
	let selectedPin = $state<Pin | null>(null);

	// Zoom & Pan
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let startDragX = $state(0);
	let startDragY = $state(0);

	function zoomIn() {
		zoom = Math.min(3, Math.round((zoom + 0.3) * 10) / 10);
	}
	function zoomOut() {
		zoom = Math.max(1, Math.round((zoom - 0.3) * 10) / 10);
		if (zoom === 1) {
			panX = 0;
			panY = 0;
		}
	}
	function resetZoom() {
		zoom = 1;
		panX = 0;
		panY = 0;
	}

	function onPointerDown(e: PointerEvent) {
		if (zoom <= 1) return;
		isDragging = true;
		startDragX = e.clientX - panX;
		startDragY = e.clientY - panY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		panX = e.clientX - startDragX;
		panY = e.clientY - startDragY;
	}
	function onPointerUp(e: PointerEvent) {
		if (isDragging) {
			isDragging = false;
			try {
				(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
			} catch {}
		}
	}

	const PIN_COLOR: Record<string, string> = {
		match: '#16a34a',
		selisih: '#d97706',
		mismatch: '#dc2626',
		unverified: '#64748b'
	};

	const STATUS_INFO: Record<string, { label: string; color: string; bg: string }> = {
		match: { label: 'Sesuai', color: '#16a34a', bg: '#dcfce7' },
		selisih: { label: 'Ada Selisih', color: '#d97706', bg: '#fef3c7' },
		mismatch: { label: 'Bermasalah', color: '#dc2626', bg: '#fee2e2' },
		unverified: { label: 'Belum Dicek', color: '#64748b', bg: '#f1f5f9' }
	};

	function isPinVisible(p: Pin): boolean {
		if (statusFilter === 'semua') return true;
		if (statusFilter === 'unverified') return p.status_verifikasi == null;
		return p.status_verifikasi === statusFilter;
	}

	async function load() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch('/api/kiosk/gudang/peta');
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal memuat peta (${res.status}).`);
			denah = data.denah || [];
			tree = data.tree || [];
			if (denah.length === 0) tab = 'daftar';
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Gagal memuat peta.';
		} finally {
			loading = false;
		}
	}

	// Filter tab pohon gudang
	let treeSearch = $state('');

	// Susun pohon jadi daftar DFS berindentasi (root = tanpa induk atau induk tak ada di set).
	let flatTree = $derived.by(() => {
		const ids = new Set(tree.map((n) => n.id));
		const childrenOf = new Map<number | null, TreeNode[]>();
		for (const n of tree) {
			const key = n.parent_gudang_id != null && ids.has(n.parent_gudang_id) ? n.parent_gudang_id : null;
			if (!childrenOf.has(key)) childrenOf.set(key, []);
			childrenOf.get(key)!.push(n);
		}
		const out: Array<{ node: TreeNode; depth: number; hasChildren: boolean }> = [];
		const walk = (parentKey: number | null, depth: number) => {
			for (const n of childrenOf.get(parentKey) || []) {
				const kids = childrenOf.get(n.id) || [];
				out.push({ node: n, depth, hasChildren: kids.length > 0 });
				if (kids.length && !collapsed.has(n.id)) walk(n.id, depth + 1);
			}
		};
		walk(null, 0);

		if (treeSearch.trim()) {
			const term = treeSearch.trim().toLowerCase();
			return out.filter(
				(row) =>
					row.node.nama_gudang.toLowerCase().includes(term) ||
					(row.node.kode_gudang && row.node.kode_gudang.toLowerCase().includes(term))
			);
		}
		return out;
	});

	function toggle(id: number) {
		const s = new Set(collapsed);
		s.has(id) ? s.delete(id) : s.add(id);
		collapsed = s;
	}

	onMount(load);
</script>

<div class="wrap">
	<button class="back" onclick={() => goto('/kiosk/gudang')}>
		<IconArrowLeft size={18} /> Kembali
	</button>
	<h1>Peta Gudang</h1>
	<p class="hint">Ketuk rak untuk lihat isinya. Warna pin = hasil cek area terakhir (hijau sesuai, kuning selisih, merah bermasalah, abu belum pernah dicek).</p>

	{#if loading}
		<div class="center py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Denah Gudang..." sublabel="Mengambil tata letak rak & zona" />
		</div>
	{:else if loadError}
		<div class="err-box">
			<p>{loadError}</p>
			<button class="retry" onclick={load}><IconRefresh size={16} /> Coba lagi</button>
		</div>
	{:else}
		<div class="tabs">
			<button class:active={tab === 'denah'} onclick={() => (tab = 'denah')} disabled={denah.length === 0}>
				<IconMap2 size={15} /> Denah {#if denah.length === 0}(kosong){/if}
			</button>
			<button class:active={tab === 'daftar'} onclick={() => (tab = 'daftar')}>
				<IconListTree size={15} /> Daftar Rak
			</button>
		</div>

		{#if tab === 'denah'}
			{#each denah as d (d.id)}
				<div class="denah">
					<div class="denah-top">
						<p class="denah-nama">{d.nama}</p>
						<span class="denah-pin-count">{d.pins.length} rak terpetakan</span>
					</div>

					<!-- Filter Status Pin -->
					<div class="filter-chips">
						<button
							class="f-chip"
							class:active={statusFilter === 'semua'}
							onclick={() => (statusFilter = 'semua')}
						>
							Semua ({d.pins.length})
						</button>
						<button
							class="f-chip"
							class:active={statusFilter === 'match'}
							onclick={() => (statusFilter = 'match')}
						>
							<i class="dot" style="background:{PIN_COLOR.match}"></i> Sesuai
						</button>
						<button
							class="f-chip"
							class:active={statusFilter === 'selisih'}
							onclick={() => (statusFilter = 'selisih')}
						>
							<i class="dot" style="background:{PIN_COLOR.selisih}"></i> Selisih
						</button>
						<button
							class="f-chip"
							class:active={statusFilter === 'mismatch'}
							onclick={() => (statusFilter = 'mismatch')}
						>
							<i class="dot" style="background:{PIN_COLOR.mismatch}"></i> Bermasalah
						</button>
					</div>

					<div
						class="denah-canvas"
						class:grab={zoom > 1 && !isDragging}
						class:grabbing={isDragging}
						onpointerdown={onPointerDown}
						onpointermove={onPointerMove}
						onpointerup={onPointerUp}
						onpointercancel={onPointerUp}
					>
						<!-- Kontrol Zoom -->
						<div class="zoom-controls">
							<button class="z-btn" onclick={zoomIn} aria-label="Perbesar" title="Perbesar">
								<IconZoomIn size={16} />
							</button>
							<button class="z-btn" onclick={zoomOut} disabled={zoom <= 1} aria-label="Perkecil" title="Perkecil">
								<IconZoomOut size={16} />
							</button>
							{#if zoom > 1}
								<button class="z-btn z-btn--reset" onclick={resetZoom} aria-label="Reset zoom" title="Reset">
									<IconZoomReset size={16} />
								</button>
							{/if}
						</div>

						<div
							class="denah-viewport"
							style="transform: scale({zoom}) translate({panX / zoom}px, {panY / zoom}px);"
						>
							<img src={`/api/kiosk/asset/${d.gambar_id}`} alt={d.nama} draggable="false" />
							{#each d.pins as p (p.pin_id)}
								{#if isPinVisible(p)}
									{@const stKey = p.status_verifikasi || 'unverified'}
									<button
										class="pin"
										class:selected={selectedPin?.pin_id === p.pin_id}
										style="left:{p.x_pct}%; top:{p.y_pct}%; background:{PIN_COLOR[stKey]};"
										title={p.gudang_nama}
										onclick={() => (selectedPin = p)}
										aria-label={`Pilih rak ${p.gudang_nama}`}
									>
										<IconMapPin size={15} />
										{#if p.label}
											<span class="pin-badge">{p.label}</span>
										{/if}
									</button>
								{/if}
							{/each}
						</div>
					</div>

					{#if d.pins.length === 0}
						<p class="denah-empty">Belum ada rak yang dipetakan di denah ini.</p>
					{/if}

					<!-- Kartu Preview Rak Melayang -->
					{#if selectedPin}
						{@const stKey = selectedPin.status_verifikasi || 'unverified'}
						{@const stInfo = STATUS_INFO[stKey]}
						<div class="pin-card">
							<div class="pin-card__top">
								<div class="pin-card__info">
									<span class="pin-card__name">{selectedPin.gudang_nama}</span>
									{#if selectedPin.gudang_kode}
										<span class="pin-card__code">{selectedPin.gudang_kode}</span>
									{/if}
								</div>
								<button class="pin-card__close" onclick={() => (selectedPin = null)} aria-label="Tutup preview">
									<IconX size={18} />
								</button>
							</div>
							<div class="pin-card__status">
								<span class="st-pill" style="color:{stInfo.color}; background:{stInfo.bg}">
									● {stInfo.label}
								</span>
								<span class="pin-card__hint">Hasil audit cek area terakhir</span>
							</div>
							<button class="pin-card__btn" onclick={() => goto(`/kiosk/cek-stok/${selectedPin!.gudang_id}`)}>
								<IconExternalLink size={16} /> Buka Detail & Isi Rak
							</button>
						</div>
					{/if}
				</div>
			{/each}
		{:else}
			<div class="tree-search-bar">
				<IconSearch size={16} class="tree-search-ic" />
				<input
					type="text"
					placeholder="Cari nama atau kode rak..."
					bind:value={treeSearch}
				/>
				{#if treeSearch}
					<button class="tree-search-clear" onclick={() => (treeSearch = '')}>
						<IconX size={16} />
					</button>
				{/if}
			</div>

			{#if flatTree.length === 0}
				<div class="empty">
					<p>{treeSearch ? `Tidak ada rak yang cocok dengan "${treeSearch}".` : 'Belum ada data gudang.'}</p>
				</div>
			{:else}
				<div class="tree">
					{#each flatTree as row (row.node.id)}
						<div class="tree-row" style="padding-left:{row.depth * 1.1 + 0.5}rem">
							{#if row.hasChildren}
								<button class="tw" onclick={() => toggle(row.node.id)} aria-label="Buka/tutup">
									{#if collapsed.has(row.node.id)}<IconChevronRight size={16} />{:else}<IconChevronDown size={16} />{/if}
								</button>
							{:else}
								<span class="tw-spacer"></span>
							{/if}
							<button class="tree-node" onclick={() => goto(`/kiosk/cek-stok/${row.node.id}`)}>
								<span class="tn-nama">{row.node.nama_gudang}</span>
								{#if row.node.kode_gudang}<span class="tn-kode">{row.node.kode_gudang}</span>{/if}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.wrap { padding: 1rem 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 100%; box-sizing: border-box; min-height: 100%; }
	.back { align-self: flex-start; display: flex; align-items: center; gap: 0.4rem; background: none; border: none; color: #475569; font-size: 0.95rem; font-weight: 600; cursor: pointer; padding: 0; }
	h1 { font-size: 1.4rem; font-weight: 800; color: #0f172a; margin: 0; }
	.hint { font-size: 0.9rem; color: #64748b; margin: 0; line-height: 1.4; }
	.center { display: flex; justify-content: center; padding: 3rem; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.err-box { text-align: center; color: #dc2626; display: flex; flex-direction: column; gap: 0.75rem; align-items: center; padding: 2rem 1rem; }
	.retry { display: flex; align-items: center; gap: 0.35rem; border: 1px solid #cbd5e1; background: white; color: #475569; border-radius: 0.6rem; padding: 0.5rem 1rem; font-weight: 700; cursor: pointer; }
	.empty { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 0.75rem; padding: 1.75rem 1rem; text-align: center; color: #64748b; font-size: 0.9rem; }
	.empty p { margin: 0; }
	.tabs { display: flex; gap: 0.4rem; }
	.tabs button { display: flex; align-items: center; gap: 0.3rem; border: 1px solid #cbd5e1; background: white; color: #475569; border-radius: 999px; padding: 0.45rem 0.9rem; font-size: 0.82rem; font-weight: 700; cursor: pointer; }
	.tabs button.active { background: #0f172a; color: white; border-color: #0f172a; }
	.tabs button:disabled { opacity: 0.4; }
	.denah { display: flex; flex-direction: column; gap: 0.6rem; }
	.denah-top { display: flex; align-items: center; justify-content: space-between; }
	.denah-nama { font-size: 0.95rem; font-weight: 800; color: #0f172a; margin: 0; }
	.denah-pin-count { font-size: 0.75rem; color: #64748b; }

	.filter-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.f-chip {
		display: flex; align-items: center; gap: 0.3rem; border: 1px solid #cbd5e1;
		background: white; color: #475569; border-radius: 999px; padding: 0.3rem 0.65rem;
		font-size: 0.75rem; font-weight: 700; cursor: pointer;
	}
	.f-chip.active { background: #0f172a; color: white; border-color: #0f172a; }
	.f-chip .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }

	.denah-canvas {
		position: relative; border: 1px solid #e2e8f0; border-radius: 0.75rem;
		overflow: hidden; background: #f8fafc; touch-action: none; user-select: none;
	}
	.denah-canvas.grab { cursor: grab; }
	.denah-canvas.grabbing { cursor: grabbing; }
	.denah-viewport {
		position: relative; width: 100%; transform-origin: 0 0;
		transition: transform 0.05s ease-out;
	}
	.denah-canvas img { display: block; width: 100%; height: auto; pointer-events: none; }

	.zoom-controls {
		position: absolute; top: 0.75rem; right: 0.75rem; display: flex; flex-direction: column;
		gap: 0.35rem; z-index: 20;
	}
	.z-btn {
		width: 34px; height: 34px; border-radius: 0.5rem; border: 1px solid #cbd5e1;
		background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(4px);
		color: #334155; display: flex; align-items: center; justify-content: center;
		cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.1);
	}
	.z-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.z-btn--reset { background: #0f766e; color: white; border-color: #0f766e; }

	.pin {
		position: absolute; transform: translate(-50%, -50%); width: 32px; height: 32px;
		border-radius: 999px; border: 2.5px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4);
		color: white; display: flex; align-items: center; justify-content: center; cursor: pointer;
		padding: 0; transition: transform 0.15s ease; z-index: 10;
	}
	.pin:hover { transform: translate(-50%, -50%) scale(1.15); z-index: 15; }
	.pin.selected { transform: translate(-50%, -50%) scale(1.25); border-color: #0f172a; z-index: 20; }
	.pin-badge {
		position: absolute; bottom: -14px; left: 50%; transform: translateX(-50%);
		background: #0f172a; color: white; font-size: 0.62rem; font-weight: 800;
		padding: 0.05rem 0.3rem; border-radius: 3px; white-space: nowrap; pointer-events: none;
	}
	.denah-empty { font-size: 0.8rem; color: #94a3b8; margin: 0.25rem 0; text-align: center; }

	.pin-card {
		background: white; border: 1px solid #e2e8f0; border-radius: 0.75rem;
		padding: 0.9rem 1.1rem; display: flex; flex-direction: column; gap: 0.5rem;
		box-shadow: 0 4px 12px rgba(0,0,0,0.06);
	}
	.pin-card__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
	.pin-card__info { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.pin-card__name { font-size: 1rem; font-weight: 800; color: #0f172a; }
	.pin-card__code { font-size: 0.75rem; font-family: monospace; background: #f1f5f9; padding: 0.1rem 0.4rem; border-radius: 4px; color: #475569; }
	.pin-card__close { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0; }
	.pin-card__status { display: flex; align-items: center; gap: 0.6rem; }
	.st-pill { font-size: 0.72rem; font-weight: 800; border-radius: 999px; padding: 0.15rem 0.5rem; }
	.pin-card__hint { font-size: 0.75rem; color: #94a3b8; }
	.pin-card__btn {
		margin-top: 0.3rem; display: flex; align-items: center; justify-content: center; gap: 0.4rem;
		background: #0f766e; color: white; border: none; border-radius: 0.6rem; padding: 0.75rem;
		font-weight: 700; font-size: 0.9rem; cursor: pointer;
	}

	.tree-search-bar {
		display: flex; align-items: center; gap: 0.5rem; background: white;
		border: 1px solid #cbd5e1; border-radius: 0.6rem; padding: 0.6rem 0.8rem;
	}
	.tree-search-bar input { flex: 1; border: none; outline: none; font-size: 0.9rem; color: #0f172a; }
	:global(.tree-search-ic) { color: #94a3b8; flex-shrink: 0; }
	.tree-search-clear { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0; display: flex; }

	.tree { display: flex; flex-direction: column; gap: 0.2rem; }
	.tree-row { display: flex; align-items: center; gap: 0.25rem; }
	.tw { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0.35rem; display: flex; flex-shrink: 0; }
	.tw-spacer { width: 26px; flex-shrink: 0; }
	.tree-node { flex: 1; min-width: 0; text-align: left; background: white; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 0.65rem 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; }
	.tree-node:hover { border-color: #cbd5e1; background: #f8fafc; }
	.tn-nama { font-size: 0.88rem; font-weight: 700; color: #0f172a; }
	.tn-kode { font-size: 0.72rem; color: #94a3b8; }
</style>
