<script lang="ts">
	// "Target & Proyeksi Saya" — target pribadi (yang sudah disetujui/dikunci atasan) & konteks proyeksi departemen
	// per minggu/bulan/kuartal/tahun. Data: /api/ess/target-saya (proxy ke admin erp-epi).
	// Fail-soft: hanya tampil jika data tersedia atau memberi penjelasan jujur saat history pribadi belum final.
	import { onMount } from 'svelte';
	import { getTargetSaya, sparkPoints, HORIZON_LABEL, STATUS_TEXT, type TargetSaya, type TargetSayaHorizon } from '$lib/services/ess/targetSaya';

	let data = $state<TargetSaya | null>(null);
	let scopeView = $state<'personal' | 'department'>('personal');

	onMount(async () => {
		data = await getTargetSaya();
		if (data && !data.personalReady && data.departmentSummary?.available) {
			scopeView = 'department';
		}
	});

	const hasPersonal = $derived(!!data?.personalReady && (data?.horizons || []).some((h) => h.target || h.forecast));
	const hasDept = $derived(!!data?.departmentSummary?.available);

	const activePayload = $derived.by(() => {
		if (!data) return null;
		if (scopeView === 'department' && data.departmentSummary?.available) {
			return {
				title: `Proyeksi Departemen (${data.departmentSummary.department})`,
				subtitle: 'Skor komposit departemen Anda berdasarkan histori bulan selesai dan proyeksi tren.',
				series: data.departmentSummary.series || [],
				projection: data.departmentSummary.projection || [],
				horizons: (data.departmentSummary.horizons || []).filter((h) => h.target || h.forecast),
				reason: data.departmentSummary.reason || null
			};
		}
		if (hasPersonal) {
			return {
				title: 'Target & Proyeksi Saya',
				subtitle: 'Target yang sudah disetujui atasan, dan perkiraan skor Anda bila tren bulan terakhir berlanjut.',
				series: data.series || [],
				projection: data.projection || [],
				horizons: (data.horizons || []).filter((h) => h.target || h.forecast),
				reason: null
			};
		}
		return null;
	});

	const rows = $derived(activePayload?.horizons || []);
	const spark = $derived(
		activePayload
			? sparkPoints([...(activePayload.series || []).map((s) => s.value), ...(activePayload.projection || []).map((p) => p.value)])
			: null
	);
	const sparkSplit = $derived(
		activePayload
			? ((activePayload.series?.length ?? 0) / Math.max(1, (activePayload.series?.length ?? 0) + (activePayload.projection?.length ?? 0))) * 120
			: 0
	);
	const riskyHorizons = $derived(rows.filter((h) => h.status === 'at_risk' || h.status === 'off_track'));
	const fmt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : Math.round(v * 10) / 10);
	const pct = (h: TargetSayaHorizon) => (h.target?.target && h.forecast ? Math.max(0, Math.min(100, (h.forecast.value / h.target.target) * 100)) : null);
</script>

{#if data?.available && (hasPersonal || hasDept) && activePayload}
	<section class="mb-8" data-testid="target-saya">
		<div class="flex flex-wrap items-center justify-between gap-2 mb-1">
			<h2 class="text-lg font-bold" style="color: var(--sys-label)">{activePayload.title}</h2>
			{#if hasPersonal && hasDept}
				<div class="inline-flex rounded-lg border border-slate-200 bg-white overflow-hidden text-[11px] font-semibold">
					<button type="button" class="px-2.5 py-1 cursor-pointer {scopeView === 'personal' ? 'bg-amber-500 text-white' : 'text-slate-600'}" onclick={() => (scopeView = 'personal')}>Pribadi</button>
					<button type="button" class="px-2.5 py-1 cursor-pointer {scopeView === 'department' ? 'bg-amber-500 text-white' : 'text-slate-600'}" onclick={() => (scopeView = 'department')}>Departemen</button>
				</div>
			{/if}
		</div>
		<p class="text-[11px] mb-3" style="color: var(--sys-label3)">
			{activePayload.subtitle}
		</p>

		{#if !hasPersonal && data.reason}
			<div class="mb-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800">
				ℹ️ <strong>Skor pribadi:</strong> {data.reason} Sementara menampilkan proyeksi departemen Anda.
			</div>
		{/if}

		<div class="rounded-2xl bg-white border border-slate-200 p-3 space-y-3">
			{#if spark}
				<div class="flex items-center gap-3">
					<svg viewBox="0 0 120 28" class="w-32 h-8 shrink-0" role="img" aria-label="Tren skor dan proyeksi">
						<polyline points={spark} fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round" />
						{#if (activePayload.projection?.length ?? 0) > 0}<line x1={sparkSplit} x2={sparkSplit} y1="0" y2="28" stroke="#cbd5e1" stroke-dasharray="2 2" />{/if}
					</svg>
					<span class="text-[10px] text-slate-400">
						Garis: aktual {activePayload.series.length} bln{(activePayload.projection?.length ?? 0) > 0 ? ` → proyeksi ${activePayload.projection.length} bln` : ''}
					</span>
				</div>
			{/if}

			{#if activePayload.reason && rows.length === 0}
				<p class="text-[11px] text-slate-500">{activePayload.reason}</p>
			{/if}

			{#each rows as h (h.horizonType)}
				{@const st = STATUS_TEXT[h.status]}
				{@const p = pct(h)}
				<div data-testid="target-row-{h.horizonType}">
					<div class="flex items-center justify-between gap-2 text-[12px]">
						<span class="font-bold text-slate-800">{HORIZON_LABEL[h.horizonType]} <span class="font-normal text-slate-400">{h.label}</span></span>
						<span class="px-2 py-0.5 rounded-full text-[10px] font-bold {st.c}">{st.t}</span>
					</div>
					<div class="mt-1 flex items-baseline gap-3 text-[12px] text-slate-600">
						<span>Target <b class="text-slate-900">{fmt(h.target?.target)}</b></span>
						<span>Perkiraan <b class="text-amber-700">{fmt(h.forecast?.value)}</b>{#if h.forecast}<span class="text-[10px] text-slate-400"> ({fmt(h.forecast.low)}–{fmt(h.forecast.high)})</span>{/if}</span>
					</div>
					{#if p != null}
						<div class="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin="0" aria-valuemax="100">
							<div class="h-full rounded-full {h.status === 'on_track' ? 'bg-emerald-500' : h.status === 'at_risk' ? 'bg-amber-500' : 'bg-red-500'}" style="width:{p}%"></div>
						</div>
					{/if}
				</div>
			{/each}

			{#if riskyHorizons.length > 0}
				<div class="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900">
					⚡ <strong>Saran aksi:</strong> Proyeksi {riskyHorizons.map((h) => HORIZON_LABEL[h.horizonType]).join(', ')} masih di bawah target. Pastikan absensi, laporan harian, dan daftar tindakan di bawah diselesaikan tepat waktu.
				</div>
			{/if}
		</div>
	</section>
{/if}
