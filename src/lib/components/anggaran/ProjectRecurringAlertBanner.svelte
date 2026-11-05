<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		IconRepeat,
		IconAlertTriangle,
		IconCalendarTime,
		IconArrowRight,
		IconChevronDown,
		IconChevronUp,
		IconHome,
		IconTools,
		IconCheck
	} from '@tabler/icons-svelte';
	import type { ProjectRecurringItem } from '$lib/services/recurringProjectApi';
	import { createDraftFromRecurring } from '$lib/services/recurringProjectApi';
	import { authStore } from '$lib/stores/auth';
	import { get } from 'svelte/store';

	let {
		items = [],
		projectsMap = {}
	} = $props<{
		items: ProjectRecurringItem[];
		projectsMap: Record<number, string>;
	}>();

	let isExpanded = $state(true);
	let creatingId = $state<number | null>(null);
	let errorMsg = $state('');

	let dueSoonItems = $derived(items.filter((i) => i.isDueSoon));

	function formatRupiah(val: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			maximumFractionDigits: 0
		}).format(val || 0);
	}

	async function handleCreateAndReviewDraft(item: ProjectRecurringItem) {
		creatingId = item.id;
		errorMsg = '';
		try {
			const auth = get(authStore);
			const pengajuName = auth?.user?.nama || auth?.user?.email || 'Project Leader';
			const draftId = await createDraftFromRecurring(item, pengajuName);
			if (draftId) {
				goto(`/anggaran/${draftId}`);
			}
		} catch (err: any) {
			errorMsg = err.message || 'Gagal membuat draf pengajuan';
		} finally {
			creatingId = null;
		}
	}
</script>

{#if dueSoonItems.length > 0}
	<div class="rounded-2xl border border-amber-300 dark:border-amber-700/60 bg-amber-50/70 dark:bg-amber-950/20 overflow-hidden shadow-xs transition-all">
		<!-- Header Alert -->
		<div class="p-3.5 sm:p-4 flex items-center justify-between gap-3">
			<div class="flex items-center gap-2.5">
				<div class="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs flex-shrink-0">
					<IconRepeat size={18} />
				</div>
				<div>
					<div class="flex items-center gap-2">
						<h3 class="text-xs sm:text-sm font-bold text-amber-900 dark:text-amber-200">
							Pengingat Biaya Rutin Proyek (Sewa Mess &amp; Alat)
						</h3>
						<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200/80 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
							{dueSoonItems.length} Perlu Perhatian
						</span>
					</div>
					<p class="text-[11px] text-amber-700/80 dark:text-amber-400 mt-0.5">
						Biaya berulang memasuki jendela jatuh tempo. Pastikan draf pengajuan diajukan tepat waktu ke Finance.
					</p>
				</div>
			</div>

			<button
				type="button"
				onclick={() => (isExpanded = !isExpanded)}
				class="p-1.5 rounded-lg text-amber-800 dark:text-amber-300 hover:bg-amber-200/50 transition-colors"
				title={isExpanded ? 'Sembunyikan rincian' : 'Tampilkan rincian'}
			>
				{#if isExpanded}
					<IconChevronUp size={18} />
				{:else}
					<IconChevronDown size={18} />
				{/if}
			</button>
		</div>

		{#if errorMsg}
			<div class="px-4 py-2 bg-red-100 text-red-700 text-xs border-t border-red-200">
				{errorMsg}
			</div>
		{/if}

		<!-- Daftar Item Biaya Rutin Proyek -->
		{#if isExpanded}
			<div class="px-3.5 pb-3.5 sm:px-4 sm:pb-4 space-y-2.5 border-t border-amber-200/70 dark:border-amber-800/40 pt-3">
				{#each dueSoonItems as item (item.id)}
					{@const projectName = item.project_id ? projectsMap[item.project_id] : null}
					{@const isOverdue = item.daysRemaining === 0}
					<div class="p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<span class="text-sm">
									{#if item.kategori === 'sewa'}🏠{:else if item.kategori === 'sewa_alat'}⚙️{:else}📋{/if}
								</span>
								<span class="font-bold text-xs text-slate-800 dark:text-slate-100">
									{item.nama_pengeluaran}
								</span>
								<span class="px-2 py-0.5 rounded-full text-[10px] font-bold {isOverdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}">
									{#if isOverdue}
										Hari ini jatuh tempo!
									{:else}
										H-{item.daysRemaining} hari lagi (Tgl {item.hari_generate})
									{/if}
								</span>
							</div>

							<div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
								{#if projectName}
									<span class="text-purple-600 dark:text-purple-400 font-medium">🏗️ {projectName}</span>
									<span>·</span>
								{/if}
								<span>🏢 {item.vendor_penerima || 'Vendor perorangan'}</span>
								<span>·</span>
								<span>Tagihan: <strong class="text-slate-700 dark:text-slate-200">{formatRupiah(item.nominal)}</strong></span>
							</div>
						</div>

						<div class="flex items-center gap-2 flex-shrink-0">
							<button
								type="button"
								onclick={() => handleCreateAndReviewDraft(item)}
								disabled={creatingId === item.id}
								class="w-full sm:w-auto px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition flex items-center justify-center gap-1.5 disabled:opacity-50"
							>
								{#if creatingId === item.id}
									<span>Menyiapkan Draf...</span>
								{:else}
									<span>⚡ Tinjau &amp; Ajukan Draf</span>
									<IconArrowRight size={14} />
								{/if}
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
