<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		IconArrowLeft, IconPackage, IconBox, IconFileText,
		IconEdit, IconCheck, IconLoader2, IconTruck, IconMinus,
		IconPlus, IconBuilding, IconMapPin, IconCircleCheck, IconTools
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { getProjectInventory, updateMaterialUsage } from '$lib/services/packingList';
	import { getProjectById } from '$lib/services/projects';
	import { authStore } from '$lib/stores/auth';
	import { bolehAksesProyek } from '$lib/services/projectScope';
	import ColorChip from '$lib/components/packing-list/ColorChip.svelte';
	import { isPaintItem, cleanColor } from '$lib/shared/paintColorUtils';

	let projectId = $derived(Number($page.params.project_id));
	let project = $state<any>(null);
	let inventory = $state<any[]>([]);
	let loading = $state(true);

	// Material usage edit
	let editingItem = $state<number | null>(null);
	let editQtyUsed = $state(0);
	let savingUsage = $state(false);

	onMount(async () => {
		const auth = get(authStore);
		try {
			const [projResult, invResult] = await Promise.all([
				getProjectById(projectId, auth.directusToken),
				getProjectInventory(projectId)
			]);
			if (!bolehAksesProyek(projResult)) {
				goto('/packing-list');
				return;
			}
			project = projResult;
			inventory = invResult || [];
		} catch (e) {
			console.error('Gagal memuat data:', e);
			goto('/packing-list');
		} finally {
			loading = false;
		}
	});

	function formatCurrency(val: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0);
	}

	function getUsagePercent(item: any) {
		if (!item.qty || item.qty === 0) return 0;
		return Math.min(100, Math.round(((item.qty_used || 0) / item.qty) * 100));
	}


	function startEditUsage(item: any) {
		editingItem = item.id;
		editQtyUsed = item.qty_used || 0;
	}

	function cancelEditUsage() {
		editingItem = null;
		editQtyUsed = 0;
	}

	function stepUsage(delta: number, maxQty: number) {
		editQtyUsed = Math.min(maxQty, Math.max(0, (editQtyUsed || 0) + delta));
	}

	function setUsage(val: number, maxQty: number) {
		editQtyUsed = Math.min(maxQty, Math.max(0, val));
	}

	async function saveUsage(item: any) {
		savingUsage = true;
		try {
			const success = await updateMaterialUsage(item.id, editQtyUsed, item.qty || 0);
			if (success) {
				inventory = inventory.map(i => {
					if (i.id === item.id) {
						return { ...i, qty_used: editQtyUsed, qty_remaining: (i.qty || 0) - editQtyUsed };
					}
					return i;
				});
				editingItem = null;
			} else {
				alert('Gagal menyimpan pemakaian.');
			}
		} catch {
			alert('Terjadi kesalahan.');
		} finally {
			savingUsage = false;
		}
	}

	// Summary stats
	let totalItems = $derived(inventory.length);
	let totalQty = $derived(inventory.reduce((a, i) => a + (Number(i.qty) || 0), 0));
	let totalUsed = $derived(inventory.reduce((a, i) => a + (Number(i.qty_used) || 0), 0));
	let totalRemaining = $derived(inventory.reduce((a, i) => a + (Number(i.qty_remaining) || ((Number(i.qty) || 0) - (Number(i.qty_used) || 0))), 0));
	let totalValue = $derived(inventory.reduce((a, i) => a + (Number(i.expense_amount) || 0), 0));
</script>

<div class="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950">

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat packing list proyek..." />
		</div>
	{:else}
		<div class="scroll-body flex-1 overflow-y-auto px-3 sm:px-4 py-3.5 max-w-4xl mx-auto w-full">
			<!-- Back & Project Header -->
			<div class="flex items-center gap-2 mb-3">
				<button
					type="button"
					class="w-8 h-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
					onclick={() => goto('/packing-list')}
				>
					<IconArrowLeft size={18} />
				</button>
				<div class="min-w-0 flex-1">
					<h2 class="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
						{project?.name || 'Proyek'}
					</h2>
					<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
						{project?.lokasi || '-'} · ID-{projectId}
					</p>
				</div>
			</div>

			<!-- Summary Stats -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3.5">
				<div class="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-2.5">
					<div class="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-800/60 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400">
						<IconBox size={18} />
					</div>
					<div class="min-w-0">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">Material</p>
						<strong class="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">{totalItems}</strong>
					</div>
				</div>

				<div class="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-2.5">
					<div class="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/60 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400">
						<IconTruck size={18} />
					</div>
					<div class="min-w-0">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">Total Masuk</p>
						<strong class="text-sm sm:text-base font-bold text-indigo-600 dark:text-indigo-400">{totalQty}</strong>
					</div>
				</div>

				<div class="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-2.5">
					<div class="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-100 dark:border-amber-800/60 flex items-center justify-center shrink-0 text-amber-600 dark:text-amber-400">
						<IconTools size={18} />
					</div>
					<div class="min-w-0">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">Terpakai</p>
						<strong class="text-sm sm:text-base font-bold text-amber-600 dark:text-amber-400">{totalUsed}</strong>
					</div>
				</div>

				<div class="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-2.5">
					<div class="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-800/60 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400">
						<IconCircleCheck size={18} />
					</div>
					<div class="min-w-0">
						<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">Sisa On-Hand</p>
						<strong class="text-sm sm:text-base font-bold text-emerald-600 dark:text-emerald-400">{totalRemaining}</strong>
					</div>
				</div>
			</div>

			<!-- Material List -->
			{#if inventory.length === 0}
				<div class="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8">
					<div class="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center mx-auto mb-3 text-blue-600">
						<IconBox size={28} />
					</div>
					<p class="text-sm font-bold text-slate-800 dark:text-slate-100">Belum ada material tercatat di proyek ini</p>
					<p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
						Material akan masuk ke inventory saat Surat Jalan (SJ) dikonfirmasi diterima di proyek.
					</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each inventory as inv}
						{@const usagePct = getUsagePercent(inv)}
						{@const qtySent = Number(inv.qty) || 0}
						{@const qtyUsed = Number(inv.qty_used) || 0}
						{@const rem = inv.qty_remaining ?? (qtySent - qtyUsed)}
						{@const colorVal = cleanColor(inv.material_color)}
						{@const healthStatus = rem <= 0 ? 'habis' : (qtySent > 0 && rem / qtySent <= 0.2) ? 'menipis' : 'aman'}

						<div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 p-3.5 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all space-y-2.5">
							<!-- Header -->
							<div class="flex items-start justify-between gap-2.5">
								<div class="flex items-start gap-2.5 min-w-0 flex-1">
									<div class="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-800/60 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 mt-0.5">
										<IconPackage size={16} />
									</div>
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-1.5 flex-wrap">
											<p class="text-xs sm:text-[13.5px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
												{inv.material_name || inv.description || 'Material Proyek'}
											</p>
											{#if colorVal}
												<span class="text-[9.5px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
													<ColorChip color={colorVal} size="xs" />
												</span>
											{:else if isPaintItem(inv.material_name || inv.description)}
												<span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300">
													⚠️ Butuh Warna
												</span>
											{/if}
										</div>
										{#if inv.reference_number}
											<div class="flex items-center gap-1 text-[10.5px] text-indigo-600 dark:text-indigo-400 mt-0.5">
												<IconFileText size={11} /> SJ: {inv.reference_number}
											</div>
										{/if}
									</div>
								</div>

								<!-- Health Tag -->
								<div class="shrink-0">
									{#if healthStatus === 'habis'}
										<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold border flex items-center gap-1 bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800">
											<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
											<span>Habis</span>
										</span>
									{:else if healthStatus === 'menipis'}
										<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold border flex items-center gap-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800">
											<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
											<span>Menipis</span>
										</span>
									{:else}
										<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold border flex items-center gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800">
											<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
											<span>Stok Aman</span>
										</span>
									{/if}
								</div>
							</div>

							<!-- 3-Column Metric Box -->
							<div class="grid grid-cols-3 gap-2 text-center">
								<div class="bg-slate-50 dark:bg-slate-800/80 rounded-xl p-2 sm:p-2.5 border border-slate-200/60 dark:border-slate-700/60">
									<p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Dikirim</p>
									<p class="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">{qtySent} <span class="text-[10px] font-normal text-slate-400">{inv.unit || 'Pcs'}</span></p>
								</div>
								<div class="bg-amber-50/40 dark:bg-amber-950/20 rounded-xl p-2 sm:p-2.5 border border-amber-200/50 dark:border-amber-900/30">
									<p class="text-[9.5px] text-amber-600/80 dark:text-amber-400/80 font-bold uppercase tracking-wider mb-0.5">Terpakai</p>
									<p class="text-xs sm:text-sm font-bold text-amber-600 dark:text-amber-400">{qtyUsed} <span class="text-[10px] font-normal text-amber-500/80">{inv.unit || 'Pcs'}</span></p>
								</div>
								<div class="bg-emerald-50/50 dark:bg-emerald-950/30 rounded-xl p-2 sm:p-2.5 border border-emerald-200/60 dark:border-emerald-900/40">
									<p class="text-[9.5px] text-emerald-600/80 dark:text-emerald-400/80 font-bold uppercase tracking-wider mb-0.5">Sisa On-Hand</p>
									<p class="text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400">{rem} <span class="text-[10px] font-normal text-emerald-500/80">{inv.unit || 'Pcs'}</span></p>
								</div>
							</div>

							<!-- Progress Bar -->
							<div class="pt-1">
								<div class="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1 font-medium">
									<span>Pemakaian: <strong class="text-slate-800 dark:text-slate-200">{usagePct}%</strong></span>
									<span class="font-bold {rem <= 0 ? 'text-rose-600' : rem / (qtySent || 1) <= 0.2 ? 'text-amber-600' : 'text-emerald-600'}">
										Sisa {rem} {inv.unit || 'Pcs'} ({100 - usagePct}%)
									</span>
								</div>
								<div class="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
									<div
										class="h-full rounded-full transition-all duration-300 {usagePct >= 90 ? 'bg-gradient-to-r from-rose-500 to-red-600' : usagePct >= 50 ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-teal-400 to-emerald-500'}"
										style="width: {usagePct}%"
									></div>
								</div>
							</div>

							<!-- Stepper / Update Pemakaian -->
							{#if editingItem === inv.id}
								{@const nextRem = Math.max(0, qtySent - (editQtyUsed || 0))}
								{@const nextPct = qtySent > 0 ? Math.min(100, Math.round(((editQtyUsed || 0) / qtySent) * 100)) : 0}
								<div class="bg-slate-50 dark:bg-slate-800/90 rounded-xl p-3 border border-[var(--g)]/40 dark:border-[var(--g)]/50 shadow-sm space-y-2.5">
									<div class="flex items-center justify-between">
										<label class="text-[11px] text-slate-700 dark:text-slate-200 font-bold block">
											Update Jumlah Pemakaian:
										</label>
										<span class="text-[10px] text-slate-400">Maks: {qtySent} {inv.unit || 'Pcs'}</span>
									</div>

									<div class="flex items-center gap-2">
										<button
											type="button"
											class="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer font-bold disabled:opacity-40"
											onclick={() => stepUsage(-1, qtySent)}
											disabled={editQtyUsed <= 0}
										>
											<IconMinus size={18} />
										</button>

										<input
											type="number"
											class="flex-1 text-center py-2 text-base font-bold border border-slate-300 dark:border-slate-600 rounded-xl outline-none focus:border-[var(--g)] bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
											bind:value={editQtyUsed}
											min="0"
											max={qtySent}
										/>

										<button
											type="button"
											class="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer font-bold disabled:opacity-40"
											onclick={() => stepUsage(1, qtySent)}
											disabled={editQtyUsed >= qtySent}
										>
											<IconPlus size={18} />
										</button>
									</div>

									<!-- Quick Presets -->
									<div class="flex items-center gap-1.5 flex-wrap pt-0.5">
										<span class="text-[10px] text-slate-400 font-medium mr-0.5">Preset:</span>
										<button
											type="button"
											class="px-2 py-0.5 text-[10.5px] font-semibold rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-[var(--g)] cursor-pointer"
											onclick={() => setUsage(0, qtySent)}
										>
											Reset (0)
										</button>
										{#if qtySent >= 1}
											<button
												type="button"
												class="px-2 py-0.5 text-[10.5px] font-semibold rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-[var(--g)] cursor-pointer"
												onclick={() => setUsage(1, qtySent)}
											>
												+1
											</button>
										{/if}
										{#if qtySent >= 5}
											<button
												type="button"
												class="px-2 py-0.5 text-[10.5px] font-semibold rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-[var(--g)] cursor-pointer"
												onclick={() => setUsage(5, qtySent)}
											>
												+5
											</button>
										{/if}
										<button
											type="button"
											class="px-2 py-0.5 text-[10.5px] font-semibold rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:border-amber-400 cursor-pointer font-bold"
											onclick={() => setUsage(qtySent, qtySent)}
										>
											Habiskan Semua ({qtySent})
										</button>
									</div>

									<!-- Live Preview -->
									<div class="p-2 rounded-lg bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/80 text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
										<span>Sisa stok setelah update:</span>
										<strong class="{nextRem === 0 ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400'} font-bold">
											{nextRem} {inv.unit || 'Pcs'} ({nextPct}% terpakai)
										</strong>
									</div>

									<!-- Action Buttons -->
									<div class="flex items-center gap-2 pt-1">
										<button
											type="button"
											class="flex-1 py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-sm hover:opacity-95 active:scale-98 transition-all cursor-pointer border-none disabled:opacity-50"
											style="background: var(--g)"
											onclick={() => saveUsage(inv)}
											disabled={savingUsage}
										>
											{#if savingUsage}
												<IconLoader2 size={15} class="animate-spin" />
												<span>Menyimpan...</span>
											{:else}
												<IconCheck size={15} />
												<span>Simpan Pemakaian</span>
											{/if}
										</button>

										<button
											type="button"
											class="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-300 transition-all cursor-pointer border-none"
											onclick={cancelEditUsage}
											disabled={savingUsage}
										>
											Batal
										</button>
									</div>
								</div>
							{:else}
								<button
									type="button"
									class="w-full py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-[var(--g)] hover:text-white dark:hover:bg-[var(--g)] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-2xs hover:shadow-xs active:scale-[0.99] cursor-pointer"
									onclick={() => startEditUsage(inv)}
								>
									<IconEdit size={14} />
									<span>Update Pemakaian Material</span>
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<div class="h-6"></div>
		</div>
	{/if}
</div>
