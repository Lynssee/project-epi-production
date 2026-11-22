<!-- src/lib/components/leader/LeaderKpiDampakCard.svelte
     "Dampak KPI Saya" untuk dashboard Leader: arah dampak finansial indikator departemen bulan ini (↑ lebih baik / ↓ perlu perhatian)
     + rantai penyebab singkat. Angka Rp tampil HANYA bila admin memilih mode "arah + Rp". Koefisien/rumus/budget tidak pernah dikirim.
     Tidak tersedia (nonaktif / divisi belum terpetakan / belum ada profil aktif / gagal) => kartu tidak tampil. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getKpiDampakSaya, ARAH_META, formatRp, type KpiDampakSaya } from '$lib/services/ess/kpiDampak';

	let data = $state<KpiDampakSaya | null>(null);
	let loading = $state(true);

	onMount(async () => {
		try {
			data = await getKpiDampakSaya();
		} finally {
			loading = false;
		}
	});

	const tampil = $derived(!loading && !!data?.available && !!data.items?.length);
</script>

{#if tampil && data}
	<section class="mb-4 rounded-2xl bg-white border border-slate-200 p-3" data-testid="leader-kpi-dampak">
		<div class="flex items-start justify-between gap-2">
			<h2 class="text-[15px] font-bold" style="color: var(--sys-label)">Dampak KPI Saya</h2>
			<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 shrink-0" title="Perkiraan berbasis asumsi, bukan angka akuntansi.">Estimasi</span>
		</div>
		<p class="text-[11px] mt-0.5 mb-2" style="color: var(--sys-label3)">
			Departemen {data.department} · {data.month}. Arah dampak kinerja Anda terhadap keuangan perusahaan. Ketertiban di lapangan (absen, laporan harian, P2H, dokumen) ikut menentukan.
		</p>
		<ul class="divide-y divide-slate-100">
			{#each data.items ?? [] as it (it.kpi_code)}
				{@const meta = ARAH_META[it.arah]}
				<li class="py-1.5 flex items-start gap-2" data-testid="dampak-item">
					<span class="text-base font-bold leading-5 w-5 text-center {meta.cls}" title={meta.teks} aria-label={meta.teks}>{meta.simbol}</span>
					<div class="min-w-0 flex-1">
						<div class="text-[13px] font-semibold" style="color: var(--sys-label)">{it.name}</div>
						{#if it.penjelasan}<div class="text-[11px] leading-snug" style="color: var(--sys-label3)">{it.penjelasan}</div>{/if}
					</div>
					{#if it.rp != null}
						<span class="text-[12px] font-mono font-bold shrink-0 {meta.cls}" data-testid="dampak-rp">{formatRp(it.rp)}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
