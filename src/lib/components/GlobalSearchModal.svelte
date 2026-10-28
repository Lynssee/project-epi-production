<!-- src/lib/components/GlobalSearchModal.svelte -->
<!-- F2 — Command palette pencarian data (Ctrl/Cmd+K). Menembak /api/search
     (jalur A live fan-out) dan mengelompokkan hasil per entitas. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { modulDokumentasi } from '$lib/data/panduan';
	import { FIELD_NAV_ITEMS, type FieldNavItem } from '$lib/data/fieldNavConfig';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import {
		matchQuery,
		highlightTokens,
		tokenize,
		scoreNavEntry,
		expandTokensWithSynonyms
	} from '$lib/utils/searchMatch';
	import { IconSearch, IconX } from '@tabler/icons-svelte';

	let open = $state(false);
	let query = $state('');
	let loading = $state(false);
	let serverGroups: { entity: string; results: any[]; fallback?: boolean }[] = $state([]);
	let activeIndex = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// F6 — Pencarian terakhir, disimpan lokal agar tersedia saat modal dibuka kosong.
	const RECENT_SEARCH_KEY = 'lapangan_recent_searches';
	const MAX_RECENT_SEARCHES = 6;
	let recentSearches: string[] = $state([]);

	function loadRecentSearches() {
		try {
			recentSearches = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '[]');
		} catch {
			recentSearches = [];
		}
	}

	function recordRecentSearch(q: string) {
		if (!q || q.length < 2) return;
		const next = [q, ...recentSearches.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES);
		recentSearches = next;
		localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
	}

	function canView(permissions?: (FeatureKey | string)[]): boolean {
		if ($authStore.roleId === 'super_admin') return true;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some((p) => hasPermission($authStore.roleId, p as FeatureKey, $rolesStore, $authStore.roleIds));
	}

	// 1. Menu & Fitur Navigasi Lapangan (client-side, instan, offline-ready)
	function searchMenuClient(q: string) {
		const tokens = tokenize(q);
		const expanded = expandTokensWithSynonyms(tokens);
		const matches: any[] = [];

		for (const item of FIELD_NAV_ITEMS) {
			if (item.permissions && !canView(item.permissions)) continue;
			const score = scoreNavEntry(
				{
					title: item.title,
					parent: item.parent,
					keywords: item.keywords,
					href: item.href
				},
				q,
				tokens,
				expanded
			);
			if (score > 0) {
				matches.push({
					entity: 'Menu & Fitur',
					source: 'menu',
					id: item.id,
					title: item.title,
					subtitle: item.parent,
					score,
					url: item.href
				});
			}
		}

		return matches.sort((a, b) => b.score - a.score).slice(0, 8);
	}

	// 2. Panduan & Dokumentasi (client-side, offline-ready)
	function searchPanduanClient(q: string) {
		const tokens = tokenize(q);
		const expanded = expandTokensWithSynonyms(tokens);
		const matches: any[] = [];

		for (const m of modulDokumentasi) {
			const score = scoreNavEntry(
				{
					title: m.nama,
					parent: m.kategori,
					keywords: m.deskripsi,
					href: m.href
				},
				q,
				tokens,
				expanded
			);
			if (score > 0) {
				matches.push({
					entity: 'Panduan & SOP',
					source: 'panduan',
					id: m.id,
					title: m.nama,
					subtitle: m.deskripsi,
					score,
					url: m.href
				});
			}
		}

		return matches.sort((a, b) => b.score - a.score).slice(0, 8);
	}

	// Gabungan hasil Menu + Panduan + Data Server
	const groups = $derived.by(() => {
		const q = query.trim();
		if (q.length < 2) return [];
		const menuResults = searchMenuClient(q);
		const panduanResults = searchPanduanClient(q);
		const withoutPanduan = serverGroups.filter((g) => g.entity !== 'Panduan' && g.entity !== 'Panduan & SOP');
		
		const list: { entity: string; results: any[]; fallback?: boolean }[] = [];
		if (menuResults.length) {
			list.push({ entity: 'Menu & Fitur Lapangan', results: menuResults });
		}
		if (panduanResults.length) {
			list.push({ entity: 'Panduan & SOP', results: panduanResults });
		}
		return [...list, ...withoutPanduan];
	});

	const ENTITY_ROUTE: Record<string, string> = {
		projects: '/proyek',
		work_order: '/maintenance/work-order',
		equipment: '/maintenance',
		maint_tickets: '/maintenance',
		identitas_barang: '/stock-lapangan',
		surat_jalan: '/lacak-sj',
		pengajuan_anggaran: '/pusat-pengajuan',
		karyawan: '/manpower'
	};

	function resultHref(item: any): string {
		if (item.url) return item.url;
		if (item.source === 'projects') return `/proyek/${item.id}`;
		if (item.source === 'work_order') return `/maintenance/work-order/${item.id}`;
		if (item.source === 'surat_jalan') return `/lacak-sj?q=${encodeURIComponent(item.title)}`;
		if (item.source === 'pengajuan_anggaran') return `/pusat-pengajuan`;
		if (item.source === 'karyawan') return `/manpower`;
		return ENTITY_ROUTE[item.source] || '/';
	}

	const flatResults = $derived(groups.flatMap((g) => g.results));

	$effect(() => {
		if (activeIndex >= flatResults.length) activeIndex = 0;
	});

	async function runSearch(q: string) {
		loading = true;
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!res.ok) {
				serverGroups = [];
				return;
			}
			const body = await res.json();
			serverGroups = body.groups || [];
		} catch (e) {
			console.error('[GlobalSearchModal] gagal memuat hasil:', e);
			serverGroups = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const q = query.trim();
		clearTimeout(debounceTimer);
		if (q.length >= 2 && open) {
			debounceTimer = setTimeout(() => runSearch(q), 250);
		} else {
			serverGroups = [];
		}
	});

	function openModal() {
		open = true;
		query = '';
		serverGroups = [];
		activeIndex = 0;
		loadRecentSearches();
		queueMicrotask(() => inputEl?.focus());
	}

	function closeModal() {
		open = false;
		query = '';
		serverGroups = [];
	}

	function rerunRecentSearch(q: string) {
		query = q;
		activeIndex = 0;
	}

	function selectResult(item: any) {
		if (!item) return;
		recordRecentSearch(query.trim());
		closeModal();
		goto(resultHref(item));
	}

	function escapeHtml(str: string): string {
		return String(str ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	// F5 — highlight semua token yang cocok (bukan cuma substring pertama).
	function highlightMulti(text: string, tokens: string[]): string {
		if (!text) return '';
		return highlightTokens(text, tokens)
			.map((seg) =>
				seg.match
					? `<mark style='background:var(--gl);color:var(--sys-label);border-radius:2px'>${escapeHtml(seg.text)}</mark>`
					: escapeHtml(seg.text)
			)
			.join('');
	}

	const queryTokens = $derived(tokenize(query.trim()));
	const totalResultCount = $derived(groups.reduce((sum, g) => sum + g.results.length, 0));
	const hasFallback = $derived(groups.some((g: any) => g.fallback));

	function handleModalKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeModal();
			return;
		}
		if (!flatResults.length) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = (activeIndex + 1) % flatResults.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = (activeIndex - 1 + flatResults.length) % flatResults.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			selectResult(flatResults[activeIndex]);
		}
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		const key = (e.key || '').toLowerCase();
		if ((e.metaKey || e.ctrlKey) && key === 'k') {
			e.preventDefault();
			open ? closeModal() : openModal();
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleGlobalKeydown);
		const handleOpenSearch = () => openModal();
		window.addEventListener('open-global-search', handleOpenSearch);
		return () => {
			window.removeEventListener('keydown', handleGlobalKeydown);
			window.removeEventListener('open-global-search', handleOpenSearch);
		};
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="search-overlay"
		onclick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
	>
		<div class="search-panel">
			<div class="search-input-row">
				<IconSearch size={16} color="var(--sys-label3)" />
				<input
					bind:this={inputEl}
					type="text"
					bind:value={query}
					oninput={() => (activeIndex = 0)}
					onkeydown={handleModalKeydown}
					placeholder="Cari menu, fitur, proyek, work order, equipment, panduan..."
					class="search-input"
				/>
				<button type="button" class="search-close" onclick={closeModal} aria-label="Tutup pencarian">
					<IconX size={16} />
				</button>
			</div>

			<div class="search-results">
				{#if query.trim().length < 2}
					{#if recentSearches.length}
						<div class="search-group-label">Pencarian Terakhir</div>
						<div class="search-recent-chips">
							{#each recentSearches as q}
								<button type="button" class="search-recent-chip" onclick={() => rerunRecentSearch(q)}>{q}</button>
							{/each}
						</div>
					{:else}
						<div class="search-empty">Ketik minimal 2 karakter untuk mencari...</div>
					{/if}
				{:else if loading && !groups.length}
					<div class="search-empty">Mencari...</div>
				{:else if !groups.length}
					<div class="search-empty">Tidak ditemukan.</div>
				{:else}
					<div class="search-result-count">
						Menampilkan {totalResultCount} hasil
						{#if hasFallback}
							<span class="search-fallback-hint">· sebagian hasil terkait (tidak semua kata cocok persis)</span>
						{/if}
					</div>
					{#each groups as group (group.entity)}
						<div class="search-group-label">
							{group.entity}
							{#if (group as any).fallback}<span class="search-fallback-hint">· Hasil terkait</span>{/if}
						</div>
						{#each group.results as item (item.source + '-' + item.id)}
							{@const idx = flatResults.indexOf(item)}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								role="button"
								tabindex="0"
								class="search-result-row {idx === activeIndex ? 'active' : ''}"
								onclick={() => selectResult(item)}
								onmouseenter={() => (activeIndex = idx)}
							>
								<span class="search-result-dot"></span>
								<span class="search-result-text">
									<span class="search-result-title">{@html highlightMulti(item.title, queryTokens)}</span>
									{#if item.subtitle}<span class="search-result-subtitle"> · {@html highlightMulti(item.subtitle, queryTokens)}</span>{/if}
								</span>
							</div>
						{/each}
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.search-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.4);
		z-index: 200;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 5rem 1rem 1rem;
	}
	.search-panel {
		width: 100%;
		max-width: 34rem;
		background: var(--sys-bg2);
		border: 1px solid var(--sys-sep);
		border-radius: 1rem;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
		overflow: hidden;
	}
	.search-input-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--sys-sep);
	}
	.search-input {
		flex: 1;
		border: none;
		outline: none;
		background: transparent;
		font-size: 0.9rem;
		color: var(--sys-label);
	}
	.search-input::placeholder {
		color: var(--sys-label3);
	}
	.search-close {
		background: none;
		border: none;
		color: var(--sys-label3);
		cursor: pointer;
		display: flex;
		padding: 0.25rem;
	}
	.search-results {
		max-height: 24rem;
		overflow-y: auto;
		padding: 0.5rem 0;
	}
	.search-empty {
		text-align: center;
		padding: 2rem 1rem;
		font-size: 0.8rem;
		color: var(--sys-label3);
	}
	.search-group-label {
		padding: 0.5rem 1rem 0.25rem;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--sys-label3);
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	.search-result-count {
		padding: 0.5rem 1rem 0;
		font-size: 0.7rem;
		color: var(--sys-label3);
	}
	.search-fallback-hint {
		text-transform: none;
		font-weight: 500;
		letter-spacing: normal;
		color: #b45309;
	}
	.search-recent-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding: 0 1rem 0.5rem;
	}
	.search-recent-chip {
		padding: 0.3rem 0.7rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		background: var(--sys-fill);
		color: var(--sys-label2);
		border: none;
		cursor: pointer;
	}
	.search-recent-chip:hover {
		background: var(--sys-fill2);
	}
	.search-result-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 1rem;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.search-result-row:hover,
	.search-result-row.active {
		background: var(--sys-fill);
	}
	.search-result-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--sys-sep);
		flex-shrink: 0;
	}
	.search-result-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.search-result-title {
		font-weight: 600;
		color: var(--sys-label);
	}
	.search-result-subtitle {
		color: var(--sys-label3);
	}
</style>
