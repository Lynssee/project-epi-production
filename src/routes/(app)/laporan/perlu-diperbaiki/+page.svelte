<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/(app)/laporan/perlu-diperbaiki/+page.svelte
	// Fase 3 (Loop Perbaikan, Gate Keras Disiplin Data & Laporan Harian, 17 Sep 2026) —
	// menutup C6. Sebelumnya leader TIDAK PERNAH bisa melihat laporan yang diminta
	// diperbaiki (revision_requested) atau ditolak (rejected) — status laporan tidak
	// pernah ditampilkan di dashboard lapangan sama sekali. Halaman ini daftar semua
	// laporan milik leader yang butuh tindakan, dengan tombol langsung ke bagian yang
	// kurang (deep-link ?fix=<id> ke /laporan/[project_id]).
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { IconArrowLeft, IconAlertTriangle, IconClock } from '@tabler/icons-svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getReportsNeedingFix } from '$lib/services/reports';
	import { EmptyStateGuide, HelpIcon, StatusExplainer } from '$lib/components/hints';
	import { laporanHints } from '$lib/data/hints/laporan';
	import { getHint } from '$lib/data/hints/getHint';

	const h = (key: string) => getHint(laporanHints, key, 'laporan-harian');

	interface FixItem {
		id: number;
		project_id: number | { id: number; name?: string };
		date: string;
		status: 'revision_requested' | 'rejected';
		rejection_note: string | null;
		revisi_diminta_at: string | null;
		revisi_batas: string | null;
		revisi_count: number;
		quality_flags: string[] | string | null;
		project_name?: string;
	}

	let loading = $state(true);
	let items = $state<FixItem[]>([]);

	function todayStr(): string {
		const tz = new Date().getTimezoneOffset() * 60000;
		return new Date(Date.now() - tz).toISOString().split('T')[0];
	}

	function isOverdue(item: FixItem): boolean {
		if (item.status !== 'revision_requested' || !item.revisi_batas) return false;
		return item.revisi_batas < todayStr();
	}

	function parsedFlags(item: FixItem): string[] {
		if (Array.isArray(item.quality_flags)) return item.quality_flags;
		if (typeof item.quality_flags === 'string') {
			try {
				const p = JSON.parse(item.quality_flags);
				return Array.isArray(p) ? p : [];
			} catch {
				return [];
			}
		}
		return [];
	}

	function projectIdOf(item: FixItem): number {
		return typeof item.project_id === 'object' ? item.project_id.id : Number(item.project_id);
	}

	function formatDate(d: string | null): string {
		if (!d) return '-';
		return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	onMount(async () => {
		try {
			const { karyawanId } = get(authStore);
			const projects = await getProjectsForCurrentUser(false);
			const projectIds = projects.map((p: any) => p.id);
			const nameById = new Map(projects.map((p: any) => [String(p.id), p.name]));

			const rows = await getReportsNeedingFix(karyawanId as any, projectIds);
			items = (rows || []).map((r: any) => ({
				...r,
				project_name: nameById.get(String(projectIdOf(r))) || `Proyek #${projectIdOf(r)}`
			}));
			// Terlambat dulu, lalu revision_requested (masih bisa ditindak), rejected paling akhir.
			items.sort((a, b) => {
				const aOverdue = isOverdue(a) ? 0 : 1;
				const bOverdue = isOverdue(b) ? 0 : 1;
				if (aOverdue !== bOverdue) return aOverdue - bOverdue;
				const order = { revision_requested: 0, rejected: 1 } as Record<string, number>;
				return (order[a.status] ?? 2) - (order[b.status] ?? 2);
			});
		} catch (e) {
			console.error('Gagal memuat laporan perlu diperbaiki:', e);
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head><title>Perlu Diperbaiki — Laporan Harian</title></svelte:head>

<div class="max-w-2xl mx-auto px-4 py-5 pb-24">
	<div class="flex items-center gap-2 mb-4">
		<a href="/laporan" class="p-2 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
			<IconArrowLeft size={20} />
		</a>
		<h1 class="text-lg font-bold text-slate-800 dark:text-slate-100">Laporan Perlu Diperbaiki</h1>
	</div>

	<p class="text-xs text-slate-500 dark:text-slate-400 mb-4 flex items-start gap-1.5">
		<HelpIcon text={h('laporan.perlu_diperbaiki.page').helpIcon} />
		<span>{h('laporan.perlu_diperbaiki.page').fieldHint}</span>
	</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat laporan perlu perbaikan..." />
	</div>
	{:else if items.length === 0}
		<EmptyStateGuide
			message="Tidak ada laporan yang perlu diperbaiki"
			hints={['Semua laporan Anda sudah lengkap atau sedang menunggu tinjauan.', 'Halaman ini otomatis menampilkan laporan begitu admin meminta perbaikan.']}
		/>
	{:else}
		<div class="space-y-3">
			{#each items as item (item.id)}
				{@const overdue = isOverdue(item)}
				{@const flags = parsedFlags(item)}
				<div class="rounded-xl border p-4 {overdue ? 'border-rose-300 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-950/30' : item.status === 'rejected' ? 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40' : 'border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30'}">
					<div class="flex items-start justify-between gap-2">
						<div>
							<div class="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.project_name}</div>
							<div class="text-xs text-slate-500 dark:text-slate-400">Laporan tanggal {formatDate(item.date)}</div>
						</div>
						<StatusExplainer
							status={item.status === 'rejected' ? 'Ditolak' : 'Perlu Diperbaiki'}
							explain={h(`laporan.status.${item.status}`).explain}
							flow={h(`laporan.status.${item.status}`).flow ?? []}
							currentIndex={item.status === 'rejected' ? 1 : 2}
						>
							<span class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase cursor-help {item.status === 'rejected' ? 'bg-slate-500/15 text-slate-600 dark:text-slate-300' : overdue ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}">
								{#if item.status === 'rejected'}
									Ditolak
								{:else if overdue}
									<IconAlertTriangle size={12} /> Lewat Batas
								{:else}
									<IconClock size={12} /> Perlu Revisi
								{/if}
							</span>
						</StatusExplainer>
					</div>

					{#if item.rejection_note}
						<p class="text-xs text-slate-700 dark:text-slate-300 mt-2 bg-white/60 dark:bg-black/20 rounded-lg p-2">
							"{item.rejection_note}"
						</p>
					{/if}

					{#if flags.length > 0}
						<div class="flex flex-wrap gap-1 mt-2">
							{#each flags.slice(0, 6) as flag}
								<span class="text-[9px] px-1.5 py-0.5 rounded bg-white/70 dark:bg-black/20 text-slate-500 dark:text-slate-400 font-mono">{flag}</span>
							{/each}
							{#if flags.length > 6}
								<span class="text-[9px] px-1.5 py-0.5 text-slate-400">+{flags.length - 6} lagi</span>
							{/if}
						</div>
					{/if}

					<div class="flex items-center justify-between mt-3">
						{#if item.status === 'revision_requested' && item.revisi_batas}
							<span class="text-[11px] {overdue ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}">
								Batas: {formatDate(item.revisi_batas)}
							</span>
						{:else}
							<span></span>
						{/if}

						{#if item.status === 'revision_requested'}
							<a
								href="/laporan/{projectIdOf(item)}?fix={item.id}"
								class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-sm"
							>
								Perbaiki Sekarang
							</a>
						{:else}
							<span class="text-[11px] text-slate-400 italic">Final — tidak bisa dikirim ulang</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
