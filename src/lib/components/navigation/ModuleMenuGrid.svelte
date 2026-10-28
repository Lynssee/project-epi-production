<!-- src/lib/components/navigation/ModuleMenuGrid.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { prefetchProjectsForCurrentUser } from '$lib/services/projectScope';

	export interface MenuItem {
		id?: string;
		label: string;
		desc?: string;
		href?: string;
		route?: string;
		icon?: any;
		badge?: number | (() => number) | string | (() => string);
		show?: boolean | (() => boolean);
		color?: string;
	}

	export interface MenuCategory {
		title: string;
		items: MenuItem[];
	}

	let {
		categories = [],
		onSelect
	}: {
		categories: MenuCategory[];
		onSelect?: (item: MenuItem) => void;
	} = $props();

	function isItemVisible(item: MenuItem): boolean {
		if (item.show === undefined) return true;
		if (typeof item.show === 'function') return Boolean(item.show());
		return Boolean(item.show);
	}

	function getBadgeValue(badge?: number | (() => number) | string | (() => string)): string | number | null {
		if (badge === undefined || badge === null) return null;
		const val = typeof badge === 'function' ? badge() : badge;
		if (typeof val === 'number' && val > 0) return val;
		if (typeof val === 'string' && val.trim() !== '' && val !== '0') return val;
		return null;
	}


	function handlePointerEnter(item: MenuItem) {
		const targetUrl = item.href || item.route;
		if (targetUrl === '/proyek' || targetUrl === '/laporan') {
			prefetchProjectsForCurrentUser(false);
		}
	}

	function handleClick(item: MenuItem, e?: MouseEvent) {
		if (onSelect) {
			if (e) e.preventDefault();
			onSelect(item);
			return;
		}
		const targetUrl = item.href || item.route;
		if (targetUrl) {
			// SvelteKit default link handling will take over when using <a>
		}
	}
</script>

<div class="flex flex-col gap-6 w-full">
	{#each categories as category}
		{@const visibleItems = category.items.filter(isItemVisible)}
		{#if visibleItems.length > 0}
			<div>
				<h3 class="text-xs font-bold uppercase tracking-wider mb-2.5 px-1" style="color: var(--sys-label3)">
					{category.title}
				</h3>
				<div class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
					{#each visibleItems as item (item.id || item.label)}
						{@const badgeVal = getBadgeValue(item.badge)}
						{@const targetUrl = item.href || item.route}
						{#if !onSelect && targetUrl}
							<a
								href={targetUrl}
								data-sveltekit-preload-data="hover"
								class="hover-lift glass-panel rounded-2xl p-4 md:p-5 flex flex-col items-center justify-center gap-3 text-center relative group cursor-pointer transition-all duration-200 w-full no-underline"
								onpointerenter={() => handlePointerEnter(item)}
								ontouchstart={() => handlePointerEnter(item)}
							>
								<div
									class="w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-blue-50/90 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-110 group-hover:bg-blue-100/90 dark:group-hover:bg-blue-900/60 transition-all duration-200 shrink-0"
									style={item.color ? `background: ${item.color}15; color: ${item.color}` : ''}
								>
									{#if item.icon}
										{@const Icon = item.icon}
										<Icon size={26} stroke={1.5} />
									{/if}
								</div>
								
								<div class="min-w-0 w-full">
									<span class="text-xs md:text-sm font-bold tracking-tight text-slate-800 dark:text-slate-100 block truncate">
										{item.label}
									</span>
									{#if item.desc}
										<span class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 block truncate">
											{item.desc}
										</span>
									{/if}
								</div>

								{#if badgeVal !== null}
									<div class="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full shadow-md border-2 border-white dark:border-slate-900 animate-bounce">
										{badgeVal}
									</div>
								{/if}
							</a>
						{:else}
							<button
								type="button"
								class="hover-lift glass-panel rounded-2xl p-4 md:p-5 flex flex-col items-center justify-center gap-3 text-center relative group cursor-pointer transition-all duration-200 w-full"
								onclick={(e) => handleClick(item, e)}
								onpointerenter={() => handlePointerEnter(item)}
							>
								<div
									class="w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-blue-50/90 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-110 group-hover:bg-blue-100/90 dark:group-hover:bg-blue-900/60 transition-all duration-200 shrink-0"
									style={item.color ? `background: ${item.color}15; color: ${item.color}` : ''}
								>
									{#if item.icon}
										{@const Icon = item.icon}
										<Icon size={26} stroke={1.5} />
									{/if}
								</div>
								
								<div class="min-w-0 w-full">
									<span class="text-xs md:text-sm font-bold tracking-tight text-slate-800 dark:text-slate-100 block truncate">
										{item.label}
									</span>
									{#if item.desc}
										<span class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 block truncate">
											{item.desc}
										</span>
									{/if}
								</div>

								{#if badgeVal !== null}
									<div class="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full shadow-md border-2 border-white dark:border-slate-900 animate-bounce">
										{badgeVal}
									</div>
								{/if}
							</button>
						{/if}
					{/each}
				</div>
			</div>
		{/if}
	{/each}
</div>
