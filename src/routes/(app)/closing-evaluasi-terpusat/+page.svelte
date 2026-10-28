<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Closing/Evaluasi Terpusat (Fase 7, fase terakhir Modul Operasional Terpusat) — status
	// closing/evaluasi lintas proyek yang dipegang user. READ-ONLY MURNI: closing sepenuhnya
	// wewenang Admin (lihat catatan di projectClosureLapangan.ts) — tidak ada aksi mulai/edit
	// di sini, cuma visibility + link ke halaman closeout existing.
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getClosureStatusForProjects, type ClosureStatusForProject } from '$lib/services/projectClosureLapangan';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let statusRows = $state<ClosureStatusForProject[]>([]);

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			statusRows = await getClosureStatusForProjects(projectIds);
		} finally {
			loading = false;
		}
	}

	function projectName(projectId: number) {
		return projects.find((p) => p.id === projectId)?.name || `Proyek #${projectId}`;
	}

	const STAGE_LABEL: Record<string, string> = {
		draft: 'Draft',
		report_generated: 'Laporan Dibuat',
		evaluated: 'Dievaluasi',
		presented: 'Dipresentasikan',
		approved: 'Disetujui',
		closed: 'Closed'
	};
	const STAGE_BADGE: Record<string, string> = {
		draft: 'bg-gray-100 text-gray-600',
		report_generated: 'bg-blue-100 text-blue-700',
		evaluated: 'bg-amber-100 text-amber-700',
		presented: 'bg-purple-100 text-purple-700',
		approved: 'bg-indigo-100 text-indigo-700',
		closed: 'bg-green-100 text-green-700'
	};
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/proyek" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> List Project
		</a>
		<h1 class="text-xl font-bold text-gray-900">Closing/Evaluasi Terpusat</h1>
		<p class="text-sm text-gray-500">Status closing & evaluasi dari semua proyek Anda — visibility saja, proses closing tetap wewenang Admin.</p>
	</div>

	{#if loading}
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat status closing evaluasi..." />
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Stage Closing</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Skor Evaluasi</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Grade</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each statusRows as r (r.project_id)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">{projectName(r.project_id)}</td>
							<td class="px-4 py-3 text-center">
								{#if r.stage}
									<span class="px-2.5 py-1 rounded-full text-xs font-semibold {STAGE_BADGE[r.stage] || 'bg-gray-100 text-gray-600'}">{STAGE_LABEL[r.stage] || r.stage}</span>
								{:else}
									<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">Belum Dimulai</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-center text-gray-700">{r.total_skor ?? '-'}</td>
							<td class="px-4 py-3 text-center text-gray-700">{r.grade || '-'}</td>
							<td class="px-4 py-3 text-center">
								<a href={`/proyek/${r.project_id}/closeout`} class="text-[12px] font-semibold text-green-700 hover:underline">Lihat Closeout</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
