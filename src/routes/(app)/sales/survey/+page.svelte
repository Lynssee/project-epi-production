<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getMySurveys, getUpcomingFollowUps, getSalesVisitKpis, type SurveyRow } from '$lib/services/sales';
	import { getMyPoStatusSummary } from '$lib/services/salesPo';
	import SalesNavTabs from '$lib/components/sales/SalesNavTabs.svelte';
	import ProcessGuideLink from '$lib/components/help/ProcessGuideLink.svelte';
	import FieldExportButton from '$lib/components/sales/FieldExportButton.svelte';
	import {
		IconPlus,
		IconLoader2,
		IconClipboardCheck,
		IconSearch,
		IconX,
		IconMapPin,
		IconCalendar,
		IconArrowRight,
		IconBuildingStore,
		IconTool,
		IconRulerMeasure,
		IconUser,
		IconPhone,
		IconBrandWhatsapp,
		IconFileDollar,
		IconAlertCircle,
		IconCheck,
		IconClock
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let surveys = $state<SurveyRow[]>([]);
	let searchQuery = $state('');
	let activeStatusFilter = $state<'all' | 'draft' | 'completed'>('all');
	let activeDateFilter = $state<'all' | 'thisMonth' | 'last7'>('all');
	let sortBy = $state<'newest' | 'area_desc' | 'customer'>('newest');

	let remindersCount = $state(0);
	let poNeedsAttention = $state(0);
	let pendingVisits = $state(0);

	const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
	const monthPrefix = todayStr.slice(0, 7);
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	onMount(async () => {
		try {
			const isSuper = $authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin');
			const surveyorName = isSuper ? null : $authStore.karyawanName;
			const salesId = isSuper ? null : $authStore.karyawanId;

			const [surveyList, reminderList, kpiData] = await Promise.all([
				getMySurveys(surveyorName),
				getUpcomingFollowUps(surveyorName),
				getSalesVisitKpis(salesId)
			]);

			surveys = surveyList;
			remindersCount = reminderList.length;
			pendingVisits = kpiData.menungguVerifikasi;

			if ($authStore.karyawanId) {
				try {
					const poSummary = await getMyPoStatusSummary($authStore.karyawanId);
					poNeedsAttention = (poSummary.belum_ada || 0) + (poSummary.revisi || 0);
				} catch {}
			}
		} catch (e) {
			console.error('[sales/survey] Error loading surveys:', e);
		} finally {
			loading = false;
		}
	});

	// Metrics derived
	let totalSurveys = $derived(surveys.length);
	let draftCount = $derived(surveys.filter((s) => s.status !== 'completed').length);
	let completedCount = $derived(surveys.filter((s) => s.status === 'completed').length);
	let totalAreaCalculated = $derived(
		surveys.reduce((sum, s) => sum + (Number(s.luas_area) || 0), 0)
	);

	function cleanWaNumber(phone?: string | null): string | null {
		if (!phone) return null;
		let digits = phone.replace(/\D/g, '');
		if (!digits) return null;
		if (digits.startsWith('0')) digits = '62' + digits.slice(1);
		else if (digits.startsWith('8')) digits = '62' + digits;
		return digits.length >= 10 ? digits : null;
	}

	let filteredSurveys = $derived.by(() => {
		let list = surveys;

		// 1. Status Filter
		if (activeStatusFilter === 'draft') {
			list = list.filter((s) => s.status !== 'completed');
		} else if (activeStatusFilter === 'completed') {
			list = list.filter((s) => s.status === 'completed');
		}

		// 2. Date Filter
		if (activeDateFilter === 'thisMonth') {
			list = list.filter((s) => (s.tanggal_survey || '').startsWith(monthPrefix));
		} else if (activeDateFilter === 'last7') {
			list = list.filter((s) => (s.tanggal_survey || '') >= sevenDaysAgo);
		}

		// 3. Search Query
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			list = list.filter(
				(s) =>
					(s.customer_name && s.customer_name.toLowerCase().includes(q)) ||
					(s.lokasi_project && s.lokasi_project.toLowerCase().includes(q)) ||
					(s.nomor_survey && s.nomor_survey.toLowerCase().includes(q)) ||
					(s.pic_lapangan && s.pic_lapangan.toLowerCase().includes(q)) ||
					(s.kondisi_permukaan && s.kondisi_permukaan.toLowerCase().includes(q))
			);
		}

		// 4. Sorting
		if (sortBy === 'area_desc') {
			list = [...list].sort((a, b) => (Number(b.luas_area) || 0) - (Number(a.luas_area) || 0));
		} else if (sortBy === 'customer') {
			list = [...list].sort((a, b) => (a.customer_name || '').localeCompare(b.customer_name || ''));
		} else {
			// newest
			list = [...list].sort((a, b) => (b.tanggal_survey || '').localeCompare(a.tanggal_survey || '') || b.id - a.id);
		}

		return list;
	});

	let exportRows = $derived(
		filteredSurveys.map((s) => ({
			no_survey: s.nomor_survey ?? '',
			tanggal: (s.tanggal_survey ?? '').slice(0, 10),
			lokasi: s.lokasi_project ?? '',
			customer: s.customer_name ?? '',
			status: s.status === 'completed' ? 'Selesai' : 'Draft',
			luas_area_m2: s.luas_area ?? 0,
			pic_lapangan: s.pic_lapangan ?? '',
			telp_pic: s.pic_lapangan_telp ?? '',
			kondisi: s.kondisi_permukaan ?? ''
		}))
	);

	function createQuotationFromSurvey(s: SurveyRow, e: Event) {
		e.stopPropagation();
		const params = new URLSearchParams();
		if (s.customer_name) params.set('customer_name', s.customer_name);
		if (s.lokasi_project) {
			params.set('lokasi', s.lokasi_project);
			params.set('project_name', s.lokasi_project);
		}
		if (s.luas_area) params.set('luas', String(s.luas_area));
		goto(`/sales/penawaran/baru?${params.toString()}`);
	}
</script>

<div class="scroll-body">
	<div class="max-w-4xl mx-auto p-4 md:p-6 pb-24">
		<!-- Header -->
		<div class="flex items-center justify-between gap-3 mb-4">
			<div>
				<h1 class="text-[20px] font-black tracking-tight" style="color: var(--sys-label)">Survey Lokasi Lapangan</h1>
				<p class="text-[12px] font-medium mt-0.5" style="color: var(--sys-label3)">Data teknis lapangan, fasilitas & spesifikasi awal penawaran</p>
				<div class="mt-1.5"><ProcessGuideLink fokus="survey" /></div>
			</div>
			<button
				type="button"
				class="h-10 px-4 rounded-xl text-[12px] font-bold text-white flex items-center gap-1.5 shrink-0 shadow-sm shadow-[var(--p,var(--g))]/30 active:scale-95 transition-transform"
				style="background: var(--p, var(--g))"
				onclick={() => goto('/sales/survey/baru')}
			>
				<IconPlus size={16} stroke={2.5} />
				<span>+ Input Survey</span>
			</button>
		</div>

		<!-- Nav Tabs Sub-Menu -->
		<SalesNavTabs
			active="survey"
			{remindersCount}
			poCount={poNeedsAttention}
			pendingCount={pendingVisits}
		/>

		<!-- KPI Metrics Cards -->
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
			<!-- Total Survey -->
			<div class="p-3.5 rounded-2xl border shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-1.5">
					<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Total Survey</span>
					<IconClipboardCheck size={16} class="opacity-60" style="color: var(--p, var(--g))" />
				</div>
				<p class="text-[22px] font-black leading-tight" style="color: var(--sys-label)">{totalSurveys}</p>
				<span class="text-[10px] font-medium" style="color: var(--sys-label4)">Tercatat di sistem</span>
			</div>

			<!-- Selesai (Completed) -->
			<div class="p-3.5 rounded-2xl border shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-1.5">
					<span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Siap Penawaran</span>
					<IconCheck size={16} class="text-emerald-500" />
				</div>
				<p class="text-[22px] font-black leading-tight text-emerald-600 dark:text-emerald-400">{completedCount}</p>
				<span class="text-[10px] font-medium" style="color: var(--sys-label4)">Status selesai</span>
			</div>

			<!-- Draft -->
			<div class="p-3.5 rounded-2xl border shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-1.5">
					<span class="text-[11px] font-bold text-amber-600 dark:text-amber-400">Draf / Belum Selesai</span>
					<IconAlertCircle size={16} class="text-amber-500" />
				</div>
				<p class="text-[22px] font-black leading-tight text-amber-600 dark:text-amber-400">{draftCount}</p>
				<span class="text-[10px] font-medium" style="color: var(--sys-label4)">Perlu kelengkapan data</span>
			</div>

			<!-- Total Luas Area -->
			<div class="p-3.5 rounded-2xl border shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-1.5">
					<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Estimasi Luas Area</span>
					<IconRulerMeasure size={16} class="opacity-60" style="color: var(--p, var(--g))" />
				</div>
				<p class="text-[22px] font-black leading-tight" style="color: var(--sys-label)">
					{totalAreaCalculated.toLocaleString('id-ID')} <span class="text-[12px] font-bold text-zinc-400">m²</span>
				</p>
				<span class="text-[10px] font-medium" style="color: var(--sys-label4)">Akumulasi luas survey</span>
			</div>
		</div>

		<!-- Search Bar & Controls -->
		<div class="flex flex-col gap-2.5 mb-4">
			<div class="flex items-center gap-2">
				<div class="relative flex-1">
					<span class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)">
						<IconSearch size={15} />
					</span>
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Cari customer, project, nomor survey, PIC, spesifikasi..."
						class="w-full h-10 pl-9 pr-8 rounded-xl border text-[12px]"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					/>
					{#if searchQuery}
						<button
							type="button"
							onclick={() => (searchQuery = '')}
							class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1"
							style="color: var(--sys-label4)"
							aria-label="Bersihkan"
						>
							<IconX size={13} />
						</button>
					{/if}
				</div>

				<FieldExportButton
					rows={exportRows}
					filename="survey-lokasi-lapangan"
					title="Survey Lokasi Lapangan"
					label="Export CSV"
					offlineNote="Dari daftar survey yang sedang tampil."
				/>
			</div>

			<!-- Filter Bar: Status, Periode & Sort -->
			<div class="flex items-center justify-between gap-2 flex-wrap">
				<!-- Status Filter Pills -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-all {activeStatusFilter === 'all'
							? 'bg-[var(--p,var(--g))] text-white shadow-sm'
							: 'border'}"
						style={activeStatusFilter !== 'all' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeStatusFilter = 'all')}
					>
						Semua ({totalSurveys})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-all {activeStatusFilter === 'completed'
							? 'bg-emerald-600 text-white shadow-sm'
							: 'border'}"
						style={activeStatusFilter !== 'completed' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeStatusFilter = 'completed')}
					>
						Selesai ({completedCount})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-all {activeStatusFilter === 'draft'
							? 'bg-amber-600 text-white shadow-sm'
							: 'border'}"
						style={activeStatusFilter !== 'draft' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeStatusFilter = 'draft')}
					>
						Draft ({draftCount})
					</button>
				</div>

				<!-- Periode & Sort Controls -->
				<div class="flex items-center gap-2 ml-auto">
					<select
						bind:value={activeDateFilter}
						class="h-8 px-2.5 rounded-lg border text-[11px] font-medium"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					>
						<option value="all">Semua Waktu</option>
						<option value="thisMonth">Bulan Ini</option>
						<option value="last7">7 Hari Terakhir</option>
					</select>

					<select
						bind:value={sortBy}
						class="h-8 px-2.5 rounded-lg border text-[11px] font-medium"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					>
						<option value="newest">Terkini</option>
						<option value="area_desc">Luas Terbesar</option>
						<option value="customer">Customer (A-Z)</option>
					</select>
				</div>
			</div>
		</div>

		{#if loading}
			<div class="py-16 flex justify-center">
				<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Data Survey..." sublabel="Sinkronisasi survey teknis Directus" />
			</div>
		{:else if filteredSurveys.length === 0}
			<div class="text-center py-16 px-4 rounded-2xl border border-dashed my-2" style="border-color: var(--sys-sep)">
				<IconClipboardCheck size={38} style="color: var(--sys-label4); margin: 0 auto" />
				<p class="text-[13px] font-bold mt-3" style="color: var(--sys-label)">
					{searchQuery ? 'Tidak ada survey yang sesuai kriteria pencarian/filter.' : 'Belum ada survey teknis tercatat.'}
				</p>
				<p class="text-[11px] mt-1 mb-4" style="color: var(--sys-label3)">
					Survey lapangan digunakan sebagai acuan estimasi kalkulator penawaran & pembuatan SPK.
				</p>
				<button
					type="button"
					class="px-4 py-2 rounded-xl text-[12px] font-bold text-white inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform"
					style="background: var(--p, var(--g))"
					onclick={() => goto('/sales/survey/baru')}
				>
					<IconPlus size={15} /> Input Survey Baru
				</button>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each filteredSurveys as s (s.id)}
					{@const waNum = cleanWaNumber(s.pic_lapangan_telp)}
					<div
						class="rounded-2xl border p-4 sm:p-5 shadow-sm w-full transition-all hover:border-[var(--p,var(--g))] group"
						style="border-color: var(--sys-sep); background: var(--sys-bg)"
					>
						<!-- Card Header -->
						<div class="flex items-start justify-between gap-3 mb-2">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2 flex-wrap">
									<h2 class="text-[15px] font-bold truncate leading-tight group-hover:text-[var(--p,var(--g))] transition-colors" style="color: var(--sys-label)">
										{s.customer_name || s.lokasi_project}
									</h2>
								</div>
								<div class="flex items-center gap-2 mt-1">
									<span class="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-[var(--p,var(--g))]/10" style="color: var(--p, var(--g))">
										{s.nomor_survey}
									</span>
									{#if s.surveyor}
										<span class="text-[10px] font-medium" style="color: var(--sys-label3)">
											Surveyor: {s.surveyor}
										</span>
									{/if}
								</div>
							</div>

							<!-- Status Pill -->
							{#if s.status === 'completed'}
								<span class="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center gap-1 border border-emerald-500/20">
									<IconCheck size={11} stroke={3} /> Selesai
								</span>
							{:else}
								<span class="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 flex items-center gap-1 border border-amber-500/20">
									<IconAlertCircle size={11} stroke={2.5} /> Draft / Belum Lengkap
								</span>
							{/if}
						</div>

						<!-- Card Key Details Grid -->
						<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-3 pt-2.5 border-t text-[11px]" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-1.5" style="color: var(--sys-label2)">
								<IconMapPin size={14} class="shrink-0 text-rose-500" />
								<span class="truncate" title={s.lokasi_project}>{s.lokasi_project || '-'}</span>
							</div>

							<div class="flex items-center gap-1.5" style="color: var(--sys-label2)">
								<IconCalendar size={14} class="shrink-0 text-blue-500" />
								<span>{s.tanggal_survey ? new Date(s.tanggal_survey).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</span>
							</div>

							<div class="flex items-center gap-1.5" style="color: var(--sys-label2)">
								<IconRulerMeasure size={14} class="shrink-0 text-amber-500" />
								<span>
									Luas: <strong style="color: var(--sys-label)">{s.luas_area ? `${Number(s.luas_area).toLocaleString('id-ID')} m²` : 'Belum diukur'}</strong>
								</span>
							</div>
						</div>

						<!-- PIC & Kondisi Permukaan -->
						<div class="flex flex-wrap items-center justify-between gap-2 mt-2.5 pt-2 border-t text-[11px]" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-2 flex-wrap">
								{#if s.pic_lapangan}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label2)">
										<IconUser size={12} class="opacity-70" />
										PIC: {s.pic_lapangan}
										{#if s.pic_lapangan_telp}
											({s.pic_lapangan_telp})
										{/if}
									</span>
								{/if}

								{#if s.kondisi_permukaan}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium" style="background: var(--sys-fill); color: var(--sys-label3)">
										<IconTool size={12} class="opacity-70" />
										Permukaan: {s.kondisi_permukaan}
									</span>
								{/if}
							</div>

							{#if waNum}
								<a
									href={`https://wa.me/${waNum}`}
									target="_blank"
									rel="noreferrer"
									class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
									onclick={(e) => e.stopPropagation()}
								>
									<IconBrandWhatsapp size={13} /> Chat PIC
								</a>
							{/if}
						</div>

						{#if s.catatan_khusus}
							<div class="mt-2.5 p-2 rounded-xl text-[11px] line-clamp-2" style="background: var(--sys-fill); color: var(--sys-label3)">
								<strong style="color: var(--sys-label2)">Catatan:</strong> {s.catatan_khusus}
							</div>
						{/if}

						<!-- Card Actions Footer -->
						<div class="flex items-center justify-between gap-2 mt-3.5 pt-3 border-t" style="border-color: var(--sys-sep)">
							<button
								type="button"
								class="h-8 px-3 rounded-xl text-[11px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 flex items-center gap-1.5 transition-colors active:scale-95"
								onclick={(e) => createQuotationFromSurvey(s, e)}
							>
								<IconFileDollar size={13} />
								<span>Buat Penawaran</span>
							</button>

							<button
								type="button"
								class="h-8 px-3 rounded-xl text-[11px] font-bold text-white flex items-center gap-1 shadow-sm transition-transform active:scale-95"
								style="background: var(--p, var(--g))"
								onclick={() => goto(`/sales/survey/${s.id}`)}
							>
								<span>Detail & Spesifikasi</span>
								<IconArrowRight size={13} />
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
