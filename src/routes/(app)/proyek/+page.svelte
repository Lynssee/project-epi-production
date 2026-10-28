<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { getProjectsForCurrentUser, getProjectScope, isDemisionerLeader } from '$lib/services/projectScope';
	import { getBatchedReports, getBatchedTodayReports } from '$lib/services/reports';
	import { secureDirectusJson } from '$lib/services/secureDirectus';
	import {
		IconBuilding, IconCalendarTime, IconStack2, IconSearch, IconX, IconLoader2,
		IconMapPin, IconMapPinOff, IconUser, IconCheck, IconClock, IconActivity, IconHourglassHigh,
		IconClipboardCheck, IconExternalLink, IconFileText, IconMaximize, IconMinimize, IconInfoCircle,
		IconArrowLeft, IconLayoutGrid
	} from '@tabler/icons-svelte';
	import FilterSort from '$lib/components/FilterSort.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { getProjectStatusLabel, getProjectStatusClass } from '$lib/utils/projectStatus';

	let projects = $state<any[]>([]);
	let todayReports = $state<Record<number, boolean>>({});
	let projectCharterStatuses = $state<Record<number, string>>({});
	// Pertajam Fase Planning Fase 2 (5 Okt 2026) — skor Kepatuhan Klien (WPO), dibaca read-only
	// dari cache yang ditulis admin erp-epi (client_compliance_evaluation). Batch 1 query per
	// halaman list (bukan per-kartu) — lihat feedback user soal hemat API usage.
	let wpoCompliance = $state<Record<number, number>>({});
	let loading = $state(true);
	let isFullscreen = $state(false);

	let searchQuery = $state('');
	let sortOption = $state('');
	let filterOption = $state('active,on progress,waiting,repair,hold');

	const limit = 10;
	let offset = $state(0);
	let hasMore = $state(true);
	let loadingMore = $state(false);

	// Dynamic Progress Loader untuk Proyek Lapangan
	let proyekLoadPercent = $state(25);
	let proyekLoadStep = $state(1);
	let proyekLoadLabel = $state('Mengambil data proyek lapangan dari Directus...');
	let proyekTimer: any = null;

	$effect(() => {
		if (loading) {
			if (!proyekTimer) {
				proyekLoadPercent = 20;
				proyekLoadStep = 1;
				proyekLoadLabel = 'Mengambil data proyek lapangan dari Directus...';
				proyekTimer = setInterval(() => {
					if (loading) {
						if (proyekLoadPercent < 55) {
							proyekLoadPercent += 8;
							proyekLoadStep = 2;
							proyekLoadLabel = 'Menghitung ringkasan KPI & status aktif...';
						} else if (proyekLoadPercent < 85) {
							proyekLoadPercent += 5;
							proyekLoadStep = 3;
							proyekLoadLabel = 'Memeriksa laporan hari ini & kesiapan charter...';
						} else if (proyekLoadPercent < 95) {
							proyekLoadPercent += 1.5;
							proyekLoadStep = 4;
							proyekLoadLabel = 'Menyiapkan kartu proyek lapangan...';
						}
					} else {
						proyekLoadPercent = 100;
						if (proyekTimer) {
							clearInterval(proyekTimer);
							proyekTimer = null;
						}
					}
				}, 200);
			}
		} else {
			if (proyekTimer) {
				clearInterval(proyekTimer);
				proyekTimer = null;
			}
			proyekLoadPercent = 100;
		}
	});

	onDestroy(() => {
		if (proyekTimer) clearInterval(proyekTimer);
	});

	// Metrik KPI Derived
	let totalProjectsCount = $derived(projects.length);
	let onProgressCount = $derived(
		projects.filter((p) => {
			const s = (p.status || '').toLowerCase();
			return s.includes('progress') || s === 'on_progress' || s === 'repair';
		}).length
	);
	let waitingCount = $derived(
		projects.filter((p) => {
			const s = (p.status || '').toLowerCase();
			return s === 'waiting' || s === 'hold' || s === 'prepare';
		}).length
	);
	let reportedTodayCount = $derived(
		projects.filter((p) => todayReports[p.id]).length
	);
	let reportedTodayPercentage = $derived(
		totalProjectsCount > 0 ? Math.round((reportedTodayCount / totalProjectsCount) * 100) : 0
	);

	// Fase 4 (correction_plan_project-double-dari-so, P-09, 27 Sep 2026): tidak ada jalur
	// so_customer -> project tunggal di project-epi (getProjects() memfilter per
	// leader/kursi/workshop, bukan per SO) -- jadi kalau ada 2 project (bug lama di admin,
	// lihat Fase 0-2 di erp-epi) yang leadernya SAMA, dua-duanya lolos filter dan tampil
	// sebagai 2 kartu terpisah untuk 1 PO yang sama. Ini murni deteksi tampilan (bukan
	// pemblokir) dari data yang SUDAH termuat -- tidak menyembunyikan/memilih salah satu,
	// leader tetap yang memutuskan mana yang dipakai sambil menghubungi admin.
	function computeDuplicateSoIds(list: any[]): Set<number> {
		const bySo = new Map<number, number[]>();
		for (const p of list) {
			const sId = typeof p.so_customer_id === 'object' ? p.so_customer_id?.id : p.so_customer_id;
			if (sId == null) continue;
			const key = Number(sId);
			if (!bySo.has(key)) bySo.set(key, []);
			bySo.get(key)!.push(p.id);
		}
		const dupIds = new Set<number>();
		for (const ids of bySo.values()) {
			if (ids.length > 1) ids.forEach((id) => dupIds.add(id));
		}
		return dupIds;
	}
	let duplicateSoProjectIds = $derived(computeDuplicateSoIds(projects));

	const sortOptions = [
		{ value: '-date_created', label: 'Paling Baru' },
		{ value: 'date_created', label: 'Paling Lama' },
		{ value: 'name', label: 'Nama (A-Z)' },
		{ value: '-name', label: 'Nama (Z-A)' },
	];

	const filterOptions = [
		{ value: 'active', label: 'Aktif' },
		{ value: 'on progress', label: 'On Progress' },
		{ value: 'waiting', label: 'Waiting' },
		{ value: 'hold', label: 'Hold' },
		{ value: 'repair', label: 'Repair' },
		{ value: 'closed', label: 'Closed' },
		{ value: 'complete', label: 'Selesai' }
	];

	function toggleFullscreen() {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen().then(() => {
				isFullscreen = true;
			}).catch((err) => {
				console.error(`Gagal aktifkan fullscreen: ${err.message}`);
			});
		} else {
			if (document.exitFullscreen) {
				document.exitFullscreen().then(() => {
					isFullscreen = false;
				}).catch((err) => {
					console.error(`Gagal keluar fullscreen: ${err.message}`);
				});
			}
		}
	}

	function handleFullscreenChange() {
		if (typeof document !== 'undefined') {
			isFullscreen = !!document.fullscreenElement;
		}
	}

	function parseProjectName(fullName: string | null | undefined) {
		if (!fullName) return { mainName: '-', poNumber: '' };
		
		const poMatch = fullName.match(/^(.*?)\s*[-–—]\s*(PO\/.*)$/i);
		if (poMatch) {
			return {
				mainName: poMatch[1].trim(),
				poNumber: poMatch[2].trim()
			};
		}
		
		const parts = fullName.split(/\s*[-–—]\s*/);
		if (parts.length > 1 && parts[parts.length - 1].toLowerCase().includes('po')) {
			return {
				mainName: parts.slice(0, -1).join(' - ').trim(),
				poNumber: parts[parts.length - 1].trim()
			};
		}

		return {
			mainName: fullName,
			poNumber: ''
		};
	}

	function getLeaderInitials(name: string | null | undefined): string {
		if (!name || name === '-') return '?';
		const words = name.trim().split(/\s+/);
		if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
		return (words[0][0] + words[words.length - 1][0]).toUpperCase();
	}

	function getLeaderAvatarBg(name: string | null | undefined): string {
		if (!name || name === '-') return 'from-slate-600 to-slate-800 text-slate-200 border-slate-600';
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		const colors = [
			'from-blue-600 to-indigo-600 text-white border-blue-400/40 ring-1 ring-blue-500/30',
			'from-emerald-600 to-teal-600 text-white border-emerald-400/40 ring-1 ring-emerald-500/30',
			'from-violet-600 to-purple-600 text-white border-violet-400/40 ring-1 ring-violet-500/30',
			'from-amber-600 to-orange-600 text-white border-amber-400/40 ring-1 ring-amber-500/30',
			'from-cyan-600 to-blue-600 text-white border-cyan-400/40 ring-1 ring-cyan-500/30',
			'from-rose-600 to-pink-600 text-white border-rose-400/40 ring-1 ring-rose-500/30'
		];
		const index = Math.abs(hash) % colors.length;
		return colors[index];
	}

	function getProjectStatusBadgeClass(status: string | null): string {
		if (!status) return 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30';
		const s = status.toLowerCase().trim();
		if (s.includes('progress') || s === 'on_progress') {
			return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
		}
		if (s === 'repair') {
			return 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30';
		}
		if (s === 'waiting' || s === 'prepare' || s === 'draft') {
			return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
		}
		if (s === 'hold') {
			return 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30';
		}
		if (s === 'complete' || s === 'done' || s === 'closed') {
			return 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30';
		}
		return 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30';
	}

	function getReportStatus(projectId: number) {
		return todayReports[projectId] ? 'Sudah lapor' : 'Belum lapor';
	}

	function getReportStatusClass(projectId: number) {
		return todayReports[projectId] ? 'ok' : 'warn';
	}

	function getStatusDotColor(status: string | null): string {
		if (!status) return 'bg-slate-400';
		const s = status.toLowerCase().trim();
		if (s.includes('progress') || s === 'on_progress') return 'bg-emerald-500 animate-pulse ring-2 ring-emerald-500/20';
		if (s === 'repair') return 'bg-teal-400 ring-2 ring-teal-400/20';
		if (s === 'waiting' || s === 'prepare' || s === 'draft') return 'bg-amber-400 ring-2 ring-amber-400/20';
		if (s === 'hold') return 'bg-orange-500 ring-2 ring-orange-500/20';
		if (s === 'complete' || s === 'done' || s === 'closed') return 'bg-blue-400 ring-2 ring-blue-400/20';
		return 'bg-slate-400';
	}

	onMount(() => {
		if (typeof document !== 'undefined') {
			document.addEventListener('fullscreenchange', handleFullscreenChange);
		}
		fetchProjects().then(() => {
			loading = false;
		});
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
		}
	});


	async function fetchProjects(isLoadMore = false) {
		if (getProjectScope().kosong) {
			if (!isLoadMore) projects = [];
			hasMore = false;
			loading = false;
			return;
		}

		if (isLoadMore) {
			loadingMore = true;
		} else {
			offset = 0;
			hasMore = true;
		}

		try {
			const options = {
				limit,
				offset,
				search: searchQuery,
				sort: sortOption,
				filterStatus: filterOption
			};

			const newProjects = await getProjectsForCurrentUser(false, options);

			if (newProjects.length < limit) hasMore = false;

			if (isLoadMore) {
				projects = [...projects, ...newProjects];
			} else {
				projects = newProjects;
			}
			offset += limit;
			loading = false; // Langsung tampilkan proyek ke layar seketika

			if (newProjects.length > 0) {
				const tzOffset = (new Date()).getTimezoneOffset() * 60000;
				const today = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
				const projectIds = newProjects.map((p: any) => p.id);
				const soIds = [...new Set(newProjects
					.map((p: any) => typeof p.so_customer_id === 'object' ? p.so_customer_id?.id : p.so_customer_id)
					.filter(Boolean)
					.map(Number)
				)];

				// Query status laporan hari ini, charter, dan skor WPO di latar belakang (tanpa memblokir render tabel/kartu)
				Promise.all([
					getBatchedTodayReports(projectIds, today),
					soIds.length > 0
						? secureDirectusJson(`/items/project_charters?filter[so_customer_id][_in]=${soIds.join(',')}&fields=id,so_customer_id,status&limit=-1`).catch(() => ({ data: [] }))
						: Promise.resolve({ data: [] }),
					secureDirectusJson(`/items/client_compliance_evaluation?filter[project_id][_in]=${projectIds.join(',')}&fields=project_id,score&limit=-1`).catch(() => ({ data: [] }))
				]).then(([batchedReports, chartersRes, complianceRes]) => {
					const charterMap = new Map<number, string>();
					for (const c of (chartersRes.data || [])) {
						const sId = typeof c.so_customer_id === 'object' ? c.so_customer_id?.id : c.so_customer_id;
						if (sId != null) charterMap.set(Number(sId), c.status || 'draft');
					}

					const updatedReports = { ...todayReports };
					const updatedCharters = { ...projectCharterStatuses };
					const updatedCompliance = { ...wpoCompliance };

					for (const row of (complianceRes.data || [])) {
						updatedCompliance[row.project_id] = row.score;
					}

					newProjects.forEach((p: any) => {
						const hasToday = (batchedReports || []).some((r: any) =>
							r.project_id === p.id && (r.date || '').split('T')[0] === today
						);
						updatedReports[p.id] = hasToday;

						const sId = typeof p.so_customer_id === 'object' ? p.so_customer_id?.id : p.so_customer_id;
						if (sId != null) {
							updatedCharters[p.id] = charterMap.get(Number(sId)) || 'draft';
						}
					});

					todayReports = updatedReports;
					projectCharterStatuses = updatedCharters;
					wpoCompliance = updatedCompliance;
				}).catch((err) => {
					console.warn('Gagal memuat status laporan/charter/WPO latar belakang:', err);
				});
			}
		} catch (e) {
			console.error('Gagal memuat proyek:', e);
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	// Fase 3 plan PO Jasa (10 Okt 2026): proyek yang belum jalan (Waiting/Prepare) = "calon proyek".
	// Leader diberi jalan pintas ke Pra-Mobilisasi agar bisa menyiapkan regu & alat lebih awal.
	function isPreProject(status: string | null | undefined): boolean {
		const s = (status || '').toLowerCase();
		return s === 'waiting' || s === 'prepare';
	}

	function handleSearchChange() {
		fetchProjects();
	}
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
	<!-- Topbar -->
	<div class="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/90 dark:border-slate-800 sticky top-0 z-30 shadow-2xs">
		<div class="px-5 md:px-6 py-3.5 flex items-center justify-between flex-wrap gap-3">
			<div class="flex items-center gap-3.5">
				<a
					href="/proyek/hub"
					data-sveltekit-preload-data="hover"
					class="p-2.5 rounded-xl text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 bg-slate-100/90 hover:bg-blue-50 dark:bg-slate-800/90 dark:hover:bg-blue-950/40 border border-slate-200/80 hover:border-blue-300/80 dark:border-slate-700/80 dark:hover:border-blue-700/80 transition-all shrink-0 active:scale-95 flex items-center justify-center group"
					title="Kembali ke Hub Departemen Project"
					aria-label="Kembali ke Hub Project"
				>
					<IconArrowLeft size={18} class="transition-transform group-hover:-translate-x-0.5" />
				</a>
				<div class="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/25 text-white border border-blue-400/30 shrink-0">
					<IconStack2 size={22} />
				</div>
				<div>
					<h1 class="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-none mb-1">Proyek Saya</h1>
					<p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Daftar dan status proyek terkini</p>
				</div>
			</div>

			<div class="flex items-center gap-2">
				<a
					href="/proyek/hub"
					data-sveltekit-preload-data="hover"
					class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800/90 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-700/80 transition-all active:scale-95 shadow-2xs"
					title="Lihat semua menu modul proyek"
				>
					<IconLayoutGrid size={15} class="text-blue-500" />
					<span class="hidden sm:inline">Hub Modul Project</span>
				</a>

				<!-- Fullscreen Toggle Button -->
				<button
					class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800/90 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-700/80 transition-all active:scale-95 shadow-2xs"
					onclick={toggleFullscreen}
					title={isFullscreen ? 'Keluar dari Layar Penuh' : 'Tampilan Layar Penuh'}
				>
					{#if isFullscreen}
						<IconMinimize size={16} class="text-blue-500" />
						<span class="hidden sm:inline">Keluar Full Screen</span>
					{:else}
						<IconMaximize size={16} class="text-blue-500" />
						<span class="hidden sm:inline">Full Screen</span>
					{/if}
				</button>
			</div>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex items-center justify-center p-6">
			<CircularProgressGauge
				percent={proyekLoadPercent}
				step={proyekLoadStep}
				totalSteps={4}
				stepLabel={proyekLoadLabel}
				subLabel="Directus /items/projects (Dashboard Lapangan)"
				hint="Memuat daftar proyek lapangan, KPI status, dan kesiapan operasional"
				timeoutSeconds={25}
				onRetry={() => fetchProjects(false)}
			/>
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto px-4 md:px-6 py-6 pb-24">
			
			<div class="w-full">
				<!-- KPI Ringkasan Status Proyek -->
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
					<!-- Card 1: Total Proyek -->
					<div class="rounded-2xl p-4.5 flex flex-col relative overflow-hidden bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/80 border-t-[3px] border-t-blue-500 shadow-sm hover-lift transition-all">
						<div class="flex items-center justify-between mb-2">
							<span class="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Total Proyek</span>
							<div class="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center font-bold">
								<IconStack2 size={18} />
							</div>
						</div>
						<div class="flex items-baseline gap-1.5 mt-auto">
							<span class="text-2xl font-black tracking-tight text-slate-900 dark:text-white font-mono">{totalProjectsCount}</span>
							<span class="text-xs font-semibold text-slate-500 dark:text-slate-400">terdaftar</span>
						</div>
					</div>

					<!-- Card 2: On Progress -->
					<div class="rounded-2xl p-4.5 flex flex-col relative overflow-hidden bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/80 border-t-[3px] border-t-emerald-500 shadow-sm hover-lift transition-all">
						<div class="flex items-center justify-between mb-2">
							<span class="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">On Progress</span>
							<div class="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold">
								<IconActivity size={18} />
							</div>
						</div>
						<div class="flex items-baseline gap-1.5 mt-auto">
							<span class="text-2xl font-black tracking-tight text-emerald-600 dark:text-emerald-400 font-mono">{onProgressCount}</span>
							<span class="text-xs font-semibold text-slate-500 dark:text-slate-400">aktif</span>
						</div>
					</div>

					<!-- Card 3: Waiting / Hold -->
					<div class="rounded-2xl p-4.5 flex flex-col relative overflow-hidden bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/80 border-t-[3px] border-t-amber-500 shadow-sm hover-lift transition-all">
						<div class="flex items-center justify-between mb-2">
							<span class="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Waiting / Hold</span>
							<div class="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center font-bold">
								<IconHourglassHigh size={18} />
							</div>
						</div>
						<div class="flex items-baseline gap-1.5 mt-auto">
							<span class="text-2xl font-black tracking-tight text-amber-600 dark:text-amber-400 font-mono">{waitingCount}</span>
							<span class="text-xs font-semibold text-slate-500 dark:text-slate-400">proyek</span>
						</div>
					</div>

					<!-- Card 4: Lapor Hari Ini -->
					<div class="rounded-2xl p-4.5 flex flex-col relative overflow-hidden bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/80 border-t-[3px] border-t-indigo-500 shadow-sm hover-lift transition-all">
						<div class="flex items-center justify-between mb-2">
							<span class="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Lapor Hari Ini</span>
							<div class="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold">
								<IconClipboardCheck size={18} />
							</div>
						</div>
						<div class="flex items-baseline justify-between mt-auto">
							<div class="flex items-baseline gap-1.5">
								<span class="text-2xl font-black tracking-tight text-indigo-600 dark:text-indigo-400 font-mono">{reportedTodayCount}</span>
								<span class="text-xs font-semibold text-slate-500 dark:text-slate-400">/ {totalProjectsCount} proyek</span>
							</div>
							<span class="text-xs font-mono font-black px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">{reportedTodayPercentage}%</span>
						</div>
						<div class="w-full bg-slate-200 dark:bg-slate-700/80 h-1.5 rounded-full mt-2.5 overflow-hidden">
							<div class="bg-gradient-to-r from-indigo-500 to-blue-500 h-full rounded-full transition-all duration-500" style="width: {reportedTodayPercentage}%"></div>
						</div>
					</div>
				</div>

				<!-- Keterangan Verifikasi Proyek -->
				<div class="mb-6 p-4 rounded-2xl bg-amber-500/10 dark:bg-amber-950/40 border border-amber-400/40 dark:border-amber-500/30 border-l-4 border-l-amber-500 text-amber-900 dark:text-amber-200 flex items-start gap-3 shadow-2xs">
					<div class="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5 text-amber-600 dark:text-amber-400">
						<IconInfoCircle size={18} />
					</div>
					<div class="text-xs leading-relaxed">
						<strong class="font-bold text-amber-950 dark:text-amber-200">Perhatian:</strong> Pastikan daftar di bawah ini terdapat proyek yang Anda pegang. Jika proyek Anda tidak tampil atau terdapat proyek yang bukan milik Anda, harap hubungi <strong class="text-amber-950 dark:text-amber-100 underline decoration-amber-500/50">Admin</strong>.
					</div>
				</div>

				<!-- Filter & Search -->
				<div class="mb-6 rounded-2xl p-4 shadow-sm bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/80">
					<FilterSort
						bind:searchQuery
						bind:sortOption
						bind:filterOption
						{sortOptions}
						{filterOptions}
						multiple={true}
						placeholder="Cari proyek, lokasi, leader..."
						onSearch={handleSearchChange}
						onSortChange={handleSearchChange}
						onFilterChange={handleSearchChange}
					/>
				</div>

				{#if projects.length === 0}
					<div class="rounded-3xl p-12 text-center bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/80 shadow-sm">
						<div class="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center mx-auto mb-4 border border-slate-200 dark:border-slate-700">
							<IconBuilding size={38} class="text-slate-400 dark:text-slate-400" />
						</div>
						<p class="text-base font-bold text-slate-800 dark:text-slate-100">Tidak Ditemukan</p>
						<p class="text-sm mt-1 text-slate-500 dark:text-slate-400 font-medium">
							{#if searchQuery || filterOption}
								Tidak ada proyek yang cocok dengan filter / pencarian.
							{:else}
								Belum ada proyek.
							{/if}
						</p>
					</div>
				{:else}
					<!-- Desktop View (Table) -->
					<div class="hidden md:block rounded-2xl overflow-hidden mb-6 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/80 shadow-sm">
						<div class="overflow-x-auto">
							<table class="w-full text-left border-collapse min-w-max">
								<thead>
									<tr class="border-b border-slate-200 dark:border-slate-700/90 bg-slate-100/95 dark:bg-slate-900/80">
										<th class="py-3.5 px-6 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">ID</th>
										<th class="py-3.5 px-6 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Proyek & No. PO</th>
										<th class="py-3.5 px-6 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Lokasi</th>
										<th class="py-3.5 px-6 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Leader</th>
										<th class="py-3.5 px-6 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Status Proyek</th>
										<th class="py-3.5 px-6 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Status Laporan</th>
										<th class="py-3.5 px-6 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 text-right">Aksi</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-200/70 dark:divide-slate-700/60">
									{#each projects as project}
										{@const parsed = parseProjectName(project.name)}
										<tr class="hover:bg-blue-50/40 dark:hover:bg-slate-700/50 transition-colors cursor-pointer group" onclick={() => goto(`/proyek/${project.id}`)}>
											<!-- ID Column -->
											<td class="py-4 px-6 whitespace-nowrap">
												<span class="font-mono text-xs px-2.5 py-1 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-bold border border-blue-500/30 shadow-2xs">ID-{project.id}</span>
											</td>

											<!-- Proyek Column -->
											<td class="py-4 px-6 max-w-sm">
												<div class="flex items-start gap-3 py-0.5">
													<div class="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 shadow-2xs mt-0.5">
														<IconBuilding size={20} />
													</div>
													<div class="flex flex-col min-w-0">
														<span class="text-[13.5px] font-extrabold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug line-clamp-2">
															{parsed.mainName}
														</span>
														{#if parsed.poNumber}
															<span class="inline-flex items-center gap-1 mt-1 text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-900/90 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 w-fit">
																<IconFileText size={12} class="text-slate-400 dark:text-slate-500 shrink-0" />
																{parsed.poNumber}
															</span>
														{/if}
													</div>
												</div>
											</td>

											<!-- Lokasi Column -->
											<td class="py-4 px-6 whitespace-nowrap">
												{#if project.lokasi && project.lokasi !== '-'}
													<div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-900/70 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold max-w-[200px]">
														<IconMapPin size={14} class="text-rose-500 shrink-0" />
														<span class="truncate">{project.lokasi}</span>
													</div>
												{:else}
													<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100/60 dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 text-xs font-medium border border-dashed border-slate-300 dark:border-slate-700">
														<IconMapPinOff size={13} class="shrink-0 text-slate-400 dark:text-slate-500" />
														<span>Tanpa Lokasi</span>
													</span>
												{/if}
											</td>

											<!-- Leader Column -->
											<td class="py-4 px-6 whitespace-nowrap">
												{#if (project.leader && project.leader !== '-') || (project.co_leader && project.co_leader !== '-')}
													<div class="flex items-center gap-2.5">
														<div class="w-7 h-7 rounded-full bg-gradient-to-tr {getLeaderAvatarBg(project.leader || project.co_leader)} flex items-center justify-center text-[10.5px] font-black tracking-tight shadow-2xs shrink-0">
															{getLeaderInitials(project.leader || project.co_leader)}
														</div>
														<div class="flex flex-col gap-0.5">
															{#if project.leader && project.leader !== '-'}
																<div class="flex items-center gap-1.5">
																	<span class="text-xs font-bold text-slate-800 dark:text-slate-100 truncate max-w-[150px]">{project.leader}</span>
																	{#if project.co_leader}
																		<span class="text-[9px] px-1 py-0.2 rounded font-semibold bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-300/40">Lead</span>
																	{/if}
																</div>
															{/if}
															{#if project.co_leader && project.co_leader !== '-'}
																<div class="flex items-center gap-1.5">
																	<span class="text-[11px] font-semibold text-teal-700 dark:text-teal-300 truncate max-w-[150px]">{project.co_leader}</span>
																	<span class="text-[9px] px-1 py-0.2 rounded font-semibold bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-300/40">Co-Leader</span>
																</div>
															{/if}
															{#if isDemisionerLeader(project)}
																<span class="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 w-fit" title="Anda adalah mantan Project Leader pada proyek ini">
																	Demisioner (Read-Only)
																</span>
															{/if}
														</div>
													</div>
												{:else}
													<div class="flex flex-col">
														<span class="text-slate-400 dark:text-slate-600 text-xs italic">-</span>
														{#if isDemisionerLeader(project)}
															<span class="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 w-fit">
																Demisioner (Read-Only)
															</span>
														{/if}
													</div>
												{/if}
											</td>

											<!-- Status Proyek Column -->
											<td class="py-4 px-6 whitespace-nowrap">
												<div class="flex flex-col gap-1 items-start">
													<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-2xs {getProjectStatusBadgeClass(project.status)}">
														<span class="w-2 h-2 rounded-full {getStatusDotColor(project.status)}"></span>
														{getProjectStatusLabel(project.status)}
													</span>
													{#if projectCharterStatuses[project.id] === 'draft'}
														<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-bold">
															📋 Isi Charter
														</span>
													{/if}
													{#if projectCharterStatuses[project.id] === 'submitted'}
														<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 text-[10px] font-bold" title="Charter sudah Anda ajukan, menunggu persetujuan admin">
															⏳ Charter Menunggu Approval
														</span>
													{/if}
													{#if isPreProject(project.status)}
														<a href="/pra-mobilisasi/{project.id}" onclick={(e) => e.stopPropagation()} class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] font-bold hover:bg-emerald-500/25" title="Calon proyek: siapkan regu, alat, dan checklist sebelum berangkat ke site">
															🧰 Pra-Mobilisasi →
														</a>
													{/if}
													{#if duplicateSoProjectIds.has(project.id)}
														<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30 text-[10px] font-bold" title="Ada project lain dengan nomor PO yang sama -- hubungi admin sebelum lapor di sini">
														⚠️ Project Ganda
													</span>
													{/if}
													{#if wpoCompliance[project.id] != null && wpoCompliance[project.id] < 100}
														<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md {wpoCompliance[project.id] >= 50 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' : 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30'} border text-[10px] font-bold" title="Kelengkapan dokumen WPO untuk klien proyek ini">
															📋 WPO {wpoCompliance[project.id]}%
														</span>
													{/if}
												</div>
											</td>

											<!-- Status Laporan Column -->
											<td class="py-4 px-6 whitespace-nowrap">
												{#if todayReports[project.id]}
													<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-xs font-black shadow-2xs">
														<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
														Sudah Lapor
													</span>
												{:else}
													<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs font-black shadow-2xs">
														<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
														Belum Lapor
													</span>
												{/if}
											</td>

											<!-- Aksi Column -->
											<td class="py-4 px-6 text-right whitespace-nowrap">
												<div class="flex items-center justify-end gap-2">
													<button
														class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 transition-all border border-slate-200 dark:border-slate-700 active:scale-95 shadow-2xs"
														onclick={(e) => { e.stopPropagation(); goto(`/timeline/${project.id}`); }}
														title="Lihat Timeline Proyek"
													>
														<IconCalendarTime size={15} class="text-blue-500" />
														<span>Timeline</span>
													</button>
													<button
														class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all active:scale-95 shadow-xs shadow-blue-500/30 border border-blue-500"
														onclick={(e) => { e.stopPropagation(); goto(`/proyek/${project.id}`); }}
														title="Buka Detail Proyek"
													>
														<span>Detail</span>
														<IconExternalLink size={14} />
													</button>
												</div>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>

					<!-- Mobile View (Cards) -->
					<div class="md:hidden flex flex-col gap-3.5">
						{#each projects as project}
							{@const parsed = parseProjectName(project.name)}
							<div class="rounded-2xl overflow-hidden hover-lift flex flex-col shadow-sm bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/80 transition-all">
								<button
									class="flex-1 flex flex-col gap-3 text-left p-4.5 focus:outline-none relative"
									onclick={() => goto(`/proyek/${project.id}`)}
								>
									<div class="flex items-start gap-3.5">
										<div class="w-11 h-11 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 shadow-2xs">
											<IconBuilding size={22} />
										</div>
										<div class="flex-1 min-w-0 pt-0.5">
											<div class="flex items-center gap-2 mb-1 flex-wrap">
												<span class="font-mono text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-bold border border-blue-500/30">ID-{project.id}</span>
												{#if project.lokasi && project.lokasi !== '-'}
													<span class="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1 truncate">
														<IconMapPin size={12} class="shrink-0 text-rose-500" />
														{project.lokasi}
													</span>
												{/if}
											</div>
											<h3 class="text-base font-black leading-snug text-slate-900 dark:text-slate-100">{parsed.mainName}</h3>
											{#if parsed.poNumber}
												<div class="mt-1">
													<span class="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-900/90 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
														<IconFileText size={11} class="text-slate-400 dark:text-slate-500" />
														{parsed.poNumber}
													</span>
												</div>
											{/if}
										</div>
									</div>

									<div class="flex items-center gap-2 mt-1 flex-wrap">
										<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border shadow-2xs {getProjectStatusBadgeClass(project.status)}">
											<span class="w-1.5 h-1.5 rounded-full {getStatusDotColor(project.status)}"></span>
											{getProjectStatusLabel(project.status)}
										</span>

										{#if projectCharterStatuses[project.id] === 'draft'}
											<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-extrabold">
												📋 Isi Charter
											</span>
										{/if}

										{#if projectCharterStatuses[project.id] === 'submitted'}
											<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 text-[10px] font-extrabold" title="Charter sudah Anda ajukan, menunggu persetujuan admin">
												⏳ Charter Menunggu Approval
											</span>
										{/if}

										{#if isPreProject(project.status)}
											<a href="/pra-mobilisasi/{project.id}" onclick={(e) => e.stopPropagation()} class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] font-extrabold" title="Calon proyek: siapkan regu, alat, dan checklist sebelum berangkat ke site">
												🧰 Pra-Mobilisasi →
											</a>
										{/if}

										{#if duplicateSoProjectIds.has(project.id)}
											<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30 text-[10px] font-extrabold" title="Ada project lain dengan nomor PO yang sama -- hubungi admin sebelum lapor di sini">
												⚠️ Project Ganda
											</span>
										{/if}

										{#if wpoCompliance[project.id] != null && wpoCompliance[project.id] < 100}
											<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full {wpoCompliance[project.id] >= 50 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' : 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30'} border text-[10px] font-extrabold" title="Kelengkapan dokumen WPO untuk klien proyek ini">
												📋 WPO {wpoCompliance[project.id]}%
											</span>
										{/if}

										{#if todayReports[project.id]}
											<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] font-black">
												<IconCheck size={11} /> Sudah Lapor
											</span>
										{:else}
											<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-black">
												<IconClock size={11} /> Belum Lapor
											</span>
										{/if}

										{#if project.leader && project.leader !== '-'}
											<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 ml-auto truncate max-w-[130px] flex items-center gap-1" title="Lead PIC: {project.leader}">
												<IconUser size={10} />
												{project.leader}
											</span>
										{/if}
										{#if project.co_leader && project.co_leader !== '-'}
											<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/50 flex items-center gap-1" title="Co-Leader: {project.co_leader}">
												🤝 {project.co_leader}
											</span>
										{/if}
										{#if isDemisionerLeader(project)}
											<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 flex items-center gap-1" title="Anda adalah mantan leader proyek ini (Akses Read-Only)">
												📁 Demisioner
											</span>
										{/if}
									</div>
								</button>
								<div class="border-t border-slate-200 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-900/60 p-2.5 flex gap-2">
									<button
										class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition-all shadow-2xs"
										onclick={() => goto(`/timeline/${project.id}`)}
									>
										<IconCalendarTime size={16} class="text-blue-500" /> Timeline
									</button>
									<button
										class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white active:scale-95 transition-all shadow-2xs shadow-blue-500/20"
										onclick={() => goto(`/proyek/${project.id}`)}
									>
										Detail <IconExternalLink size={15} />
									</button>
								</div>
							</div>
						{/each}
					</div>

					<div class="mt-6">
						<InfiniteScroll {hasMore} loading={loadingMore} onloadmore={() => fetchProjects(true)} />
					</div>
				{/if}
				
			</div>
		</div>
	{/if}
</div>
