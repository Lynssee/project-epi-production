<!-- src/lib/components/anggaran/CategoryPicker.svelte
     Pengajuan Anggaran v3, Fase 3: kartu pemilih kategori.
     Dilengkapi Live Search cerdas dan Clue Pengeluaran agar pengaju lapangan
     mudah menemukan kategori anggaran yang tepat. -->
<script lang="ts">
	import type { BudgetCategory } from '$lib/services/budgetCategory';
	import { getCategoryClue, matchCategorySearch, categorySearchResult } from '$lib/data/budgetCategoryClues';

	let {
		categories = [],
		selectedKode = $bindable(null),
		departmentCode = null,
		onSelect
	}: {
		categories: BudgetCategory[];
		selectedKode: string | null;
		departmentCode?: string | null;
		onSelect?: (cat: BudgetCategory) => void;
	} = $props();

	let searchQuery = $state('');

	function inScope(cat: BudgetCategory) {
		if (!cat.dept_scope || cat.dept_scope.length === 0) return true;
		if (!departmentCode) return true;
		const target = departmentCode.trim().toUpperCase();
		return cat.dept_scope.some((s) => s.trim().toUpperCase() === target);
	}

	let topLevel = $derived(categories.filter((c) => !c.parent_id && inScope(c)));
	let childrenByParent = $derived(
		categories.reduce((acc: Record<number, BudgetCategory[]>, c) => {
			if (c.parent_id && inScope(c)) (acc[c.parent_id] = acc[c.parent_id] || []).push(c);
			return acc;
		}, {})
	);

	function isCategoryMatched(cat: BudgetCategory, query: string) {
		if (!query.trim()) return true;
		if (matchCategorySearch(cat, query)) return true;
		const children = childrenByParent[cat.id] || [];
		return children.some((child) => matchCategorySearch(child, query));
	}

	// R6: hasil pencarian diurutkan dari yang paling relevan; kartu menampilkan keyword yang cocok (mis. ketik "kir" -> Legal & Perizinan).
	function bestHit(cat: BudgetCategory, query: string) {
		let best: { score: number; hint: string | null; via: string | null } = { ...categorySearchResult(cat, query), via: null };
		for (const child of childrenByParent[cat.id] || []) {
			const r = categorySearchResult(child, query);
			if (r.score > best.score) best = { ...r, via: child.nama };
		}
		return best;
	}
	let filteredTopLevel = $derived.by(() => {
		const list = topLevel.filter((c) => isCategoryMatched(c, searchQuery));
		if (!searchQuery.trim()) return list;
		return [...list].sort((a, b) => bestHit(b, searchQuery).score - bestHit(a, searchQuery).score);
	});

	let expandedParent = $state<number | null>(null);

	$effect(() => {
		if (searchQuery.trim()) {
			const matchedParent = topLevel.find((cat) => {
				const children = childrenByParent[cat.id] || [];
				return children.some((child) => matchCategorySearch(child, searchQuery));
			});
			if (matchedParent) {
				expandedParent = matchedParent.id;
			}
		}
	});

	function pick(cat: BudgetCategory) {
		selectedKode = cat.kode;
		onSelect?.(cat);
	}

	function toggleExpand(parentId: number) {
		expandedParent = expandedParent === parentId ? null : parentId;
	}

	function getActiveChildName(parentId: number) {
		const children = childrenByParent[parentId] || [];
		const active = children.find((c) => c.kode === selectedKode);
		return active ? active.nama : null;
	}
</script>

<div class="space-y-2.5">
	<!-- Search bar -->
	<div class="relative">
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="🔍 Cari kategori / pengeluaran (bensin, tiket, laptop, genset, tukang)..."
			class="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg border border-gray-200 bg-gray-50/80 text-gray-800 placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-[var(--p)]/20 focus:border-[var(--p)] outline-none transition-all"
		/>
		{#if searchQuery}
			<button
				type="button"
				onclick={() => (searchQuery = '')}
				class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs p-1"
				title="Hapus pencarian"
			>✕</button>
		{/if}
	</div>

	<!-- Category Grid -->
	<div class="grid grid-cols-2 gap-2">
		{#each filteredTopLevel as cat (cat.id)}
			{@const children = childrenByParent[cat.id] || []}
			{@const hasChildren = children.length > 0}
			{@const activeChildName = hasChildren ? getActiveChildName(cat.id) : null}
			{@const isParentSelected = selectedKode === cat.kode}
			{@const isChildSelected = !!activeChildName}
			{@const clue = getCategoryClue(cat.kode, cat)}
			{@const shortSnippet = clue?.examples?.slice(0, 2).join(', ') || cat.description || ''}

			<button
				type="button"
				class="text-left border rounded-xl p-2.5 transition-all relative flex flex-col justify-between
					{isParentSelected || isChildSelected
						? 'border-[var(--p)] bg-[var(--p)]/5 ring-1 ring-[var(--p)]/20 shadow-xs'
						: 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'}"
				onclick={() => (hasChildren ? toggleExpand(cat.id) : pick(cat))}
			>
				<div>
					<div class="flex items-center gap-1.5 mb-1">
						<span class="text-base leading-none">{cat.icon || clue?.icon || '📄'}</span>
						<span class="text-[12px] font-bold text-gray-800 line-clamp-1">{cat.nama}</span>
						{#if cat.dept_scope && cat.dept_scope.length > 0}
							<span class="ml-auto text-[9px] px-1 py-0.2 bg-blue-50 text-blue-700 font-semibold rounded border border-blue-200 shrink-0" title={`Kategori spesifik departemen: ${cat.dept_scope.join(', ')}`}>
								{cat.dept_scope.join(', ')}
							</span>
						{/if}
					</div>

					{#if searchQuery.trim() && bestHit(cat, searchQuery).hint}
						{@const hit = bestHit(cat, searchQuery)}
						<p class="text-[10px] text-emerald-700 font-semibold line-clamp-1 leading-tight mb-1" title="Kata kunci kategori yang cocok dengan pencarian Anda">
							🔎 cocok: {hit.hint}{hit.via ? ` (${hit.via})` : ''}
						</p>
					{/if}
					{#if shortSnippet}
						<p class="text-[10px] text-gray-500 line-clamp-1 leading-tight mb-1">
							{shortSnippet}
						</p>
					{/if}
				</div>

				{#if hasChildren}
					<div class="pt-1 border-t border-gray-100 mt-1 flex items-center justify-between">
						<span class="text-[10px] font-medium {isChildSelected ? 'text-[var(--p)] font-semibold' : 'text-gray-500'}">
							{isChildSelected ? `✓ ${activeChildName}` : (expandedParent === cat.id ? '▾ Sembunyikan' : `▸ ${children.length} sub-kategori`)}
						</span>
						<span class="text-[9px] px-1 py-0.2 bg-gray-100 text-gray-600 rounded">
							{children.length}
						</span>
					</div>
				{/if}
			</button>

			{#if hasChildren && (expandedParent === cat.id || searchQuery.trim())}
				<div class="col-span-2 grid grid-cols-2 gap-2 pl-3 py-1 bg-gray-50/60 rounded-xl border border-gray-100">
					{#each children as child (child.id)}
						{@const isChildMatch = !searchQuery.trim() || matchCategorySearch(child, searchQuery)}
						{#if isChildMatch}
							{@const childClue = getCategoryClue(child.kode, child)}
							{@const childSnippet = childClue?.examples?.slice(0, 2).join(', ') || ''}
							<button
								type="button"
								class="text-left border rounded-xl p-2 transition-all
									{selectedKode === child.kode
										? 'border-[var(--p)] bg-[var(--p)]/10 text-[var(--p)] font-semibold ring-1 ring-[var(--p)]/30'
										: 'border-gray-200 bg-white hover:border-gray-300'}"
								onclick={() => pick(child)}
							>
								<div class="flex items-center gap-1.5">
									<span class="text-sm">{child.icon || childClue?.icon || '📄'}</span>
									<span class="text-[11px] font-medium text-gray-800">{child.nama}</span>
									{#if child.dept_scope && child.dept_scope.length > 0}
										<span class="ml-auto text-[8.5px] px-1 py-0.2 bg-blue-50 text-blue-700 font-semibold rounded border border-blue-200 shrink-0">
											{child.dept_scope.join(', ')}
										</span>
									{/if}
								</div>
								{#if childSnippet}
									<p class="text-[9.5px] text-gray-400 mt-0.5 line-clamp-1">
										{childSnippet}
									</p>
								{/if}
							</button>
						{/if}
					{/each}
				</div>
			{/if}
		{/each}

		{#if filteredTopLevel.length === 0 && topLevel.length > 0}
			<div class="col-span-2 text-center py-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
				<p class="text-xs text-gray-500">Tidak ada kategori yang cocok dengan kata kunci "{searchQuery}".</p>
				<button
					type="button"
					onclick={() => (searchQuery = '')}
					class="mt-1 text-xs text-[var(--p)] font-semibold hover:underline"
				>Tampilkan Semua</button>
			</div>
		{:else if topLevel.length === 0}
			<p class="col-span-2 text-[11px] text-gray-400 italic py-2">Kategori belum tersedia — pakai kategori standar di bawah.</p>
		{/if}
	</div>
</div>
