<script lang="ts">
	import { IconSearch, IconX, IconFilter, IconSortAscending, IconCheck } from '@tabler/icons-svelte';

	let {
		searchQuery = $bindable(''),
		sortOption = $bindable(''),
		filterOption = $bindable(''),
		sortOptions = [],
		filterOptions = [],
		placeholder = "Cari...",
		multiple = false,
		onSearch,
		onSortChange,
		onFilterChange
	}: {
		searchQuery?: string;
		sortOption?: string;
		filterOption?: string;
		sortOptions?: { value: string; label: string }[];
		filterOptions?: { value: string; label: string }[];
		placeholder?: string;
		multiple?: boolean;
		onSearch?: () => void;
		onSortChange?: (val: string) => void;
		onFilterChange?: (val: string) => void;
	} = $props();

	let showSort = $state(false);
	let showFilter = $state(false);

	let timeoutId: any;

	let selectedParts = $derived(filterOption ? filterOption.split(',').map(s => s.trim()).filter(Boolean) : []);

	function handleSearchInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;
		
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			if (onSearch) onSearch();
		}, 300); // debounce search
	}

	function clearSearch() {
		searchQuery = '';
		if (onSearch) onSearch();
	}

	function selectSort(val: string) {
		sortOption = val;
		showSort = false;
		if (onSortChange) onSortChange(val);
	}

	function isSelected(val: string): boolean {
		if (multiple) {
			if (val === '') {
				return filterOption === '';
			}
			return selectedParts.includes(val);
		} else {
			return filterOption === val;
		}
	}

	function handleFilterClick(val: string) {
		if (multiple) {
			if (val === '') {
				filterOption = '';
			} else {
				const parts = [...selectedParts];
				const idx = parts.indexOf(val);
				if (idx > -1) {
					parts.splice(idx, 1);
				} else {
					parts.push(val);
				}
				filterOption = parts.join(',');
			}
			if (onFilterChange) onFilterChange(filterOption);
		} else {
			filterOption = val;
			showFilter = false;
			if (onFilterChange) onFilterChange(val);
		}
	}
</script>

<div class="flex flex-col gap-3 mb-1">
	<div class="relative w-full">
		<IconSearch size={18} class="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 dark:text-slate-500" />
		<input
			type="text"
			value={searchQuery}
			oninput={handleSearchInput}
			{placeholder}
			class="w-full pl-11 pr-11 py-2.5 text-[13.5px] rounded-xl outline-none transition-all font-medium bg-white dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 border border-slate-200/90 dark:border-slate-700/80 shadow-2xs placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
		/>
		{#if searchQuery}
			<button
				class="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center transition-colors bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300 active:scale-95"
				onclick={clearSearch}
				title="Hapus pencarian"
			>
				<IconX size={13} />
			</button>
		{/if}
	</div>

	{#if sortOptions.length > 0 || filterOptions.length > 0}
		<div class="flex flex-wrap items-center gap-2 relative">
			{#if sortOptions.length > 0}
				<div class="relative">
					<button 
						class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-2xs active:scale-95 {sortOption ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}"
						onclick={() => { showSort = !showSort; showFilter = false; }}
					>
						<IconSortAscending size={14} class={sortOption ? 'text-blue-500' : 'text-slate-400'} /> 
						<span>Urutkan</span>
						{#if sortOption}
							<span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
						{/if}
					</button>
					
					{#if showSort}
						<div class="absolute left-0 mt-2 w-52 rounded-xl shadow-xl z-50 overflow-hidden py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
							{#each sortOptions as opt}
								<button 
									class="w-full text-left px-4 py-2 text-xs font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/70 flex items-center justify-between {sortOption === opt.value ? 'text-blue-600 dark:text-blue-400 font-bold bg-blue-50/50 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-200'}"
									onclick={() => selectSort(opt.value)}
								>
									<span>{opt.label}</span>
									{#if sortOption === opt.value}
										<IconCheck size={14} class="text-blue-600 dark:text-blue-400" />
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			{#if filterOptions.length > 0}
				<div class="relative">
					<button 
						class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-2xs active:scale-95 {filterOption ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}"
						onclick={() => { showFilter = !showFilter; showSort = false; }}
					>
						<IconFilter size={14} class={filterOption ? 'text-blue-500' : 'text-slate-400'} /> 
						<span>Filter</span>
						{#if filterOption}
							<span class="px-1.5 py-0.2 bg-blue-500 text-white rounded-full text-[10px] font-mono leading-none">
								{multiple ? selectedParts.length : 1}
							</span>
						{/if}
					</button>

					{#if showFilter}
						<div class="absolute left-0 mt-2 w-56 rounded-xl shadow-xl z-50 overflow-hidden py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
							<button 
								class="w-full text-left px-4 py-2 text-xs font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/70 flex items-center justify-between {isSelected('') ? 'text-blue-600 dark:text-blue-400 font-bold bg-blue-50/50 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-200'}"
								onclick={() => handleFilterClick('')}
							>
								<span>Semua</span>
								{#if isSelected('')}
									<IconCheck size={14} class="text-blue-600 dark:text-blue-400" />
								{/if}
							</button>
							{#each filterOptions as opt}
								<button 
									class="w-full text-left px-4 py-2 text-xs font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/70 flex items-center justify-between {isSelected(opt.value) ? 'text-blue-600 dark:text-blue-400 font-bold bg-blue-50/50 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-200'}"
									onclick={() => handleFilterClick(opt.value)}
								>
									<span>{opt.label}</span>
									{#if isSelected(opt.value)}
										<IconCheck size={14} class="text-blue-600 dark:text-blue-400" />
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
		
		<!-- Click away backdrop -->
		{#if showSort || showFilter}
			<button 
				class="fixed inset-0 z-40 w-full h-full bg-transparent border-none p-0 cursor-default outline-none" 
				onclick={() => { showSort = false; showFilter = false; }}
				aria-label="Tutup menu"
			></button>
		{/if}
	{/if}
</div>
