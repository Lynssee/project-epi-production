<!-- src/lib/components/shared/FieldSCurve.svelte
     Fase 6 / 6.3 (Pertajam Modul Penawaran). Kurva S RENCANA (dari penawaran yang
     ditandatangani customer — so_rab.scurve_baseline) vs REALISASI harian.
     SVG murni, tanpa library chart. Runes mode (project-epi enforce). -->
<script lang="ts">
	import IconChartLine from '@tabler/icons-svelte/icons/chart-line';
	import { actualCumulativeSeries, scurveGap, type SCurvePoint } from '$lib/utils/fieldSCurve';

	let {
		baseline = null,
		reports = [],
		project = null,
		startDate = null,
		endDate = null
	}: {
		baseline?: SCurvePoint[] | null;
		reports?: any[];
		project?: any;
		startDate?: string | Date | null;
		endDate?: string | Date | null;
	} = $props();

	const W = 320;
	const H = 150;
	const PAD = { l: 28, r: 8, t: 10, b: 20 };

	function toTime(v: any): number {
		const d = v instanceof Date ? v : new Date(v);
		return d.getTime();
	}

	let plotted = $derived.by(() => {
		const pts = (Array.isArray(baseline) ? baseline : [])
			.filter((x) => x && x.d)
			.map((x) => ({ t: toTime(x.d), p: Number(x.p) || 0 }))
			.filter((x) => !Number.isNaN(x.t))
			.sort((a, b) => a.t - b.t);
		if (pts.length < 2) return null;

		const t0 = startDate ? toTime(startDate) : pts[0].t;
		const t1 = endDate ? toTime(endDate) : pts[pts.length - 1].t;
		const span = Math.max(1, t1 - t0);

		const x = (t: number) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r);
		const y = (p: number) => PAD.t + (1 - Math.min(100, Math.max(0, p)) / 100) * (H - PAD.t - PAD.b);

		// garis rencana: mulai dari (t0, 0) supaya kurva berangkat dari nol
		const planPts = [{ t: t0, p: 0 }, ...pts.filter((pt) => pt.t >= t0 && pt.t <= t1)];
		const planLine = planPts.map((pt) => `${x(pt.t)},${y(pt.p)}`).join(' ');

		const actual = actualCumulativeSeries(reports, project).filter(
			(a: { d: string; p: number }) => toTime(a.d) >= t0 && toTime(a.d) <= Math.max(t1, Date.now())
		);
		const actLine =
			actual.length > 0
				? [{ t: t0, p: 0 }, ...actual.map((a: { d: string; p: number }) => ({ t: toTime(a.d), p: a.p }))]
						.map((pt) => `${x(pt.t)},${y(pt.p)}`)
						.join(' ')
				: '';

		// penanda "hari ini"
		const now = Date.now();
		const todayX = now >= t0 && now <= t1 ? x(now) : null;

		return { x, y, planLine, actLine, todayX, gridY: [0, 25, 50, 75, 100].map((p) => ({ p, yy: y(p) })) };
	});

	let latestActualPct = $derived.by(() => {
		const s = actualCumulativeSeries(reports, project);
		return s.length ? s[s.length - 1].p : null;
	});

	let status = $derived(scurveGap(baseline, latestActualPct, new Date()));
	let toneClass = $derived(
		status.tone === 'ahead'
			? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
			: status.tone === 'behind'
				? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'
				: status.tone === 'ontrack'
					? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800'
					: 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
	);
</script>

{#if plotted}
	<div class="p-4 rounded-xl bg-gray-50/70 dark:bg-slate-800/50 border border-gray-200/80 dark:border-slate-700/80 my-3">
		<div class="flex items-center justify-between gap-2 flex-wrap mb-2">
			<h5 class="flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-slate-200 m-0">
				<IconChartLine size={14} class="text-violet-500" />
				Kurva S — Rencana vs Realisasi
			</h5>
			<span class="text-[10px] font-bold px-2 py-0.5 rounded border {toneClass}">{status.label}</span>
		</div>

		<svg viewBox="0 0 {W} {H}" class="w-full h-auto" role="img" aria-label="Kurva S rencana vs realisasi">
			{#each plotted.gridY as g}
				<line x1={PAD.l} y1={g.yy} x2={W - PAD.r} y2={g.yy} class="stroke-gray-200 dark:stroke-slate-700" stroke-width="0.5" />
				<text x={PAD.l - 4} y={g.yy + 3} text-anchor="end" class="fill-gray-400 dark:fill-slate-500" style="font-size:7px">{g.p}%</text>
			{/each}
			{#if plotted.todayX != null}
				<line x1={plotted.todayX} y1={PAD.t} x2={plotted.todayX} y2={H - PAD.b} class="stroke-amber-400" stroke-width="0.75" stroke-dasharray="3 2" />
				<text x={plotted.todayX} y={H - PAD.b + 12} text-anchor="middle" class="fill-amber-500" style="font-size:7px">hari ini</text>
			{/if}
			<polyline points={plotted.planLine} fill="none" class="stroke-violet-500" stroke-width="1.5" stroke-dasharray="4 3" />
			{#if plotted.actLine}
				<polyline points={plotted.actLine} fill="none" class="stroke-emerald-500" stroke-width="2" />
			{/if}
		</svg>

		<div class="flex items-center gap-4 mt-1 text-[10px] text-gray-500 dark:text-slate-400">
			<span class="flex items-center gap-1"><span class="w-3 border-t-2 border-dashed border-violet-500 inline-block"></span> Rencana (penawaran)</span>
			<span class="flex items-center gap-1"><span class="w-3 border-t-2 border-emerald-500 inline-block"></span> Realisasi harian</span>
		</div>
		<p class="text-[10px] text-gray-400 dark:text-slate-500 mt-1 m-0">
			Garis rencana = Kurva S bobot fisik dari penawaran yang ditandatangani customer.
		</p>
	</div>
{/if}
