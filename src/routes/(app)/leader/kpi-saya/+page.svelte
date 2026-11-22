<!-- src/routes/(app)/leader/kpi-saya/+page.svelte
     KPI Saya (versi ringan) untuk Project Leader: Health Score + angka operasional per proyek yang dipimpin.
     Health Score dihitung ERP (projects.health_score) — halaman ini hanya MENAMPILKAN. SPI/CPI belum ada: EVM belum aktif. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore, isLeaderRole } from '$lib/stores/auth';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import GateKpiSayaCard from '$lib/components/ess/GateKpiSayaCard.svelte';
	import LeaderKpiEarlyWarningBanner from '$lib/components/leader/LeaderKpiEarlyWarningBanner.svelte';
	import { getProyekKpiSaya, healthTone, p2hPct, perhatianProyek, HEALTH_THRESHOLD, type ProyekKpiSaya } from '$lib/services/plKpiSaya';

	let loading = $state(true);
	let errorMsg = $state('');
	let proyek = $state<ProyekKpiSaya[]>([]);

	const TONE: Record<string, { bg: string; fg: string; label: string }> = {
		on_target: { bg: '#DCFCE7', fg: '#15803D', label: 'On Target' },
		warning: { bg: '#FEF3C7', fg: '#B45309', label: 'Waspada' },
		critical: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Kritis' },
		no_data: { bg: '#F1F5F9', fg: '#64748B', label: 'Belum dinilai' }
	};

	$effect(() => {
		if ($authStore.checked && !isLeaderRole($authStore.roleId) && $authStore.roleId !== 'super_admin') goto('/');
	});

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			proyek = await getProyekKpiSaya($authStore.karyawanId, $authStore.karyawanName);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat KPI proyek.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	const tgl = (s: string | null) => (s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
</script>

<div class="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-4">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-[17px] font-bold" style="color: var(--sys-label)">KPI Saya</h1>
			<p class="text-[11px]" style="color: var(--sys-label3)">Ringkasan kinerja proyek yang Anda pimpin</p>
		</div>
		<a href="/leader" class="text-[12px] font-semibold underline" style="color: var(--pd)">&larr; Dashboard Leader</a>
	</div>

	<details class="rounded-xl border p-3 text-[12px]" style="border-color: var(--sys-sep); color: var(--sys-label2)">
		<summary class="cursor-pointer font-semibold">Cara membaca halaman ini</summary>
		<ul class="list-disc pl-4 mt-2 space-y-1">
			<li><b>Health Score</b> dihitung otomatis oleh sistem pusat. Hijau ≥ {HEALTH_THRESHOLD.onTarget}, kuning ≥ {HEALTH_THRESHOLD.warning}, merah di bawahnya.</li>
			<li><b>P2H hari ini</b> = unit yang sudah P2H dibanding unit aktif di proyek. <b>PM terlambat</b> = jadwal perawatan lewat tanggal.</li>
			<li>Bagian <b>Perlu perhatian</b> menyorot hal yang sebaiknya Anda tangani hari ini.</li>
			<li>Indeks jadwal/biaya (SPI/CPI) belum tampil karena belum diaktifkan untuk proyek.</li>
		</ul>
	</details>

	<LeaderKpiEarlyWarningBanner departemen="Project" projectIds={proyek.map((p) => p.id)} />

	{#if loading}
		<div class="py-16 flex justify-center"><CircularProgressGauge size={48} strokeWidth={5} label="Memuat KPI…" /></div>
	{:else if errorMsg}
		<div class="rounded-xl p-3 text-[12px]" style="background:#FEE2E2;color:#B91C1C">{errorMsg}
			<button class="underline ml-2 font-semibold" onclick={load}>Coba lagi</button></div>
	{:else if proyek.length === 0}
		<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Belum ada proyek yang tercatat Anda pimpin.</div>
	{:else}
		{#each proyek as p (p.id)}
			{@const tone = TONE[healthTone(p.healthScore)]}
			{@const perhatian = perhatianProyek(p)}
			{@const pct = p2hPct(p.kpi)}
			<div class="rounded-2xl border p-4 flex flex-col gap-3" style="border-color: var(--sys-sep)">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<a href={`/proyek/${p.id}`} class="text-[14px] font-bold truncate block" style="color: var(--sys-label)">{p.name}</a>
						<p class="text-[11px]" style="color: var(--sys-label3)">{p.status || '-'} · selesai {tgl(p.endDate)}</p>
					</div>
					<div class="text-center rounded-xl px-3 py-1.5 shrink-0" style="background: {tone.bg}; color: {tone.fg}" title="Health Score proyek (diperbarui {tgl(p.healthUpdatedAt)})">
						<p class="text-[20px] font-black leading-none">{p.healthScore != null ? Math.round(p.healthScore) : '–'}</p>
						<p class="text-[10px] font-semibold">{tone.label}</p>
					</div>
				</div>

				{#if p.kpi}
					<div class="grid grid-cols-3 gap-2 text-center">
						<div class="rounded-lg p-2" style="background: var(--sys-fill, #F8FAFC)">
							<p class="text-[16px] font-bold" style="color: var(--sys-label)">{p.kpi.woOpen + p.kpi.woInspection}</p>
							<p class="text-[10px]" style="color: var(--sys-label3)">WO berjalan</p>
						</div>
						<div class="rounded-lg p-2" style="background: var(--sys-fill, #F8FAFC)">
							<p class="text-[16px] font-bold" style="color: {pct != null && pct < 100 ? '#B45309' : 'var(--sys-label)'}">{pct != null ? `${pct}%` : '–'}</p>
							<p class="text-[10px]" style="color: var(--sys-label3)">P2H hari ini</p>
						</div>
						<div class="rounded-lg p-2" style="background: var(--sys-fill, #F8FAFC)">
							<p class="text-[16px] font-bold" style="color: {p.kpi.pmOverdue > 0 ? '#B91C1C' : 'var(--sys-label)'}">{p.kpi.pmOverdue}</p>
							<p class="text-[10px]" style="color: var(--sys-label3)">PM terlambat</p>
						</div>
					</div>
				{:else}
					<p class="text-[11px]" style="color: var(--sys-label3)">Belum ada peralatan aktif di proyek ini, jadi angka WO/P2H/PM tidak tersedia.</p>
				{/if}

				{#if perhatian.length}
					<div class="rounded-lg p-2.5" style="background:#FFFBEB">
						<p class="text-[11px] font-bold" style="color:#B45309">Perlu perhatian</p>
						<ul class="text-[12px] list-disc pl-4" style="color:#92400E">
							{#each perhatian as t}<li>{t}</li>{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/each}
	{/if}

	<GateKpiSayaCard />
</div>
