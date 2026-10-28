<!-- src/routes/(app)/proyek/[project_id]/presentasi/+page.svelte -->
<!-- Mode Presentasi Ringkas (rekomendasi Evaluasi & Closing Proyek): halaman auto-generate -->
<!-- dari data proyek (bukan bikin slide manual) untuk dibuka saat rapat closing. Sengaja TIDAK -->
<!-- menampilkan nilai Rupiah (konsisten dgn projectContract.ts/projectSummary.ts — leader view -->
<!-- hanya lihat persentase/status, bukan angka finansial mentah). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getProjectById } from '$lib/services/projects';
	import { getProjectBudgetHealth, type ProjectBudgetHealth } from '$lib/services/projectSummary';
	import { getClosureStatus, getClosureEvaluation, type ClosureStatus, type ClosureEvaluation } from '$lib/services/projectClosureLapangan';
	import { IconArrowLeft, IconLoader2, IconPrinter } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let budgetHealth = $state<ProjectBudgetHealth | null>(null);
	let closure = $state<ClosureStatus | null>(null);
	let evaluation = $state<ClosureEvaluation | null>(null);

	const STATUS_LABEL: Record<string, string> = { sehat: 'Sehat', waspada: 'Waspada', kritis: 'Kritis', unknown: 'Belum Ada Data' };
	const STATUS_COLOR: Record<string, string> = {
		sehat: 'color:#15803d;background:#dcfce7',
		waspada: 'color:#b45309;background:#fef3c7',
		kritis: 'color:#b91c1c;background:#fee2e2',
		unknown: 'color:#6b7280;background:#f3f4f6'
	};

	onMount(async () => {
		loading = true;
		try {
			const [proj, health, cl, ev] = await Promise.all([
				getProjectById(projectId),
				getProjectBudgetHealth(Number(projectId)),
				getClosureStatus(Number(projectId)),
				getClosureEvaluation(Number(projectId))
			]);
			project = proj;
			budgetHealth = health;
			closure = cl;
			evaluation = ev;
		} finally {
			loading = false;
		}
	});

	function fmtDate(d: string | null | undefined) {
		if (!d) return '-';
		return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
	}
</script>

<div class="mx-auto max-w-2xl p-4 pb-24 print:p-0">
	<div class="mb-3 flex items-center justify-between print:hidden">
		<button class="flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
			<IconArrowLeft size={16} /> Kembali ke Proyek
		</button>
		<button class="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600" onclick={() => window.print()}>
			<IconPrinter size={14} /> Cetak / Layar Rapat
		</button>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat materi presentasi proyek..." />
	</div>
	{:else}
		<div class="rounded-2xl border border-gray-200 bg-white p-6 print:border-0 print:p-0">
			<p class="text-xs font-bold uppercase tracking-wider text-gray-400">Presentasi Closing Proyek</p>
			<h1 class="mt-1 text-2xl font-extrabold text-gray-900">{project?.name || '-'}</h1>
			<p class="mt-1 text-sm text-gray-500">{project?.lokasi || '-'} · Leader: {project?.leader || '-'}</p>

			<div class="mt-6 grid grid-cols-2 gap-3 text-sm">
				<div class="rounded-xl bg-gray-50 p-3">
					<p class="text-xs text-gray-400">Tanggal Mulai</p>
					<p class="font-semibold text-gray-800">{fmtDate(project?.start_date)}</p>
				</div>
				<div class="rounded-xl bg-gray-50 p-3">
					<p class="text-xs text-gray-400">Tanggal Akhir Rencana</p>
					<p class="font-semibold text-gray-800">{fmtDate(project?.end_date)}</p>
				</div>
				<div class="rounded-xl bg-gray-50 p-3">
					<p class="text-xs text-gray-400">Progress Fisik</p>
					<p class="font-semibold text-gray-800">{project?.total_progress ?? project?.progress_details ?? 0}%</p>
				</div>
				<div class="rounded-xl p-3" style={STATUS_COLOR[budgetHealth?.status || 'unknown']}>
					<p class="text-xs opacity-70">Kesehatan Biaya</p>
					<p class="font-semibold">
						{STATUS_LABEL[budgetHealth?.status || 'unknown']}
						{#if budgetHealth?.usedPct != null}· {Math.round(budgetHealth.usedPct)}% terpakai{/if}
					</p>
				</div>
			</div>

			<div class="mt-6">
				<p class="text-xs font-bold uppercase tracking-wider text-gray-400">Skor Evaluasi Closing</p>
				{#if evaluation}
					<div class="mt-2 flex items-center gap-3">
						<span class="text-3xl font-extrabold text-gray-900">{evaluation.total_skor}</span>
						<span class="rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-700">Grade {evaluation.grade}</span>
					</div>
				{:else}
					<p class="mt-2 text-sm text-gray-400">Evaluasi belum tersedia — akan diisi Admin di tahap closing.</p>
				{/if}
			</div>

			<div class="mt-6">
				<p class="text-xs font-bold uppercase tracking-wider text-gray-400">Status Alur Closing</p>
				<p class="mt-2 text-sm text-gray-700">
					{#if closure}
						Tahap saat ini: <b>{closure.stage}</b>{#if closure.closed_at}· Ditutup {fmtDate(closure.closed_at)}{/if}
					{:else}
						Closing belum dimulai.
					{/if}
				</p>
			</div>
		</div>

		<p class="mt-4 text-center text-[11px] text-gray-400 print:hidden">
			Halaman ini auto-generate dari data proyek — tidak perlu bikin slide manual untuk rapat closing.
		</p>
	{/if}
</div>

<style>
	@media print {
		:global(body) {
			background: white;
		}
	}
</style>
