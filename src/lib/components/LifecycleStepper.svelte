<!-- src/lib/components/LifecycleStepper.svelte
     Lifecycle Customer -> PO -> Komisi v2, Fase 6 (L1) — stepper read-only utk
     dashboard lapangan. Sales/PL lihat SO ini sudah sampai tahap mana (PO
     diverifikasi / SJ / invoice) tanpa perlu tanya admin. TANPA nominal komisi
     (sensitif) -- fase Komisi Agen (C9) sengaja TIDAK ditampilkan di sini. -->
<script lang="ts">
	import { resolveCustomerLifecycle } from '$lib/services/customerLifecycle.js';

	let { facts, so }: { facts: any; so: { id: number } | null } = $props();

	const STATE_STYLE: Record<string, { dot: string; text: string; label: string }> = {
		selesai: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Selesai' },
		proses: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-700', label: 'Proses' },
		belum: { dot: 'bg-gray-300', text: 'text-gray-400', label: 'Belum tercatat' },
		gagal: { dot: 'bg-rose-500', text: 'text-rose-700', label: 'Gagal' }
	};

	let result = $derived(
		so?.id
			? resolveCustomerLifecycle({
					so,
					prospect: facts?.prospect ?? null,
					surveys: facts?.surveys ?? [],
					quotations: facts?.quotations ?? [],
					kalkulatorPenawaran: facts?.kalkulatorPenawaran ?? [],
					masterCustomer: facts?.masterCustomer ?? null,
					suratJalan: facts?.suratJalan ?? [],
					invoices: facts?.invoices ?? [],
					komisiPengajuan: facts?.komisiPengajuan ?? []
				})
			: null
	);

	// L1 sengaja TIDAK menampilkan fase Komisi Agen (C9) ke lapangan -- sensitif.
	let visiblePhases = $derived((result?.phases ?? []).filter((p: any) => p.id !== 'C9'));
</script>

{#if result && visiblePhases.length > 0}
	<div class="space-y-2">
		{#each visiblePhases as phase (phase.id)}
			{@const style = STATE_STYLE[phase.state] ?? STATE_STYLE.belum}
			<div class="flex items-start gap-2.5" title={phase.hint}>
				<div class="mt-1 w-2.5 h-2.5 rounded-full shrink-0 {style.dot}"></div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5 flex-wrap">
						<span class="text-sm font-medium text-gray-800">{phase.label}</span>
						<span class="text-[10px] px-1.5 py-0.5 rounded border {style.text} border-current/30">{style.label}</span>
						{#if phase.conflict}
							<span class="text-[10px] px-1.5 py-0.5 rounded border border-orange-300 bg-orange-50 text-orange-700 font-medium">Status bentrok</span>
						{/if}
					</div>
					<p class="text-xs text-gray-500 mt-0.5">{phase.evidence}</p>
				</div>
			</div>
		{/each}
	</div>
{:else}
	<p class="text-xs text-gray-400">Belum ada data lifecycle untuk SO ini.</p>
{/if}
