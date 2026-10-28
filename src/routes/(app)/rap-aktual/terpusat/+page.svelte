<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// RAP & Aktualisasi Terpusat (Fase 2 Modul Operasional Terpusat) — over-budget alert lintas
	// SEMUA proyek yang dipegang user, supaya tidak perlu buka proyek satu-satu. Rumus urgensi
	// (variance/percentage/threshold) SENGAJA identik dengan ProjectFinancialRapVsActualConsolidated
	// di erp-epi-1 supaya definisi "over budget" konsisten lintas dashboard admin & lapangan.
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getRabTotalsForProjects } from '$lib/services/soRabApi';
	import { getActualTotalsForProjects } from '$lib/services/projectAktualisasiApi';
	import LeaderEfficiencyCard from '$lib/components/project/LeaderEfficiencyCard.svelte';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let rabTotals = $state<Record<number, number>>({});
	let actualTotals = $state<Record<number, number>>({});
	let urgencyFilter = $state<'all' | 'minus' | 'warning' | 'normal'>('all');

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			[rabTotals, actualTotals] = await Promise.all([
				getRabTotalsForProjects(projectIds),
				getActualTotalsForProjects(projectIds)
			]);
		} finally {
			loading = false;
		}
	}

	function metrics(projectId: number) {
		const rab = rabTotals[projectId] || 0;
		const actual = actualTotals[projectId] || 0;
		const variance = rab - actual;
		const percentage = rab > 0 ? (actual / rab) * 100 : 0;
		let urgency: 'minus' | 'warning' | 'normal' = 'normal';
		if (variance < 0) urgency = 'minus';
		else if (percentage >= 80) urgency = 'warning';
		return { rab, actual, variance, percentage, urgency };
	}

	let rows = $derived(
		projects
			.map((p) => ({ project: p, ...metrics(p.id) }))
			.filter((r) => urgencyFilter === 'all' || r.urgency === urgencyFilter)
	);

	let urgencyCounts = $derived.by(() => {
		const counts = { all: projects.length, minus: 0, warning: 0, normal: 0 };
		for (const p of projects) {
			const { urgency } = metrics(p.id);
			counts[urgency]++;
		}
		return counts;
	});

	function fmtRp(v: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v || 0);
	}

	const URGENCY_LABEL: Record<string, string> = { minus: 'Over Budget', warning: 'Terpakai ≥80%', normal: 'Normal' };
	const URGENCY_BADGE: Record<string, string> = {
		minus: 'bg-red-100 text-red-700',
		warning: 'bg-amber-100 text-amber-700',
		normal: 'bg-green-100 text-green-700'
	};
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/rap-aktual" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> RAP vs Aktual
		</a>
		<h1 class="text-xl font-bold text-gray-900">RAP & Aktualisasi Terpusat</h1>
		<p class="text-sm text-gray-500">Perbandingan RAP vs realisasi dari semua proyek yang Anda pegang.</p>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<span class="text-xs font-semibold text-gray-500 mr-1">Filter Urgensi:</span>
		{#each [['all', 'Semua Proyek'], ['minus', 'Over Budget'], ['warning', 'Terpakai ≥80%'], ['normal', 'Normal']] as [key, label]}
			<button
				type="button"
				onclick={() => (urgencyFilter = key as typeof urgencyFilter)}
				class="px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all
					{urgencyFilter === key ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}"
			>
				{label} ({urgencyCounts[key as keyof typeof urgencyCounts]})
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat RAP terpusat..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else if rows.length === 0}
		<div class="space-y-4">
			<LeaderEfficiencyCard {projects} {rabTotals} {actualTotals} />
			<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
				<p class="text-[14px] text-gray-500">Tidak ada proyek yang cocok dengan filter.</p>
			</div>
		</div>
	{:else}
		<div class="mb-4">
			<LeaderEfficiencyCard {projects} {rabTotals} {actualTotals} />
		</div>
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">RAP</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">Actual</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">Selisih</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">% Terpakai</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Status</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each rows as r (r.project.id)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">{r.project.name}</td>
							<td class="px-4 py-3 text-right text-gray-700">{fmtRp(r.rab)}</td>
							<td class="px-4 py-3 text-right text-amber-700">{fmtRp(r.actual)}</td>
							<td class="px-4 py-3 text-right font-semibold {r.variance >= 0 ? 'text-green-600' : 'text-red-600'}">
								{r.variance >= 0 ? '+' : ''}{fmtRp(r.variance)}
							</td>
							<td class="px-4 py-3 text-center font-semibold {r.urgency === 'minus' ? 'text-red-600' : r.urgency === 'warning' ? 'text-amber-600' : 'text-green-600'}">
								{r.percentage.toFixed(1)}%
							</td>
							<td class="px-4 py-3 text-center">
								<span class="px-2.5 py-1 rounded-full text-xs font-semibold {URGENCY_BADGE[r.urgency]}">{URGENCY_LABEL[r.urgency]}</span>
							</td>
							<td class="px-4 py-3 text-center">
								<a href={`/rap-aktual?project=${r.project.id}`} class="text-[12px] font-semibold text-green-700 hover:underline">Lihat Detail</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
