<!-- src/lib/components/ess/GateKpiBannerMendesak.svelte
     Banner dashboard harian: dokumen yang akan berpengaruh ke skor KPI dalam < BATAS_JAM jam. Menaut ke kartu "Kinerja Saya".
     Memakai getGateKpiSaya() (cache memori 2 menit, sama dengan kartu) -> tidak menambah beban server. Fail-soft: tidak tampil bila tak ada yang mendesak. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getGateKpiSaya } from '$lib/services/ess/gateKpiSaya';
	import { IconClockHour4 } from '@tabler/icons-svelte';

	const BATAS_JAM = 12;
	let jumlah = $state(0);
	let tersempit = $state<number | null>(null);

	onMount(async () => {
		const d = await getGateKpiSaya();
		const mendesak = (d.tertahan ?? []).filter((x) => x.status === 'edukasi' && x.sisa_jam <= BATAS_JAM);
		jumlah = mendesak.length;
		tersempit = mendesak.length ? Math.min(...mendesak.map((x) => x.sisa_jam)) : null;
	});
</script>

{#if jumlah > 0}
	<a href="/ess/kinerja" class="mb-4 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700" data-testid="gate-kpi-banner" title="Buka Kinerja Saya untuk membenahi dokumen">
		<IconClockHour4 size={20} />
		<span class="text-xs font-semibold">
			{jumlah} dokumen akan berpengaruh ke skor KPI dalam &lt; {BATAS_JAM} jam (tersisa {Math.ceil(tersempit ?? 0)} jam). Ketuk untuk membenahi.
		</span>
	</a>
{/if}
