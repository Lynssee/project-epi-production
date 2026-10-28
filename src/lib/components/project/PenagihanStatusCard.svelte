<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Forecast Keuangan Global — Fase 4 (Visibilitas AR untuk Lapangan, Gap G6). Kartu
	// status penagihan customer per termin kontrak, untuk Project Leader. Sama pola
	// dgn ProjectBepTrackerCard: nominal Rp hanya tampil bila admin membukanya
	// (project.field_penagihan.show_rupiah).
	import { onMount } from 'svelte';
	import { fetchPenagihanStatusForProjects, PENAGIHAN_STATUS_META, type PenagihanTerminRow } from '$lib/services/penagihanProyek';
	import { fetchB2BStatusForProjects, type B2BTerminStatusRow } from '$lib/services/b2bStatusApi';
	import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
	import { IconLoader2, IconReceipt2 } from '@tabler/icons-svelte';

	let { projectId, projectName }: { projectId: number | string; projectName: string } = $props();

	let loading = $state(true);
	let rows = $state<PenagihanTerminRow[]>([]);
	// Rencana B2B Payment, Fase 2 (3 Okt 2026) — indikator "N pembayaran subkon dirilis"
	// setelah node termin lunas. TANPA rupiah/nama vendor (keputusan Lead).
	let b2bByTermin = $state<Record<string, B2BTerminStatusRow>>({});

	let enabled = $derived(getProjectSetting('project.field_penagihan.enabled') !== false);

	// R7 (Forecast Keuangan Global, rekomendasi laporan): timeline horizontal sederhana
	// (DP ✅ → Termin 1 ⏳ → Pelunasan 🔲), TANPA nominal sama sekali — beda dari daftar
	// detail di bawah yang masih ikut kebijakan show_rupiah. Urutan sudah benar dari
	// fetchPenagihanStatusForProjects() (sort by urutan).
	const STEP_DOT: Record<string, { cls: string; icon: string }> = {
		lunas: { cls: 'bg-emerald-500 border-emerald-500', icon: '✓' },
		menunggu_bayar: { cls: 'bg-amber-400 border-amber-400', icon: '⏳' },
		sudah_terbit: { cls: 'bg-sky-400 border-sky-400', icon: '📤' },
		belum_ditagih: { cls: 'bg-white border-gray-300', icon: '' }
	};

	function rp(n: number): string {
		return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
	}

	onMount(async () => {
		if (!enabled) {
			loading = false;
			return;
		}
		try {
			rows = await fetchPenagihanStatusForProjects([{ id: projectId, name: projectName }]);
			await loadProjectSettings();
			if (getProjectSetting('project.b2b.enabled') === true) {
				const b2bRows = await fetchB2BStatusForProjects([{ id: projectId, name: projectName }]);
				b2bByTermin = Object.fromEntries(b2bRows.map((r) => [String(r.termin_id), r]));
			}
		} finally {
			loading = false;
		}
	});
</script>

{#if enabled}
	<div class="rounded-xl border border-gray-200 bg-white p-4">
		<div class="flex items-center gap-2 mb-2">
			<IconReceipt2 size={18} class="text-gray-600" />
			<h3 class="text-sm font-semibold text-gray-800">Status Penagihan Customer</h3>
		</div>

		{#if loading}
			<CircularProgressGauge size={44} strokeWidth={3} label="Memuat status penagihan..." />
		{:else if rows.length === 0}
			<p class="text-sm text-gray-500">
				Belum ada termin kontrak tercatat untuk proyek ini, atau proyek belum punya kontrak.
			</p>
		{:else}
			<!-- R7: timeline milestone pembayaran, tanpa nominal -->
			<div class="flex items-center overflow-x-auto pb-1 mb-3">
				{#each rows as row, i (row.termin_id)}
					{@const dot = STEP_DOT[row.status]}
					{@const b2b = b2bByTermin[String(row.termin_id)]}
					<div class="flex items-center shrink-0" title="{row.termin_label}: {PENAGIHAN_STATUS_META[row.status].label}">
						<div class="flex flex-col items-center gap-1">
							<div class="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] text-white {dot.cls}">
								{dot.icon}
							</div>
							<span class="text-[9px] text-gray-500 max-w-[64px] truncate text-center">{row.termin_label}</span>
							{#if row.status === 'lunas' && b2b && (b2b.releasedCount + b2b.partialCount) > 0}
								<span
									class="text-[9px] text-indigo-500"
									title="{b2b.releasedCount} pembayaran subkon/pemborong terkait termin ini otomatis terbuka{b2b.partialCount ? `, ${b2b.partialCount} sebagian` : ''}"
								>⬇️ {b2b.releasedCount + b2b.partialCount}</span>
							{/if}
						</div>
						{#if i < rows.length - 1}
							<div class="w-8 h-0.5 mx-1 {row.status === 'lunas' ? 'bg-emerald-400' : 'bg-gray-200'}"></div>
						{/if}
					</div>
				{/each}
			</div>

			<div class="space-y-2">
				{#each rows as row (row.termin_id)}
					{@const meta = PENAGIHAN_STATUS_META[row.status]}
					<div class="flex items-start justify-between gap-2 py-1.5 border-b border-gray-50 last:border-0">
						<div class="min-w-0">
							<p class="text-xs font-medium text-gray-800 truncate">{row.termin_label}</p>
							{#if row.status === 'menunggu_bayar' && row.promised_date}
								<p class="text-[11px] text-gray-400">Janji bayar: {row.promised_date}</p>
							{:else if row.due_date}
								<p class="text-[11px] text-gray-400">Jatuh tempo: {row.due_date}</p>
							{/if}
							{#if row.amount != null}
								<p class="text-[11px] text-gray-500">{rp(row.amount)}</p>
							{/if}
						</div>
						<span class="shrink-0 text-xs font-semibold {meta.cls} whitespace-nowrap">
							{meta.icon} {meta.label}
						</span>
					</div>
				{/each}
			</div>
			<p class="text-[10px] text-gray-400 mt-2">
				ⓘ Status penagihan ke customer, bukan progres fisik pekerjaan. Hubungi Finance/Sales bila ada termin "Belum Ditagih" yang seharusnya sudah tercapai.
			</p>
		{/if}
	</div>
{/if}
