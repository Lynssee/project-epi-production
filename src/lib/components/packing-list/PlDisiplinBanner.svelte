<!-- Quick-Fix Gate Banner (Penajaman Gate PL, Fase 3): ringkasan disiplin proyek SEBELUM user mengetik.
     Berlaku untuk semua pengaju — status dihitung per proyek. Mode shadow tampil sebagai info, tidak memblokir. -->
<script lang="ts">
	import { precheckPackingGate, type PackingDisiplinInfo } from '$lib/services/packingList';

	let { projectId = null, refreshKey = 0 }: { projectId?: number | null; refreshKey?: number } = $props();

	let items = $state<PackingDisiplinInfo[]>([]);
	let loading = $state(false);
	let seq = 0;

	async function load(pid: number) {
		const mine = ++seq;
		loading = true;
		const r = await precheckPackingGate(pid, []);
		if (mine !== seq) return; // proyek berganti saat menunggu
		items = (r.disiplin || []).filter((d) => d.status !== 'not_applicable');
		loading = false;
	}

	$effect(() => {
		void refreshKey;
		if (projectId) load(projectId);
		else {
			seq++;
			items = [];
		}
	});

	const modeNote = (m: string) =>
		m === 'hard' ? 'wajib dipenuhi sebelum kirim' : m === 'shadow' ? 'pemantauan — belum memblokir' : 'peringatan — tetap bisa kirim';
</script>

{#if projectId && (loading || items.length > 0)}
	<div class="rounded-xl border border-gray-200 bg-white p-3 text-[12px] space-y-2" aria-live="polite">
		<div class="flex items-center justify-between">
			<span class="font-semibold text-gray-800">Kesiapan Proyek</span>
			<span class="text-[10px] text-gray-400" title="Dicek otomatis untuk proyek terpilih, siapa pun yang mengajukan.">ⓘ berlaku untuk semua pengaju</span>
		</div>
		{#if loading && items.length === 0}
			<p class="text-gray-400">Memeriksa data proyek, P2H alat & laporan harian…</p>
		{/if}
		{#each items as d (d.gate_key)}
			<div class="flex items-start gap-2 rounded-lg px-2.5 py-2 {d.status === 'passed' ? 'bg-emerald-50 text-emerald-800' : d.mode === 'hard' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}">
				<span>{d.status === 'passed' ? '🟢' : d.mode === 'hard' ? '🔴' : '🟡'}</span>
				<div class="min-w-0 flex-1">
					<div class="font-semibold">{d.label}</div>
					<div>{d.message}</div>
					{#if d.status === 'failed'}
						<div class="text-[10px] opacity-70 mt-0.5">{modeNote(d.mode)}</div>
						{#if d.fix_links.length}
							<div class="mt-1.5 flex flex-wrap gap-1.5">
								{#each d.fix_links as l}
									<a href={l.href} class="px-2 py-1 rounded-md bg-white/80 border border-current text-[11px] font-semibold hover:bg-white">{l.label} →</a>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}
