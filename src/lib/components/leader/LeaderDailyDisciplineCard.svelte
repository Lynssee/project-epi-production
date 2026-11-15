<!-- src/lib/components/leader/LeaderDailyDisciplineCard.svelte
     Fase 4: Rapor Disiplin & Kepatuhan Site Saya Hari Ini di Dashboard Project Leader.
     Memantau 4 Checklist Kritis Harian:
     1. TBM Morning Briefing (Target 08:00 WIB)
     2. P2H Equipment (Target 08:30 WIB)
     3. Presensi Kru Lapangan (Target 10:00 WIB)
     4. Laporan Harian Proyek (Target SLA 20:00 WIB)
     Menggunakan Svelte 5 runes, fail-soft (nol crash bila server lambat), dan in-memory cache 60s. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		fetchLeaderDailyDiscipline,
		type LeaderDailyDisciplineSummary
	} from '$lib/services/leaderDisciplineDaily';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import IconClipboardCheck from '@tabler/icons-svelte/icons/clipboard-check';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconCheck from '@tabler/icons-svelte/icons/check';
	import IconClock from '@tabler/icons-svelte/icons/clock';
	import IconArrowRight from '@tabler/icons-svelte/icons/arrow-right';
	import IconChevronDown from '@tabler/icons-svelte/icons/chevron-down';
	import IconChevronUp from '@tabler/icons-svelte/icons/chevron-up';
	import IconInfoCircle from '@tabler/icons-svelte/icons/info-circle';

	let {
		projectIds = [],
		equipmentIds = []
	}: {
		projectIds: number[];
		equipmentIds?: string[];
	} = $props();

	let summary = $state<LeaderDailyDisciplineSummary | null>(null);
	let loading = $state(true);
	let showGuide = $state(false);

	async function loadDiscipline(force = false) {
		loading = true;
		try {
			const res = await fetchLeaderDailyDiscipline(projectIds, equipmentIds, force);
			if (res) summary = res;
		} catch (e) {
			console.error('[LeaderDailyDisciplineCard] Gagal memuat data kedisiplinan:', e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (projectIds.length > 0) {
			loadDiscipline();
		} else {
			loading = false;
		}
	});

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'completed':
				return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800';
			case 'in_progress':
				return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800';
			case 'warning':
				return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800';
			case 'overdue':
				return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800';
			default:
				return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
		}
	}

	function formatWibDate(ymd: string): string {
		if (!ymd) return '-';
		try {
			const [y, m, d] = ymd.split('-').map(Number);
			const date = new Date(Date.UTC(y, m - 1, d));
			return date.toLocaleDateString('id-ID', {
				weekday: 'long',
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				timeZone: 'UTC'
			});
		} catch {
			return ymd;
		}
	}
</script>

<div class="rounded-2xl border p-4 mb-4 shadow-2xs transition-all bg-white dark:bg-slate-850" style="border-color: var(--sys-sep)">
	<!-- Header Kartu Disiplin -->
	<div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b" style="border-color: var(--sys-sep)">
		<div class="flex items-center gap-2.5">
			<div class="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white shrink-0 shadow-2xs" style="background: var(--g)">
				<span>🎯</span>
			</div>
			<div>
				<div class="flex items-center gap-2">
					<h3 class="text-[13px] md:text-[14px] font-bold" style="color: var(--sys-label)">
						Checklist Kepatuhan &amp; Disiplin Site
					</h3>
					{#if summary}
						<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border {summary.badge.badgeClass}">
							{summary.score}% · {summary.badge.label}
						</span>
						{#if summary.weeklyStreak && summary.weeklyStreak.totalDays > 0}
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800 flex items-center gap-1" title="Konsistensi pelaporan 7 hari terakhir">
								<span>🔥</span>
								<span>{summary.weeklyStreak.onTimeDays}/{summary.weeklyStreak.totalDays} Hari Tepat</span>
							</span>
						{/if}
					{/if}
				</div>
				<p class="text-[11px]" style="color: var(--sys-label3)">
					{#if summary}
						{formatWibDate(summary.date)} · SLA Harian Site Eltama
					{:else}
						Pantauan kepatuhan operasional harian
					{/if}
				</p>
			</div>
		</div>

		<div class="flex items-center gap-1.5">
			<button
				type="button"
				class="text-[11px] font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg border transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
				style="border-color: var(--sys-sep); color: var(--sys-label2)"
				onclick={() => (showGuide = !showGuide)}
				title="Lihat panduan checklist harian"
			>
				<IconInfoCircle size={13} />
				<span>Panduan SLA</span>
				{#if showGuide}
					<IconChevronUp size={13} />
				{:else}
					<IconChevronDown size={13} />
				{/if}
			</button>
		</div>
	</div>

	<!-- Panduan Interaktif Ramah Mandor (Expandable) -->
	{#if showGuide}
		<div class="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border text-[11px] space-y-1.5" style="border-color: var(--sys-sep); color: var(--sys-label2)">
			<p class="font-bold flex items-center gap-1.5" style="color: var(--sys-label)">
				<span>💡</span> Panduan Jam Kritis Lapangan:
			</p>
			<ul class="space-y-1 pl-4 list-disc text-[11px] leading-relaxed" style="color: var(--sys-label3)">
				<li><strong style="color: var(--sys-label)">08:00 WIB — TBM Briefing:</strong> Kumpulkan seluruh personil, cek APD, bahas bahaya kerja &amp; rollcall absensi sebelum pekerjaan fisik dimulai.</li>
				<li><strong style="color: var(--sys-label)">08:30 WIB — P2H Alat:</strong> Mekanik/Operator wajib inspeksi kompresor, sandpot &amp; genset sebelum mesin dinyalakan. Pastikan status GO.</li>
				<li><strong style="color: var(--sys-label)">10:00 WIB — Presensi Kru:</strong> Pastikan seluruh tenaga kerja check-in di dalam radius geofence lokasi proyek (GPS valid &lt; 200m).</li>
				<li><strong style="color: var(--sys-label)">20:00 WIB — Laporan Harian:</strong> Rangkum progres fisik harian, kondisi cuaca, tenaga kerja &amp; lampirkan minimal 1 foto progres sebelum batas SLA 20:00 WIB.</li>
			</ul>
		</div>
	{/if}

	<!-- Alert Kritis / Overdue (Bila Ada) -->
	{#if summary && summary.alerts.length > 0}
		<div class="mt-3 space-y-2">
			{#each summary.alerts as alert}
				<div class="p-2.5 rounded-xl border flex items-center justify-between gap-2.5 text-[11px] {alert.priority === 'high' ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'}">
					<div class="flex items-center gap-2 min-w-0">
						<span class="text-sm shrink-0">{alert.icon}</span>
						<span class="font-medium truncate">{alert.message}</span>
					</div>
					{#if alert.actionUrl}
						<button
							type="button"
							class="text-[11px] font-bold underline shrink-0 cursor-pointer"
							onclick={() => goto(alert.actionUrl!)}
						>
							Selesaikan &rarr;
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- 4 Checklist Items -->
	{#if loading}
		<div class="py-6 flex flex-col items-center justify-center">
			<CircularProgressGauge size={38} strokeWidth={3} label="Memeriksa status disiplin harian site..." />
		</div>
	{:else if summary}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-3">
			{#each summary.checklist as item (item.key)}
				<div class="p-3 rounded-xl border flex flex-col justify-between bg-slate-50/60 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors" style="border-color: var(--sys-sep)">
					<div>
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="text-[12px] font-bold truncate" style="color: var(--sys-label)">
									{item.title}
								</p>
								<p class="text-[10px] font-medium" style="color: var(--sys-label3)">
									Target SLA: {item.slaTime}
								</p>
							</div>
							<span class="text-[9.5px] font-bold px-2 py-0.5 rounded-full border shrink-0 {statusBadgeClass(item.status)}">
								{item.statusLabel}
							</span>
						</div>
						<p class="text-[11px] mt-1.5 leading-snug line-clamp-2" style="color: var(--sys-label2)">
							{item.detail}
						</p>
					</div>

					<div class="mt-2.5 pt-2 border-t flex items-center justify-between gap-2" style="border-color: var(--sys-sep)">
						<span class="text-[10px] font-mono font-semibold" style="color: var(--sys-label4)">
							Bobot: {Math.round(item.weight * 100)}%
						</span>
						<button
							type="button"
							class="text-[11px] font-bold flex items-center gap-1 hover:underline transition-all cursor-pointer"
							style="color: var(--pd)"
							onclick={() => goto(item.actionUrl)}
						>
							<span>{item.actionLabel}</span>
							<IconArrowRight size={12} />
						</button>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="text-center py-4 text-[11px]" style="color: var(--sys-label3)">
			Tidak ada proyek aktif yang perlu dievaluasi hari ini.
		</div>
	{/if}
</div>
