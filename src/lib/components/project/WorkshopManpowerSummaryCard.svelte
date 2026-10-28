<!-- WorkshopManpowerSummaryCard.svelte — RAP Ciketing v2, Fase 5 #2 (dashboard lapangan).
     Ringkasan RAP vs Aktual MANPOWER per PO yang dipegang leader.
     Keputusan user: leader lapangan HANYA melihat lampu (hijau/kuning/merah) + persen —
     TIDAK ada nominal rupiah (pola share_ke_sales 'lampu' di kapasitasEngine.js). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { loadFullRab } from '$lib/services/soRabApi';
	import { getRABvsAktualisasi } from '$lib/services/projectAktualisasiApi';
	import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
	import { IconUsersGroup, IconLoader2, IconAlertTriangle, IconCheck } from '@tabler/icons-svelte';

	let { projects = [] } = $props<{ projects?: any[] }>();

	const MAX_PO = 20;

	let loading = $state(true);
	let rows = $state<Array<{
		id: number | string;
		name: string;
		lokasi?: string;
		rapPlanned: number;      // dipakai hanya untuk hitung %, TIDAK ditampilkan
		actual: number;          // idem
		pct: number | null;      // % serapan manpower
		manDayPlan: number;      // orang-hari rencana (info, bukan uang)
		status: 'ok' | 'warning' | 'critical' | 'na';
		error?: boolean;
	}>>([]);

	let thresholds = $state({ cost_pct_warning: 90, cost_pct_critical: 100 });

	function statusOf(pct: number | null): 'ok' | 'warning' | 'critical' | 'na' {
		if (pct === null) return 'na';
		if (pct >= thresholds.cost_pct_critical) return 'critical';
		if (pct >= thresholds.cost_pct_warning) return 'warning';
		return 'ok';
	}

	let criticalCount = $derived(rows.filter((r) => r.status === 'critical').length);
	let warningCount = $derived(rows.filter((r) => r.status === 'warning').length);

	async function loadOne(project: any) {
		const soId = typeof project.so_customer_id === 'object' ? project.so_customer_id?.id : project.so_customer_id;
		const base = {
			id: project.id,
			name: project.name || project.nomor_po || `PO #${project.id}`,
			lokasi: project.lokasi || '',
			rapPlanned: 0,
			actual: 0,
			pct: null as number | null,
			manDayPlan: 0,
			status: 'na' as 'ok' | 'warning' | 'critical' | 'na',
		};
		if (!soId) return base;
		try {
			const rabRes = await loadFullRab(soId);
			const rabItems = rabRes?.items || [];
			const manpowerRows = rabItems.filter((i: any) => i.is_manpower === true || i.is_manpower === 1);
			const rapFromManpowerRows = manpowerRows.reduce((s: number, i: any) => s + (parseFloat(i.planned_amount) || 0), 0);
			const manDayPlan = manpowerRows.reduce(
				(s: number, i: any) => s + (parseFloat(i.jml_orang) || 0) * (parseFloat(i.jml_hari) || 0),
				0,
			);

			const cmp = await getRABvsAktualisasi(project.id, rabItems);
			const jasa: any = cmp?.success ? (cmp.data?.categories as any)?.jasa : null;
			const rapPlanned = rapFromManpowerRows > 0 ? rapFromManpowerRows : (parseFloat(jasa?.rab) || 0);
			const actual = parseFloat(jasa?.actual) || 0;
			const pct = rapPlanned > 0 ? Math.round((actual / rapPlanned) * 1000) / 10 : null;

			return { ...base, rapPlanned, actual, pct, manDayPlan, status: statusOf(pct) };
		} catch {
			return { ...base, error: true };
		}
	}

	onMount(async () => {
		loading = true;
		try {
			await loadProjectSettings();
			thresholds = getProjectSetting('project.monitor.thresholds') || thresholds;
		} catch {
			/* pakai default */
		}
		try {
			const list = (projects || []).slice(0, MAX_PO);
			rows = await Promise.all(list.map(loadOne));
			// urutkan: kritis dulu, lalu warning, lalu sisanya (yang punya data di atas N/A)
			rows = rows.sort((a, b) => {
				const rank = { critical: 0, warning: 1, ok: 2, na: 3 } as const;
				return rank[a.status] - rank[b.status] || (b.pct ?? -1) - (a.pct ?? -1);
			});
		} finally {
			loading = false;
		}
	});

	const DOT: Record<string, string> = {
		ok: 'bg-emerald-500',
		warning: 'bg-amber-500',
		critical: 'bg-red-500',
		na: 'bg-gray-300 dark:bg-gray-600',
	};
	const PCT_TEXT: Record<string, string> = {
		ok: 'text-emerald-600 dark:text-emerald-400',
		warning: 'text-amber-600 dark:text-amber-400',
		critical: 'text-red-600 dark:text-red-400',
		na: 'text-gray-400 dark:text-gray-500',
	};
</script>

<div class="bg-white dark:bg-[#1B2530] rounded-2xl shadow-xs border border-gray-200/80 dark:border-[#2B3844] p-4 sm:p-5 transition-all">
	<div class="flex items-center gap-2.5 mb-3">
		<div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400">
			<IconUsersGroup size={18} />
		</div>
		<div class="min-w-0">
			<h3 class="text-sm font-extrabold text-gray-900 dark:text-white leading-tight">Manpower — RAP vs Aktual per PO</h3>
			<p class="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
				Lampu &amp; persen serapan tenaga kerja untuk PO yang Anda pegang
			</p>
		</div>
	</div>

	{#if loading}
		<CircularProgressGauge size={46} strokeWidth={3} label="Memuat ringkasan manpower..." />
	{:else if rows.length === 0}
		<p class="text-xs text-gray-400 dark:text-gray-500 py-4 text-center">Tidak ada PO untuk ditampilkan.</p>
	{:else}
		{#if criticalCount > 0}
			<div class="mb-3 flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-2">
				<IconAlertTriangle size={15} class="text-red-500 mt-0.5 shrink-0" />
				<p class="text-[11px] font-semibold text-red-700 dark:text-red-300">
					{criticalCount} PO sudah melewati batas anggaran manpower (aktual ≥ rencana). Segera koordinasi sebelum menambah orang.
				</p>
			</div>
		{:else if warningCount > 0}
			<div class="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-2">
				<IconAlertTriangle size={15} class="text-amber-500 mt-0.5 shrink-0" />
				<p class="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
					{warningCount} PO mendekati batas anggaran manpower.
				</p>
			</div>
		{:else}
			<div class="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 px-3 py-2">
				<IconCheck size={15} class="text-emerald-500 shrink-0" />
				<p class="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Semua PO dalam batas anggaran manpower.</p>
			</div>
		{/if}

		<ul class="divide-y divide-gray-100 dark:divide-[#2B3844]">
			{#each rows as r (r.id)}
				<li class="flex items-center gap-3 py-2.5">
					<Tooltip text={r.status} position="right"><span class="inline-flex p-2 -m-2 shrink-0"><span class="w-2.5 h-2.5 rounded-full shrink-0 {DOT[r.status]}"></span></span></Tooltip>
					<div class="min-w-0 flex-1">
						<p class="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
						<p class="text-[11px] text-gray-400 dark:text-gray-500 truncate">
							{#if r.error}gagal memuat data{:else if r.manDayPlan > 0}rencana {Math.round(r.manDayPlan)} orang-hari{:else}rencana manpower belum diisi{/if}
							{#if r.lokasi} · {r.lokasi}{/if}
						</p>
					</div>
					<span class="text-xs font-extrabold shrink-0 {PCT_TEXT[r.status]}">
						{r.pct === null ? '—' : `${r.pct}%`}
					</span>
				</li>
			{/each}
		</ul>

		<p class="mt-2 text-[10px] text-gray-400 dark:text-gray-500 leading-snug">
			🟢 di bawah {thresholds.cost_pct_warning}% · 🟡 {thresholds.cost_pct_warning}–{thresholds.cost_pct_critical}% · 🔴 ≥ {thresholds.cost_pct_critical}% terpakai. Angka = persen serapan anggaran tenaga kerja.
		</p>
	{/if}
</div>
