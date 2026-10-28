<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getMyOffboardingStatus, type OffboardingStatus } from '$lib/services/ess/offboarding';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconCircleCheck, IconClock, IconLock, IconLockOpen } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let data = $state<OffboardingStatus | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			data = await getMyOffboardingStatus();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data offboarding.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const STATUS_LABEL: Record<string, string> = {
		pending: 'Menunggu',
		cleared: 'Selesai',
		na: 'Tidak Berlaku'
	};
	const STATUS_COLOR: Record<string, string> = {
		pending: '#9CA3AF',
		cleared: '#16A34A',
		na: '#9CA3AF'
	};
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold mb-1" style="color: var(--sys-label)">Offboarding Saya</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Status clearance & settlement — dieksekusi masing-masing PIC department</p>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat status offboarding..." />
		</div>
	{:else if errorMsg}
		<div class="rounded-lg p-4" style="background: var(--rel)">
			<p class="text-[12px] flex items-center gap-1.5" style="color: #DC2626"><IconAlertTriangle size={14} /> {errorMsg}</p>
			<button class="mt-2 text-[11px] font-semibold underline" style="color: #DC2626" onclick={load}>Coba lagi</button>
		</div>
	{:else if !data?.kasus}
		<div class="glass-panel rounded-2xl p-6 text-center">
			<p class="text-[12px]" style="color: var(--sys-label3)">Tidak ada proses offboarding aktif untuk Anda saat ini.</p>
		</div>
	{:else}
		<div class="glass-panel rounded-2xl p-5 mb-4">
			<div class="flex items-center justify-between mb-2">
				<p class="text-[13px] font-bold" style="color: var(--sys-label)">{data.kasus.jenis}</p>
				<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">{data.kasus.status}</span>
			</div>
			{#if data.kasus.tanggal_efektif}
				<p class="text-[11px] mb-2" style="color: var(--sys-label4)">Hari kerja terakhir: {data.kasus.tanggal_efektif}</p>
			{/if}
			<div class="w-full h-2 rounded-full bg-gray-100 overflow-hidden mb-1">
				<div class="h-full bg-blue-500 rounded-full" style="width: {data.kasus.progress}%"></div>
			</div>
			<p class="text-[10px]" style="color: var(--sys-label4)">Progress clearance {data.kasus.progress}%</p>
		</div>

		<div class="glass-panel rounded-2xl p-4 mb-4" style="border: 1px solid {data.kasus.settlement_blocked ? '#D9770633' : '#16A34A33'}">
			<div class="flex items-center gap-2 mb-1">
				{#if data.kasus.settlement_blocked}
					<IconLock size={16} style="color: #D97706" />
					<p class="text-[12px] font-bold" style="color: #D97706">Settlement Ditahan</p>
				{:else}
					<IconLockOpen size={16} style="color: #16A34A" />
					<p class="text-[12px] font-bold" style="color: #16A34A">Settlement Dibuka</p>
				{/if}
			</div>
			<p class="text-[11px]" style="color: var(--sys-label4)">{data.kasus.settlement_block_reason || '-'}</p>
			<p class="text-[10px] mt-2" style="color: var(--sys-label4)">
				Gaji bulanan reguler Anda TIDAK terpengaruh oleh status ini — tetap dibayar normal seperti biasa.
			</p>
		</div>

		<h3 class="text-[11px] font-bold uppercase tracking-wider mt-4 mb-2 px-1" style="color: var(--sys-label3)">Checklist Clearance</h3>
		<div class="flex flex-col gap-2">
			{#each data.clearance as item}
				<div class="glass-panel rounded-2xl p-4 flex items-center justify-between gap-3">
					<div>
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">{item.nama_task}</p>
						<p class="text-[10px]" style="color: var(--sys-label4)">{item.kategori} · PIC: {item.pic_department}</p>
					</div>
					<span class="flex items-center gap-1 text-[10px] font-bold shrink-0" style="color: {STATUS_COLOR[item.status]}">
						{#if item.status === 'cleared'}
							<IconCircleCheck size={14} />
						{:else}
							<IconClock size={14} />
						{/if}
						{STATUS_LABEL[item.status]}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
