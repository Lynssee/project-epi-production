<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Kartu Kelengkapan HSE per proyek — Fase 1 rencana JSA & Administrasi HSE v2.0.
	// Dihitung saat dibaca (P3), tanpa entri data baru di lapangan (R2/T3).
	import { onMount } from 'svelte';
	import { getProjectHseCompleteness, type ProjectHseCompleteness } from '$lib/services/hse';
	import { IconShieldCheck, IconLoader2 } from '@tabler/icons-svelte';

	let { projectId }: { projectId: number | string } = $props();

	let loading = $state(true);
	let data = $state<ProjectHseCompleteness | null>(null);

	onMount(async () => {
		loading = true;
		data = await getProjectHseCompleteness(projectId);
		loading = false;
	});

	function badge(value: boolean | null): { text: string; bg: string; fg: string } {
		if (value === null) return { text: 'Menyusul', bg: 'var(--sys-fill)', fg: 'var(--sys-label3)' };
		return value
			? { text: 'Ya', bg: 'var(--gl)', fg: 'var(--gd)' }
			: { text: 'Belum', bg: 'var(--rel)', fg: 'var(--re)' };
	}
</script>

<div class="card-section">
	<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
		<IconShieldCheck size={16} style="color: var(--g)" /> Kelengkapan HSE
	</h4>

	{#if loading}
		<CircularProgressGauge size={44} strokeWidth={3} label="Memeriksa kelengkapan HSE..." />
	{:else if data}
		<div class="flex flex-col gap-2.5">
			<div class="flex items-center justify-between">
				<span class="text-[12px]" style="color: var(--sys-label3)">JSA Berlaku</span>
				<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background: {badge(data.jsaBerlaku).bg}; color: {badge(data.jsaBerlaku).fg}">
					{badge(data.jsaBerlaku).text}
				</span>
			</div>
			<div style="height:1px; background: var(--sys-sep)"></div>
			<div class="flex items-center justify-between">
				<span class="text-[12px]" style="color: var(--sys-label3)">Izin Kerja (PTW) Aktif</span>
				<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background: {badge(data.ptwAktif).bg}; color: {badge(data.ptwAktif).fg}">
					{badge(data.ptwAktif).text}
				</span>
			</div>
			<div style="height:1px; background: var(--sys-sep)"></div>
			<div class="flex items-center justify-between">
				<span class="text-[12px]" style="color: var(--sys-label3)">Toolbox Meeting Hari Ini</span>
				<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background: {badge(data.toolboxHariIni).bg}; color: {badge(data.toolboxHariIni).fg}">
					{badge(data.toolboxHariIni).text}
				</span>
			</div>
			<div style="height:1px; background: var(--sys-sep)"></div>
			<div class="flex items-center justify-between">
				<span class="text-[12px]" style="color: var(--sys-label3)">Insiden Belum Selesai</span>
				<span class="text-[11px] font-bold px-2 py-0.5 rounded-full"
					style="background: {data.insidenBelumSelesai > 0 ? 'var(--rel)' : 'var(--gl)'}; color: {data.insidenBelumSelesai > 0 ? 'var(--re)' : 'var(--gd)'}">
					{data.insidenBelumSelesai}
				</span>
			</div>
		</div>
	{/if}
</div>
