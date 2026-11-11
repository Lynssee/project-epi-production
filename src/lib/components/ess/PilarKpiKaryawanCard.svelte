<!-- src/lib/components/ess/PilarKpiKaryawanCard.svelte
     4 Pilar kinerja pada satu scorecard Finalized (General / Teknis / Administrasi / Inovasi). Data dihitung server (kpi.pilar);
     komponen ini hanya menampilkan. Pilar tanpa data tidak dihitung 0 -> bobot dialihkan (ditandai "belum terukur"). -->
<script lang="ts">
	import type { KpiPilar, KpiPilarKey } from '$lib/services/ess/kpi';

	let { pilar = null }: { pilar?: KpiPilar | null } = $props();

	const URUT: KpiPilarKey[] = ['general', 'teknis', 'administrasi', 'inovasi'];
	const META: Record<KpiPilarKey, { label: string; hint: string; bar: string }> = {
		general: { label: 'Disiplin', hint: 'Kehadiran, ketepatan jam masuk, bebas SP, pelatihan wajib.', bar: 'bg-purple-500' },
		teknis: { label: 'Teknis', hint: 'Hasil kerja sesuai peran/jabatan Anda.', bar: 'bg-blue-500' },
		administrasi: { label: 'Administrasi', hint: 'Laporan harian, kecepatan approval, kepatuhan gate, kelengkapan berkas.', bar: 'bg-amber-500' },
		inovasi: { label: 'Kepemimpinan & Inisiatif', hint: 'Penilaian rekan/atasan, inisiatif perbaikan, koordinasi tim.', bar: 'bg-cyan-500' }
	};
	const tone = (s: number | null) => (s == null ? 'var(--sys-label4)' : s >= 85 ? '#059669' : s >= 70 ? '#d97706' : '#e11d48');
</script>

{#if pilar && pilar.pilars}
	<div class="mb-5 relative z-10" data-testid="pilar-kpi-karyawan">
		<div class="flex items-center justify-between mb-2">
			<p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--sys-label4)">
				4 Pilar Kinerja
				{#if pilar.mode === 'shadow'}<span class="ml-1 normal-case font-semibold text-indigo-500" title="Tampilan simulasi: skor resmi Anda tidak berubah.">(simulasi)</span>{/if}
			</p>
			{#if pilar.composite != null}
				<p class="text-[11px] font-bold" style="color: var(--sys-label3)">Komposit <span style="color: {tone(pilar.composite)}">{pilar.composite}</span></p>
			{/if}
		</div>
		<div class="grid grid-cols-2 gap-2">
			{#each URUT as k (k)}
				{@const p = pilar.pilars[k]}
				<div class="rounded-xl p-2.5 bg-white/50 border border-white/20" title={META[k].hint}>
					<div class="flex items-center justify-between">
						<span class="text-[9px] font-bold uppercase tracking-wider" style="color: var(--sys-label4)">{META[k].label}</span>
						<span class="text-[9px]" style="color: var(--sys-label4)">{p?.weight ?? 0}%</span>
					</div>
					<p class="text-lg font-black" style="color: {tone(p?.score ?? null)}">{p?.score ?? '—'}</p>
					{#if p?.score != null}
						<div class="h-1.5 rounded-full overflow-hidden bg-slate-100 mt-1">
							<div class="h-full rounded-full {META[k].bar}" style="width: {Math.min(p.score, 100)}%"></div>
						</div>
						<p class="text-[9px] mt-1" style="color: var(--sys-label4)">{p.terukur}/{p.total} indikator terukur</p>
					{:else}
						<p class="text-[9px] mt-1 italic" style="color: var(--sys-label4)">{(p?.total ?? 0) > 0 ? 'Belum terukur' : 'Tidak ada indikator'}</p>
					{/if}
				</div>
			{/each}
		</div>
		{#if pilar.missing.length}
			<p class="text-[10px] mt-1.5" style="color: var(--sys-label4)">Pilar yang belum terukur tidak dihitung 0 — bobotnya dialihkan ke pilar lain.</p>
		{/if}
	</div>
{/if}
