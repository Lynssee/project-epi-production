<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Kontrak Jatuh Tempo Terpusat (Fase 4 Modul Operasional Terpusat) — kontrak proyek-customer
	// yang mendekati/lewat tanggal berakhir, lintas SEMUA proyek yang dipegang user. Rumus aging
	// bucket disalin PERSIS dari sisi admin (ContractExpiryTerpusatModule.svelte) supaya kategori
	// identik lintas dashboard. TANPA nilai Rp kontrak — ikut konvensi existing projectContract.ts.
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getContractExpiryForProjects, type ContractExpiryRow } from '$lib/services/projectContract';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let contracts = $state<ContractExpiryRow[]>([]);
	let agingFilter = $state<'' | 'expired' | 'under30' | 'd30to90' | 'over90'>('');

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			contracts = await getContractExpiryForProjects(projectIds);
		} finally {
			loading = false;
		}
	}

	const CLOSED_STATUSES = ['expired', 'arsip', 'batal'];

	function daysUntil(dateStr: string | null) {
		if (!dateStr) return null;
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const target = new Date(dateStr);
		return Math.round((target.getTime() - today.getTime()) / 86400000);
	}

	function agingBucket(row: ContractExpiryRow): '' | 'expired' | 'under30' | 'd30to90' | 'over90' {
		if (CLOSED_STATUSES.includes(row.status) || !row.tanggal_berakhir) return '';
		const d = daysUntil(row.tanggal_berakhir);
		if (d === null) return '';
		if (d < 0) return 'expired';
		if (d < 30) return 'under30';
		if (d <= 90) return 'd30to90';
		return 'over90';
	}

	function projectName(projectId: number) {
		return projects.find((p) => p.id === projectId)?.name || `Proyek #${projectId}`;
	}

	let rows = $derived(
		contracts
			.map((c) => ({ ...c, _aging: agingBucket(c), _sisaHari: daysUntil(c.tanggal_berakhir) }))
			.filter((r) => !agingFilter || r._aging === agingFilter)
	);

	let agingCounts = $derived.by(() => {
		const counts = { expired: 0, under30: 0, d30to90: 0, over90: 0 };
		for (const c of contracts) {
			const bucket = agingBucket(c);
			if (bucket) counts[bucket]++;
		}
		return counts;
	});

	function fmtDate(d: string | null) {
		return d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
	}

	const AGING_LABEL: Record<string, string> = { expired: 'Expired', under30: '< 30 Hari', d30to90: '30-90 Hari', over90: '> 90 Hari' };
	const AGING_BADGE: Record<string, string> = {
		expired: 'bg-red-100 text-red-700',
		under30: 'bg-rose-100 text-rose-700',
		d30to90: 'bg-amber-100 text-amber-700',
		over90: 'bg-green-100 text-green-700'
	};
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/proyek" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> List Project
		</a>
		<h1 class="text-xl font-bold text-gray-900">Kontrak Jatuh Tempo Terpusat</h1>
		<p class="text-sm text-gray-500">Kontrak proyek-customer yang mendekati/lewat tanggal berakhir dari semua proyek Anda.</p>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			onclick={() => (agingFilter = '')}
			class="px-3 py-1.5 rounded-xl text-[11px] font-bold border {agingFilter === '' ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}"
		>
			Semua ({contracts.length})
		</button>
		{#each Object.entries(AGING_LABEL) as [key, label]}
			<button
				type="button"
				onclick={() => (agingFilter = key as typeof agingFilter)}
				class="px-3 py-1.5 rounded-xl text-[11px] font-bold border {agingFilter === key ? AGING_BADGE[key] + ' border-transparent' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}"
			>
				{label} ({agingCounts[key as keyof typeof agingCounts]})
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat kontrak terpusat..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else if rows.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Tidak ada kontrak yang cocok dengan filter.</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Judul Kontrak</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Customer</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Tanggal Berakhir</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Sisa Hari</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Status</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Aging</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each rows as r (r.id)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">{projectName(r.project_id)}</td>
							<td class="px-4 py-3 text-gray-700">{r.judul}</td>
							<td class="px-4 py-3 text-gray-600">{r.pihak_2 || '-'}</td>
							<td class="px-4 py-3 text-gray-600">{fmtDate(r.tanggal_berakhir)}</td>
							<td class="px-4 py-3 text-center text-gray-700">{r._sisaHari ?? '-'}</td>
							<td class="px-4 py-3 text-center">
								<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 capitalize">{r.status}</span>
							</td>
							<td class="px-4 py-3 text-center">
								{#if r._aging}
									<span class="px-2.5 py-1 rounded-full text-xs font-semibold {AGING_BADGE[r._aging]}">{AGING_LABEL[r._aging]}</span>
								{:else}
									<span class="text-gray-400">-</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-center">
								<a href={`/proyek/${r.project_id}?tab=keuangan&sub=kontrak`} class="text-[12px] font-semibold text-green-700 hover:underline">Lihat Proyek</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
