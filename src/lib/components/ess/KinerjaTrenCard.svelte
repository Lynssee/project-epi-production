<script lang="ts">
	// "Tren Kinerja Saya" — mini-matriks riwayat skor KPI pribadi (bulanan / triwulan / tahunan) + rincian indikator,
	// dengan unduh Rapor Kinerja (PDF). Data: /api/ess/kinerja-tren (hanya skor Finalized milik sendiri).
	// Gagal / belum ada skor sama sekali => kartu tidak tampil (tidak merusak halaman Kinerja).
	import { onMount } from 'svelte';
	import { getKinerjaTren, toneClass, type KinerjaTren, type TrenCadence } from '$lib/services/ess/kinerjaTren';
	import { unduhRaporKinerjaSaya } from '$lib/utils/raporKinerjaSayaPdf';

	let data = $state<KinerjaTren | null>(null);
	let loading = $state(true);
	let cadence = $state<TrenCadence>('bulanan');
	let year = $state(new Date().getFullYear());
	let bukaIndikator = $state(false);
	let mengunduh = $state(false);
	let pesan = $state('');
	let punyaSkorApaPun = $state(false); // true begitu pernah ada skor di tahun/cadence mana pun -> kartu tetap tampil saat user ganti tahun

	const CADENCES: [TrenCadence, string][] = [['bulanan', 'Bulanan'], ['triwulan', 'Triwulan'], ['tahunan', 'Tahunan']];

	async function muat() {
		loading = true;
		try {
			data = await getKinerjaTren(cadence, year);
			if (data?.available && Object.values(data.cells || {}).some((c) => c.score != null)) punyaSkorApaPun = true;
		} finally {
			loading = false;
		}
	}
	onMount(muat);

	function ganti(c: TrenCadence) {
		cadence = c;
		muat();
	}
	function geser(d: number) {
		year += d;
		muat();
	}

	const tampil = $derived(!!data?.available && punyaSkorApaPun);
	const buckets = $derived(data?.buckets || []);
	const semuaKosong = $derived(!Object.values(data?.cells || {}).some((c) => c.score != null));

	async function unduh() {
		if (!data || mengunduh) return;
		mengunduh = true;
		pesan = '';
		const res = await unduhRaporKinerjaSaya(data, data.nama || '');
		if (!res.success) pesan = res.error || 'Gagal membuat PDF';
		mengunduh = false;
	}
</script>

{#if tampil && data}
	<section class="mb-8" data-testid="kinerja-tren">
		<div class="flex items-start justify-between gap-2 mb-1">
			<h2 class="text-lg font-bold" style="color: var(--sys-label)">Tren Kinerja Saya</h2>
			<button type="button" class="text-xs font-semibold text-amber-600 shrink-0 disabled:opacity-50" disabled={mengunduh || semuaKosong} onclick={unduh} title="Unduh rapor skor Anda pada periode yang sedang tampil (PDF)">
				{mengunduh ? 'Menyusun PDF…' : '⬇ Unduh Rapor (PDF)'}
			</button>
		</div>
		<p class="text-[11px] mb-3" style="color: var(--sys-label3)">
			Riwayat skor KPI final Anda. Pilih Bulanan / Triwulan / Tahunan dan geser tahun. Warna: hijau tercapai, kuning waspada, merah kritis; "–" berarti belum ada skor final di periode itu.
		</p>

		<div class="rounded-2xl bg-white border border-slate-200 p-3">
			<div class="flex items-center justify-between gap-2 mb-3 flex-wrap">
				<div class="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-semibold" role="group" aria-label="Periode tren">
					{#each CADENCES as [val, lbl] (val)}
						<button type="button" class="px-3 py-1.5 {cadence === val ? 'bg-amber-500 text-white' : 'bg-white text-slate-600'}" aria-pressed={cadence === val} onclick={() => ganti(val)}>{lbl}</button>
					{/each}
				</div>
				{#if cadence !== 'tahunan'}
					<div class="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-700">
						<button type="button" class="w-7 h-7 rounded-lg border border-slate-200" aria-label="Tahun sebelumnya" onclick={() => geser(-1)}>◀</button>
						<span class="px-2 tabular-nums">{year}</span>
						<button type="button" class="w-7 h-7 rounded-lg border border-slate-200" aria-label="Tahun berikutnya" onclick={() => geser(1)}>▶</button>
					</div>
				{/if}
			</div>

			{#if loading}
				<p class="text-[11px] text-slate-400" data-testid="tren-loading">Memuat tren…</p>
			{:else if semuaKosong}
				<p class="text-[12px] text-slate-500" data-testid="tren-kosong">Belum ada skor final pada rentang ini. Coba tahun atau periode lain.</p>
			{:else}
				<div class="overflow-x-auto -mx-1 px-1">
					<table class="w-full text-[11px] border-separate border-spacing-0.5">
						<thead>
							<tr>
								<th class="text-left font-semibold text-slate-500 sticky left-0 bg-white pr-2 min-w-[110px]">Indikator</th>
								{#each buckets as b (b.key)}
									<th class="font-semibold text-slate-500 px-1 min-w-[34px]" title={b.fullLabel}>{b.label}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							<tr>
								<td class="sticky left-0 bg-white pr-2 font-black text-slate-800">Skor total</td>
								{#each buckets as b (b.key)}
									{@const s = data.cells?.[b.key]?.score ?? null}
									<td class="text-center rounded font-black py-1.5 {toneClass(s, data.thresholds)}" title="{b.fullLabel}: {s ?? 'belum ada skor final'}">{s ?? '–'}</td>
								{/each}
							</tr>
							{#if bukaIndikator}
								{#each data.indicators || [] as ind (ind.key)}
									<tr>
										<td class="sticky left-0 bg-white pr-2 truncate max-w-[130px] text-slate-600" title="{ind.name}{ind.weight != null ? ` (bobot ${ind.weight}%)` : ''}">{ind.name}</td>
										{#each buckets as b (b.key)}
											{@const a = ind.cells?.[b.key]?.achievement ?? null}
											<td class="text-center rounded py-1 {toneClass(a, data.thresholds)}">{a ?? '–'}</td>
										{/each}
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</div>
				<div class="mt-2 flex items-center justify-between gap-2">
					{#if (data.indicators?.length ?? 0) > 0}
						<button type="button" class="text-[11px] font-semibold text-slate-600 underline" aria-expanded={bukaIndikator} onclick={() => (bukaIndikator = !bukaIndikator)}>
							{bukaIndikator ? 'Sembunyikan rincian indikator' : `Lihat rincian ${data.indicators?.length} indikator`}
						</button>
					{/if}
					{#if data.summary?.delta != null}
						<span class="text-[11px] font-bold {data.summary.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}" title="Selisih skor periode terakhir dibanding periode berdata sebelumnya">
							{data.summary.delta >= 0 ? '▲' : '▼'} {Math.abs(data.summary.delta)} poin
						</span>
					{/if}
				</div>
				{#if pesan}<p class="mt-1 text-[11px] text-red-600" role="alert">{pesan}</p>{/if}
			{/if}
		</div>
	</section>
{/if}
