<!-- src/routes/(app)/packing-list/pick/+page.svelte -->
<!-- Pintu masuk Picking Barcode dari dashboard Barang. Daftar proyek yang punya
     permintaan packing aktif (requested/approved/shipped) supaya admin lapangan
     bisa langsung lompat ke sesi scan per-proyek tanpa muter lewat halaman
     detail proyek. Lihat (app)/packing-list/[project_id]/pick untuk sesi scan-nya. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import { getProjectsForCurrentUser, getProjectScope } from '$lib/services/projectScope';
	import { getPackingRequests } from '$lib/services/packingList';
	import FilterSort from '$lib/components/FilterSort.svelte';
	import {
		IconArrowLeft, IconScan, IconLoader2, IconPackage, IconChevronRight
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let search = $state('');
	let projectNames = $state<Record<number, string>>({});

	interface ProjectPickSummary {
		projectId: number;
		name: string;
		totalItems: number;
		pendingCount: number;
	}

	let summaries = $state<ProjectPickSummary[]>([]);

	async function load() {
		loading = true;
		try {
			const needsLeaderFilter = !getProjectScope().unrestricted;
			const projects = await getProjectsForCurrentUser(false);

			const names: Record<number, string> = {};
			for (const p of projects || []) names[p.id] = p.name;
			projectNames = names;

			const projectIds = needsLeaderFilter ? (projects || []).map((p: any) => p.id) : undefined;
			const requests = await getPackingRequests(projectIds, { limit: -1 } as any);

			// Hanya baris yang sudah lolos approval (approved/requested) relevan
			// untuk sesi picking ini — pending_approval (belum di-ACC) dan
			// received/delivered (sudah kelar dikirim) disaring dari sini.
			const grouped: Record<number, any[]> = {};
			for (const item of requests) {
				const pid = item.project_id;
				if (pid === null || pid === undefined) continue;
				const readyForPick = item.packing_status === 'approved' || item.packing_status === 'requested';
				if (!readyForPick) continue;
				if (!grouped[pid]) grouped[pid] = [];
				grouped[pid].push(item);
			}

			summaries = Object.entries(grouped)
				.map(([pid, items]) => ({
					projectId: Number(pid),
					name: names[Number(pid)] || `Proyek ID-${pid}`,
					totalItems: items.length,
					pendingCount: items.filter((i: any) => i.pick_status !== 'verified').length
				}))
				// Proyek yang semua barisnya sudah 'verified' (pendingCount 0) tidak
				// perlu tampil lagi — sudah selesai, tidak actionable buat gudang.
				.filter((s) => s.pendingCount > 0)
				.sort((a, b) => b.pendingCount - a.pendingCount);
		} catch (e) {
			console.error('Gagal memuat daftar proyek picking:', e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let filtered: ProjectPickSummary[] = $derived(
		search.trim()
			? summaries.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()))
			: summaries
	);
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="scroll-body px-4 py-4 max-w-4xl mx-auto w-full">
		<div class="bg-gradient-to-br from-[var(--gl)] to-white rounded-xl p-3.5 mb-3 border border-[var(--g)]/10 flex items-start gap-3">
			<div class="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-sm">
				<IconScan size={18} class="text-[var(--g)]" />
			</div>
			<div>
				<p class="text-[12px] font-semibold text-[var(--gd)]">Pilih proyek untuk mulai scan</p>
				<p class="text-[11px] text-[var(--g)] mt-0.5">Ambil barang sesuai permintaan (packing list) — scan barcode lalu input jumlah yang diambil.</p>
			</div>
		</div>

		<FilterSort
			bind:searchQuery={search}
			sortOptions={[]}
			filterOptions={[]}
			placeholder="Cari nama proyek..."
		/>

		{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat daftar picking..." />
		</div>
		{:else if filtered.length === 0}
			<div class="text-center py-12 text-gray-400 text-[13px]">
				Tidak ada proyek dengan permintaan barang yang perlu diambil.
			</div>
		{:else}
			<div class="space-y-1.5 mt-1">
				{#each filtered as s (s.projectId)}
					<button
						type="button"
						class="w-full flex items-center gap-2.5 p-3 rounded-xl bg-white border border-gray-100 hover:border-[var(--g)]/30 transition-colors text-left"
						onclick={() => goto(`/packing-list/${s.projectId}/pick`)}
					>
						<div class="w-9 h-9 rounded-lg bg-[var(--gl)] flex items-center justify-center shrink-0">
							<IconPackage size={18} class="text-[var(--g)]" />
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-[12.5px] font-medium text-gray-800 truncate">{s.name}</p>
							<p class="text-[10px] text-gray-400 mt-0.5">{s.totalItems} item diminta · {s.pendingCount} belum diambil</p>
						</div>
						<IconChevronRight size={16} class="text-gray-300 shrink-0" />
					</button>
				{/each}
			</div>
		{/if}

		<div class="h-4"></div>
	</div>
</div>
