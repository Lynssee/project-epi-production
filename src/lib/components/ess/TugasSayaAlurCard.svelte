<!-- src/lib/components/ess/TugasSayaAlurCard.svelte -->
<!-- "Tugas Saya di Alur Kerja" (halaman Kinerja ESS, di samping kartu Dampak Gate ke KPI): langkah-langkah alur bisnis yang
     menjadi tanggung jawab jabatan Anda + target waktunya. Ringan: satu panggilan ber-cache; fail-soft (tidak ada data = kartu tak tampil). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { loadMyTasks, type MineResult } from '$lib/services/processGuidanceMineApi';
	import { loadTrainingStatus, type TrainingStatus } from '$lib/services/processGuidanceTrainingApi';
	import { IconRoute } from '@tabler/icons-svelte';

	const MAX_SHOWN = 4;
	let data = $state<MineResult | null>(null);

	// Status training untuk program yang ditautkan ke langkah saya (SATU panggilan, maks. 20 program). Gagal = baris training tidak tampil.
	let training = $state<TrainingStatus[]>([]);

	onMount(async () => {
		data = await loadMyTasks();
		const ids = [...new Set((data?.tasks ?? []).flatMap((t) => (t.training ?? []).map((x) => x.program_id)))];
		if (ids.length > 0) {
			const r = await loadTrainingStatus(ids);
			if (r.ok) training = r.items;
		}
	});

	// Hanya program TERBIT yang bisa diikuti, jadi hanya itu yang dihitung.
	let trainingTerbit = $derived(training.filter((p) => p.terbit));
	let trainingBelum = $derived(trainingTerbit.filter((p) => p.status_saya !== 'lulus').length);

	let tasks = $derived(data?.tasks ?? []);
	let flowCount = $derived(new Set(tasks.map((t) => t.flow_id)).size);
	// Langkah ber-SLA dulu (paling terukur), lalu urutan alur.
	let shown = $derived([...tasks].sort((a, b) => Number(!!b.sla_hours) - Number(!!a.sla_hours)).slice(0, MAX_SHOWN));
	let withSla = $derived(tasks.filter((t) => t.sla_hours).length);
	let tampil = $derived(Boolean(data?.posisi && tasks.length > 0));
</script>

{#if tampil && data?.posisi}
	<div class="mb-8 glass-panel rounded-2xl p-5" data-testid="tugas-saya-alur">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h2 class="text-lg font-bold flex items-center gap-2" style="color: var(--sys-label)">
					<IconRoute size={20} style="color: var(--p, var(--g))" /> Tugas Saya di Alur Kerja
				</h2>
				<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
					Langkah alur bisnis yang menjadi tanggung jawab jabatan <strong>{data.posisi.nama}</strong>.
					{#if data.source === 'cached'}(salinan terakhir di perangkat){/if}
				</p>
			</div>
			<div class="text-right shrink-0">
				<p class="text-2xl font-extrabold" style="color: var(--sys-label)">{tasks.length}</p>
				<p class="text-[10px]" style="color: var(--sys-label3)">langkah · {flowCount} alur</p>
			</div>
		</div>

		<ul class="mt-3 space-y-1.5">
			{#each shown as t (`${t.flow_id}:${t.node_id}`)}
				<li>
					<a
						href="/panduan/alur?alur={encodeURIComponent(t.flow_id)}&fokus={encodeURIComponent(t.node_id)}"
						class="block rounded-xl px-3 py-2 bg-slate-50 active:scale-[0.99] transition-transform"
					>
						<span class="block text-xs font-semibold" style="color: var(--sys-label)">{t.label}</span>
						<span class="block text-[10px]" style="color: var(--sys-label3)">
							{t.flow_title}{t.sla_hours ? ` · target ${t.sla_hours} jam` : ''}
						</span>
					</a>
				</li>
			{/each}
		</ul>

		{#if trainingTerbit.length > 0}
			<a href="/ess/pelatihan" class="mt-3 block rounded-xl px-3 py-2 text-[11px] {trainingBelum > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}" data-testid="tugas-training">
				{#if trainingBelum > 0}
					🎓 <strong>{trainingBelum}</strong> dari {trainingTerbit.length} training untuk langkah Anda belum selesai — buka Pelatihan →
				{:else}
					🎓 Semua {trainingTerbit.length} training untuk langkah Anda sudah lulus ✅
				{/if}
			</a>
		{/if}

		<div class="mt-3 flex items-center justify-between text-[11px]">
			<span style="color: var(--sys-label3)">{withSla > 0 ? `${withSla} langkah punya target waktu` : 'Belum ada target waktu pada langkah Anda'}</span>
			<a href="/panduan/alur" class="font-bold underline" style="color: var(--p, var(--g))">Lihat semua →</a>
		</div>
	</div>
{/if}
