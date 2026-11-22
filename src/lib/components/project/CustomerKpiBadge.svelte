<!-- src/lib/components/project/CustomerKpiBadge.svelte
     Laporan Periodik Fase 6A: badge KPI customer proyek (read-only, tanpa nominal). Dimuat malas & non-blokir;
     bila tidak tersedia, tidak menampilkan apa pun (tidak menyamar sebagai "aman"). Skor dihitung di ERP admin. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getIdToken } from '$lib/services/secureDirectus';

	let { projectId }: { projectId: number | string } = $props();

	let info = $state<{ badge: string; label: string; composite: number | null } | null>(null);

	const TONE: Record<string, { bg: string; fg: string }> = {
		pelanggan_loyal: { bg: 'rgba(52,199,89,0.25)', fg: '#eafff0' },
		lancar: { bg: 'rgba(52,199,89,0.2)', fg: '#eafff0' },
		perlu_monitoring: { bg: 'rgba(255,204,0,0.3)', fg: '#fff8d6' },
		risiko_piutang: { bg: 'rgba(255,59,48,0.35)', fg: '#ffecea' },
		belum_ada_transaksi: { bg: 'rgba(255,255,255,0.15)', fg: 'rgba(255,255,255,0.8)' }
	};

	onMount(async () => {
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/proyek/${encodeURIComponent(String(projectId))}/customer-kpi`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!res.ok) return;
			const j = await res.json();
			if (j?.available) info = { badge: j.badge, label: j.label, composite: j.composite ?? null };
		} catch {
			// non-blokir: badge hanya tambahan informasi
		}
	});

	const tone = $derived(TONE[info?.badge ?? ''] ?? TONE.belum_ada_transaksi);
</script>

{#if info}
	<span
		class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
		style="background: {tone.bg}; color: {tone.fg}"
		title="Status kinerja customer (pembayaran, disiplin TOP, transaksi, komplain). Hanya informasi — tidak memblokir pekerjaan. Detail ada di dashboard admin."
	>
		Customer: {info.label}{info.composite != null ? ` · ${info.composite}` : ''}
	</span>
{/if}
