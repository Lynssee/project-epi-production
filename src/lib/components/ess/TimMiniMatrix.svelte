<script lang="ts">
	// Mini-matriks skor pekerja satu proyek (mingguan/bulanan) di kartu "Performa Tim Proyek Saya".
	// Data dari /api/ess/tim-proyek-tren (anggota ditentukan server dari token). Sel kosong "–" = belum ada data periode itu, bukan 0.
	import { goto } from '$app/navigation';
	import { toneClass, type TimTren, type TimCadence } from '$lib/services/ess/kinerjaTren';

	let { tren, projectId, cadence, loading = false, onCadence }: {
		tren: TimTren | null;
		projectId: number;
		cadence: TimCadence;
		loading?: boolean;
		onCadence: (c: TimCadence) => void;
	} = $props();

	const CADENCES: [TimCadence, string][] = [['mingguan', 'Mingguan'], ['bulanan', 'Bulanan']];
	const proyek = $derived(tren?.available ? (tren.proyek || []).find((p) => p.project_id === projectId) : null);
	const buckets = $derived(tren?.buckets || []);
	const belumDinilai = $derived((proyek?.anggota || []).filter((a) => a.belumDinilaiPeriodeIni));
	const labelBerjalan = $derived(buckets.find((b) => b.key === tren?.bucketBerjalan)?.fullLabel || '');
</script>

<div class="border-t border-slate-100 px-4 py-3" data-testid="tim-mini-matrix">
	<div class="flex items-center justify-between gap-2 mb-2">
		<p class="text-[11px] font-semibold text-slate-600" title="Skor tiap pekerja per periode. Warna: hijau tercapai, kuning waspada, merah kritis; '–' = belum ada data (bukan nilai 0).">Matriks skor pekerja</p>
		<div class="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-semibold" role="group" aria-label="Periode matriks">
			{#each CADENCES as [val, lbl] (val)}
				<button type="button" class="px-2.5 py-1 {cadence === val ? 'bg-amber-500 text-white' : 'bg-white text-slate-600'}" aria-pressed={cadence === val} onclick={() => onCadence(val)}>{lbl}</button>
			{/each}
		</div>
	</div>

	{#if loading}
		<p class="text-[11px] text-slate-400" data-testid="tim-matrix-loading">Memuat matriks…</p>
	{:else if !proyek || buckets.length === 0}
		<p class="text-[11px] text-slate-400">Matriks belum tersedia untuk proyek ini.</p>
	{:else}
		{#if belumDinilai.length > 0}
			<div class="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800" data-testid="tim-belum-dinilai">
				<b>{belumDinilai.length} pekerja belum dinilai</b> pada {labelBerjalan || 'periode ini'}: {belumDinilai.slice(0, 3).map((a) => a.nama).join(', ')}{belumDinilai.length > 3 ? ` +${belumDinilai.length - 3} lainnya` : ''}.
				<button type="button" class="underline font-semibold ml-1" onclick={() => goto('/manpower/rating')}>Nilai sekarang →</button>
			</div>
		{/if}
		<div class="overflow-x-auto -mx-1 px-1">
			<table class="w-full text-[11px] border-separate border-spacing-0.5">
				<thead>
					<tr>
						<th class="text-left font-semibold text-slate-500 sticky left-0 bg-white pr-2 min-w-[96px]">Pekerja</th>
						{#each buckets as b (b.key)}
							<th class="font-semibold px-1 min-w-[34px] {b.key === tren?.bucketBerjalan ? 'text-amber-600' : 'text-slate-500'}" title={b.fullLabel}>{b.label}</th>
						{/each}
						<th class="font-semibold text-slate-500 px-1" title="Rata-rata skor periode yang berdata">Rata²</th>
					</tr>
				</thead>
				<tbody>
					{#each proyek.anggota as a (a.manpower_id)}
						<tr>
							<td class="sticky left-0 bg-white pr-2 truncate max-w-[110px] font-semibold text-slate-700" title="{a.nama} · {a.jabatan}">{a.nama}</td>
							{#each buckets as b (b.key)}
								{@const s = a.cells?.[b.key] ?? null}
								<td class="text-center rounded font-bold py-1 {toneClass(s, tren?.thresholds)}" title="{b.fullLabel}: {s != null ? s : 'belum ada data'}">{s ?? '–'}</td>
							{/each}
							<td class="text-center font-black text-slate-800">{a.avgScore ?? '–'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="mt-1.5 text-[10px] text-slate-400">Skor dari kehadiran + penilaian lapangan pada periode tersebut. Geser tabel ke samping bila kolom banyak.</p>
	{/if}
</div>
