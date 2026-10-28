<script lang="ts">

	let {
		totalAktif = 0,
		belumLapor = 0,
		anggaranPending = 0,
		proyekBerisiko = 0,
		loading = false
	}: {
		totalAktif: number;
		belumLapor: number;
		anggaranPending: number;
		proyekBerisiko: number;
		loading?: boolean;
	} = $props();
</script>

<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
	<!-- Total Proyek Aktif -->
	<div class="rounded-xl p-4 flex flex-col gap-1" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep); box-shadow: 0 1px 2px rgba(0,0,0,0.04)">
		<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: var(--sys-label3)">Proyek Aktif</p>
		{#if loading}
			<div class="h-7 w-10 rounded-md animate-pulse" style="background: var(--sys-fill2)"></div>
		{:else}
			<p class="text-[26px] font-bold leading-none mt-1" style="color: var(--p); letter-spacing: -0.5px">{totalAktif}</p>
		{/if}
		<p class="text-[11px]" style="color: var(--sys-label3)">proyek</p>
	</div>

	<!-- Belum Lapor -->
	<div
		class="rounded-xl p-4 flex flex-col gap-1 transition-colors"
		style="background: {belumLapor > 0 ? 'var(--rel)' : 'var(--sys-bg2)'}; border: 1px solid {belumLapor > 0 ? 'transparent' : 'var(--sys-sep)'}; box-shadow: 0 1px 2px rgba(0,0,0,0.04)"
	>
		<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: {belumLapor > 0 ? 'var(--re)' : 'var(--sys-label3)'}">Belum Lapor</p>
		{#if loading}
			<div class="h-7 w-8 rounded-md animate-pulse" style="background: var(--sys-fill2)"></div>
		{:else}
			<p class="text-[26px] font-bold leading-none mt-1" style="color: {belumLapor > 0 ? 'var(--re)' : 'var(--sys-label)'}; letter-spacing: -0.5px">{belumLapor}</p>
		{/if}
		<p class="text-[11px]" style="color: {belumLapor > 0 ? 'var(--re)' : 'var(--sys-label3)'}">hari ini</p>
	</div>

	<!-- Anggaran Pending -->
	<div
		class="rounded-xl p-4 flex flex-col gap-1 transition-colors"
		style="background: {anggaranPending > 0 ? 'var(--pl)' : 'var(--sys-bg2)'}; border: 1px solid {anggaranPending > 0 ? 'transparent' : 'var(--sys-sep)'}; box-shadow: 0 1px 2px rgba(0,0,0,0.04)"
	>
		<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: {anggaranPending > 0 ? 'var(--p)' : 'var(--sys-label3)'}">Anggaran</p>
		{#if loading}
			<div class="h-7 w-8 rounded-md animate-pulse" style="background: var(--sys-fill2)"></div>
		{:else}
			<p class="text-[26px] font-bold leading-none mt-1" style="color: {anggaranPending > 0 ? 'var(--p)' : 'var(--sys-label)'}; letter-spacing: -0.5px">{anggaranPending}</p>
		{/if}
		<p class="text-[11px]" style="color: {anggaranPending > 0 ? 'var(--p)' : 'var(--sys-label3)'}">pending</p>
	</div>

	<!-- Proyek Berisiko -->
	<div
		class="rounded-xl p-4 flex flex-col gap-1 transition-colors"
		style="background: {proyekBerisiko > 0 ? 'var(--aml)' : 'var(--sys-bg2)'}; border: 1px solid {proyekBerisiko > 0 ? 'transparent' : 'var(--sys-sep)'}; box-shadow: 0 1px 2px rgba(0,0,0,0.04)"
	>
		<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: {proyekBerisiko > 0 ? '#D97706' : 'var(--sys-label3)'}">At Risk</p>
		{#if loading}
			<div class="h-7 w-8 rounded-md animate-pulse" style="background: var(--sys-fill2)"></div>
		{:else}
			<p class="text-[26px] font-bold leading-none mt-1" style="color: {proyekBerisiko > 0 ? '#D97706' : 'var(--sys-label)'}; letter-spacing: -0.5px">{proyekBerisiko}</p>
		{/if}
		<p class="text-[11px]" style="color: {proyekBerisiko > 0 ? '#D97706' : 'var(--sys-label3)'}">deadline lewat</p>
	</div>
</div>
