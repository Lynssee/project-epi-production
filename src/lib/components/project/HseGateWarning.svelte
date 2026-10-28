<script lang="ts">
	// Gerbang kepatuhan HSE (R1) — HANYA peringatan visual, TIDAK PERNAH
	// memblokir pengiriman laporan harian (K6, dikonfirmasi 23 Jul 2026).
	// Ditempel di layar laporan harian karena itu satu-satunya alur yang sudah
	// wajib dipakai setiap hari oleh setiap leader proyek (P3).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getProjectHseCompleteness } from '$lib/services/hse';

	let { projectId }: { projectId: number | string } = $props();

	let loading = $state(true);
	let jsaBerlaku = $state(true);
	let toolboxHariIni = $state(true);

	onMount(async () => {
		if (!projectId) return;
		try {
			const c = await getProjectHseCompleteness(projectId);
			jsaBerlaku = c.jsaBerlaku;
			toolboxHariIni = c.toolboxHariIni;
		} finally {
			loading = false;
		}
	});
</script>

{#if !loading && (!jsaBerlaku || !toolboxHariIni)}
	<div class="rounded-lg p-3 mb-3 flex items-start gap-2 border" style="background: var(--o6); border-color: var(--o)">
		<span class="text-[16px] shrink-0">⚠️</span>
		<div class="flex-1 min-w-0">
			<p class="text-[12px] font-semibold" style="color: var(--orange)">Pengingat HSE</p>
			{#if !jsaBerlaku}
				<button class="block text-[11px] underline text-left hover:opacity-80" style="color: var(--orange)" onclick={() => goto(`/jsa/${projectId}`)}>
					Belum ada JSA berlaku untuk proyek ini — buat/ajukan sekarang
				</button>
			{/if}
			{#if !toolboxHariIni}
				<button class="block text-[11px] underline text-left mt-0.5 hover:opacity-80" style="color: var(--orange)" onclick={() => goto(`/toolbox/${projectId}`)}>
					Toolbox meeting hari ini belum diisi — isi sekarang
				</button>
			{/if}
			<p class="text-[10px] mt-1" style="color: var(--sys-label3)">Laporan harian tetap bisa dikirim — ini pengingat, bukan pemblokir.</p>
		</div>
	</div>
{/if}
