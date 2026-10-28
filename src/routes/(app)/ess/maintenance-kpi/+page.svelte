<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getMyMaintenanceKpi, type MaintenanceKpiSummary } from '$lib/services/ess/maintenanceKpi';
	import { IconLoader2, IconAlertTriangle, IconTool, IconClock } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let summary = $state<MaintenanceKpiSummary | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			summary = await getMyMaintenanceKpi();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data maintenance.';
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-8">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Work Order Saya</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Penyelesaian WO periode berjalan</p>
	</div>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data KPI maintenance..." />
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else if summary && !summary.linked}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
				<IconTool size={32} class="text-slate-400" />
			</div>
			<p class="text-sm font-medium" style="color: var(--sys-label3)">
				Akun Anda belum tertaut ke identitas mekanik/teknisi (data <code>personnel</code>). Hubungi admin Maintenance kalau seharusnya sudah.
			</p>
		</div>
	{:else if summary}
		<div class="glass-panel rounded-3xl p-6 mb-6 relative overflow-hidden">
			<div class="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
			<div class="flex items-center justify-between relative z-10">
				<div>
					<p class="text-xs font-bold" style="color: var(--sys-label3)">Periode {summary.periode || '-'}</p>
					<p class="text-base font-bold mt-1" style="color: var(--sys-label)">{summary.personnelName}</p>
				</div>
				{#if summary.pct !== null}
					<div class="flex items-baseline gap-1 bg-white/50 px-4 py-2 rounded-xl border border-white/20 shadow-sm">
						<p class="text-3xl font-black gradient-text tracking-tight">{summary.pct}%</p>
					</div>
				{/if}
			</div>
			<p class="text-xs mt-4 relative z-10" style="color: var(--sys-label3)">
				{#if summary.total === 0}
					Belum ada WO ditugaskan ke Anda pada periode ini.
				{:else}
					{summary.selesai} dari {summary.total} WO periode ini sudah selesai.
				{/if}
			</p>
		</div>

		<h2 class="text-lg font-bold mb-4" style="color: var(--sys-label)">WO Belum Selesai ({summary.openList.length})</h2>
		{#if summary.openList.length === 0}
			<div class="glass-panel rounded-2xl p-10 text-center">
				<p class="text-sm font-medium" style="color: var(--sys-label3)">Tidak ada WO menggantung. 🎉</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#each summary.openList as wo (wo.id)}
					<div class="glass-panel rounded-2xl p-5">
						<div class="flex items-center justify-between mb-2">
							<p class="text-sm font-bold" style="color: var(--sys-label)">{wo.wo_number}</p>
							<span class="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-600 border-amber-200">{wo.statusName}</span>
						</div>
						{#if wo.keluhan}
							<p class="text-xs" style="color: var(--sys-label3)">{wo.keluhan}</p>
						{/if}
						{#if wo.created_at}
							<div class="flex items-center gap-1.5 mt-3 text-[11px]" style="color: var(--sys-label4)">
								<IconClock size={13} />
								<span>Dibuat {new Date(wo.created_at).toLocaleDateString('id-ID')}</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<div class="mt-6 rounded-xl p-4 text-xs" style="background: var(--bl, #eff6ff); border: 1px solid var(--bl2, #bfdbfe); color: var(--sys-label3)">
			Halaman ini hanya menampilkan penyelesaian WO. Waktu respons rata-rata (MTTR) dan pengingat PM belum
			tersedia — data pendukungnya (tanggal selesai WO, jadwal PM) belum terisi konsisten di sistem.
		</div>
	{/if}
</div>
