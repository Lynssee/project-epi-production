<!-- src/lib/components/site-checkin/JourneyTimeline.svelte -->
<!-- Fase 3: riwayat check-in/out hari ini milik karyawan yang login (multi-site 1 hari
     langsung terlihat sebagai beberapa entri timeline interaktif). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { getTodayCheckins, type SiteCheckinRecord } from '$lib/services/siteCheckin';
	import {
		IconMapPin,
		IconClock,
		IconCircleCheck,
		IconAlertTriangle,
		IconLoader2,
		IconRoute,
		IconNotes,
		IconChevronDown,
		IconChevronUp,
		IconBuildingFactory2
	} from '@tabler/icons-svelte';
	import { slide } from 'svelte/transition';

	let { refreshKey = 0 }: { refreshKey?: number } = $props();

	let records = $state<SiteCheckinRecord[]>([]);
	let loading = $state(true);
	let expandedRecordIds = $state<Set<string>>(new Set());

	function toggleExpand(id: string) {
		const next = new Set(expandedRecordIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedRecordIds = next;
	}

	$effect(() => {
		refreshKey; // re-run saat parent memicu refresh
		loading = true;
		getTodayCheckins()
			.then((r) => (records = r.records || []))
			.catch(() => (records = []))
			.finally(() => (loading = false));
	});

	function formatTime(iso: string | null): string {
		if (!iso) return '-';
		return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
	}

	function formatDuration(r: SiteCheckinRecord): string {
		if (r.durasi_menit != null) {
			const h = Math.floor(r.durasi_menit / 60);
			const m = r.durasi_menit % 60;
			return h > 0 ? `${h} jam ${m} mnt` : `${m} menit`;
		}
		if (r.status === 'active') {
			const ms = Date.now() - new Date(r.check_in_at).getTime();
			const totalMin = Math.max(0, Math.floor(ms / 60000));
			const h = Math.floor(totalMin / 60);
			const m = totalMin % 60;
			return h > 0 ? `Berjalan ${h}j ${m}m` : `Berjalan ${m}m`;
		}
		return '-';
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<IconRoute size={18} class="text-blue-600 dark:text-blue-400" />
			<h2 class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
				Perjalanan Hari Ini
			</h2>
		</div>
		{#if records.length > 0}
			<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
				{records.length} Kunjungan
			</span>
		{/if}
	</div>

	{#if loading}
		<CircularProgressGauge size={46} strokeWidth={3} label="Memuat riwayat check-in hari ini..." />
	{:else if records.length === 0}
		<div class="py-8 px-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-center flex flex-col items-center justify-center">
			<div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-2">
				<IconBuildingFactory2 size={20} />
			</div>
			<p class="text-xs font-semibold text-slate-700 dark:text-slate-300">Belum Ada Kunjungan Hari Ini</p>
			<p class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 max-w-xs">
				Pilih proyek tujuan di atas dan lakukan check-in pertama Anda untuk mencatat riwayat kehadiran lapangan.
			</p>
		</div>
	{:else}
		<div class="relative pl-3 flex flex-col gap-3 border-l-2 border-slate-200 dark:border-slate-800 ml-2">
			{#each records as r (r.id)}
				<div class="relative">
					<!-- Timeline Node Dot -->
					<div
						class="absolute -left-[19px] top-4 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-900 {r.status === 'active' ? 'bg-emerald-500 ring-4 ring-emerald-500/20 animate-pulse' : 'bg-blue-600'}"
					></div>

					<!-- Card Item -->
					<div
						class="rounded-2xl border p-3.5 transition-all {r.status === 'active' ? 'bg-emerald-500/5 dark:bg-emerald-950/20 border-emerald-500/30 dark:border-emerald-800/50 shadow-2xs' : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 shadow-2xs'}"
					>
						<div class="flex items-start justify-between gap-2 mb-1.5">
							<div class="min-w-0 flex-1">
								<p class="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 truncate">
									<IconBuildingFactory2 size={15} class={r.status === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'} />
									{r.nama_lokasi}
								</p>
								<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
									<IconClock size={12} class="text-slate-400 shrink-0" />
									<span>{formatTime(r.check_in_at)} — {r.check_out_at ? formatTime(r.check_out_at) : 'Sekarang'}</span>
									<span class="text-slate-300 dark:text-slate-600">•</span>
									<span class="font-semibold {r.status === 'active' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}">
										{formatDuration(r)}
									</span>
								</p>
							</div>

							{#if r.status === 'active'}
								<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white shadow-2xs shrink-0">
									Sedang Aktif
								</span>
							{:else}
								<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
									Selesai
								</span>
							{/if}
						</div>

						<!-- Badges & Geofence Status -->
						<div class="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[10px]">
							{#if r.tier_absensi}
								<span class="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold border border-blue-200/60 dark:border-blue-800/60">
									Tier: {r.tier_absensi}
									{#if r.area_status === 'usulan'}<span class="italic text-[9px] font-normal"> (usulan)</span>{/if}
								</span>
							{/if}

							{#if r.in_geofence === false}
								<span class="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-semibold border border-amber-200/60 dark:border-amber-800/60 flex items-center gap-1">
									<IconAlertTriangle size={11} /> Luar Radius
								</span>
							{:else if r.in_geofence === true}
								<span class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200/60 dark:border-emerald-800/60 flex items-center gap-1">
									<IconCircleCheck size={11} /> Dalam Radius
								</span>
							{/if}

							{#if r.catatan || r.kegiatan || r.temuan}
								<button
									type="button"
									class="ml-auto text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
									onclick={() => toggleExpand(r.id)}
								>
									<span>{expandedRecordIds.has(r.id) ? 'Tutup Catatan' : 'Lihat Catatan'}</span>
									{#if expandedRecordIds.has(r.id)}
										<IconChevronUp size={12} />
									{:else}
										<IconChevronDown size={12} />
									{/if}
								</button>
							{/if}
						</div>

						<!-- Expandable Notes / Visit Summary -->
						{#if expandedRecordIds.has(r.id) && (r.catatan || r.kegiatan || r.temuan)}
							<div transition:slide={{ duration: 150 }} class="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs flex flex-col gap-1.5 bg-slate-50/50 dark:bg-slate-800/40 p-2.5 rounded-xl">
								{#if r.catatan}
									<div>
										<p class="text-[10px] uppercase font-bold text-slate-400">Catatan Check-in</p>
										<p class="text-xs text-slate-700 dark:text-slate-200 mt-0.5">{r.catatan}</p>
									</div>
								{/if}
								{#if r.kegiatan}
									<div>
										<p class="text-[10px] uppercase font-bold text-slate-400">Kegiatan</p>
										<p class="text-xs text-slate-700 dark:text-slate-200 mt-0.5">{r.kegiatan}</p>
									</div>
								{/if}
								{#if r.temuan}
									<div>
										<p class="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">Temuan / Kendala</p>
										<p class="text-xs text-slate-700 dark:text-slate-200 mt-0.5">{r.temuan}</p>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

