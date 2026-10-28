<script lang="ts">
	// Rekomendasi §6.7 — Rapor Efisiensi per Leader.
	// Biaya realisasi per rupiah plafon RAP, dikelompokkan & diperingkat per Project Leader.
	// Makin RENDAH rasio, makin efisien. Data menumpang yang sudah dimuat halaman terpusat
	// (nol fetch tambahan). Untuk leader biasa hanya barisnya sendiri; coordinator melihat
	// perbandingan lintas leader di workshop-nya.
	let {
		projects = [],
		rabTotals = {},
		actualTotals = {}
	}: {
		projects: any[];
		rabTotals: Record<number, number>;
		actualTotals: Record<number, number>;
	} = $props();

	function pct(r: number | null): string {
		return r == null ? '—' : `${Math.round(r * 100)}%`;
	}

	let rows = $derived.by(() => {
		const byLeader = new Map<string, { leader: string; projects: number; rab: number; actual: number }>();
		for (const p of projects) {
			const leader = (p.leader || p.leader_name || 'Tanpa Leader').toString().trim() || 'Tanpa Leader';
			const g = byLeader.get(leader) || { leader, projects: 0, rab: 0, actual: 0 };
			g.projects++;
			g.rab += Number(rabTotals[p.id] || 0);
			g.actual += Number(actualTotals[p.id] || 0);
			byLeader.set(leader, g);
		}
		return [...byLeader.values()]
			.map((g) => ({ ...g, ratio: g.rab > 0 ? g.actual / g.rab : null }))
			.sort((a, b) => (a.ratio ?? 99) - (b.ratio ?? 99));
	});

	function tone(ratio: number | null): string {
		if (ratio == null) return 'text-gray-400';
		if (ratio > 1) return 'text-red-600 font-semibold';
		if (ratio > 0.85) return 'text-amber-600 font-semibold';
		return 'text-emerald-600 font-semibold';
	}
</script>

{#if rows.length > 0}
	<div class="bg-white dark:bg-[#1B2530] rounded-2xl shadow-xs border border-gray-200/80 dark:border-[#2B3844] p-4 sm:p-5">
		<h3 class="text-sm font-bold text-gray-900 dark:text-white mb-1">Efisiensi per Leader</h3>
		<p class="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
			Realisasi biaya dibanding plafon RAP. Makin rendah, makin efisien.
		</p>
		<div class="overflow-x-auto">
			<table class="min-w-full text-xs">
				<thead>
					<tr class="text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-[#2B3844]">
						<th class="py-1.5 pr-3 text-left font-medium">Leader</th>
						<th class="py-1.5 px-2 text-right font-medium">Proyek</th>
						<th class="py-1.5 px-2 text-right font-medium">Realisasi / Plafon</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r, i (r.leader)}
						<tr class="border-b border-gray-50 dark:border-[#232F3B]">
							<td class="py-1.5 pr-3">
								<span class="text-gray-400">{i + 1}.</span> {r.leader}
							</td>
							<td class="py-1.5 px-2 text-right text-gray-600 dark:text-gray-300">{r.projects}</td>
							<td class="py-1.5 px-2 text-right {tone(r.ratio)}">{pct(r.ratio)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
