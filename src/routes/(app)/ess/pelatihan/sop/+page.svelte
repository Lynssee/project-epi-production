<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Daftar SOP (Fase 2C) — hanya status=published yang tampil (lihat $lib/server/ess/sop.ts).
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getSopList, type SopDocument } from '$lib/services/ess/sop';
	import { cacheSopList, getCachedSopList } from '$lib/utils/offlineSopCache';
	import { IconAlertTriangle, IconChevronRight, IconFileText, IconLoader2, IconSchool, IconWifiOff } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let sopList = $state<SopDocument[]>([]);
	let compliance = $state<{ confirmed: number; total: number } | null>(null);
	let search = $state('');
	let offlineMode = $state(false);

	async function load() {
		loading = true;
		errorMsg = '';
		offlineMode = false;
		try {
			const res = await getSopList();
			sopList = res.sopList;
			compliance = res.compliance;
			await cacheSopList(res.sopList);
		} catch (err: any) {
			// R2: sinyal buruk di lapangan -- coba tampilkan salinan tersimpan alih-alih error kosong.
			const cached = await getCachedSopList();
			if (cached.length > 0) {
				sopList = cached;
				compliance = null;
				offlineMode = true;
			} else {
				errorMsg = err?.message || 'Gagal memuat daftar SOP.';
			}
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let filtered = $derived(
		sopList.filter((s) => !search || s.title.toLowerCase().includes(search.toLowerCase()) || (s.department || '').toLowerCase().includes(search.toLowerCase()))
	);
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-6">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">SOP Perusahaan</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Standard Operating Procedure yang berlaku saat ini</p>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat modul SOP perusahaan..." />
		</div>
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
	{:else}
		{#if offlineMode}
			<div class="glass-panel rounded-2xl p-3 mb-4 flex items-center gap-2" style="background: var(--rel)">
				<IconWifiOff size={16} style="color: var(--red)" />
				<p class="text-xs font-semibold" style="color: var(--red)">Mode offline — menampilkan salinan tersimpan terakhir.</p>
			</div>
		{/if}
		{#if compliance && compliance.total > 0}
			<div class="glass-panel rounded-2xl p-4 mb-4 flex items-center justify-between">
				<div>
					<p class="text-xs font-bold" style="color: var(--sys-label3)">Kepatuhan SOP Anda</p>
					<p class="text-lg font-extrabold" style="color: var(--sys-label)">{compliance.confirmed} / {compliance.total} dikonfirmasi</p>
				</div>
				<div class="w-16 h-16 rounded-full flex items-center justify-center text-sm font-extrabold gradient-bg text-white">
					{Math.round((compliance.confirmed / compliance.total) * 100)}%
				</div>
			</div>
		{/if}
		<input
			type="text"
			placeholder="Cari SOP..."
			bind:value={search}
			class="w-full px-4 py-3 rounded-xl mb-4 text-sm glass-panel border-none outline-none"
		/>

		{#if filtered.length === 0}
			<div class="glass-panel rounded-2xl p-10 text-center">
				<IconFileText size={40} class="mx-auto mb-3 opacity-40" />
				<p class="text-sm font-medium" style="color: var(--sys-label4)">Belum ada SOP yang dipublikasikan.</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each filtered as sop (sop.id)}
					<button
						class="w-full text-left glass-panel rounded-2xl p-4 flex items-center gap-3 hover:opacity-90 transition-opacity"
						onclick={() => goto(`/ess/pelatihan/sop/${sop.id}`)}>
						<div class="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center shrink-0">
							<IconFileText size={20} class="text-white" />
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-bold truncate">{sop.title}</p>
							<p class="text-xs mt-0.5" style="color: var(--sys-label3)">{sop.department || '-'} · v{sop.version}</p>
							{#if sop.requires_training}
								<span class="inline-flex items-center gap-1 mt-1 text-[10px] font-bold" style="color: var(--p, var(--g))">
									<IconSchool size={12} /> Training wajib
								</span>
							{/if}
						</div>
						<IconChevronRight size={18} class="opacity-40 shrink-0" />
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>
