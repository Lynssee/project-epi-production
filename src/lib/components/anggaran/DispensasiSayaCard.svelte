<!-- src/lib/components/anggaran/DispensasiSayaCard.svelte -->
<!-- "Permintaan dispensasi saya": status 5 permintaan terbaru (menunggu / disetujui / ditolak + catatan GM).
     Sekali muat saat dibuka + saat `refreshKey` berubah (mis. setelah mengirim permintaan) -- tanpa polling (hemat kuota).
     Disembunyikan bila belum pernah meminta, supaya tidak menambah kebisingan layar. -->
<script lang="ts">
	import { fetchMyDispensasiRequests, type MyDispensasiRequest } from '$lib/services/dispensasiRequest';
	import { dispensasiStatusInfo, pickRecentRequests } from '$lib/utils/dispensasiStatus';

	let {
		refreshKey = 0,
		projectNames = {}
	}: { refreshKey?: number; projectNames?: Record<string, string> } = $props();

	const GATE_LABEL: Record<string, string> = { G10_HARIAN: 'Laporan Harian (G10)', G_MOM_BRIEFING: 'MOM Briefing' };
	const TONE: Record<string, string> = {
		amber: 'background:#fffbeb;color:#92400e',
		green: 'background:#f0fdf4;color:#166534',
		red: 'background:#fef2f2;color:#991b1b'
	};

	let rows = $state<MyDispensasiRequest[]>([]);
	let loading = $state(true);

	async function muat() {
		loading = true;
		rows = pickRecentRequests(await fetchMyDispensasiRequests(), 5);
		loading = false;
	}

	$effect(() => {
		void refreshKey; // muat ulang saat kunci berubah
		muat();
	});
</script>

{#if !loading && rows.length > 0}
	<div class="card-section space-y-1.5" data-testid="dispensasi-saya">
		<div class="flex items-center justify-between">
			<span class="text-[13px] font-semibold text-slate-800 dark:text-slate-100">🆘 Permintaan Dispensasi Saya</span>
			<button type="button" onclick={muat} class="text-[11px] font-semibold text-[var(--p)]" title="Ambil status terbaru">🔄 Muat ulang</button>
		</div>
		{#each rows as r (r.id)}
			{@const st = dispensasiStatusInfo(r.status)}
			<div class="p-2 rounded-lg text-[12px]" style={TONE[st.tone]}>
				<div class="flex items-center justify-between gap-2">
					<span class="font-medium truncate">{projectNames[String(r.project_id)] || `Proyek #${r.project_id}`} · {GATE_LABEL[r.gate_key] || r.gate_key}</span>
					<span class="shrink-0 font-semibold">{st.icon} {st.label}</span>
				</div>
				{#if r.status === 'ditolak' && r.catatan_keputusan}
					<p class="text-[11px] mt-0.5">Alasan: {r.catatan_keputusan}</p>
				{:else if st.hint}
					<p class="text-[11px] mt-0.5 opacity-80">{st.hint}</p>
				{/if}
			</div>
		{/each}
	</div>
{/if}
