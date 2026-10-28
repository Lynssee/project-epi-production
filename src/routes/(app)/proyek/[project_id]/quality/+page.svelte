<!-- src/routes/(app)/proyek/[project_id]/quality/+page.svelte -->
<!-- Quality Cockpit (R6, Quality Management Proyek v2 Fase 1 — 10 Agustus 2026): satu layar -->
<!-- untuk PL — skor (snapshot harian, bukan real-time), NCR terbuka, tren, buat NCR baru. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import { fetchLatestQualityScore, fetchQualityScoreTrend, type QualityScoreSnapshot } from '$lib/services/qualityScoreApi';
	import { fetchProjectNcrList, createNcr } from '$lib/services/projectNcrApi';
	import { getQualitySetting, loadQualitySettings } from '$lib/services/qualitySettingsApi';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let score = $state<QualityScoreSnapshot | null>(null);
	let trend = $state<QualityScoreSnapshot[]>([]);
	let ncrList = $state<any[]>([]);
	let categories = $state<string[]>([]);

	let creating = $state(false);
	let showForm = $state(false);
	let form = $state({ severity: 'minor', category: '', deskripsi: '' });

	const STATUS_LABEL: Record<string, string> = {
		draft: 'Draft', open: 'Open', in_progress: 'In Progress',
		verification: 'Verification', closed: 'Closed', void: 'Void'
	};

	onMount(async () => {
		loading = true;
		try {
			await loadQualitySettings();
			categories = getQualitySetting('ncr.categories') || [];
			if (categories.length) form.category = categories[0];

			const [proj, sc, tr, ncrs] = await Promise.all([
				getProjectById(projectId),
				fetchLatestQualityScore(Number(projectId)),
				fetchQualityScoreTrend(Number(projectId)),
				fetchProjectNcrList(Number(projectId))
			]);
			project = proj;
			score = sc;
			trend = tr;
			ncrList = ncrs as any[];
		} finally {
			loading = false;
		}
	});

	let openNcr = $derived(ncrList.filter((n) => !['closed', 'void'].includes(n.status)));

	async function submitNcr() {
		if (!form.deskripsi.trim()) return;
		creating = true;
		try {
			await createNcr({
				projectId: Number(projectId),
				category: form.category || undefined,
				severity: form.severity,
				deskripsi: form.deskripsi.trim(),
				actorName: $authStore.karyawanName || undefined
			});
			form.deskripsi = '';
			showForm = false;
			ncrList = (await fetchProjectNcrList(Number(projectId))) as any[];
		} finally {
			creating = false;
		}
	}
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data quality control..." />
	</div>
	{:else}
		<h1 class="text-lg font-bold text-gray-900">Quality Cockpit</h1>
		<p class="mb-4 text-sm text-gray-500">{project?.name || '-'}</p>

		<div class="mb-4 rounded-xl border border-gray-200 bg-white p-4">
			<p class="text-xs font-semibold uppercase text-gray-400">Quality Score (snapshot terakhir)</p>
			{#if score}
				<p class="text-3xl font-extrabold text-gray-900">{score.quality_score ?? 'N/A'}</p>
				<p class="mt-1 text-xs text-gray-400">
					Pass Rate {score.pass_rate ?? 'N/A'}% · NCR terbuka {score.capa_open_count} · per {score.period_date}
				</p>
			{:else}
				<p class="text-sm text-gray-400">Belum ada snapshot untuk proyek ini.</p>
			{/if}

			{#if trend.length > 1}
				<div class="mt-3 flex items-end gap-1" style="height: 40px;">
					{#each trend as t (t.id)}
						<div
							class="flex-1 rounded-t bg-blue-400"
							style="height: {Math.max(4, ((t.quality_score ?? 0) / 100) * 40)}px"
							title="{t.period_date}: {t.quality_score ?? 'N/A'}"
						></div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="rounded-xl border border-gray-200 bg-white p-4">
			<div class="mb-2 flex items-center justify-between">
				<h2 class="text-sm font-bold text-gray-800">NCR Terbuka ({openNcr.length})</h2>
				<button class="text-xs font-semibold text-blue-600" onclick={() => (showForm = !showForm)}>
					{showForm ? 'Batal' : '+ Buat NCR'}
				</button>
			</div>

			{#if showForm}
				<div class="mb-3 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
					<select class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" bind:value={form.severity}>
						<option value="minor">Minor</option>
						<option value="major">Major</option>
						<option value="critical">Critical</option>
					</select>
					<select class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" bind:value={form.category}>
						{#each categories as c (c)}
							<option value={c}>{c}</option>
						{/each}
					</select>
					<textarea class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" rows="2" placeholder="Deskripsi temuan" bind:value={form.deskripsi}></textarea>
					<button
						class="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white disabled:opacity-60"
						disabled={creating}
						onclick={submitNcr}
					>
						{creating ? '…' : 'Simpan NCR (status: open)'}
					</button>
				</div>
			{/if}

			<div class="space-y-2">
				{#each openNcr as ncr (ncr.id)}
					<div class="rounded-lg bg-gray-50 p-2 text-xs">
						<div class="flex items-center justify-between">
							<span class="font-mono text-gray-400">{ncr.ncr_no}</span>
							<span class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{STATUS_LABEL[ncr.status] || ncr.status}</span>
						</div>
						<p class="mt-1 text-gray-700">{ncr.deskripsi}</p>
					</div>
				{:else}
					<p class="text-xs text-gray-400">Tidak ada NCR terbuka.</p>
				{/each}
			</div>
		</div>
	{/if}
</div>
