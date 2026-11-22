<!-- src/lib/components/strategy/PosisiLiniCard.svelte
     Kartu READ-ONLY "Posisi Lini Bisnis" untuk sales/leader: lini mana yang sedang tumbuh/menyusut. Hanya info — tanpa nilai rupiah/margin.
     Tidak tampil sama sekali bila dimatikan Superadmin (bawaan) atau belum ada snapshot. Mandiri & non-blocking. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchPosisiLini, type PosisiLiniResult } from '$lib/services/strategyRadar';

	let data = $state<PosisiLiniResult | null>(null);

	const Q: Record<string, { label: string; cls: string }> = {
		star: { label: 'Bintang', cls: 'bg-emerald-100 text-emerald-800' },
		cash_cow: { label: 'Andalan', cls: 'bg-sky-100 text-sky-800' },
		question: { label: 'Berpotensi', cls: 'bg-amber-100 text-amber-800' },
		dog: { label: 'Menurun', cls: 'bg-rose-100 text-rose-800' },
		tidak_dinilai: { label: 'Belum dinilai', cls: 'bg-slate-100 text-slate-600' }
	};

	onMount(async () => {
		try {
			data = await fetchPosisiLini();
		} catch (e) {
			console.warn('[PosisiLiniCard] gagal memuat (diabaikan):', e);
		}
	});

	const items = $derived((data?.items ?? []).filter((i) => i.quadrant !== 'tidak_dinilai'));
</script>

{#if data?.enabled && items.length}
	<section class="rounded-2xl border p-3.5" style="border-color: var(--sys-sep); background: var(--sys-fill)">
		<header class="mb-2 flex items-start justify-between gap-2">
			<h3 class="text-[13px] font-extrabold" style="color: var(--sys-label)">📊 Posisi Lini Bisnis</h3>
			<span class="cursor-help rounded-full border px-1.5 text-[10px]" title="Dibandingkan pada periode yang sama tahun lalu, berdasarkan jumlah proyek. Hanya info; angka rupiah tidak ditampilkan." style="color: var(--sys-label3)">?</span>
		</header>
		<ul class="space-y-1.5">
			{#each items as i (i.lini_key)}
				<li class="flex items-center justify-between gap-2 text-[12px]">
					<span class="font-semibold" style="color: var(--sys-label)">{i.label}</span>
					<span class="flex items-center gap-1.5">
						<span class="tabular-nums" style="color: var(--sys-label2)">{i.growth_pct == null ? '—' : (i.growth_pct > 0 ? '+' : '') + Math.round(i.growth_pct) + '%'}</span>
						<span class="rounded-full px-2 py-0.5 text-[10px] font-bold {Q[i.quadrant]?.cls}">{Q[i.quadrant]?.label}</span>
					</span>
				</li>
			{/each}
		</ul>
		<p class="mt-2 text-[10px]" style="color: var(--sys-label3)">Pertumbuhan jumlah proyek vs periode sama tahun lalu{data.periode ? ' · snapshot ' + data.periode : ''}.</p>
	</section>
{/if}
