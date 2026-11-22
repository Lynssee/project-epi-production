<!-- src/lib/components/ess/IndikatorBedahCard.svelte
     "Bedah Nilai Saya" (Fase 4 rencana penajaman KPI): daftar indikator scorecard Finalized; ketuk satu indikator → bottom-sheet berisi
     mengapa nilainya X, apakah mandiri/kolektif, sampel dokumen yang menurunkan skor, langkah perbaikan, dan tombol sanggahan bertaut bukti.
     Hanya menampilkan data yang sudah dihitung server (tanpa panggilan API baru). -->
<script lang="ts">
	import type { BedahIndikator, KpiPilarKey } from '$lib/services/ess/kpi';
	import { draftSanggahan } from '$lib/utils/ess/kpiSanggahan';

	let {
		indikator = [],
		bolehSanggah = true,
		onSanggah = () => {}
	}: {
		indikator?: BedahIndikator[];
		/** false bila sanggahan sudah pernah diajukan / jendela tutup — tombol disembunyikan. */
		bolehSanggah?: boolean;
		onSanggah?: (draft: string) => void;
	} = $props();

	const PILAR: Record<KpiPilarKey, string> = { general: 'Disiplin', teknis: 'Teknis', administrasi: 'Administrasi', inovasi: 'Inisiatif' };
	const tone = (s: number | null) => (s == null ? 'var(--sys-label4)' : s >= 85 ? '#059669' : s >= 70 ? '#d97706' : '#e11d48');

	let terbuka = $state<BedahIndikator | null>(null);
	let dipilih = $state<string[]>([]);

	function buka(i: BedahIndikator) {
		terbuka = i;
		dipilih = [];
	}
	function tutup() {
		terbuka = null;
	}
	function toggle(ref: string) {
		dipilih = dipilih.includes(ref) ? dipilih.filter((r) => r !== ref) : [...dipilih, ref];
	}
	function sanggah() {
		if (!terbuka) return;
		onSanggah(draftSanggahan(terbuka, dipilih));
		tutup();
	}
	const fmt = (n: number | null) => (n == null ? '—' : Number(n.toFixed(2)).toLocaleString('id-ID'));
</script>

{#if indikator.length}
	<div class="mb-5 relative z-10" data-testid="indikator-bedah">
		<p class="text-[10px] font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label4)">
			Bedah Nilai Saya <span class="normal-case font-semibold">— ketuk indikator untuk melihat alasannya</span>
		</p>
		<div class="space-y-1.5">
			{#each indikator as i (i.nama)}
				<button
					type="button"
					class="w-full text-left rounded-xl px-3 py-2 bg-white/50 border border-white/20 flex items-center justify-between gap-2 active:scale-[0.99] transition"
					onclick={() => buka(i)}
					title="Ketuk untuk melihat mengapa nilai indikator ini demikian"
				>
					<span class="min-w-0">
						<span class="block text-xs font-bold truncate" style="color: var(--sys-label)">{i.nama}</span>
						<span class="block text-[9px]" style="color: var(--sys-label4)">
							{PILAR[i.pilar]} · bobot {i.bobot}%
							{#if i.atribusi === 'departemen'}· <span class="font-bold text-amber-600">Tim</span>{/if}
						</span>
					</span>
					<span class="text-sm font-black shrink-0" style="color: {tone(i.skor)}">{i.skor == null ? '—' : `${Math.round(i.skor)}`}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

{#if terbuka}
	<div
		class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm"
		role="presentation"
		data-testid="bedah-sheet"
		onclick={(e) => { if (e.target === e.currentTarget) tutup(); }}
	>
		<div class="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[88vh] flex flex-col shadow-2xl" role="dialog" aria-modal="true">
			<div class="p-5 border-b border-slate-200 shrink-0">
				<p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--sys-label4)">Bedah Nilai Saya</p>
				<h3 class="text-base font-bold" style="color: var(--sys-label)">{terbuka.nama}</h3>
				<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
					{#if terbuka.terukur}
						Realisasi <strong>{fmt(terbuka.nilai)}{terbuka.unit ? ` ${terbuka.unit}` : ''}</strong> ·
						target {terbuka.arah === 'rendah' ? '≤' : '≥'} {fmt(terbuka.target)}{terbuka.unit ? ` ${terbuka.unit}` : ''} ·
						skor <strong style="color: {tone(terbuka.skor)}">{terbuka.skor == null ? '—' : Math.round(terbuka.skor)}</strong>
					{:else}
						Belum terukur — tidak dihitung 0.
					{/if}
				</p>
			</div>
			<div class="p-5 overflow-y-auto space-y-3 text-xs" style="color: var(--sys-label)">
				<div class="rounded-xl p-3 border {terbuka.atribusi === 'departemen' ? 'bg-amber-50 border-amber-200' : 'bg-sky-50 border-sky-200'}" data-testid="bedah-atribusi">
					<p class="font-bold">
						{#if terbuka.atribusi === 'departemen'}Nilai tim (kolektif departemen){:else if terbuka.atribusi === 'individu'}Nilai mandiri (capaian pribadi){:else}Atribusi belum tercatat{/if}
					</p>
					<p class="mt-0.5" style="color: var(--sys-label3)">
						{#if terbuka.atribusi === 'departemen'}Dihitung dari seluruh tim/sistem departemen — bukan hanya kinerja Anda.
						{:else if terbuka.atribusi === 'individu'}Dihitung dari aktivitas Anda sendiri.
						{:else}Akan terisi setelah HRD menghitung ulang scorecard periode ini.{/if}
					</p>
				</div>

				<div>
					<p class="text-[10px] font-bold uppercase tracking-wider mb-1" style="color: var(--sys-label4)">Mengapa nilainya begini?</p>
					<p data-testid="bedah-catatan">{terbuka.catatan || 'Belum ada penjelasan tersimpan untuk indikator ini.'}</p>
				</div>

				{#if terbuka.outliers.length}
					<div data-testid="bedah-outliers">
						<p class="text-[10px] font-bold uppercase tracking-wider mb-1" style="color: var(--sys-label4)">
							Contoh yang menurunkan skor ({terbuka.outliers.length}{(terbuka.outliers_total ?? 0) > terbuka.outliers.length ? ` dari ${terbuka.outliers_total}` : ''})
						</p>
						{#if bolehSanggah}<p class="text-[10px] mb-1" style="color: var(--sys-label4)">Centang yang menurut Anda keliru, lalu ketuk "Ajukan keberatan".</p>{/if}
						<ul class="space-y-1">
							{#each terbuka.outliers as o, idx (idx)}
								<li class="flex items-start gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
									{#if bolehSanggah}
										<input type="checkbox" class="mt-0.5" checked={dipilih.includes(o.ref)} onchange={() => toggle(o.ref)} aria-label={`Pilih ${o.ref}`} />
									{/if}
									<span class="min-w-0 flex-1">
										<span class="block font-mono font-bold break-all">{o.ref}</span>
										<span class="block text-[10px]" style="color: var(--sys-label3)">{o.detail}</span>
									</span>
									{#if o.nilai != null}<span class="font-bold text-rose-600 shrink-0">{fmt(o.nilai)} {o.satuan}</span>{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if terbuka.tip}
					<div class="rounded-xl p-3 bg-emerald-50 border border-emerald-200" data-testid="bedah-tip">
						<p class="font-bold text-emerald-800">Langkah perbaikan</p>
						<p class="mt-0.5 text-emerald-900">{terbuka.tip}</p>
					</div>
				{/if}
			</div>
			<div class="p-4 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-slate-50 rounded-b-3xl">
				<button type="button" class="px-4 py-2 text-xs font-bold rounded-xl bg-white border" style="border-color: var(--sys-sep); color: var(--sys-label3)" onclick={tutup}>Tutup</button>
				{#if bolehSanggah}
					<button
						type="button"
						class="px-4 py-2 text-xs font-bold rounded-xl text-white"
						style="background: var(--p, var(--g))"
						onclick={sanggah}
						title="Membuka formulir keberatan dengan indikator dan dokumen terpilih sudah tercantum"
					>
						Ajukan keberatan{dipilih.length ? ` (${dipilih.length} dokumen)` : ''}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
