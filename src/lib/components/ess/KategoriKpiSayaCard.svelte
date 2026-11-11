<script lang="ts">
	// "Skor Departemen Saya per Kategori" — 5 kategori (General/Teknis/Administrasi/Keuangan/Inovasi) departemen Anda bulan ini
	// + saran tindakan konkret agar skor naik. Data: /api/ess/kategori-kpi (hanya skor/status kategori & nama indikator; tanpa data per orang).
	// Tidak tersedia (mode nonaktif / divisi belum terpetakan / gagal) => kartu tidak tampil, halaman Kinerja tidak terganggu.
	import { onMount } from 'svelte';
	import { getKategoriKpiSaya, KATEGORI_URUT, KATEGORI_META, type KategoriKpiSaya } from '$lib/services/ess/kategoriKpi';

	let data = $state<KategoriKpiSaya | null>(null);
	let loading = $state(true);

	onMount(async () => {
		try {
			data = await getKategoriKpiSaya();
		} finally {
			loading = false;
		}
	});

	const thr = $derived(data?.thresholds || { onTarget: 85, warning: 65 });
	const tone = (v: number | null | undefined) => (v == null ? 'text-slate-400' : v >= thr.onTarget ? 'text-emerald-600' : v >= thr.warning ? 'text-amber-600' : 'text-rose-600');
	const statusText = (s: string | null | undefined) => (s === 'on_target' ? 'On-Track' : s === 'warning' ? 'Waspada' : s === 'critical' ? 'Kritis' : '');
	const tampil = $derived(!loading && !!data?.available && !!data.categories);
</script>

{#if tampil && data}
	<section class="mb-8" data-testid="kategori-kpi-saya">
		<div class="flex items-start justify-between gap-2 mb-1">
			<h2 class="text-lg font-bold" style="color: var(--sys-label)">Skor Departemen Saya per Kategori</h2>
			{#if data.mode !== 'on'}
				<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 shrink-0" title="Tampilan simulasi: skor resmi departemen belum memakai 5 kategori.">Simulasi</span>
			{/if}
		</div>
		<p class="text-[11px] mb-3" style="color: var(--sys-label3)">
			Departemen {data.department} · {data.month}. Kerja tertib Anda di lapangan (absen, laporan harian, P2H, dokumen) ikut menentukan skor ini. Kategori tanpa indikator berbobot belum dihitung (bukan nol).
		</p>

		<div class="rounded-2xl bg-white border border-slate-200 p-3 space-y-3">
			{#if data.composite != null}
				<div class="flex items-baseline justify-between">
					<span class="text-xs font-semibold text-slate-500">Komposit 5 kategori</span>
					<span class="text-xl font-black {tone(data.composite)}">{Math.round(data.composite)}%</span>
				</div>
			{/if}
			<ul class="space-y-2">
				{#each KATEGORI_URUT as k (k)}
					{@const c = data.categories?.[k]}
					<li title={KATEGORI_META[k].hint}>
						<div class="flex items-center justify-between text-xs">
							<span class="px-1.5 py-0.5 rounded font-bold {KATEGORI_META[k].badge}">{KATEGORI_META[k].label}</span>
							{#if c?.score != null}
								<span><strong class={tone(c.score)}>{Math.round(c.score)}%</strong> <span class="text-[10px] text-slate-400">{statusText(c.status)}</span></span>
							{:else}
								<span class="text-[10px] text-slate-400">belum dihitung</span>
							{/if}
						</div>
						<div class="h-1.5 mt-1 rounded-full bg-slate-100 overflow-hidden">
							<div class="h-full rounded-full {KATEGORI_META[k].bar}" style="width: {Math.max(0, Math.min(100, c?.score ?? 0))}%"></div>
						</div>
					</li>
				{/each}
			</ul>

			{#if data.nudges?.length}
				<div class="pt-2 border-t border-slate-100" data-testid="kategori-nudges">
					<p class="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Yang bisa Anda perbaiki</p>
					<ul class="space-y-1.5">
						{#each data.nudges as n (n.id)}
							<li class="flex gap-2 text-xs rounded-lg px-2.5 py-2 {n.severity === 'critical' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}">
								<span aria-hidden="true">{n.severity === 'critical' ? '⚠️' : '•'}</span>
								<span>
									<strong>{n.title}</strong>
									<span class="ml-1 text-[9px] font-bold px-1 rounded bg-white/70">{n.categoryLabel}</span>
									<span class="block text-[11px] opacity-80">{n.detail}</span>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-2">Semua indikator berbobot sudah di atas ambang On-Track. Pertahankan!</p>
			{/if}
		</div>
	</section>
{/if}
