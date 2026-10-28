<!-- src/lib/components/project/ManpowerTodayCard.svelte -->
<!-- Kartu "Kebutuhan Manpower Hari Ini" (Fase 3 Integrasi Timeline <-> PL & Manpower). Rencana
     dari sub.manpower[] di timeline_planning (nol query tambahan), hadir dari laporan harian yang
     SUDAH ditarik halaman timeline. Tidak tampil bila admin belum mengisi rencana manpower. -->
<script lang="ts">
	import { plannedManpowerOn, attendedOn } from '$lib/utils/manpowerPlan';

	let { categories = [], reports = [], todayKey }: { categories: any[]; reports: any[]; todayKey: string } = $props();

	let planned = $derived(plannedManpowerOn(categories, todayKey));
	let attended = $derived(attendedOn(reports, todayKey));
	let roleText = $derived(
		Object.entries(planned.byRole)
			.map(([role, qty]) => `${qty} ${role}`)
			.join(', ')
	);
	let gap = $derived(attended == null ? null : attended - planned.total);
</script>

{#if planned.total > 0}
	<div class="mp-card">
		<div class="mp-head">👷 Kebutuhan Manpower Hari Ini: <strong>{planned.total} orang</strong></div>
		<div class="mp-roles">{roleText}</div>
		{#if attended == null}
			<div class="mp-att mp-att-none">Laporan harian hari ini belum ada — isi jumlah hadir di laporan agar terbandingkan.</div>
		{:else}
			<div class="mp-att {gap != null && gap < 0 ? 'mp-att-short' : 'mp-att-ok'}">
				Hadir (laporan): <strong>{attended} orang</strong>
				{#if gap != null && gap < 0}· kurang {Math.abs(gap)} dari rencana{:else if gap != null && gap > 0}· lebih {gap} dari rencana{:else}· sesuai rencana{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.mp-card { margin: 8px 16px 0; padding: 8px 12px; border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 12px; font-size: 12px; color: #1e3a8a; }
	.mp-head { font-size: 12.5px; }
	.mp-roles { font-size: 11px; color: #475569; margin-top: 2px; }
	.mp-att { font-size: 11px; margin-top: 4px; font-weight: 600; }
	.mp-att-ok { color: #15803d; }
	.mp-att-short { color: #b91c1c; }
	.mp-att-none { color: #64748b; font-weight: 400; }
</style>
