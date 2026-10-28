<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/gudang/persiapan/+page.svelte
	// Persiapan Harian (read-only) untuk terminal Kiosk Gudang.
	// Fase 4 penajaman kiosk: search per tab, pagination virtual slice, indikator kecukupan bahan, shortcut cek rak.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		IconArrowLeft, IconLoader2, IconRefresh, IconAlertTriangle, IconClipboardList,
		IconBuildingFactory2, IconPackage, IconSearch, IconX, IconChevronDown,
		IconChevronRight, IconQrcode, IconExternalLink
	} from '@tabler/icons-svelte';

	interface Reorder {
		item_id: number;
		nama_barang: string;
		satuan: string;
		stok_tersedia: number;
		stok_minimum: number;
	}
	interface Spk {
		item_id: number;
		nama_barang: string;
		satuan: string;
		spk_id: number;
		quantity: number;
		stok_tersedia?: number | null;
		is_cukup?: boolean | null;
	}
	interface Pipeline {
		id: number;
		material_name: string;
		qty: number;
		unit: string;
		packing_status: string;
		requested_at: string | null;
	}
	interface Fg {
		item_id: number;
		nama_barang: string;
		satuan: string;
		stok_tersedia: number;
	}
	interface Data {
		reorder_alerts: Reorder[];
		spk_reservations: Spk[];
		packing_pipeline: Pipeline[];
		finish_good: Fg[];
	}

	let loading = $state(true);
	let loadError = $state('');
	let data = $state<Data | null>(null);
	let hubEnabled = $state(true);
	let tab = $state<'spk' | 'reorder' | 'packing' | 'fg'>('spk');

	// Search & pagination
	let searchQuery = $state('');
	let pageLimit = $state(35);
	let collapsedSpks = $state<Set<number>>(new Set());

	function toggleSpk(spkId: number) {
		const s = new Set(collapsedSpks);
		s.has(spkId) ? s.delete(spkId) : s.add(spkId);
		collapsedSpks = s;
	}

	function switchTab(t: 'spk' | 'reorder' | 'packing' | 'fg') {
		tab = t;
		searchQuery = '';
		pageLimit = 35;
	}

	async function load() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch('/api/kiosk/gudang/persiapan');
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || `Gagal memuat persiapan (${res.status}).`);
			data = d.data;
			hubEnabled = d.gate?.persiapan_hub_enabled ?? true;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Gagal memuat persiapan.';
		} finally {
			loading = false;
		}
	}

	// Filter & slicing
	let q = $derived(searchQuery.trim().toLowerCase());

	let spkGroups = $derived.by(() => {
		if (!data) return [];
		const map = new Map<number, Spk[]>();
		for (const r of data.spk_reservations) {
			if (q) {
				const matchSpk = String(r.spk_id).includes(q);
				const matchName = r.nama_barang.toLowerCase().includes(q);
				if (!matchSpk && !matchName) continue;
			}
			if (!map.has(r.spk_id)) map.set(r.spk_id, []);
			map.get(r.spk_id)!.push(r);
		}
		return [...map.entries()];
	});

	let filteredReorders = $derived.by(() => {
		if (!data) return [];
		let list = data.reorder_alerts;
		if (q) list = list.filter((r) => r.nama_barang.toLowerCase().includes(q));
		return list;
	});

	let filteredPacking = $derived.by(() => {
		if (!data) return [];
		let list = data.packing_pipeline;
		if (q) list = list.filter((p) => p.material_name.toLowerCase().includes(q));
		return list;
	});

	let filteredFg = $derived.by(() => {
		if (!data) return [];
		let list = data.finish_good;
		if (q) list = list.filter((f) => f.nama_barang.toLowerCase().includes(q));
		return list;
	});

	const PACKING_LABEL: Record<string, string> = { requested: 'Diminta', approved: 'Disetujui' };

	onMount(load);
</script>

<div class="wrap">
	<div class="top-nav">
		<button class="back" onclick={() => goto('/kiosk/gudang')}>
			<IconArrowLeft size={18} /> Kembali
		</button>
		<button class="refresh-btn" onclick={load} disabled={loading} title="Segarkan data">
			<IconRefresh size={18} class={loading ? 'spin' : ''} />
		</button>
	</div>

	<h1>Persiapan Harian</h1>
	<p class="hint">Panduan apa yang perlu disiapkan hari ini. Halaman ini hanya menampilkan — pengambilan barang lewat Antrian atau Opname.</p>

	{#if loading && !data}
		<div class="center py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Daftar Persiapan..." sublabel="Sinkronisasi picking list barang" />
		</div>
	{:else if loadError && !data}
		<div class="err-box">
			<p>{loadError}</p>
			<button class="retry" onclick={load}><IconRefresh size={16} /> Coba lagi</button>
		</div>
	{:else if !hubEnabled}
		<div class="empty"><p>Hub Persiapan belum diaktifkan admin.</p></div>
	{:else if data}
		<div class="tabs">
			<button class:active={tab === 'spk'} onclick={() => switchTab('spk')}>
				<IconBuildingFactory2 size={15} /> Bahan SPK <span class="n">{data.spk_reservations.length}</span>
			</button>
			<button class:active={tab === 'reorder'} onclick={() => switchTab('reorder')}>
				<IconAlertTriangle size={15} /> Reorder <span class="n">{data.reorder_alerts.length}</span>
			</button>
			<button class:active={tab === 'packing'} onclick={() => switchTab('packing')}>
				<IconClipboardList size={15} /> Packing <span class="n">{data.packing_pipeline.length}</span>
			</button>
			<button class:active={tab === 'fg'} onclick={() => switchTab('fg')}>
				<IconPackage size={15} /> Finish Good <span class="n">{data.finish_good.length}</span>
			</button>
		</div>

		<!-- Search Bar per tab -->
		<div class="search-bar">
			<IconSearch size={16} class="search-ic" />
			<input
				type="text"
				placeholder={tab === 'spk' ? 'Cari bahan atau no. SPK...' : 'Cari nama barang...'}
				bind:value={searchQuery}
			/>
			{#if searchQuery}
				<button class="search-clear" onclick={() => (searchQuery = '')} aria-label="Reset pencarian">
					<IconX size={16} />
				</button>
			{/if}
		</div>

		<!-- Tab 1: Bahan SPK -->
		{#if tab === 'spk'}
			{#if spkGroups.length === 0}
				<div class="empty">
					<p>{searchQuery ? `Tidak ada reservasi SPK cocok dengan "${searchQuery}".` : 'Tidak ada reservasi bahan baku SPK aktif.'}</p>
				</div>
			{:else}
				<div class="spk-list">
					{#each spkGroups as [spkId, items]}
						{@const isCollapsed = collapsedSpks.has(spkId)}
						{@const allOk = items.every((i) => i.is_cukup !== false)}
						<div class="spk-card">
							<button class="spk-header" onclick={() => toggleSpk(spkId)}>
								<div class="spk-title-wrap">
									{#if isCollapsed}
										<IconChevronRight size={18} class="chevron" />
									{:else}
										<IconChevronDown size={18} class="chevron" />
									{/if}
									<span class="spk-title">SPK #{spkId}</span>
									<span class="spk-count">{items.length} bahan</span>
								</div>
								<span class="spk-badge" class:spk-badge--ok={allOk} class:spk-badge--warn={!allOk}>
									{allOk ? 'Stok Cukup' : 'Ada Defisit'}
								</span>
							</button>

							{#if !isCollapsed}
								<div class="spk-items">
									{#each items as it}
										<div class="spk-row">
											<div class="spk-row__main">
												<span class="row-nama">{it.nama_barang}</span>
												{#if it.is_cukup === true}
													<span class="stock-pill stock-pill--ok">Tersedia: {it.stok_tersedia} {it.satuan}</span>
												{:else if it.is_cukup === false}
													<span class="stock-pill stock-pill--short">Defisit (Stok: {it.stok_tersedia ?? 0} {it.satuan})</span>
												{/if}
											</div>
											<span class="row-qty"><strong>{it.quantity}</strong> {it.satuan}</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

		<!-- Tab 2: Reorder -->
		{:else if tab === 'reorder'}
			{#if filteredReorders.length === 0}
				<div class="empty">
					<p>{searchQuery ? `Tidak ada barang cocok dengan "${searchQuery}".` : 'Tidak ada barang di bawah stok minimum.'}</p>
				</div>
			{:else}
				<div class="slice-hint">
					Menampilkan {Math.min(pageLimit, filteredReorders.length)} dari {filteredReorders.length} barang
				</div>
				<div class="rows">
					{#each filteredReorders.slice(0, pageLimit) as r (r.item_id)}
						{@const defisit = Math.max(0, r.stok_minimum - r.stok_tersedia)}
						<div class="row warn">
							<div class="row-main">
								<span class="row-nama">{r.nama_barang}</span>
								<div class="reorder-meta">
									<span class="defisit-tag">Kurang {defisit} {r.satuan}</span>
									<button
										class="shortcut-btn"
										onclick={() => goto(`/kiosk/cek-stok?q=${encodeURIComponent(r.nama_barang)}`)}
										title="Cari lokasi rak"
									>
										<IconQrcode size={13} /> Cek Rak
									</button>
								</div>
							</div>
							<span class="row-qty">
								<strong style="color:#dc2626">{r.stok_tersedia}</strong> / min {r.stok_minimum} {r.satuan}
							</span>
						</div>
					{/each}
				</div>
				{#if pageLimit < filteredReorders.length}
					<button class="load-more-btn" onclick={() => (pageLimit += 35)}>
						Muat 35 Lagi ({filteredReorders.length - pageLimit} tersisa)
					</button>
				{/if}
			{/if}

		<!-- Tab 3: Packing -->
		{:else if tab === 'packing'}
			{#if filteredPacking.length === 0}
				<div class="empty">
					<p>{searchQuery ? `Tidak ada packing cocok dengan "${searchQuery}".` : 'Tidak ada permintaan packing proyek.'}</p>
				</div>
			{:else}
				<div class="slice-hint">
					Menampilkan {Math.min(pageLimit, filteredPacking.length)} dari {filteredPacking.length} item
				</div>
				<div class="rows">
					{#each filteredPacking.slice(0, pageLimit) as p (p.id)}
						<div class="row">
							<span class="row-nama">{p.material_name}</span>
							<span class="row-qty">{p.qty} {p.unit} · <span class="packing-st">{PACKING_LABEL[p.packing_status] || p.packing_status}</span></span>
						</div>
					{/each}
				</div>
				{#if pageLimit < filteredPacking.length}
					<button class="load-more-btn" onclick={() => (pageLimit += 35)}>
						Muat 35 Lagi ({filteredPacking.length - pageLimit} tersisa)
					</button>
				{/if}
			{/if}

		<!-- Tab 4: Finish Good -->
		{:else if tab === 'fg'}
			{#if filteredFg.length === 0}
				<div class="empty">
					<p>{searchQuery ? `Tidak ada Finish Good cocok dengan "${searchQuery}".` : 'Tidak ada stok Finish Good.'}</p>
				</div>
			{:else}
				<div class="slice-hint">
					Menampilkan {Math.min(pageLimit, filteredFg.length)} dari {filteredFg.length} item
				</div>
				<div class="rows">
					{#each filteredFg.slice(0, pageLimit) as f (f.item_id)}
						<div class="row">
							<div class="row-main">
								<span class="row-nama">{f.nama_barang}</span>
								<button
									class="shortcut-btn"
									onclick={() => goto(`/kiosk/cek-stok?q=${encodeURIComponent(f.nama_barang)}`)}
									title="Lihat rak penyimpanan"
								>
									<IconQrcode size={13} /> Rak
								</button>
							</div>
							<span class="row-qty"><strong style="color:#0f766e">{f.stok_tersedia}</strong> {f.satuan}</span>
						</div>
					{/each}
				</div>
				{#if pageLimit < filteredFg.length}
					<button class="load-more-btn" onclick={() => (pageLimit += 35)}>
						Muat 35 Lagi ({filteredFg.length - pageLimit} tersisa)
					</button>
				{/if}
			{/if}
		{/if}
	{/if}
</div>

<style>
	.wrap { padding: 1rem 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 100%; box-sizing: border-box; min-height: 100%; }
	.top-nav { display: flex; align-items: center; justify-content: space-between; }
	.back {
		align-self: flex-start; display: flex; align-items: center; gap: 0.4rem;
		background: none; border: none; color: #475569; font-size: 0.95rem; font-weight: 600; cursor: pointer; padding: 0;
	}
	.refresh-btn {
		background: white; border: 1px solid #cbd5e1; border-radius: 0.5rem; width: 36px; height: 36px;
		display: flex; align-items: center; justify-content: center; color: #475569; cursor: pointer;
	}
	.refresh-btn:hover { background: #f8fafc; color: #0f172a; }
	h1 { font-size: 1.4rem; font-weight: 800; color: #0f172a; margin: 0; }
	.hint { font-size: 0.9rem; color: #64748b; margin: 0; line-height: 1.4; }
	.center { display: flex; justify-content: center; padding: 3rem; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.err-box { text-align: center; color: #dc2626; display: flex; flex-direction: column; gap: 0.75rem; align-items: center; padding: 2rem 1rem; }
	.retry { display: flex; align-items: center; gap: 0.35rem; border: 1px solid #cbd5e1; background: white; color: #475569; border-radius: 0.6rem; padding: 0.5rem 1rem; font-weight: 700; cursor: pointer; }
	.empty { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 0.75rem; padding: 1.75rem 1rem; text-align: center; color: #64748b; font-size: 0.9rem; }
	.empty p { margin: 0; }

	.tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.tabs button {
		display: flex; align-items: center; gap: 0.3rem; border: 1px solid #cbd5e1; background: white;
		color: #475569; border-radius: 999px; padding: 0.45rem 0.8rem; font-size: 0.8rem; font-weight: 700; cursor: pointer;
	}
	.tabs button.active { background: #0f172a; color: white; border-color: #0f172a; }
	.tabs .n { background: rgba(100,116,139,0.2); border-radius: 999px; padding: 0 0.4rem; font-size: 0.72rem; }
	.tabs button.active .n { background: rgba(255,255,255,0.25); }

	.search-bar {
		display: flex; align-items: center; gap: 0.5rem; background: white;
		border: 1px solid #cbd5e1; border-radius: 0.6rem; padding: 0.6rem 0.8rem;
	}
	.search-bar:focus-within { border-color: #0f766e; }
	.search-bar input { flex: 1; border: none; outline: none; font-size: 0.9rem; color: #0f172a; }
	:global(.search-ic) { color: #94a3b8; flex-shrink: 0; }
	.search-clear { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0; display: flex; }

	.slice-hint { font-size: 0.75rem; color: #64748b; font-weight: 600; margin: 0; }

	.spk-list { display: flex; flex-direction: column; gap: 0.6rem; }
	.spk-card { background: white; border: 1px solid #e2e8f0; border-radius: 0.75rem; overflow: hidden; }
	.spk-header {
		width: 100%; display: flex; align-items: center; justify-content: space-between;
		padding: 0.85rem 1rem; background: none; border: none; cursor: pointer; text-align: left;
	}
	.spk-header:hover { background: #f8fafc; }
	.spk-title-wrap { display: flex; align-items: center; gap: 0.45rem; }
	:global(.chevron) { color: #94a3b8; }
	.spk-title { font-size: 0.95rem; font-weight: 800; color: #0f172a; }
	.spk-count { font-size: 0.75rem; color: #64748b; }
	.spk-badge { font-size: 0.68rem; font-weight: 800; padding: 0.15rem 0.45rem; border-radius: 4px; }
	.spk-badge--ok { background: #ecfdf5; color: #047857; }
	.spk-badge--warn { background: #fef2f2; color: #b91c1c; }

	.spk-items { display: flex; flex-direction: column; border-top: 1px solid #f1f5f9; padding: 0.4rem 1rem 0.8rem; gap: 0.4rem; }
	.spk-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.35rem 0; border-bottom: 1px dashed #f1f5f9; }
	.spk-row:last-child { border-bottom: none; }
	.spk-row__main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
	.stock-pill { font-size: 0.7rem; font-weight: 700; width: fit-content; border-radius: 3px; padding: 0.05rem 0.35rem; }
	.stock-pill--ok { background: #ecfdf5; color: #059669; }
	.stock-pill--short { background: #fff1f2; color: #e11d48; }

	.rows { display: flex; flex-direction: column; gap: 0.4rem; }
	.row {
		display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
		background: white; border: 1px solid #e2e8f0; border-radius: 0.65rem; padding: 0.75rem 0.95rem;
	}
	.row.warn { background: #fffbeb; border-color: #fde68a; }
	.row-main { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
	.row-nama { font-size: 0.9rem; font-weight: 700; color: #0f172a; min-width: 0; }
	.row-qty { font-size: 0.85rem; color: #64748b; white-space: nowrap; flex-shrink: 0; }
	.reorder-meta { display: flex; align-items: center; gap: 0.5rem; }
	.defisit-tag { font-size: 0.72rem; font-weight: 800; color: #b91c1c; background: #fee2e2; padding: 0.05rem 0.35rem; border-radius: 3px; }
	.shortcut-btn {
		display: inline-flex; align-items: center; gap: 0.2rem; background: white; border: 1px solid #cbd5e1;
		border-radius: 4px; padding: 0.1rem 0.4rem; font-size: 0.72rem; font-weight: 700; color: #0f766e; cursor: pointer;
	}
	.shortcut-btn:hover { background: #f0fdfa; border-color: #0f766e; }
	.packing-st { font-weight: 700; color: #0f766e; }
	.load-more-btn {
		width: 100%; background: white; border: 1px solid #cbd5e1; border-radius: 0.6rem;
		padding: 0.75rem; font-size: 0.85rem; font-weight: 700; color: #334155; cursor: pointer;
	}
	.load-more-btn:hover { background: #f8fafc; }
</style>
