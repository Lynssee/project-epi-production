<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fetchActiveCheckpoints } from '$lib/services/security';
	import { IconShieldCheck, IconLoader2, IconQrcode, IconDoorEnter, IconUsers, IconAlertTriangle, IconRepeat, IconDeviceMobile } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let checkpointCount = $state(0);

	onMount(async () => {
		try {
			const checkpoints = await fetchActiveCheckpoints();
			checkpointCount = checkpoints.length;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat data keamanan.';
		}
		loading = false;
	});

	const quickActions = [
		{ label: 'Patroli/Cleaning', icon: IconQrcode, href: '/satpam/patroli' },
		{ label: 'Gate Log', icon: IconDoorEnter, href: '/satpam/gate' },
		{ label: 'Tamu', icon: IconUsers, href: '/satpam/tamu' },
		{ label: 'Insiden', icon: IconAlertTriangle, href: '/satpam/insiden' },
		{ label: 'Serah-Terima', icon: IconRepeat, href: '/satpam/serah-terima' },
		{ label: 'Deposit HP', icon: IconDeviceMobile, href: '/satpam/deposit-hp' }
	];
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center justify-between mb-4">
			<div>
				<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">General Affair</h1>
				<p class="text-[11px]" style="color: var(--sys-label3)">Patroli & tugas pos hari ini</p>
			</div>
			<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--rel)">
				<IconShieldCheck size={18} style="color: #DC2626" />
			</div>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat checkpoint satpam..." />
		{:else if errorMsg}
			<div class="rounded-lg p-4 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
		{:else}
			<div class="rounded-xl p-4 mb-4" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<p class="text-[11px]" style="color: var(--sys-label3)">Checkpoint Aktif</p>
				<p class="text-[18px] font-bold" style="color: var(--sys-label)">{checkpointCount}</p>
			</div>

			<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
				{#each quickActions as action}
					<button
						class="rounded-xl p-4 flex flex-col items-center gap-2 text-center"
						style="background: var(--sys-fill); border: 1px dashed var(--sys-sep)"
						onclick={() => goto(action.href)}
					>
						<action.icon size={22} style="color: var(--sys-label3)" />
						<span class="text-[12px] font-medium" style="color: var(--sys-label)">{action.label}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
