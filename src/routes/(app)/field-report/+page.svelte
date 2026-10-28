<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import {
		IconStack2, IconClipboardCheck, IconPackage, IconAlertTriangle,
		IconTruck, IconArrowUpRight, IconArrowDownRight, IconClock, IconLoader2
	} from '@tabler/icons-svelte';
	import {
		getFieldReportKpis, getStockMovements, getPackingPipeline, getUrgentNeeds,
		type FieldReportKpis, type StockMovementRow, type PackingPipelineCount, type UrgentNeedItem
	} from '$lib/services/fieldReport';

	let loading = $state(true);
	let kpis = $state<FieldReportKpis>({
		proyekAktif: 0,
		kepatuhanLaporan: 0,
		materialDipakaiHariIni: 0,
		kebutuhanUrgentOpen: 0
	});
	let movements = $state<StockMovementRow[]>([]);
	let pipeline = $state<PackingPipelineCount>({ requested: 0, approved: 0, delivered: 0 });
	let urgentNeeds = $state<UrgentNeedItem[]>([]);

	async function loadAll() {
		loading = true;
		try {
			const [k, m, p, u] = await Promise.all([
				getFieldReportKpis(),
				getStockMovements(),
				getPackingPipeline(),
				getUrgentNeeds()
			]);
			kpis = k;
			movements = m;
			pipeline = p;
			urgentNeeds = u;
		} finally {
			loading = false;
		}
	}

	onMount(loadAll);
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm">
		<div class="px-6 py-4 flex items-center justify-between">
			<div class="flex items-center gap-4">
				<div class="w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white">
					<IconStack2 size={24} />
				</div>
				<div>
					<h1 class="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-blue-600 tracking-tight">Field Reporting Dashboard</h1>
					<p class="text-xs font-medium" style="color: var(--sys-label3)">Data lapangan & pergerakan material</p>
				</div>
			</div>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat field report proyek..." />
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto px-4 md:px-6 py-6 pb-24">
			<div class="max-w-7xl mx-auto w-full">

				<!-- KPI -->
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
					<div class="glass-panel hover-lift rounded-3xl p-6 flex flex-col relative overflow-hidden border border-white/50 shadow-sm group">
						<div class="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl -mr-8 -mt-8 transition-opacity group-hover:opacity-100"></div>
						<div class="relative z-10">
							<p class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Proyek Aktif</p>
							<div class="flex items-baseline gap-2">
								<p class="text-4xl font-black tracking-tight" style="color: var(--sys-label)">{kpis.proyekAktif}</p>
								<p class="text-sm font-bold" style="color: var(--sys-label3)">proyek</p>
							</div>
						</div>
					</div>

					<div class="glass-panel hover-lift rounded-3xl p-6 flex flex-col relative overflow-hidden shadow-sm group {kpis.kepatuhanLaporan < 70 ? 'bg-red-50/50 border-red-200' : 'border border-white/50'}">
						<div class="absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl -mr-8 -mt-8 transition-opacity group-hover:opacity-100 {kpis.kepatuhanLaporan < 70 ? 'bg-red-500/20' : 'bg-emerald-500/10'}"></div>
						<div class="relative z-10">
							<p class="text-xs font-bold uppercase tracking-wider mb-2 {kpis.kepatuhanLaporan < 70 ? 'text-red-600' : 'text-slate-500'}">Kepatuhan Laporan</p>
							<div class="flex items-baseline gap-2">
								<p class="text-4xl font-black tracking-tight {kpis.kepatuhanLaporan < 70 ? 'text-red-600' : 'text-emerald-600'}">{kpis.kepatuhanLaporan}%</p>
								<p class="text-sm font-bold {kpis.kepatuhanLaporan < 70 ? 'text-red-500/70' : 'text-slate-400'}">bulan ini</p>
							</div>
						</div>
					</div>

					<div class="glass-panel hover-lift rounded-3xl p-6 flex flex-col relative overflow-hidden border border-white/50 shadow-sm group">
						<div class="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl -mr-8 -mt-8 transition-opacity group-hover:opacity-100"></div>
						<div class="relative z-10">
							<p class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Material Dipakai</p>
							<div class="flex items-baseline gap-2">
								<p class="text-4xl font-black tracking-tight" style="color: var(--sys-label)">{kpis.materialDipakaiHariIni}</p>
								<p class="text-sm font-bold" style="color: var(--sys-label3)">hari ini</p>
							</div>
						</div>
					</div>

					<div class="glass-panel hover-lift rounded-3xl p-6 flex flex-col relative overflow-hidden shadow-sm group {kpis.kebutuhanUrgentOpen > 0 ? 'bg-amber-50/50 border-amber-200' : 'border border-white/50'}">
						<div class="absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl -mr-8 -mt-8 transition-opacity group-hover:opacity-100 {kpis.kebutuhanUrgentOpen > 0 ? 'bg-amber-500/20' : 'bg-slate-500/10'}"></div>
						<div class="relative z-10">
							<p class="text-xs font-bold uppercase tracking-wider mb-2 {kpis.kebutuhanUrgentOpen > 0 ? 'text-amber-600' : 'text-slate-500'}">Kebutuhan Urgent</p>
							<div class="flex items-baseline gap-2">
								<p class="text-4xl font-black tracking-tight {kpis.kebutuhanUrgentOpen > 0 ? 'text-amber-600' : 'text-slate-700'}">{kpis.kebutuhanUrgentOpen}</p>
								<p class="text-sm font-bold {kpis.kebutuhanUrgentOpen > 0 ? 'text-amber-600/70' : 'text-slate-400'}">belum dipenuhi</p>
							</div>
						</div>
					</div>
				</div>

				<div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
					<!-- Kolom kiri: pergerakan stok -->
					<div class="lg:col-span-8 flex flex-col gap-4 min-w-0">
						<div class="flex items-center gap-2 mb-2 px-2">
							<div class="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
								<IconPackage size={18} class="text-blue-600" />
							</div>
							<h2 class="text-lg font-bold" style="color: var(--sys-label)">Pergerakan Stok per Proyek</h2>
						</div>
						<div class="glass-panel rounded-3xl overflow-hidden border border-white/50 shadow-sm">
							<div class="overflow-x-auto">
								<table class="w-full text-left border-collapse">
									<thead>
										<tr class="bg-slate-50/80 border-b border-slate-200/50">
											<th class="py-4 px-6 text-xs font-black uppercase tracking-wider text-slate-500">Proyek</th>
											<th class="py-4 px-6 text-xs font-black uppercase tracking-wider text-slate-500 text-center">Masuk</th>
											<th class="py-4 px-6 text-xs font-black uppercase tracking-wider text-slate-500 text-center">Keluar</th>
											<th class="py-4 px-6 text-xs font-black uppercase tracking-wider text-slate-500 text-center">Sisa Sistem</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-slate-100">
										{#if movements.length === 0}
											<tr><td colspan="4" class="p-8 text-center text-sm font-medium text-slate-400 italic">Belum ada data pergerakan stok.</td></tr>
										{:else}
											{#each movements as row}
												<tr class="hover:bg-white/40 transition-colors">
													<td class="py-4 px-6 font-bold text-sm text-slate-800">{row.projectName}</td>
													<td class="py-4 px-6 text-center">
														<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-black"><IconArrowDownRight size={14} />{row.masuk}</span>
													</td>
													<td class="py-4 px-6 text-center">
														<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-600 border border-red-200 text-xs font-black"><IconArrowUpRight size={14} />{row.keluar}</span>
													</td>
													<td class="py-4 px-6 text-center font-black text-sm text-slate-700">{row.sisaSistem}</td>
												</tr>
											{/each}
										{/if}
									</tbody>
								</table>
							</div>
						</div>
					</div>

					<!-- Kolom kanan: pipeline & alert -->
					<div class="lg:col-span-4 flex flex-col gap-8 shrink-0">
						<div>
							<div class="flex items-center gap-2 mb-4 px-2">
								<div class="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
									<IconTruck size={18} class="text-blue-600" />
								</div>
								<h2 class="text-lg font-bold" style="color: var(--sys-label)">Pipeline Kebutuhan</h2>
							</div>
							<div class="glass-panel rounded-3xl p-6 flex flex-col gap-4 border border-white/50 shadow-sm relative overflow-hidden">
								<div class="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent pointer-events-none"></div>
								<div class="flex items-center justify-between relative z-10">
									<div class="text-center flex-1">
										<div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-600 font-black text-xl shadow-inner">{pipeline.requested}</div>
										<p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Requested</p>
									</div>
									<div class="text-slate-300 font-bold mb-5">→</div>
									<div class="text-center flex-1">
										<div class="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-2 text-amber-600 font-black text-xl shadow-sm">{pipeline.approved}</div>
										<p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Approved</p>
									</div>
									<div class="text-slate-300 font-bold mb-5">→</div>
									<div class="text-center flex-1">
										<div class="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-2 text-emerald-600 font-black text-xl shadow-sm">{pipeline.delivered}</div>
										<p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Delivered</p>
									</div>
								</div>
							</div>
						</div>

						<div>
							<div class="flex items-center gap-2 mb-4 px-2">
								<div class="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center">
									<IconAlertTriangle size={18} class="text-red-600" />
								</div>
								<h2 class="text-lg font-bold" style="color: var(--sys-label)">Alert Kebutuhan Urgent</h2>
							</div>
							<div class="glass-panel rounded-3xl overflow-hidden border border-white/50 shadow-sm">
								{#if urgentNeeds.length === 0}
									<div class="p-8 text-center text-sm font-medium text-slate-400 italic">Tidak ada kebutuhan urgent yang terbuka.</div>
								{:else}
									<div class="divide-y divide-slate-100">
										{#each urgentNeeds as need}
											<div class="p-4 flex items-start gap-4 hover:bg-white/40 transition-colors">
												<div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 {need.daysOpen > 2 ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'}">
													<IconClock size={20} />
												</div>
												<div class="flex-1 min-w-0">
													<p class="text-sm font-bold text-slate-800 truncate">{need.materialName}</p>
													<p class="text-xs font-medium text-slate-500 mt-0.5">{need.projectName} · {need.qty} {need.unit}</p>
													<div class="mt-2">
														<span class="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider {need.daysOpen > 2 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">
															{need.daysOpen} hari belum dipenuhi
														</span>
													</div>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
