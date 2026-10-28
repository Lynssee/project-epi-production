<!-- ProjectDetailModal.svelte — Popup ringkasan detail profil, jadwal, progres & lingkup proyek -->
<script lang="ts">
	import {
		IconX,
		IconBuilding,
		IconBriefcase,
		IconMapPin,
		IconCalendar,
		IconUser,
		IconFileText,
		IconExternalLink,
		IconShieldCheck,
		IconClock,
		IconTrendingUp,
		IconFileInvoice,
		IconListCheck
	} from '@tabler/icons-svelte';
	import { fade, scale } from 'svelte/transition';
	import { onMount } from 'svelte';

	interface Props {
		open: boolean;
		project: any;
		soCustomer?: any;
		soDetails?: any[];
		onClose: () => void;
	}

	let { open = $bindable(false), project, soCustomer = null, soDetails = [], onClose }: Props = $props();

	function formatDate(d: string | null | undefined) {
		if (!d) return '-';
		try {
			return new Intl.DateTimeFormat('id-ID', {
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			}).format(new Date(d));
		} catch {
			return d;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			onClose();
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
		};
	});

	let progressActual = $derived(Number(project?.total_progress || 0));
	let progressTarget = $derived(Number(project?.target_progress || 0));
	let progressDiff = $derived(progressActual - progressTarget);

	let statusBadgeClass = $derived(
		project?.status === 'on progress' || project?.status === 'on_progress'
			? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-300/40'
			: project?.status === 'hold'
			? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300/40'
			: project?.status === 'complete' || project?.status === 'done'
			? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300/40'
			: 'bg-gray-500/15 text-gray-700 dark:text-gray-300 border-gray-300/40'
	);

	let customerName = $derived(
		soCustomer?.customer_name || soCustomer?.nama_customer || project?.customer_name || 'Klien Proyek'
	);
	let poNumber = $derived(project?.nomor_po || soCustomer?.nomor_po || '-');
	let soNumber = $derived(soCustomer?.nomor_so || '-');
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity"
		transition:fade={{ duration: 150 }}
		onclick={onClose}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="relative w-full max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden text-left"
			transition:scale={{ duration: 180, start: 0.96 }}
			onclick={(e) => e.stopPropagation()}
			role="document"
		>
			<!-- Header Modal -->
			<div class="px-5 py-4 border-b border-gray-200 dark:border-slate-800 flex items-start justify-between gap-3 bg-gray-50/80 dark:bg-slate-850">
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 flex-wrap mb-1">
						<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border {statusBadgeClass}">
							<span class="w-1.5 h-1.5 rounded-full bg-current"></span>
							{project?.status ? String(project.status).toUpperCase() : 'ON PROGRESS'}
						</span>
						{#if project?.id}
							<span class="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-200/70 dark:bg-slate-700 text-gray-700 dark:text-slate-300 font-medium">
								ID #{project.id}
							</span>
						{/if}
						{#if project?.jenis_project}
							<span class="text-[11px] px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-medium border border-blue-200/50 dark:border-blue-800/40">
								{project.jenis_project}
							</span>
						{/if}
					</div>
					<h2 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white leading-snug line-clamp-2">
						{project?.name || 'Detail Proyek'}
					</h2>
					<p class="text-[12px] text-gray-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
						<IconBuilding size={14} class="shrink-0 text-blue-600 dark:text-blue-400" />
						<span class="font-medium text-gray-700 dark:text-slate-200">{customerName}</span>
					</p>
				</div>
				<button
					type="button"
					class="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800 dark:hover:text-gray-200 transition-colors cursor-pointer shrink-0"
					onclick={onClose}
					aria-label="Tutup popup"
				>
					<IconX size={20} />
				</button>
			</div>

			<!-- Body Modal (Scrollable) -->
			<div class="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-[13px]">
				<!-- Ringkasan Kunci (Grid 2 kolom) -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-gray-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-gray-100 dark:border-slate-800">
					<div class="flex items-start gap-2.5">
						<div class="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
							<IconFileInvoice size={15} />
						</div>
						<div class="min-w-0">
							<p class="text-[10.5px] uppercase tracking-wide font-medium text-gray-500 dark:text-slate-400">Nomor PO & SO</p>
							<p class="font-semibold text-gray-800 dark:text-white truncate">PO: {poNumber}</p>
							{#if soNumber !== '-'}
								<p class="text-[11px] text-gray-500 dark:text-slate-400">SO: {soNumber}</p>
							{/if}
						</div>
					</div>

					<div class="flex items-start gap-2.5">
						<div class="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
							<IconMapPin size={15} />
						</div>
						<div class="min-w-0">
							<p class="text-[10.5px] uppercase tracking-wide font-medium text-gray-500 dark:text-slate-400">Lokasi / Site</p>
							<p class="font-semibold text-gray-800 dark:text-white line-clamp-2">{project?.lokasi || '-'}</p>
							{#if project?.workshop}
								<p class="text-[11px] text-gray-500 dark:text-slate-400">Workshop: {project.workshop}</p>
							{/if}
						</div>
					</div>

					<div class="flex items-start gap-2.5">
						<div class="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 mt-0.5">
							<IconUser size={15} />
						</div>
						<div class="min-w-0">
							<p class="text-[10.5px] uppercase tracking-wide font-medium text-gray-500 dark:text-slate-400">Project Leader</p>
							<p class="font-semibold text-gray-800 dark:text-white truncate">{project?.leader || '-'}</p>
						</div>
					</div>

					<div class="flex items-start gap-2.5">
						<div class="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
							<IconCalendar size={15} />
						</div>
						<div class="min-w-0">
							<p class="text-[10.5px] uppercase tracking-wide font-medium text-gray-500 dark:text-slate-400">Jadwal Proyek</p>
							<p class="font-semibold text-gray-800 dark:text-white">
								{formatDate(project?.start_date)} — {formatDate(project?.end_date)}
							</p>
							{#if project?.workdays_per_week}
								<p class="text-[11px] text-gray-500 dark:text-slate-400">{project.workdays_per_week} hari kerja / minggu</p>
							{/if}
						</div>
					</div>
				</div>

				<!-- Section Progress Bar -->
				<div class="p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-850">
					<div class="flex items-center justify-between mb-2">
						<div class="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-slate-200">
							<IconTrendingUp size={16} class="text-blue-600 dark:text-blue-400" />
							<span>Capaian Progress Lapangan</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="text-[12px] font-bold text-gray-900 dark:text-white">
								{progressActual}%
							</span>
							{#if progressTarget > 0}
								<span class="text-[11px] text-gray-500 dark:text-slate-400">
									/ target {progressTarget}%
								</span>
							{/if}
							{#if progressTarget > 0}
								<span
									class="text-[10px] font-semibold px-1.5 py-0.5 rounded"
									class:bg-emerald-100={progressDiff >= 0}
									class:text-emerald-700={progressDiff >= 0}
									class:bg-rose-100={progressDiff < 0}
									class:text-rose-700={progressDiff < 0}
								>
									{progressDiff >= 0 ? `+${progressDiff}% Ahead` : `${progressDiff}% Behind`}
								</span>
							{/if}
						</div>
					</div>
					<!-- Bar -->
					<div class="w-full bg-gray-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden relative">
						<div
							class="bg-blue-600 h-full rounded-full transition-all duration-500"
							style="width: {Math.min(100, Math.max(0, progressActual))}%"
						></div>
					</div>
				</div>

				<!-- Deskripsi Proyek -->
				{#if project?.description}
					<div class="p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-850">
						<p class="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1 flex items-center gap-1">
							<IconFileText size={14} /> Catatan / Ruang Lingkup Proyek
						</p>
						<p class="text-gray-700 dark:text-slate-300 text-[12.5px] whitespace-pre-line leading-relaxed">
							{project.description}
						</p>
					</div>
				{/if}

				<!-- Lingkup Pekerjaan & Item Sales Order -->
				<div class="p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-850">
					<div class="flex items-center justify-between mb-2">
						<p class="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 flex items-center gap-1">
							<IconListCheck size={14} /> Lingkup Item Pekerjaan (SO)
						</p>
						<span class="text-[11px] font-medium text-gray-500 dark:text-slate-400">
							{soDetails?.length || 0} aktivitas
						</span>
					</div>

					{#if soDetails && soDetails.length > 0}
						<div class="space-y-2 max-h-48 overflow-y-auto pr-1">
							{#each soDetails as item, idx}
								<div class="p-2.5 rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/40 flex items-start justify-between gap-2">
									<div class="min-w-0">
										<p class="font-semibold text-gray-800 dark:text-slate-200 text-[12.5px]">
											<span class="text-gray-400 mr-1">#{idx + 1}</span>
											{item.nama_barang || item.jenis_jasa || item.item_name || 'Aktivitas Jasa'}
										</p>
										{#if item.spesifikasi || item.deskripsi}
											<p class="text-[11px] text-gray-500 dark:text-slate-400 line-clamp-1 mt-0.5">
												{item.spesifikasi || item.deskripsi}
											</p>
										{/if}
									</div>
									<div class="text-right shrink-0">
										<span class="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-white dark:bg-slate-700 text-gray-800 dark:text-white border border-gray-200 dark:border-slate-600">
											{item.qty || item.jumlah_pcs || 0} {item.input_unit || item.packing || 'm²'}
										</span>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-[12px] text-gray-400 dark:text-slate-500 italic py-2 text-center">
							Belum ada rincian item pekerjaan di Sales Order terkait.
						</p>
					{/if}
				</div>

				<!-- Info HSE jika ada -->
				{#if project?.hse_risk_level || project?.hse_work_types}
					<div class="p-3 rounded-xl border border-amber-200/60 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 flex items-center justify-between gap-2">
						<div class="flex items-center gap-2">
							<IconShieldCheck size={18} class="text-amber-600 dark:text-amber-400 shrink-0" />
							<div>
								<span class="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Level Risiko HSE: </span>
								<span class="text-[11px] font-bold text-amber-900 dark:text-amber-200 uppercase">{project?.hse_risk_level || 'Standar'}</span>
							</div>
						</div>
						{#if project?.hse_work_types}
							<span class="text-[10.5px] px-2 py-0.5 rounded bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-amber-200 dark:border-amber-800/50">
								{project.hse_work_types}
							</span>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer Modal -->
			<div class="px-5 py-3 border-t border-gray-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-gray-50/90 dark:bg-slate-850">
				<a
					href="/proyek/{project?.id}"
					target="_blank"
					rel="noreferrer"
					class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
				>
					<span>Buka Lembar Kerja Proyek Lengkap</span>
					<IconExternalLink size={14} />
				</a>

				<button
					type="button"
					class="px-4 py-2 text-[12px] font-semibold rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-800 dark:text-slate-200 transition-colors cursor-pointer"
					onclick={onClose}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}
