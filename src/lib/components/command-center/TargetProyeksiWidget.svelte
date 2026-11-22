<!-- src/lib/components/command-center/TargetProyeksiWidget.svelte
     Command Center — "Target & Proyeksi Perusahaan" bulan berjalan (Skor Komposit). Read-only, 2 query ringan, tanpa nominal rupiah.
     Target yang tampil hanya yang sudah TERKUNCI. Belum ada cache/target → pesan jujur (bukan angka kosong). Tidak memblokir apa pun. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getTargetProyeksiSummary, type TargetProyeksiSummary } from '$lib/services/targetProyeksiSummary';

	let data = $state<TargetProyeksiSummary | null>(null);
	let loading = $state(true);

	onMount(async () => {
		data = await getTargetProyeksiSummary();
		loading = false;
	});

	const TONE = {
		on_track: { c: '#16a34a', t: 'Sesuai target' },
		at_risk: { c: '#d97706', t: 'Berisiko' },
		off_track: { c: '#dc2626', t: 'Kritis' },
		unknown: { c: 'var(--sys-label3)', t: 'Belum dapat dinilai' }
	} as const;
	const fmt = (v: number | null) => (v == null ? '—' : v.toLocaleString('id-ID', { maximumFractionDigits: 1 }));
</script>

<div class="rounded-2xl border p-4" style="background: var(--sys-bg2, #fff); border-color: var(--sys-sep, #e5e7eb)" data-testid="cc-target-proyeksi">
	<div class="flex items-center justify-between mb-2">
		<p class="text-[12px] font-bold" style="color: var(--sys-label)">🔮 Target & Proyeksi Perusahaan</p>
		{#if data}<span class="text-[10px] font-bold" style="color: {TONE[data.status].c}">{TONE[data.status].t}</span>{/if}
	</div>
	{#if loading}
		<p class="text-[12px]" style="color: var(--sys-label3)">Memuat…</p>
	{:else if !data}
		<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada proyeksi bulan ini — cache forecast belum dihitung atau data belum dapat dibaca.</p>
	{:else}
		<div class="grid grid-cols-3 gap-2 text-center">
			<div><p class="text-[10px]" style="color: var(--sys-label3)">Target {data.label}</p><p class="text-[14px] font-bold" style="color: var(--sys-label)">{data.targetLocked ? fmt(data.target) : '—'}</p></div>
			<div><p class="text-[10px]" style="color: var(--sys-label3)">Forecast</p><p class="text-[14px] font-bold" style="color: var(--sys-label)" title={data.low != null ? `Rentang ${fmt(data.low)} – ${fmt(data.high)}` : ''}>{fmt(data.forecast)}</p></div>
			<div><p class="text-[10px]" style="color: var(--sys-label3)">Gap</p><p class="text-[14px] font-bold" style="color: {TONE[data.status].c}">{data.gapPct != null ? `${data.gapPct > 0 ? '+' : ''}${fmt(data.gapPct)}%` : '—'}</p></div>
		</div>
		{#if !data.targetLocked}<p class="text-[10px] mt-2" style="color: var(--sys-label3)">Target bulan ini belum ditetapkan/dikunci oleh manajemen.</p>{/if}
		{#if data.computedAt}<p class="text-[10px] mt-1" style="color: var(--sys-label3)">Dihitung {new Date(data.computedAt).toLocaleString('id-ID')}</p>{/if}
	{/if}
</div>
