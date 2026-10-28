<script lang="ts">
	import { IconSearch, IconX } from '@tabler/icons-svelte';

	let {
		projects = [],
		value = $bindable(''),
		placeholder = '— Pilih Proyek —'
	}: {
		projects: { id: number | string; name: string; workshop?: string | null; status?: string | null }[];
		value: string;
		placeholder?: string;
	} = $props();

	// Fase 5 (Pertajam Modul Ciketing & MB v2) — badge workshop + status per baris.
	// Penyaringan sudah terjadi di hulu (getProjectsForCurrentUser); ini murni label.
	function workshopLabel(w?: string | null): string {
		if (w === 'ciketing') return 'Ciketing';
		if (w === 'balaraja') return 'Balaraja';
		return '';
	}

	let open = $state(false);
	let query = $state('');
	let containerEl: HTMLElement | undefined = $state();

	let selectedLabel = $derived.by(() => {
		const p = projects.find((p) => String(p.id) === value);
		return p ? `${p.name} (ID-${p.id})` : '';
	});

	let filteredProjects = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return projects;
		return projects.filter(
			(p) => p.name.toLowerCase().includes(q) || String(p.id).includes(q)
		);
	});

	function toggleOpen() {
		open = !open;
		if (open) query = '';
	}

	function select(id: string) {
		value = id;
		open = false;
		query = '';
	}

	function onWindowClick(e: MouseEvent) {
		if (open && containerEl && !containerEl.contains(e.target as Node)) {
			open = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}

	function focusOnMount(node: HTMLInputElement) {
		node.focus();
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

<div class="relative" bind:this={containerEl}>
	<button type="button" class="f-select w-full text-left truncate" onclick={toggleOpen}>
		{#if selectedLabel}
			{selectedLabel}
		{:else}
			<span style="color: var(--sys-label4)">{placeholder}</span>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute z-30 w-full mt-1.5 rounded-xl border shadow-2xl overflow-hidden"
			style="border-color: var(--sys-sep); background: var(--sys-bg)"
		>
			<div class="relative p-2 border-b" style="border-color: var(--sys-sep)">
				<IconSearch size={14} class="absolute left-4.5 top-1/2 -translate-y-1/2 pointer-events-none" style="color: var(--sys-label4)" />
				<input
					type="text"
					class="f-input !py-2 !pl-8 !text-[13px]"
					placeholder="Cari proyek..."
					bind:value={query}
					use:focusOnMount
				/>
				{#if query}
					<button
						type="button"
						class="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
						style="color: var(--sys-label4)"
						onclick={() => (query = '')}
					>
						<IconX size={13} />
					</button>
				{/if}
			</div>
			<div class="max-h-56 overflow-y-auto">
				<button
					type="button"
					class="w-full text-left px-3.5 py-2 text-[13px] hover:bg-black/5 dark:hover:bg-white/5"
					style="color: var(--sys-label3)"
					onclick={() => select('')}
				>
					{placeholder}
				</button>
				{#each filteredProjects as p (p.id)}
					<button
						type="button"
						class="w-full text-left px-3.5 py-2 text-[13px] hover:bg-black/5 dark:hover:bg-white/5"
						style="color: var(--sys-label)"
						onclick={() => select(String(p.id))}
					>
						{p.name} <span style="color: var(--sys-label4)">(ID-{p.id})</span>
						{#if workshopLabel(p.workshop)}
							<span style="color: var(--sys-label4)"> · {workshopLabel(p.workshop)}</span>
						{/if}
						{#if p.status}
							<span style="color: var(--sys-label4)"> · {p.status}</span>
						{/if}
					</button>
				{:else}
					<div class="px-3.5 py-4 text-center text-[12px]" style="color: var(--sys-label4)">
						Proyek "{query}" tidak ditemukan
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
