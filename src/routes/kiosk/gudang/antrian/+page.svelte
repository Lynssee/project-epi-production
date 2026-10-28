<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/gudang/antrian/+page.svelte
	// Daftar antrian persiapan (packing_list) untuk terminal Kiosk Gudang.
	// Penajaman Kiosk Gudang: Tampilan Kanban Board 3-Kolom + List View, KPI Summary Ribbon, Alert Overdue & Progress Picking.
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		IconArrowLeft, IconLoader2, IconChevronRight, IconInbox, IconRefresh,
		IconSearch, IconX, IconAlertTriangle, IconFlame, IconLayoutKanban,
		IconList, IconClock, IconPackage, IconCircleCheck, IconArrowRight,
		IconUser, IconCalendar, IconFilter, IconCheck
	} from '@tabler/icons-svelte';

	interface Row {
		id: number;
		nomor_pl: string;
		prep_status: string;
		priority: string;
		urgency: string;
		needed_date: string | null;
		requested_by_department: string;
		destination_pic_name: string;
		assigned_to_name: string | null;
		request_type: string;
		item_count: number;
		items_completed?: number;
	}

	let loading = $state(true);
	let loadError = $state('');
	let rows = $state<Row[]>([]);
	let hqEnabled = $state(true);
	let lastUpdated = $state<string>('');

	// View mode: 'kanban' or 'list' (default 'kanban')
	let viewMode = $state<'kanban' | 'list'>('kanban');

	// Search & Filters
	let searchQuery = $state('');
	let filterUrgentOnly = $state(false);
	let filterRequestType = $state<'all' | 'project' | 'maintenance' | 'internal'>('all');
	let sortBy = $state<'urgency_desc' | 'needed_asc' | 'pl_asc'>('urgency_desc');

	// Active tab for List View
	let activeTab = $state<'semua' | 'pending' | 'picking' | 'urgent' | 'packed'>('pending');

	// Auto-refresh interval
	let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

	const PREP_LABEL: Record<string, string> = {
		pending: 'Belum disiapkan',
		picking: 'Sedang disiapkan',
		packed: 'Siap kirim',
		dispatched: 'Terkirim'
	};
	const PREP_COLOR: Record<string, string> = {
		pending: '#64748b',
		picking: '#d97706',
		packed: '#16a34a',
		dispatched: '#0ea5e9'
	};
	const TYPE_LABEL: Record<string, string> = {
		project: 'Proyek',
		maintenance: 'Maintenance',
		internal: 'Internal'
	};
	const TYPE_COLOR: Record<string, { bg: string; text: string; border: string }> = {
		project: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
		maintenance: { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
		internal: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' }
	};

	function isUrgent(r: Row): boolean {
		return r.urgency === 'urgent' || r.priority === 'tinggi' || r.priority === 'urgent';
	}

	function getTodayIso(): string {
		const d = new Date();
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	function getDueDateStatus(iso: string | null): { text: string; type: 'overdue' | 'today' | 'upcoming'; isUrgent: boolean } | null {
		if (!iso) return null;
		const dateOnly = iso.split('T')[0];
		const today = getTodayIso();
		const d = new Date(iso);
		const dateLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

		if (dateOnly < today) {
			return { text: `Terlambat (${dateLabel})`, type: 'overdue', isUrgent: true };
		}
		if (dateOnly === today) {
			return { text: `Hari ini! (${dateLabel})`, type: 'today', isUrgent: true };
		}
		return { text: `Butuh: ${dateLabel}`, type: 'upcoming', isUrgent: false };
	}

	async function load() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch('/api/kiosk/gudang/antrian');
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal memuat antrian (${res.status}).`);
			rows = data.rows || [];
			hqEnabled = data.gate?.gudang_hq_enabled ?? false;
			lastUpdated = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Gagal memuat antrian.';
		} finally {
			loading = false;
		}
	}

	let counts = $derived.by(() => {
		let pending = 0;
		let picking = 0;
		let urgent = 0;
		let packed = 0;
		for (const r of rows) {
			if (r.prep_status === 'pending') pending++;
			else if (r.prep_status === 'picking') picking++;
			else if (r.prep_status === 'packed') packed++;
			if (isUrgent(r)) urgent++;
		}
		return { semua: rows.length, pending, picking, urgent, packed };
	});

	let filteredRows = $derived.by(() => {
		let list = rows;

		if (filterUrgentOnly) {
			list = list.filter(isUrgent);
		}
		if (filterRequestType !== 'all') {
			list = list.filter((r) => r.request_type === filterRequestType);
		}

		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			list = list.filter(
				(r) =>
					(r.nomor_pl || '').toLowerCase().includes(q) ||
					(r.destination_pic_name || '').toLowerCase().includes(q) ||
					(r.requested_by_department || '').toLowerCase().includes(q) ||
					(TYPE_LABEL[r.request_type] || r.request_type || '').toLowerCase().includes(q) ||
					(r.assigned_to_name || '').toLowerCase().includes(q)
			);
		}

		// Sorting
		return [...list].sort((a, b) => {
			if (sortBy === 'urgency_desc') {
				const aUrg = isUrgent(a) ? 1 : 0;
				const bUrg = isUrgent(b) ? 1 : 0;
				if (aUrg !== bUrg) return bUrg - aUrg;
				if (a.needed_date && b.needed_date) return a.needed_date.localeCompare(b.needed_date);
				return 0;
			} else if (sortBy === 'needed_asc') {
				if (!a.needed_date) return 1;
				if (!b.needed_date) return -1;
				return a.needed_date.localeCompare(b.needed_date);
			} else if (sortBy === 'pl_asc') {
				return (a.nomor_pl || '').localeCompare(b.nomor_pl || '');
			}
			return 0;
		});
	});

	// Kanban column derivation
	let pendingRows = $derived(filteredRows.filter((r) => r.prep_status === 'pending'));
	let pickingRows = $derived(filteredRows.filter((r) => r.prep_status === 'picking'));
	let packedRows = $derived(filteredRows.filter((r) => r.prep_status === 'packed'));
	let pendingUrgentCount = $derived(pendingRows.filter(isUrgent).length);
	let pickingUrgentCount = $derived(pickingRows.filter(isUrgent).length);

	// List view filtered subset
	let listViewRows = $derived.by(() => {
		if (activeTab === 'pending') {
			return filteredRows.filter((r) => r.prep_status === 'pending' || r.prep_status === 'picking');
		} else if (activeTab === 'picking') {
			return filteredRows.filter((r) => r.prep_status === 'picking');
		} else if (activeTab === 'urgent') {
			return filteredRows.filter(isUrgent);
		} else if (activeTab === 'packed') {
			return filteredRows.filter((r) => r.prep_status === 'packed');
		}
		return filteredRows;
	});

	function resetFilters() {
		searchQuery = '';
		filterUrgentOnly = false;
		filterRequestType = 'all';
		sortBy = 'urgency_desc';
		activeTab = 'pending';
	}

	onMount(() => {
		const savedView = localStorage.getItem('kiosk_antrian_view_mode');
		if (savedView === 'list' || savedView === 'kanban') {
			viewMode = savedView;
		}
		load();
		// Auto refresh setiap 45 detik
		autoRefreshTimer = setInterval(() => {
			if (!loading) load();
		}, 45000);
	});

	onDestroy(() => {
		if (autoRefreshTimer) clearInterval(autoRefreshTimer);
	});

	function setViewMode(mode: 'kanban' | 'list') {
		viewMode = mode;
		localStorage.setItem('kiosk_antrian_view_mode', mode);
	}
</script>

<div class="wrap" class:wrap-kanban={viewMode === 'kanban'}>
	<!-- TOP NAVIGATION BAR -->
	<header class="top-nav">
		<div class="nav-left">
			<button class="back-btn" onclick={() => goto('/kiosk/gudang')}>
				<IconArrowLeft size={20} />
				<span>Kembali</span>
			</button>
			<div class="title-group">
				<div class="title-row">
					<h1>Ambil Barang untuk Permintaan</h1>
					<span class="live-pill">
						<span class="live-dot"></span> Terminal Kiosk
					</span>
				</div>
				<p class="subtitle">Packing list dari pusat yang perlu disiapkan & diambil dari rak gudang</p>
			</div>
		</div>

		<div class="nav-right">
			<!-- View Mode Toggle -->
			<div class="view-switch" role="group" aria-label="Mode Tampilan">
				<button
					type="button"
					class="view-btn"
					class:active={viewMode === 'kanban'}
					onclick={() => setViewMode('kanban')}
					title="Tampilan Kanban Board"
				>
					<IconLayoutKanban size={17} />
					<span>Kanban</span>
				</button>
				<button
					type="button"
					class="view-btn"
					class:active={viewMode === 'list'}
					onclick={() => setViewMode('list')}
					title="Tampilan List"
				>
					<IconList size={17} />
					<span>List</span>
				</button>
			</div>

			<!-- Refresh Button & Status -->
			<div class="refresh-box">
				{#if lastUpdated}
					<span class="last-sync" title="Waktu pembaruan data terakhir">
						{lastUpdated}
					</span>
				{/if}
				<button
					class="refresh-btn"
					onclick={load}
					disabled={loading}
					title="Segarkan data antrian sekarang"
					aria-label="Segarkan data"
				>
					<IconRefresh size={18} class={loading ? 'spin' : ''} />
				</button>
			</div>
		</div>
	</header>

	{#if loading && rows.length === 0}
		<div class="py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Antrian Gudang..." sublabel="Mengambil pesanan siap muat" />
		</div>
	{:else if loadError && rows.length === 0}
		<div class="err-card">
			<IconAlertTriangle size={32} class="err-icon" />
			<div class="err-content">
				<h3>Gagal Mengambil Data Antrian</h3>
				<p>{loadError}</p>
			</div>
			<button class="retry-btn" onclick={load}>
				<IconRefresh size={16} /> Coba Lagi
			</button>
		</div>
	{:else if !hqEnabled}
		<div class="empty-state">
			<IconInbox size={36} />
			<h3>Modul Antrian Gudang Belum Diaktifkan</h3>
			<p>Hubungi admin untuk mengaktifkan integrasi gudang HQ.</p>
		</div>
	{:else}
		<!-- KPI EXECUTIVE RIBBON -->
		<section class="kpi-ribbon" aria-label="Ringkasan Antrian">
			<button
				class="kpi-card"
				class:selected={activeTab === 'semua' && !filterUrgentOnly}
				onclick={() => { resetFilters(); activeTab = 'semua'; }}
			>
				<div class="kpi-label">Total Antrian</div>
				<div class="kpi-val">{counts.semua}</div>
				<div class="kpi-foot">Semua PL aktif</div>
			</button>

			<button
				class="kpi-card kpi-card--pending"
				class:selected={activeTab === 'pending' && !filterUrgentOnly}
				onclick={() => { filterUrgentOnly = false; activeTab = 'pending'; }}
			>
				<div class="kpi-label">
					<IconClock size={14} /> Belum Disiapkan
				</div>
				<div class="kpi-val">{counts.pending}</div>
				<div class="kpi-foot">Menunggu diambil</div>
			</button>

			<button
				class="kpi-card kpi-card--picking"
				class:selected={activeTab === 'picking'}
				onclick={() => { filterUrgentOnly = false; activeTab = 'picking'; }}
			>
				<div class="kpi-label">
					<IconPackage size={14} /> Sedang Disiapkan
				</div>
				<div class="kpi-val">{counts.picking}</div>
				<div class="kpi-foot">Proses ambil di rak</div>
			</button>

			<button
				class="kpi-card kpi-card--urgent"
				class:selected={filterUrgentOnly}
				onclick={() => { filterUrgentOnly = !filterUrgentOnly; if (filterUrgentOnly) activeTab = 'urgent'; }}
			>
				<div class="kpi-label">
					<IconFlame size={14} /> Urgent / Kritis
				</div>
				<div class="kpi-val">{counts.urgent}</div>
				<div class="kpi-foot">Prioritas utama</div>
			</button>

			<button
				class="kpi-card kpi-card--packed"
				class:selected={activeTab === 'packed'}
				onclick={() => { filterUrgentOnly = false; activeTab = 'packed'; }}
			>
				<div class="kpi-label">
					<IconCircleCheck size={14} /> Siap Kirim
				</div>
				<div class="kpi-val">{counts.packed}</div>
				<div class="kpi-foot">Lengkap dipacking</div>
			</button>
		</section>

		<!-- FILTER & CONTROLS TOOLBAR -->
		<section class="toolbar">
			<div class="search-wrap">
				<IconSearch size={18} class="search-icon" />
				<input
					type="text"
					placeholder="Cari no. PL, nama PIC, proyek, divisi..."
					bind:value={searchQuery}
					aria-label="Cari antrian"
				/>
				{#if searchQuery}
					<button class="clear-search" onclick={() => (searchQuery = '')} aria-label="Hapus kata kunci">
						<IconX size={16} />
					</button>
				{/if}
			</div>

			<div class="filter-group">
				<!-- Urgency Toggle -->
				<button
					type="button"
					class="filter-pill"
					class:active={filterUrgentOnly}
					onclick={() => (filterUrgentOnly = !filterUrgentOnly)}
				>
					<IconFlame size={14} class="pill-icon-flame" />
					<span>Hanya Urgent</span>
					{#if counts.urgent > 0}
						<span class="pill-badge pill-badge--urgent">{counts.urgent}</span>
					{/if}
				</button>

				<!-- Request Type Filter -->
				<div class="type-filter-pills">
					<button
						type="button"
						class="filter-pill"
						class:active={filterRequestType === 'all'}
						onclick={() => (filterRequestType = 'all')}
					>
						Semua Tipe
					</button>
					<button
						type="button"
						class="filter-pill"
						class:active={filterRequestType === 'project'}
						onclick={() => (filterRequestType = 'project')}
					>
						Proyek
					</button>
					<button
						type="button"
						class="filter-pill"
						class:active={filterRequestType === 'maintenance'}
						onclick={() => (filterRequestType = 'maintenance')}
					>
						Maintenance
					</button>
					<button
						type="button"
						class="filter-pill"
						class:active={filterRequestType === 'internal'}
						onclick={() => (filterRequestType = 'internal')}
					>
						Internal
					</button>
				</div>

				<!-- Sort Dropdown -->
				<div class="sort-wrap">
					<select bind:value={sortBy} aria-label="Urutkan antrian">
						<option value="urgency_desc">Prioritas: Tertinggi</option>
						<option value="needed_asc">Deadline: Terdekat</option>
						<option value="pl_asc">Nomor PL</option>
					</select>
				</div>

				<!-- Reset Filters -->
				{#if searchQuery || filterUrgentOnly || filterRequestType !== 'all' || sortBy !== 'urgency_desc'}
					<button class="reset-btn" onclick={resetFilters} title="Reset semua filter">
						<IconX size={14} /> Reset
					</button>
				{/if}
			</div>
		</section>

		<!-- ACTIVE FILTER SUMMARY -->
		{#if filteredRows.length !== rows.length}
			<div class="filter-summary">
				<span>Menampilkan <strong>{filteredRows.length}</strong> dari {rows.length} packing list</span>
				<button class="filter-summary-reset" onclick={resetFilters}>Tampilkan semua</button>
			</div>
		{/if}

		<!-- VIEW: KANBAN BOARD -->
		{#if viewMode === 'kanban'}
			<div class="kanban-board">
				<!-- KOLOM 1: BELUM DISIAPKAN -->
				<div class="kanban-col kanban-col--pending">
					<div class="col-header">
						<div class="col-title-wrap">
							<div class="col-icon col-icon--pending">
								<IconClock size={16} />
							</div>
							<div>
								<div class="col-title">Belum Disiapkan</div>
								<div class="col-sub">Menunggu diambil di rak</div>
							</div>
						</div>
						<div class="col-badges">
							{#if pendingUrgentCount > 0}
								<span class="col-urg-badge" title={`${pendingUrgentCount} urgent di antrian ini`}>
									<IconFlame size={12} /> {pendingUrgentCount}
								</span>
							{/if}
							<span class="col-count-pill">{pendingRows.length}</span>
						</div>
					</div>

					<div class="col-cards">
						{#if pendingRows.length === 0}
							<div class="col-empty">
								<IconCheck size={24} />
								<p>Tidak ada antrian tertunda</p>
							</div>
						{:else}
							{#each pendingRows as r (r.id)}
								{@render kanbanCard(r, 'pending')}
							{/each}
						{/if}
					</div>
				</div>

				<!-- KOLOM 2: SEDANG DISIAPKAN -->
				<div class="kanban-col kanban-col--picking">
					<div class="col-header">
						<div class="col-title-wrap">
							<div class="col-icon col-icon--picking">
								<IconPackage size={16} />
							</div>
							<div>
								<div class="col-title">Sedang Disiapkan</div>
								<div class="col-sub">Proses pengambilan di rak</div>
							</div>
						</div>
						<div class="col-badges">
							{#if pickingUrgentCount > 0}
								<span class="col-urg-badge" title={`${pickingUrgentCount} urgent`}>
									<IconFlame size={12} /> {pickingUrgentCount}
								</span>
							{/if}
							<span class="col-count-pill col-count-pill--amber">{pickingRows.length}</span>
						</div>
					</div>

					<div class="col-cards">
						{#if pickingRows.length === 0}
							<div class="col-empty">
								<IconPackage size={24} />
								<p>Belum ada yang sedang disiapkan</p>
							</div>
						{:else}
							{#each pickingRows as r (r.id)}
								{@render kanbanCard(r, 'picking')}
							{/each}
						{/if}
					</div>
				</div>

				<!-- KOLOM 3: SIAP KIRIM -->
				<div class="kanban-col kanban-col--packed">
					<div class="col-header">
						<div class="col-title-wrap">
							<div class="col-icon col-icon--packed">
								<IconCircleCheck size={16} />
							</div>
							<div>
								<div class="col-title">Siap Kirim</div>
								<div class="col-sub">Lengkap, siap ekspedisi</div>
							</div>
						</div>
						<div class="col-badges">
							<span class="col-count-pill col-count-pill--green">{packedRows.length}</span>
						</div>
					</div>

					<div class="col-cards">
						{#if packedRows.length === 0}
							<div class="col-empty">
								<IconInbox size={24} />
								<p>Belum ada packing list selesai</p>
							</div>
						{:else}
							{#each packedRows as r (r.id)}
								{@render kanbanCard(r, 'packed')}
							{/each}
						{/if}
					</div>
				</div>
			</div>

		<!-- VIEW: LIST VIEW -->
		{:else}
			<!-- List Tabs Filter -->
			<div class="list-tabs-container">
				<div class="tabs">
					<button class="tab-btn" class:active={activeTab === 'pending'} onclick={() => (activeTab = 'pending')}>
						Perlu Disiapkan <span class="tab-badge">{counts.pending + counts.picking}</span>
					</button>
					<button class="tab-btn" class:active={activeTab === 'picking'} onclick={() => (activeTab = 'picking')}>
						Sedang Ambil <span class="tab-badge">{counts.picking}</span>
					</button>
					<button class="tab-btn" class:active={activeTab === 'urgent'} onclick={() => (activeTab = 'urgent')}>
						<IconFlame size={13} class="pill-icon-flame" /> Urgent <span class="tab-badge">{counts.urgent}</span>
					</button>
					<button class="tab-btn" class:active={activeTab === 'semua'} onclick={() => (activeTab = 'semua')}>
						Semua <span class="tab-badge">{counts.semua}</span>
					</button>
					<button class="tab-btn" class:active={activeTab === 'packed'} onclick={() => (activeTab = 'packed')}>
						Siap Kirim <span class="tab-badge">{counts.packed}</span>
					</button>
				</div>
			</div>

			<div class="list-view-wrap">
				{#if listViewRows.length === 0}
					<div class="empty-state">
						<IconInbox size={32} />
						<p>Tidak ada antrian yang sesuai kriteria pencarian/filter.</p>
					</div>
				{:else}
					<div class="list-cards">
						{#each listViewRows as r (r.id)}
							{@render listCard(r)}
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- ================= SNIPPETS / CARD TEMPLATES ================= -->

{#snippet kanbanCard(r: Row, colType: 'pending' | 'picking' | 'packed')}
	{@const urgent = isUrgent(r)}
	{@const due = getDueDateStatus(r.needed_date)}
	{@const typeStyle = TYPE_COLOR[r.request_type] || TYPE_COLOR.internal}
	{@const completedCount = r.items_completed ?? (r.prep_status === 'packed' ? r.item_count : 0)}
	{@const pct = r.item_count > 0 ? Math.min(100, Math.round((completedCount / r.item_count) * 100)) : 0}

	<div
		role="button"
		tabindex="0"
		class="k-card"
		class:k-card--urgent={urgent}
		onclick={() => goto(`/kiosk/gudang/antrian/${r.id}`)}
		onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') goto(`/kiosk/gudang/antrian/${r.id}`); }}
	>
		<!-- Card Top: PL & Badges -->
		<div class="k-card__top">
			<div class="k-card__id-box">
				<span class="k-card__pl">{r.nomor_pl}</span>
			</div>
			<div class="k-card__top-tags">
				{#if urgent}
					<span class="k-urg-tag">
						<IconFlame size={12} /> URGENT
					</span>
				{/if}
				<span
					class="k-type-tag"
					style="background: {typeStyle.bg}; color: {typeStyle.text}; border-color: {typeStyle.border};"
				>
					{TYPE_LABEL[r.request_type] || r.request_type || 'Internal'}
				</span>
			</div>
		</div>

		<!-- Card Body: Target PIC & Dept -->
		<div class="k-card__body">
			{#if r.destination_pic_name}
				<div class="k-card__info-row">
					<IconUser size={14} class="info-icon" />
					<span class="info-text">
						utk <strong>{r.destination_pic_name}</strong>
					</span>
				</div>
			{/if}
			{#if r.requested_by_department}
				<div class="k-card__info-row k-card__info-row--sub">
					<span class="dept-bullet">•</span>
					<span class="dept-text">{r.requested_by_department}</span>
				</div>
			{/if}
		</div>

		<!-- Progress Bar for Picking / Partial -->
		{#if colType === 'picking' || completedCount > 0}
			<div class="k-card__progress">
				<div class="k-card__progress-label">
					<span>Progress Ambil</span>
					<strong>{completedCount} / {r.item_count} item ({pct}%)</strong>
				</div>
				<div class="k-progress-bar">
					<div class="k-progress-fill" style="width: {pct}%"></div>
				</div>
			</div>
		{:else}
			<div class="k-card__item-count-badge">
				<IconPackage size={13} />
				<span>{r.item_count} item barang</span>
			</div>
		{/if}

		<!-- Card Footer: Due Date & Action Button -->
		<div class="k-card__foot">
			<div class="k-card__due">
				{#if due}
					<span class="due-chip" class:due-chip--overdue={due.type === 'overdue'} class:due-chip--today={due.type === 'today'}>
						{#if due.type === 'overdue'}
							<IconAlertTriangle size={12} />
						{:else if due.type === 'today'}
							<IconClock size={12} />
						{:else}
							<IconCalendar size={12} />
						{/if}
						{due.text}
					</span>
				{:else}
					<span class="due-chip due-chip--none">Bebas jadwal</span>
				{/if}
			</div>

			<!-- Action CTA Button -->
			<button
				type="button"
				class="k-card__cta-btn"
				class:k-card__cta-btn--orange={colType === 'pending'}
				class:k-card__cta-btn--amber={colType === 'picking'}
				class:k-card__cta-btn--green={colType === 'packed'}
				onclick={(e) => { e.stopPropagation(); goto(`/kiosk/gudang/antrian/${r.id}`); }}
			>
				{#if colType === 'pending'}
					<span>Mulai Ambil</span>
					<IconArrowRight size={14} />
				{:else if colType === 'picking'}
					<span>Lanjutkan</span>
					<IconArrowRight size={14} />
				{:else}
					<span>Detail</span>
					<IconChevronRight size={14} />
				{/if}
			</button>
		</div>
	</div>
{/snippet}

{#snippet listCard(r: Row)}
	{@const urgent = isUrgent(r)}
	{@const due = getDueDateStatus(r.needed_date)}
	{@const typeStyle = TYPE_COLOR[r.request_type] || TYPE_COLOR.internal}
	{@const completedCount = r.items_completed ?? (r.prep_status === 'packed' ? r.item_count : 0)}
	{@const pct = r.item_count > 0 ? Math.min(100, Math.round((completedCount / r.item_count) * 100)) : 0}

	<div
		role="button"
		tabindex="0"
		class="list-card"
		class:list-card--urgent={urgent}
		onclick={() => goto(`/kiosk/gudang/antrian/${r.id}`)}
		onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') goto(`/kiosk/gudang/antrian/${r.id}`); }}
	>
		<div class="list-card__main">
			<div class="list-card__top">
				<span class="list-card__pl">{r.nomor_pl}</span>
				{#if urgent}
					<span class="k-urg-tag">
						<IconFlame size={12} /> URGENT
					</span>
				{/if}
				<span
					class="k-type-tag"
					style="background: {typeStyle.bg}; color: {typeStyle.text}; border-color: {typeStyle.border};"
				>
					{TYPE_LABEL[r.request_type] || r.request_type || 'Internal'}
				</span>
			</div>

			<div class="list-card__details">
				<span class="list-card__meta">
					{#if r.destination_pic_name}
						utk <strong>{r.destination_pic_name}</strong>
					{/if}
					{#if r.requested_by_department}
						<span class="dot-sep">•</span> {r.requested_by_department}
					{/if}
				</span>
				<span class="list-card__items-label">
					<strong>{r.item_count} item</strong>
					{#if completedCount > 0}
						({completedCount} diambil)
					{/if}
				</span>
			</div>

			<div class="list-card__bottom">
				<span class="status-pill" style="color: {PREP_COLOR[r.prep_status] || '#64748b'}">
					● {PREP_LABEL[r.prep_status] || r.prep_status}
				</span>
				{#if due}
					<span class="due-chip" class:due-chip--overdue={due.type === 'overdue'} class:due-chip--today={due.type === 'today'}>
						{due.text}
					</span>
				{/if}
			</div>
		</div>

		<div class="list-card__action">
			<button
				type="button"
				class="list-action-btn"
				onclick={(e) => { e.stopPropagation(); goto(`/kiosk/gudang/antrian/${r.id}`); }}
			>
				<span>Buka</span>
				<IconChevronRight size={16} />
			</button>
		</div>
	</div>
{/snippet}

<style>
	/* SHELL & CONTAINER */
	.wrap {
		padding: 1.25rem 1.5rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		width: 100%;
		box-sizing: border-box;
	}
	.wrap-kanban {
		max-width: 1440px;
		margin: 0 auto;
	}

	/* TOP NAVIGATION */
	.top-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.25rem;
		flex-wrap: wrap;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid #e2e8f0;
	}
	.nav-left {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		flex-wrap: wrap;
	}
	.back-btn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		background: white;
		border: 1px solid #cbd5e1;
		border-radius: 0.65rem;
		padding: 0.55rem 0.95rem;
		color: #334155;
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s;
		box-shadow: 0 1px 2px rgba(0,0,0,0.04);
	}
	.back-btn:hover {
		background: #f1f5f9;
		color: #0f172a;
		border-color: #94a3b8;
	}
	.title-group {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.title-row h1 {
		font-size: 1.35rem;
		font-weight: 800;
		color: #0f172a;
		margin: 0;
		letter-spacing: -0.01em;
	}
	.live-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: #f0fdf4;
		color: #15803d;
		border: 1px solid #bbf7d0;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
	}
	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: #22c55e;
		box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25);
	}
	.subtitle {
		font-size: 0.85rem;
		color: #64748b;
		margin: 0;
	}

	.nav-right {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		margin-left: auto;
	}
	.view-switch {
		display: flex;
		background: #e2e8f0;
		padding: 0.25rem;
		border-radius: 0.65rem;
		gap: 0.2rem;
	}
	.view-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		border: none;
		background: transparent;
		color: #64748b;
		padding: 0.45rem 0.85rem;
		border-radius: 0.5rem;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s;
	}
	.view-btn.active {
		background: white;
		color: #0f172a;
		box-shadow: 0 1px 3px rgba(0,0,0,0.08);
	}
	.refresh-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.last-sync {
		font-size: 0.78rem;
		font-weight: 600;
		color: #64748b;
		font-variant-numeric: tabular-nums;
	}
	.refresh-btn {
		width: 38px;
		height: 38px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: white;
		border: 1px solid #cbd5e1;
		border-radius: 0.65rem;
		color: #475569;
		cursor: pointer;
		transition: all 0.15s;
	}
	.refresh-btn:hover {
		background: #f8fafc;
		color: #0f172a;
		border-color: #94a3b8;
	}

	/* KPI EXECUTIVE RIBBON */
	.kpi-ribbon {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 0.75rem;
	}
	.kpi-card {
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 0.85rem;
		padding: 0.85rem 1rem;
		text-align: left;
		cursor: pointer;
		transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		box-shadow: 0 1px 3px rgba(0,0,0,0.03);
	}
	.kpi-card:hover {
		transform: translateY(-2px);
		border-color: #cbd5e1;
		box-shadow: 0 4px 10px rgba(0,0,0,0.05);
	}
	.kpi-card.selected {
		border-color: #0f172a;
		box-shadow: 0 0 0 2px #0f172a;
		background: #f8fafc;
	}
	.kpi-label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.76rem;
		font-weight: 700;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.kpi-val {
		font-size: 1.7rem;
		font-weight: 850;
		color: #0f172a;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.kpi-foot {
		font-size: 0.75rem;
		color: #94a3b8;
	}

	.kpi-card--pending .kpi-val { color: #334155; }
	.kpi-card--picking .kpi-val { color: #d97706; }
	.kpi-card--urgent .kpi-val { color: #dc2626; }
	.kpi-card--urgent { border-left: 4px solid #dc2626; }
	.kpi-card--packed .kpi-val { color: #16a34a; }

	/* TOOLBAR & FILTERS */
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
	}
	.search-wrap {
		flex: 1;
		min-width: 260px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: white;
		border: 1px solid #cbd5e1;
		border-radius: 0.75rem;
		padding: 0.6rem 0.9rem;
		box-shadow: 0 1px 2px rgba(0,0,0,0.02);
	}
	.search-wrap:focus-within {
		border-color: #0f766e;
		box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.15);
	}
	.search-wrap input {
		flex: 1;
		border: none;
		outline: none;
		font-size: 0.92rem;
		color: #0f172a;
		background: transparent;
	}
	:global(.search-icon) {
		color: #94a3b8;
		flex-shrink: 0;
	}
	.clear-search {
		background: none;
		border: none;
		color: #94a3b8;
		cursor: pointer;
		padding: 0;
		display: flex;
	}

	.filter-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.type-filter-pills {
		display: flex;
		gap: 0.25rem;
		background: #f1f5f9;
		padding: 0.2rem;
		border-radius: 0.65rem;
	}
	.filter-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid transparent;
		background: transparent;
		color: #475569;
		border-radius: 0.5rem;
		padding: 0.4rem 0.75rem;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}
	.filter-pill:hover {
		color: #0f172a;
	}
	.filter-pill.active {
		background: white;
		color: #0f172a;
		border-color: #cbd5e1;
		box-shadow: 0 1px 2px rgba(0,0,0,0.05);
	}
	:global(.pill-icon-flame) {
		color: #dc2626;
	}
	.pill-badge {
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
		font-size: 0.7rem;
		font-weight: 800;
	}
	.pill-badge--urgent {
		background: #fee2e2;
		color: #b91c1c;
	}
	.sort-wrap select {
		height: 36px;
		padding: 0 0.75rem;
		border-radius: 0.65rem;
		border: 1px solid #cbd5e1;
		background: white;
		font-size: 0.82rem;
		font-weight: 700;
		color: #334155;
		cursor: pointer;
		outline: none;
	}
	.reset-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px dashed #cbd5e1;
		background: white;
		color: #64748b;
		padding: 0.4rem 0.75rem;
		border-radius: 0.65rem;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
	}
	.reset-btn:hover {
		background: #f8fafc;
		color: #dc2626;
		border-color: #fca5a5;
	}

	.filter-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.82rem;
		color: #64748b;
		background: #f1f5f9;
		padding: 0.45rem 0.85rem;
		border-radius: 0.55rem;
	}
	.filter-summary-reset {
		background: none;
		border: none;
		color: #0f766e;
		font-weight: 700;
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
	}

	/* KANBAN BOARD */
	.kanban-board {
		display: grid;
		grid-template-columns: repeat(3, minmax(320px, 1fr));
		gap: 1.25rem;
		align-items: start;
		overflow-x: auto;
		padding-bottom: 1.5rem;
	}
	@media (max-width: 1024px) {
		.kanban-board {
			grid-template-columns: repeat(3, 330px);
		}
	}

	.kanban-col {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 1rem;
		display: flex;
		flex-direction: column;
		min-height: 480px;
		box-shadow: 0 1px 3px rgba(0,0,0,0.02);
	}
	.kanban-col--pending {
		border-top: 4px solid #64748b;
	}
	.kanban-col--picking {
		border-top: 4px solid #f59e0b;
		background: #fffdfa;
	}
	.kanban-col--packed {
		border-top: 4px solid #22c55e;
		background: #fbfdfb;
	}

	.col-header {
		padding: 1rem 1.1rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid #e2e8f0;
		background: rgba(255, 255, 255, 0.7);
		border-top-left-radius: calc(1rem - 4px);
		border-top-right-radius: calc(1rem - 4px);
	}
	.col-title-wrap {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}
	.col-icon {
		width: 32px;
		height: 32px;
		border-radius: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.col-icon--pending { background: #f1f5f9; color: #475569; }
	.col-icon--picking { background: #fef3c7; color: #b45309; }
	.col-icon--packed { background: #dcfce7; color: #15803d; }

	.col-title {
		font-size: 0.96rem;
		font-weight: 800;
		color: #0f172a;
		line-height: 1.2;
	}
	.col-sub {
		font-size: 0.72rem;
		color: #64748b;
	}
	.col-badges {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.col-urg-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		background: #fee2e2;
		color: #b91c1c;
		border-radius: 999px;
		padding: 0.15rem 0.45rem;
		font-size: 0.72rem;
		font-weight: 800;
	}
	.col-count-pill {
		background: #e2e8f0;
		color: #334155;
		font-size: 0.75rem;
		font-weight: 800;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
	}
	.col-count-pill--amber {
		background: #fef3c7;
		color: #92400e;
	}
	.col-count-pill--green {
		background: #dcfce7;
		color: #166534;
	}

	.col-cards {
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		flex: 1;
	}
	.col-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 1rem;
		color: #94a3b8;
		gap: 0.5rem;
		text-align: center;
		font-size: 0.85rem;
		font-weight: 600;
	}

	/* KANBAN CARD */
	.k-card {
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 0.85rem;
		padding: 0.95rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		cursor: pointer;
		transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
		box-shadow: 0 1px 3px rgba(0,0,0,0.03);
		user-select: none;
	}
	.k-card:hover {
		border-color: #cbd5e1;
		box-shadow: 0 4px 12px rgba(0,0,0,0.06);
		transform: translateY(-2px);
	}
	.k-card:active {
		transform: scale(0.99);
	}
	.k-card--urgent {
		border-left: 4px solid #dc2626;
		background: #fffafa;
	}

	.k-card__top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.k-card__pl {
		font-size: 1.05rem;
		font-weight: 850;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.k-card__top-tags {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.k-urg-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		background: #fee2e2;
		color: #b91c1c;
		border-radius: 0.35rem;
		padding: 0.15rem 0.45rem;
		font-size: 0.68rem;
		font-weight: 850;
	}
	.k-type-tag {
		display: inline-block;
		border-radius: 0.35rem;
		padding: 0.15rem 0.45rem;
		font-size: 0.72rem;
		font-weight: 700;
		border: 1px solid transparent;
	}

	.k-card__body {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.k-card__info-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: #334155;
	}
	:global(.info-icon) {
		color: #64748b;
		flex-shrink: 0;
	}
	.k-card__info-row--sub {
		font-size: 0.78rem;
		color: #64748b;
		padding-left: 0.25rem;
	}
	.dept-bullet {
		color: #94a3b8;
	}

	/* Progress bar inside card */
	.k-card__progress {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		background: #f8fafc;
		padding: 0.5rem 0.65rem;
		border-radius: 0.55rem;
		border: 1px solid #e2e8f0;
	}
	.k-card__progress-label {
		display: flex;
		justify-content: space-between;
		font-size: 0.74rem;
		color: #475569;
	}
	.k-progress-bar {
		width: 100%;
		height: 6px;
		background: #e2e8f0;
		border-radius: 999px;
		overflow: hidden;
	}
	.k-progress-fill {
		height: 100%;
		background: #f59e0b;
		border-radius: 999px;
		transition: width 0.3s ease;
	}

	.k-card__item-count-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		font-weight: 700;
		color: #475569;
	}

	.k-card__foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding-top: 0.4rem;
		border-top: 1px solid #f1f5f9;
		margin-top: 0.1rem;
	}
	.due-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.76rem;
		font-weight: 700;
		color: #64748b;
		background: #f1f5f9;
		padding: 0.2rem 0.5rem;
		border-radius: 0.4rem;
	}
	.due-chip--overdue {
		background: #fee2e2;
		color: #dc2626;
		font-weight: 800;
	}
	.due-chip--today {
		background: #fef3c7;
		color: #b45309;
		font-weight: 800;
	}
	.due-chip--none {
		color: #94a3b8;
		background: transparent;
	}

	.k-card__cta-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.8rem;
		border-radius: 0.55rem;
		border: none;
		font-size: 0.82rem;
		font-weight: 800;
		cursor: pointer;
		transition: all 0.15s;
		touch-action: manipulation;
		min-height: 38px;
	}
	.k-card__cta-btn--orange {
		background: #ea580c;
		color: white;
	}
	.k-card__cta-btn--orange:hover {
		background: #c2410c;
	}
	.k-card__cta-btn--amber {
		background: #f59e0b;
		color: #1e293b;
	}
	.k-card__cta-btn--amber:hover {
		background: #d97706;
		color: white;
	}
	.k-card__cta-btn--green {
		background: #16a34a;
		color: white;
	}
	.k-card__cta-btn--green:hover {
		background: #15803d;
	}

	/* LIST VIEW WRAPPER */
	.list-tabs-container {
		max-width: 960px;
		margin: 0 auto;
		width: 100%;
	}
	.list-view-wrap {
		max-width: 960px;
		margin: 0 auto;
		width: 100%;
	}
	.tabs {
		display: flex;
		gap: 0.35rem;
		overflow-x: auto;
		padding-bottom: 0.2rem;
	}
	.tab-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid #cbd5e1;
		background: white;
		color: #475569;
		border-radius: 999px;
		padding: 0.45rem 0.85rem;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.tab-btn.active {
		background: #0f172a;
		color: white;
		border-color: #0f172a;
	}
	.tab-badge {
		background: rgba(100, 116, 139, 0.15);
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
		font-size: 0.7rem;
	}
	.tab-btn.active .tab-badge {
		background: rgba(255, 255, 255, 0.25);
		color: white;
	}

	.list-cards {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.list-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 0.85rem;
		padding: 1rem 1.25rem;
		cursor: pointer;
		transition: all 0.15s ease;
		box-shadow: 0 1px 2px rgba(0,0,0,0.02);
	}
	.list-card:hover {
		border-color: #cbd5e1;
		box-shadow: 0 3px 10px rgba(0,0,0,0.05);
	}
	.list-card--urgent {
		border-left: 4px solid #dc2626;
	}
	.list-card__main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.list-card__top {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.list-card__pl {
		font-size: 1.05rem;
		font-weight: 850;
		color: #0f172a;
	}
	.list-card__details {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.85rem;
		color: #475569;
		flex-wrap: wrap;
	}
	.dot-sep {
		color: #94a3b8;
		margin: 0 0.15rem;
	}
	.list-card__items-label {
		color: #0f766e;
	}
	.list-card__bottom {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		margin-top: 0.15rem;
		flex-wrap: wrap;
	}
	.status-pill {
		font-size: 0.8rem;
		font-weight: 700;
	}
	.list-action-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
		color: #334155;
		border-radius: 0.55rem;
		padding: 0.5rem 0.85rem;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
	}
	.list-action-btn:hover {
		background: #0f172a;
		color: white;
		border-color: #0f172a;
	}

	/* COMMON STATES */
	.center-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 4rem 1rem;
		color: #64748b;
		font-size: 0.95rem;
		font-weight: 600;
	}
	:global(.spin) {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.err-card {
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 0.85rem;
		padding: 1.5rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	:global(.err-icon) {
		color: #dc2626;
		flex-shrink: 0;
	}
	.err-content {
		flex: 1;
		min-width: 200px;
	}
	.err-content h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 800;
		color: #991b1b;
	}
	.err-content p {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: #b91c1c;
	}
	.retry-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: white;
		border: 1px solid #f87171;
		color: #991b1b;
		border-radius: 0.6rem;
		padding: 0.5rem 0.9rem;
		font-weight: 700;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 4rem 1rem;
		color: #94a3b8;
		text-align: center;
	}
	.empty-state h3 {
		font-size: 1.05rem;
		font-weight: 700;
		color: #475569;
		margin: 0;
	}
	.empty-state p {
		font-size: 0.88rem;
		margin: 0;
	}
</style>
