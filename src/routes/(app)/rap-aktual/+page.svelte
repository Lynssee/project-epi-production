<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import ProjectAktualisasiPanel from '$lib/components/project/ProjectAktualisasiPanel.svelte';
	import ProjectRiwayatPengajuan from '$lib/components/project/ProjectRiwayatPengajuan.svelte';
	import WorkshopManpowerSummaryCard from '$lib/components/project/WorkshopManpowerSummaryCard.svelte';
	import ProjectBepTrackerCard from '$lib/components/project/ProjectBepTrackerCard.svelte';
	import WsRapAktualStatusCard from '$lib/components/project/WsRapAktualStatusCard.svelte';
	import { IconChartBar, IconLoader2, IconBuildingFactory2, IconChevronDown, IconBuildingSkyscraper, IconMapPin } from '@tabler/icons-svelte';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let selectedProjectId = $state<string | number | null>(null);

	let selectedProject = $derived(projects.find(p => p.id === selectedProjectId) || null);

	onMount(async () => {
		loading = true;
		try {
			// getProjectsForCurrentUser() sudah menangani kasus "tidak punya pegangan
			// apa pun → kosong" dan kursi Manpower Leader sekaligus.
			projects = await getProjectsForCurrentUser(false, { limit: -1 });

			// Fase 2 RAB & Aktualisasi Terpusat: deep-link dari halaman terpusat via ?project=.
			const urlProjectId = page.url.searchParams.get('project');
			const matched = urlProjectId ? projects.find((p) => String(p.id) === urlProjectId) : null;
			if (matched) {
				selectedProjectId = matched.id;
			} else if (projects.length > 0) {
				selectedProjectId = projects[0].id;
			}
		} catch (error) {
			console.error("Failed to load projects:", error);
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>RAP vs Aktual - Operasional Dashboard</title>
</svelte:head>

<div class="flex flex-col min-h-screen bg-gray-50/50 dark:bg-[#121A22] text-gray-900 dark:text-gray-100 transition-colors duration-200">
	<!-- Page Header -->
	<header class="bg-white/90 dark:bg-[#1B2530]/90 backdrop-blur-md px-4 sm:px-6 py-4 sticky top-0 z-20 border-b border-gray-200/80 dark:border-[#2B3844] shadow-xs">
		<div class="max-w-7xl mx-auto w-full flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">
					<IconChartBar size={22} />
				</div>
				<div>
					<h1 class="text-lg font-extrabold text-gray-900 dark:text-white leading-tight">RAP vs Aktual</h1>
					<p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Monitoring kondisi & realisasi keuangan per proyek</p>
				</div>
			</div>
		</div>
	</header>

	<div class="flex-1 overflow-y-auto w-full">
		<div class="px-4 sm:px-6 py-6 lg:px-8 max-w-7xl mx-auto w-full space-y-6">
			{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat RAP vs realisasi aktual..." />
		</div>
			{:else if projects.length === 0}
				<div class="flex flex-col items-center justify-center py-16 bg-white dark:bg-[#1B2530] rounded-2xl border border-gray-200/80 dark:border-[#2B3844] shadow-xs text-center px-4">
					<div class="w-16 h-16 bg-gray-100 dark:bg-[#232F3B] rounded-2xl flex items-center justify-center mb-4 text-gray-400 dark:text-gray-500">
						<IconBuildingFactory2 size={34} />
					</div>
					<h3 class="text-base font-bold text-gray-900 dark:text-white mb-1">Tidak Ada Proyek Active</h3>
					<p class="text-xs text-gray-500 dark:text-gray-400 max-w-xs">Anda belum ditugaskan ke proyek manapun saat ini.</p>
				</div>
			{:else}
				<!-- Project Selector Card -->
				<div class="bg-white dark:bg-[#1B2530] rounded-2xl p-4 sm:p-5 shadow-xs border border-gray-200/80 dark:border-[#2B3844] transition-all">
					<div class="flex items-center justify-between mb-2.5">
						<label for="project-select" class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
							<IconBuildingSkyscraper size={15} class="text-blue-500" />
							Pilih Proyek Aktif
						</label>
						{#if selectedProject?.lokasi}
							<span class="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/50">
								<IconMapPin size={12} />
								{selectedProject.lokasi}
							</span>
						{/if}
					</div>
					<div class="relative">
						<select
							id="project-select"
							class="w-full appearance-none bg-gray-50/80 dark:bg-[#121A22] border border-gray-200 dark:border-[#2B3844] text-gray-900 dark:text-gray-100 text-sm font-semibold rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block px-4 py-3 pr-10 transition-all cursor-pointer hover:border-gray-300 dark:hover:border-gray-600"
							bind:value={selectedProjectId}
						>
							{#each projects as project}
								<option value={project.id} class="bg-white dark:bg-[#1B2530] text-gray-900 dark:text-gray-100 py-1">
									{project.name} {project.lokasi ? `- ${project.lokasi}` : ''}
								</option>
							{/each}
						</select>
						<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400 dark:text-gray-500">
							<IconChevronDown size={18} />
						</div>
					</div>
				</div>

				<!-- Ringkasan Manpower lintas-PO (RAP Ciketing v2, Fase 5 #2) — lampu & persen, tanpa rupiah -->
				<WorkshopManpowerSummaryCard {projects} />

				<!-- RAP vs Aktual Panel -->
				{#if selectedProject}
					<!-- Fase 5 Sinkronisasi Laporan Harian Workshop v2 — lampu progres vs serapan (workshop only) -->
					{#key selectedProjectId}
						<WsRapAktualStatusCard project={selectedProject} />
					{/key}

					<!-- Penajaman Finance CVP Fase 5 — Sisa Jatah / posisi impas proyek -->
					{#key selectedProjectId}
						<ProjectBepTrackerCard projectId={selectedProject.id} />
					{/key}

					<div class="bg-white dark:bg-[#1B2530] rounded-2xl shadow-xs border border-gray-200/80 dark:border-[#2B3844] overflow-hidden p-4 sm:p-6 transition-all">
						{#key selectedProjectId}
							<ProjectAktualisasiPanel project={selectedProject} />
						{/key}
					</div>

					<!-- Riwayat Pengajuan -->
					<div class="bg-white dark:bg-[#1B2530] rounded-2xl shadow-xs border border-gray-200/80 dark:border-[#2B3844] p-4 sm:p-6 transition-all">
						<ProjectRiwayatPengajuan projectId={selectedProjectId} projectName={selectedProject?.name} />
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>

