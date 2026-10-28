<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getProjectStatusLabel, getProjectStatusClass } from '$lib/utils/projectStatus';
	import CuacaBadge from '$lib/components/shared/CuacaBadge.svelte';
	import {
		IconCalendarTime,
		IconSearch,
		IconLoader2,
		IconBuildingFactory2,
		IconMapPin,
		IconUser,
		IconChevronRight,
		IconCalendar,
		IconAlertTriangle,
		IconChecklist,
		IconArrowRight,
		IconClock,
		IconSparkles
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let searchQuery = $state('');
	let activeFilter = $state<'all' | 'progress' | 'has_timeline' | 'no_timeline'>('all');

	onMount(async () => {
		loading = true;
		try {
			// Mengambil proyek yang diizinkan untuk user login saat ini (mematuhi role & manpower leader)
			projects = await getProjectsForCurrentUser(false, { limit: -1 });
		} catch (error) {
			console.error('Gagal memuat proyek:', error);
		} finally {
			loading = false;
		}
	});

	function formatDate(dateStr: string | null | undefined) {
		if (!dateStr) return '-';
		try {
			return new Date(dateStr).toLocaleDateString('id-ID', {
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			});
		} catch {
			return dateStr;
		}
	}

	function parseTimelineSummary(rawPlanning: any) {
		if (!rawPlanning) return { hasTimeline: false, categoryCount: 0, subtaskCount: 0 };
		try {
			const parsed = typeof rawPlanning === 'string' ? JSON.parse(rawPlanning) : rawPlanning;
			const categories = parsed?.categories || [];
			let subtaskCount = 0;
			categories.forEach((cat: any) => {
				subtaskCount += (cat.subtasks || []).length;
			});
			return {
				hasTimeline: categories.length > 0,
				categoryCount: categories.length,
				subtaskCount
			};
		} catch {
			return { hasTimeline: false, categoryCount: 0, subtaskCount: 0 };
		}
	}

	// Metrik KPI
	let totalProjects = $derived(projects.length);
	let onProgressProjects = $derived(
		projects.filter((p) => {
			const s = (p.status || '').toLowerCase();
			return s.includes('progress') || s === 'on_progress' || s === 'repair';
		}).length
	);
	let hasTimelineProjects = $derived(
		projects.filter((p) => parseTimelineSummary(p.timeline_planning).hasTimeline).length
	);
	let noTimelineProjects = $derived(
		projects.filter((p) => !parseTimelineSummary(p.timeline_planning).hasTimeline).length
	);

	// Filtering & Searching
	let filteredProjects = $derived(
		projects.filter((p) => {
			// Filter tab
			if (activeFilter === 'progress') {
				const s = (p.status || '').toLowerCase();
				if (!s.includes('progress') && s !== 'on_progress' && s !== 'repair') return false;
			} else if (activeFilter === 'has_timeline') {
				if (!parseTimelineSummary(p.timeline_planning).hasTimeline) return false;
			} else if (activeFilter === 'no_timeline') {
				if (parseTimelineSummary(p.timeline_planning).hasTimeline) return false;
			}

			// Search Query
			if (searchQuery.trim()) {
				const q = searchQuery.trim().toLowerCase();
				const matchName = (p.name || '').toLowerCase().includes(q);
				const matchLoc = (p.lokasi || '').toLowerCase().includes(q);
				const matchPo = (p.nomor_po || '').toLowerCase().includes(q);
				const matchLeader = (p.leader || '').toLowerCase().includes(q);
				const matchId = String(p.id).includes(q);
				return matchName || matchLoc || matchPo || matchLeader || matchId;
			}

			return true;
		})
	);
</script>

<svelte:head>
	<title>Timeline & Jadwal - Operasional Dashboard</title>
</svelte:head>

<div class="flex flex-col min-h-screen bg-gray-50/50 dark:bg-[#121A22] text-gray-900 dark:text-gray-100 transition-colors duration-200">
	<!-- Page Header -->
	<header class="bg-white/90 dark:bg-[#1B2530]/90 backdrop-blur-md px-4 sm:px-6 py-4 sticky top-0 z-20 border-b border-gray-200/80 dark:border-[#2B3844] shadow-xs">
		<div class="max-w-7xl mx-auto w-full flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
					<IconCalendarTime size={22} />
				</div>
				<div>
					<h1 class="text-lg font-extrabold text-gray-900 dark:text-white leading-tight">Timeline & Jadwal</h1>
					<p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Monitoring timeline, Gantt chart, dan milestone pelaksanaan proyek</p>
				</div>
			</div>
		</div>
	</header>

	<div class="flex-1 overflow-y-auto w-full">
		<div class="px-4 sm:px-6 py-6 lg:px-8 max-w-7xl mx-auto w-full space-y-6">
			<!-- KPI Summary Grid -->
			<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
				<div class="bg-white dark:bg-[#1B2530] p-4 rounded-2xl border border-gray-200/80 dark:border-[#2B3844] shadow-xs flex items-center gap-3.5">
					<div class="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
						<IconBuildingFactory2 size={22} />
					</div>
					<div>
						<p class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Proyek</p>
						<h3 class="text-xl font-extrabold text-gray-900 dark:text-white mt-0.5">{totalProjects}</h3>
					</div>
				</div>

				<div class="bg-white dark:bg-[#1B2530] p-4 rounded-2xl border border-gray-200/80 dark:border-[#2B3844] shadow-xs flex items-center gap-3.5">
					<div class="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
						<IconClock size={22} />
					</div>
					<div>
						<p class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">On Progress</p>
						<h3 class="text-xl font-extrabold text-gray-900 dark:text-white mt-0.5">{onProgressProjects}</h3>
					</div>
				</div>

				<div class="bg-white dark:bg-[#1B2530] p-4 rounded-2xl border border-gray-200/80 dark:border-[#2B3844] shadow-xs flex items-center gap-3.5">
					<div class="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
						<IconChecklist size={22} />
					</div>
					<div>
						<p class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ada Timeline</p>
						<h3 class="text-xl font-extrabold text-gray-900 dark:text-white mt-0.5">{hasTimelineProjects}</h3>
					</div>
				</div>

				<div class="bg-white dark:bg-[#1B2530] p-4 rounded-2xl border border-gray-200/80 dark:border-[#2B3844] shadow-xs flex items-center gap-3.5">
					<div class="w-11 h-11 rounded-xl bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
						<IconSparkles size={22} />
					</div>
					<div>
						<p class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Belum Diset</p>
						<h3 class="text-xl font-extrabold text-gray-900 dark:text-white mt-0.5">{noTimelineProjects}</h3>
					</div>
				</div>
			</div>

			<!-- Search & Filter Controls -->
			<div class="bg-white dark:bg-[#1B2530] rounded-2xl p-4 sm:p-5 shadow-xs border border-gray-200/80 dark:border-[#2B3844] flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
				<!-- Search -->
				<div class="relative flex-1">
					<IconSearch size={18} class="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
					<input
						type="text"
						placeholder="Cari proyek berdasarkan nama, lokasi, nomor PO, atau leader..."
						bind:value={searchQuery}
						class="w-full pl-10 pr-4 py-2.5 bg-gray-50/80 dark:bg-[#121A22] border border-gray-200 dark:border-[#2B3844] text-sm text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all placeholder:text-gray-400"
					/>
				</div>

				<!-- Filter Chips -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
					<button
						type="button"
						class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap {activeFilter === 'all' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 dark:bg-[#232F3B] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
						onclick={() => (activeFilter = 'all')}
					>
						Semua ({totalProjects})
					</button>
					<button
						type="button"
						class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap {activeFilter === 'progress' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 dark:bg-[#232F3B] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
						onclick={() => (activeFilter = 'progress')}
					>
						On Progress ({onProgressProjects})
					</button>
					<button
						type="button"
						class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap {activeFilter === 'has_timeline' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 dark:bg-[#232F3B] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
						onclick={() => (activeFilter = 'has_timeline')}
					>
						Ada Timeline ({hasTimelineProjects})
					</button>
					<button
						type="button"
						class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap {activeFilter === 'no_timeline' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 dark:bg-[#232F3B] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
						onclick={() => (activeFilter = 'no_timeline')}
					>
						Belum Diset ({noTimelineProjects})
					</button>
				</div>
			</div>

			<!-- Project Cards List -->
			{#if loading}
				<div class="py-20 flex justify-center bg-white dark:bg-[#1B2530] rounded-2xl border border-gray-200/80 dark:border-[#2B3844] shadow-xs">
					<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Timeline Proyek..." sublabel="Mengambil daftar proyek aktif Directus" />
				</div>
			{:else if filteredProjects.length === 0}
				<div class="flex flex-col items-center justify-center py-16 bg-white dark:bg-[#1B2530] rounded-2xl border border-gray-200/80 dark:border-[#2B3844] shadow-xs text-center px-4">
					<div class="w-16 h-16 bg-gray-100 dark:bg-[#232F3B] rounded-2xl flex items-center justify-center mb-4 text-gray-400 dark:text-gray-500">
						<IconCalendarTime size={34} />
					</div>
					<h3 class="text-base font-bold text-gray-900 dark:text-white mb-1">
						{searchQuery.trim() ? 'Tidak Ada Proyek yang Cocok' : 'Tidak Ada Proyek'}
					</h3>
					<p class="text-xs text-gray-500 dark:text-gray-400 max-w-xs">
						{searchQuery.trim()
							? 'Coba gunakan kata kunci pencarian lain atau ubah filter.'
							: 'Anda belum ditugaskan ke proyek manapun saat ini.'}
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each filteredProjects as project (project.id)}
						{@const timelineInfo = parseTimelineSummary(project.timeline_planning)}
						<div class="bg-white dark:bg-[#1B2530] rounded-2xl border border-gray-200/80 dark:border-[#2B3844] shadow-xs hover:border-emerald-500/50 dark:hover:border-emerald-500/50 transition-all flex flex-col justify-between overflow-hidden group">
							<!-- Card Body -->
							<div class="p-5 space-y-3.5">
								<!-- Title & Status -->
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0 flex-1">
										<h4 class="text-sm font-bold text-gray-900 dark:text-white leading-snug line-clamp-2 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
											{project.name || 'Proyek Tanpa Nama'}
										</h4>
										{#if project.nomor_po}
											<p class="text-[11px] font-medium text-gray-400 dark:text-gray-500 mt-0.5 truncate">
												PO: {project.nomor_po}
											</p>
										{/if}
									</div>
									<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0 {
										(project.status || '').toLowerCase().includes('progress') || project.status === 'on_progress' || project.status === 'repair'
											? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/50'
											: project.status === 'complete' || project.status === 'done'
											? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/50'
											: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/50'
									}">
										{getProjectStatusLabel(project.status)}
									</span>
								</div>

								<!-- Meta Details -->
								<div class="space-y-1.5 text-xs text-gray-600 dark:text-gray-300">
									{#if project.lokasi}
										<div class="flex items-center gap-2">
											<IconMapPin size={14} class="text-gray-400 shrink-0" />
											<span class="truncate">{project.lokasi}</span>
											<CuacaBadge projectId={project.id} />
										</div>
									{/if}

									{#if project.leader}
										<div class="flex items-center gap-2">
											<IconUser size={14} class="text-gray-400 shrink-0" />
											<span class="truncate">Leader: {project.leader}</span>
										</div>
									{/if}

									{#if project.start_date || project.end_date}
										<div class="flex items-center gap-2">
											<IconCalendar size={14} class="text-gray-400 shrink-0" />
											<span class="truncate">
												{formatDate(project.start_date)} — {formatDate(project.end_date)}
											</span>
										</div>
									{/if}
								</div>

								<!-- Timeline Badge / Indicator -->
								<div class="pt-2 border-t border-gray-100 dark:border-[#232F3B]">
									{#if timelineInfo.hasTimeline}
										<div class="flex items-center justify-between text-xs">
											<span class="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
												<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
												Timeline Aktif
											</span>
											<span class="text-gray-500 dark:text-gray-400 font-medium">
												{timelineInfo.categoryCount} Task, {timelineInfo.subtaskCount} Subtask
											</span>
										</div>
									{:else}
										<div class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
											<IconAlertTriangle size={14} class="text-amber-500 shrink-0" />
											<span>Belum ada perencanaan timeline dari admin</span>
										</div>
									{/if}
								</div>
							</div>

							<!-- Card Footer / Actions -->
							<div class="p-3 bg-gray-50/70 dark:bg-[#16202A] border-t border-gray-100 dark:border-[#232F3B] flex items-center gap-2">
								<button
									type="button"
									class="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-xs font-bold rounded-xl shadow-xs transition-all"
									onclick={() => goto(`/timeline/${project.id}`)}
								>
									<IconCalendarTime size={15} />
									<span>Buka Timeline & Jadwal</span>
								</button>
								<button
									type="button"
									class="inline-flex items-center justify-center p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-white dark:bg-[#1B2530] hover:bg-gray-100 dark:hover:bg-[#232F3B] border border-gray-200 dark:border-[#2B3844] rounded-xl transition-all"
									title="Lihat Detail Proyek"
									onclick={() => goto(`/proyek/${project.id}`)}
								>
									<IconChevronRight size={16} />
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
