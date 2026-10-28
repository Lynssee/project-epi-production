<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchActivePrograms, type CsrProgram } from '$lib/services/csr';
	import { IconHeartHandshake, IconLoader2, IconUsers, IconCamera } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let programs = $state<CsrProgram[]>([]);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'access_csr', roles)) {
			goto('/');
		}
	});

	onMount(async () => {
		try {
			programs = await fetchActivePrograms();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat program CSR.';
		}
		loading = false;
	});
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center justify-between mb-4">
			<div>
				<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">CSR / TJSL</h1>
				<p class="text-[11px]" style="color: var(--sys-label3)">Program berjalan — catat kegiatan & penerima manfaat</p>
			</div>
			<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--gl)">
				<IconHeartHandshake size={18} style="color: var(--g)" />
			</div>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat program CSR..." />
		{:else if errorMsg}
			<div class="rounded-lg p-4 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
		{:else if programs.length === 0}
			<div class="rounded-lg p-6 text-[12px] text-center" style="background: var(--sys-fill); color: var(--sys-label3)">
				Tidak ada program CSR yang sedang berjalan/disetujui saat ini.
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each programs as p (p.id)}
					<div class="rounded-xl p-4" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{p.nama}</p>
						<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">{p.pilar}{p.lokasi ? ` · ${p.lokasi}` : ''}</p>
						<div class="flex gap-2 mt-3">
							<button
								class="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-semibold text-white"
								style="background: var(--g)"
								onclick={() => goto(`/csr/kegiatan?program_id=${p.id}`)}
							>
								<IconCamera size={14} /> Catat Kegiatan
							</button>
							<button
								class="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-semibold"
								style="background: var(--gl); color: var(--g)"
								onclick={() => goto(`/csr/penerima?program_id=${p.id}`)}
							>
								<IconUsers size={14} /> Penerima Manfaat
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
