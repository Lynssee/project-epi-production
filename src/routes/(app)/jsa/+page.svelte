<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import {
		IconArrowLeft,
		IconLoader2,
		IconSearch,
		IconBuilding,
		IconChevronRight,
		IconFlame
	} from '@tabler/icons-svelte';

	let projects = $state<any[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let searchQuery = $state('');

	let filteredProjects = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return projects;
		return projects.filter(
			(p) =>
				(p.name || '').toLowerCase().includes(q) ||
				(p.lokasi || '').toLowerCase().includes(q) ||
				(p.leader || '').toLowerCase().includes(q) ||
				(p.nomor_po || '').toLowerCase().includes(q) ||
				String(p.id).includes(q)
		);
	});

	async function load() {
		loading = true;
		loadError = null;
		try {
			// JSA hanya relevan untuk proyek yang masih berjalan.
			projects = await getProjectsForCurrentUser(true, { sort: '-date_created' });
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Gagal memuat daftar proyek.';
			projects = [];
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="px-4 pt-4 max-w-4xl mx-auto w-full">
		<button
			type="button"
			onclick={() => goto('/hse/hub')}
			class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
		>
			<IconArrowLeft size={16} />
			<span>Kembali ke Hub HSE &amp; Mutu</span>
		</button>
		<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Job Safety Analysis (JSA)</h2>
		<p class="text-[12px] mb-3" style="color: var(--sys-label3)">
			Pilih proyek untuk membuat atau melihat JSA-nya.
		</p>

		<div class="relative mb-3">
			<IconSearch
				size={16}
				class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
				style="color: var(--sys-label3)"
			/>
			<input
				bind:value={searchQuery}
				placeholder="Cari nama proyek, lokasi, leader, atau No. PO"
				class="w-full border rounded-xl pl-9 pr-3 py-2 text-[13px]"
				style="border-color: var(--sys-sep); background: var(--sys-bg2); color: var(--sys-label)"
			/>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat Job Safety Analysis (JSA)..." />
		</div>
	{:else}
		<div class="scroll-body px-4 pb-4 flex flex-col gap-2" style="background: var(--sys-bg)">
			<div class="max-w-4xl mx-auto w-full flex flex-col gap-2">
				{#if loadError}
					<div class="card-section text-center">
						<p class="text-[13px] mb-3" style="color: var(--re)">{loadError}</p>
						<button
							class="px-4 py-2 rounded-xl text-[13px] font-semibold text-white"
							style="background: var(--g)"
							onclick={load}
						>
							Coba Lagi
						</button>
					</div>
				{:else if filteredProjects.length === 0}
					<div class="card-section text-center py-8">
						<IconFlame size={28} style="color: var(--sys-label3)" class="mx-auto mb-2" />
						<p class="text-[13px]" style="color: var(--sys-label3)">
							{searchQuery.trim()
								? 'Tidak ada proyek yang cocok dengan pencarian.'
								: 'Belum ada proyek aktif yang bisa diakses.'}
						</p>
					</div>
				{:else}
					{#each filteredProjects as p (p.id)}
						<button
							type="button"
							class="card-section w-full text-left flex items-center gap-3"
							onclick={() => goto(`/jsa/${p.id}`)}
						>
							<div
								class="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
								style="background: var(--sys-fill)"
							>
								<IconBuilding size={18} style="color: var(--sys-label3)" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-[14px] font-semibold truncate" style="color: var(--sys-label)">
									{p.name || `Proyek #${p.id}`}
								</p>
								<p class="text-[12px] truncate" style="color: var(--sys-label3)">
									{[p.lokasi, p.leader].filter(Boolean).join(' • ') || '-'}
								</p>
							</div>
							<IconChevronRight size={18} style="color: var(--sys-label3)" class="shrink-0" />
						</button>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
