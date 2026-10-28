<!-- src/lib/components/leader/LeaderKesiapanCard.svelte
     Fase 4a (Rencana Pertajam ERP v2, 12 Okt 2026) — kartu "Kesiapan Proyek" di dashboard Leader.
     Memakai fetchReadinessBatch (cache 2 menit, sama dengan Home & /anggaran/cek-gate) => nol endpoint baru,
     nol request tambahan bila Home sudah dibuka. Hanya TAMPIL bila ada proyek yang belum siap (nol noise).
     Gagal memuat / server tak terjangkau => kartu diam (tidak pernah menahan dashboard). Read-only. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchReadinessBatch } from '$lib/services/readinessBatch';

	let { projectIds }: { projectIds: Array<number | string> } = $props();

	let readiness = $state<any>(null);

	const belumSiap = $derived(
		((readiness?.projects as any[]) || []).filter((p) => p?.found && !p?.siap)
	);

	onMount(async () => {
		try {
			const res = await fetchReadinessBatch(projectIds || []);
			if (res && res.available !== false) readiness = res;
		} catch (e) {
			console.error('[LeaderKesiapanCard] gagal memuat:', e);
		}
	});

	function gagal(p: any): string {
		return ((p?.gates as any[]) || [])
			.filter((g) => g?.status === 'failed')
			.map((g) => g?.label || g?.gate_key || '')
			.filter(Boolean)
			.join(', ');
	}
</script>

{#if belumSiap.length > 0}
	<div class="rounded-xl border p-3.5 mb-4" style="border-color: #F59E0B; background: var(--sys-fill2)">
		<div class="flex items-center justify-between gap-2">
			<p class="text-[12px] font-semibold" style="color: var(--sys-label)">🧭 Kesiapan Proyek</p>
			<span class="text-[11px] font-bold text-amber-600">{belumSiap.length} proyek belum siap</span>
		</div>
		<ul class="mt-2 space-y-1.5">
			{#each belumSiap.slice(0, 3) as p (p.project_id)}
				<li class="text-[11px]" style="color: var(--sys-label-2)">
					<span class="font-semibold" style="color: var(--sys-label)">{p.name || `Proyek #${p.project_id}`}</span>
					<span class="text-amber-600"> · {p.pct ?? 0}%</span>
					<br />Belum: {gagal(p) || '-'}
				</li>
			{/each}
		</ul>
		{#if belumSiap.length > 3}
			<p class="text-[10px] mt-1" style="color: var(--sys-label3)">+{belumSiap.length - 3} proyek lain</p>
		{/if}
		<button
			type="button"
			onclick={() => goto('/anggaran/cek-gate')}
			class="mt-2.5 text-[11px] font-semibold text-amber-600"
		>
			Lihat detail & cara melengkapi →
		</button>
		<p class="text-[10px] mt-1.5" style="color: var(--sys-label3)">
			Pengajuan anggaran proyek butuh Timeline, Laporan Harian, dan Manpower terisi. Tap tombol di atas untuk tautan ke halaman yang perlu dilengkapi.
		</p>
	</div>
{/if}
