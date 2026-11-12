<!-- src/lib/components/leader/LeaderKpiEarlyWarningBanner.svelte
     Early Warning System (EWS) Kinerja & Sanksi Departemen untuk Project Leader.
     Memantau sanksi aktif divisi (SP-1, SP-2, Pembekuan Anggaran, Karantina SLA)
     dan status gate G_DEPT_KPI_SANCTION_CHECK. Fail-soft & cached 60s. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getActiveDepartmentSanctions, type SanksiKaryawan } from '$lib/services/sanksi';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconShieldAlert from '@tabler/icons-svelte/icons/shield-exclamation';
	import IconFileText from '@tabler/icons-svelte/icons/file-text';
	import IconArrowRight from '@tabler/icons-svelte/icons/arrow-right';

	let {
		departemen = 'Project',
		projectIds = []
	}: {
		departemen?: string;
		projectIds?: number[];
	} = $props();

	let sanksiList = $state<SanksiKaryawan[]>([]);
	let loading = $state(true);
	let isExpanded = $state(false);

	// Client-side cache 60 detik
	let lastFetch = 0;
	const CACHE_TTL_MS = 60_000;

	async function loadWarning() {
		const now = Date.now();
		if (now - lastFetch < CACHE_TTL_MS && sanksiList.length > 0) {
			loading = false;
			return;
		}

		loading = true;
		try {
			const res = await getActiveDepartmentSanctions(departemen);
			sanksiList = res || [];
			lastFetch = Date.now();
		} catch (err) {
			console.warn('[LeaderKpiEarlyWarningBanner] Gagal memuat status sanksi:', err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadWarning();
	});
</script>

{#if sanksiList.length > 0}
	{@const utama = sanksiList[0]}
	<div class="rounded-xl border p-4 mb-4 bg-rose-50/80 border-rose-300 dark:bg-rose-950/20 dark:border-rose-900 shadow-xs transition-all">
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-start gap-2.5">
				<div class="p-2 rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 shrink-0 mt-0.5">
					<IconShieldAlert class="w-5 h-5" />
				</div>
				<div>
					<div class="flex items-center gap-2 flex-wrap">
						<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-600 text-white uppercase tracking-wider">
							🏢 Sanksi Divisi Aktif
						</span>
						<span class="text-xs font-bold text-rose-900 dark:text-rose-200">
							{utama.jenis_sanksi} · {utama.departemen || departemen}
						</span>
						{#if utama.nomor_surat}
							<span class="text-[10px] font-mono text-rose-600 dark:text-rose-400">
								({utama.nomor_surat})
							</span>
						{/if}
					</div>
					<p class="text-xs text-rose-800 dark:text-rose-300 font-medium mt-1 leading-snug">
						{utama.deskripsi_pelanggaran || 'Terdapat catatan deviasi KPI atau SLA operasional divisi yang memerlukan tindakan perbaikan segera.'}
					</p>

					<!-- Catatan Gate Lifecycle G_DEPT_KPI_SANCTION_CHECK -->
					<div class="mt-2 text-[11px] bg-white/70 dark:bg-gray-900/60 rounded-md p-2 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 flex items-start gap-1.5">
						<IconAlertTriangle class="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
						<div>
							<span class="font-bold">Gate Kepatuhan G_DEPT_KPI_SANCTION_CHECK Aktif:</span>
							Pengajuan kasbon operasional / dana non-RAB ditahan sementara sampai Rencana Tindakan Perbaikan (CAPA) diverifikasi.
						</div>
					</div>

					{#if utama.tindakan_perbaikan}
						<div class="mt-2 text-[11px] text-rose-900 dark:text-rose-300">
							<span class="font-bold">Komitmen CAPA Divisi:</span> {utama.tindakan_perbaikan}
						</div>
					{/if}

					<!-- Tombol Cepat Mitigasi Lapangan -->
					<div class="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-rose-200/60 dark:border-rose-900/60">
						<a 
							href="/laporan" 
							class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-xs"
						>
							<IconFileText class="w-3.5 h-3.5" />
							<span>Lengkapi Laporan Harian</span>
						</a>
						<a 
							href="/regu" 
							class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-rose-800 border border-rose-300 hover:bg-rose-50 transition-colors shadow-xs"
						>
							<span>Cek Presensi &amp; Regu</span>
							<IconArrowRight class="w-3 h-3" />
						</a>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
