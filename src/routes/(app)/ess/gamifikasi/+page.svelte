<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getMyGamifikasi, type GamifikasiSummary } from '$lib/services/ess/gamifikasi';
	import { IconLoader2, IconAlertTriangle, IconAward, IconMedal } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let summary = $state<GamifikasiSummary | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			summary = await getMyGamifikasi();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data gamifikasi.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function medalColor(rank: number) {
		if (rank === 1) return '#F59E0B';
		if (rank === 2) return '#94A3B8';
		if (rank === 3) return '#B45309';
		return 'var(--sys-label4)';
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-8">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Poin & Badge</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Reward simbolik dari kehadiran, training, KPI, dan aktivitas lain — tidak memengaruhi payroll.</p>
	</div>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data gamifikasi..." />
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
	{:else if !summary?.musim}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
				<IconAward size={32} class="text-slate-400" />
			</div>
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada musim gamifikasi yang berjalan.</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-4 mb-6">
			<div class="glass-panel rounded-2xl p-5 text-center">
				<p class="text-[10px] font-bold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Poin Saya</p>
				<p class="text-3xl font-black gradient-text">{summary.poinSaya}</p>
				<p class="text-[11px] mt-1" style="color: var(--sys-label4)">Musim {summary.musim.kode}</p>
			</div>
			<div class="glass-panel rounded-2xl p-5 text-center">
				<p class="text-[10px] font-bold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Peringkat Saya</p>
				<p class="text-3xl font-black" style="color: var(--sys-label)">
					{summary.peringkatSaya ? `#${summary.peringkatSaya}` : '-'}
				</p>
				<p class="text-[11px] mt-1" style="color: var(--sys-label4)">dari {summary.totalPeserta} peserta</p>
			</div>
		</div>

		<h2 class="text-lg font-bold mb-4" style="color: var(--sys-label)">Papan Peringkat (Top 10)</h2>
		{#if summary.top10.length === 0}
			<div class="glass-panel rounded-2xl p-8 text-center mb-6">
				<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada poin tercatat musim ini.</p>
			</div>
		{:else}
			<div class="glass-panel rounded-2xl overflow-hidden mb-8">
				<div class="divide-y divide-slate-100">
					{#each summary.top10 as row, i (row.karyawan_id)}
						<div class="flex items-center justify-between px-5 py-3">
							<div class="flex items-center gap-3">
								<div class="w-8 h-8 rounded-full flex items-center justify-center font-black text-sm" style="background: {medalColor(i + 1)}1A; color: {medalColor(i + 1)}">
									{#if i < 3}<IconMedal size={16} />{:else}{i + 1}{/if}
								</div>
								<span class="text-sm font-semibold" style="color: var(--sys-label)">{row.nama_karyawan}</span>
							</div>
							<span class="text-sm font-black" style="color: var(--sys-label)">{row.total_poin} pts</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<h2 class="text-lg font-bold mb-4" style="color: var(--sys-label)">Badge Saya</h2>
		{#if summary.badgeSaya.length === 0}
			<div class="glass-panel rounded-2xl p-8 text-center">
				<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada badge yang diraih.</p>
			</div>
		{:else}
			<div class="grid grid-cols-2 md:grid-cols-3 gap-4">
				{#each summary.badgeSaya as b (b.id)}
					<div class="glass-panel rounded-2xl p-4 flex items-center gap-3">
						<div class="w-10 h-10 rounded-full flex items-center justify-center bg-amber-50 text-amber-500 flex-shrink-0">
							<IconAward size={20} />
						</div>
						<div class="min-w-0">
							<p class="text-sm font-bold truncate" style="color: var(--sys-label)">{b.badge_nama}</p>
							<p class="text-[11px]" style="color: var(--sys-label4)">{new Date(b.tanggal_diraih).toLocaleDateString('id-ID')}</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
