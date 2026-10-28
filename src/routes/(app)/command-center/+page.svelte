<!-- src/routes/(app)/command-center/+page.svelte -->
<!-- Fase 3 — Command Center Lapangan. Read-only, mobile-first, 1 departemen per user
     (karyawan.divisi -> department via department_alias). Data sama dgn admin
     (erp-epi-1), dibaca langsung dari Directus — bukan panggil app admin. -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getFieldCommandCenterSnapshot, type CcSnapshot } from '$lib/services/commandCenter';
	import { getKapasitasSummary, type KapasitasSummary } from '$lib/services/kapasitasSummary';
	import { goto } from '$app/navigation';
	import { IconMenu2, IconRefresh, IconWifiOff, IconArrowUpRight } from '@tabler/icons-svelte';

	let loading = $state(true);
	let snapshot = $state<CcSnapshot | null>(null);
	let stale = $state(false);
	let error = $state<string | null>(null);

	// Dynamic Progress Loader untuk Command Center Lapangan
	let ccLoadPercent = $state(25);
	let ccLoadStep = $state(1);
	let ccLoadLabel = $state('Memuat snapshot Command Center...');
	let ccTimer: any = null;

	$effect(() => {
		if (loading && !snapshot) {
			if (!ccTimer) {
				ccLoadPercent = 25;
				ccLoadStep = 1;
				ccLoadLabel = 'Mengambil snapshot data operasional dari Directus...';
				ccTimer = setInterval(() => {
					if (loading && !snapshot) {
						if (ccLoadPercent < 60) {
							ccLoadPercent += 10;
							ccLoadStep = 2;
							ccLoadLabel = 'Menghubungkan metrik kapasitas & approval...';
						} else if (ccLoadPercent < 90) {
							ccLoadPercent += 4;
							ccLoadStep = 3;
							ccLoadLabel = 'Menyusun dashboard Command Center...';
						}
					} else {
						ccLoadPercent = 100;
						if (ccTimer) {
							clearInterval(ccTimer);
							ccTimer = null;
						}
					}
				}, 200);
			}
		} else {
			if (ccTimer) {
				clearInterval(ccTimer);
				ccTimer = null;
			}
			ccLoadPercent = 100;
		}
	});

	onDestroy(() => {
		if (ccTimer) clearInterval(ccTimer);
	});

	// Kapasitas Proyek & Rekomendasi Dashboard v2, §9 poin 1 — company-wide, dibatasi
	// peran manajemen (sama seperti view_all_projects di /proyek/hub), BEDA dari widget
	// snapshot di atas yang di-scope per departemen.
	let kapasitasVisible = $derived(
		$authStore.roleId === 'super_admin' ||
			$authStore.roleIds?.includes('super_admin') ||
			hasPermission($authStore.roleId, 'view_all_projects', $rolesStore, $authStore.roleIds)
	);
	let kapasitas = $state<KapasitasSummary | null>(null);
	let kapasitasLoading = $state(true);

	function healthColor(score: number | null): string {
		if (score == null) return 'var(--sys-label3)';
		if (score >= 80) return 'var(--g)';
		if (score >= 50) return '#d97706';
		return '#dc2626';
	}

	function statusColor(status: string): string {
		if (status === 'danger') return '#dc2626';
		if (status === 'warning') return '#d97706';
		return 'var(--g)';
	}

	function formatValue(v: number | string | null): string {
		if (v == null) return '—';
		if (typeof v === 'number') return v.toLocaleString('id-ID', { maximumFractionDigits: 1 });
		return v;
	}

	async function load() {
		loading = true;
		const divisi = $authStore.karyawanDivisi;
		const res = await getFieldCommandCenterSnapshot(divisi);
		snapshot = res.snapshot;
		stale = res.stale;
		error = res.error;
		loading = false;
	}

	async function loadKapasitas() {
		kapasitasLoading = true;
		kapasitas = await getKapasitasSummary();
		kapasitasLoading = false;
	}

	function lampuColor(l: string): string {
		return { hijau: 'var(--g)', kuning: '#d97706', merah: '#dc2626', abu: 'var(--sys-label3)' }[l] || 'var(--sys-label3)';
	}
	function lampuLabel(l: string): string {
		return { hijau: 'Sehat', kuning: 'Perlu Perhatian', merah: 'Ketat', abu: 'Belum Diketahui' }[l] || 'Belum Diketahui';
	}

	onMount(() => {
		const unsub = authStore.subscribe(($s) => {
			if (!$s.loading && $s.user) {
				load();
				if (kapasitasVisible) loadKapasitas();
			}
		});
		return unsub;
	});
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="scroll-body px-4 sm:px-6 py-6 max-w-3xl mx-auto w-full" style="background: var(--sys-bg)">
		<div class="flex items-center justify-between mb-4">
			<div>
				<h2 class="text-lg font-bold" style="color: var(--sys-label)">Status Lapangan</h2>
				<p class="text-xs" style="color: var(--sys-label3)">Snapshot performa dan metrik departemen</p>
			</div>
			<button
				type="button"
				class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
				style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
				onclick={load}
				title="Segarkan Data"
			>
				<IconRefresh size={15} class={loading ? "animate-spin" : ""} />
				<span>Refresh</span>
			</button>
		</div>

		{#if kapasitasVisible}
			<div class="rounded-2xl p-4 mb-6" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep)">
				<div class="flex items-center justify-between mb-2">
					<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Kapasitas Perusahaan</p>
					{#if kapasitas?.skor_overall != null}
						<span class="text-lg font-extrabold" style="color: {healthColor(kapasitas.skor_overall)}">{kapasitas.skor_overall}</span>
					{/if}
				</div>
				{#if kapasitasLoading}
					<p class="text-[12px]" style="color: var(--sys-label3)">Memuat...</p>
				{:else if !kapasitas}
					<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada snapshot kapasitas — cron harian belum pernah dijalankan.</p>
				{:else if !kapasitas.layak_dipercaya}
					<p class="text-[12px]" style="color: var(--amd)">Data belum layak dipercaya{kapasitas.alasan.length ? `: ${kapasitas.alasan[0]}` : ''}.</p>
				{:else}
					<div class="grid grid-cols-2 gap-2 mt-2">
						<div>
							<p class="text-[10px]" style="color: var(--sys-label3)">Manpower Tersedia</p>
							<p class="text-[14px] font-bold" style="color: var(--sys-label)">{kapasitas.manpower_tersedia ?? '-'}{#if kapasitas.manpower_bentrok > 0}<span class="text-[10px] font-normal" style="color: #dc2626"> · {kapasitas.manpower_bentrok} bentrok</span>{/if}</p>
						</div>
						<div>
							<p class="text-[10px]" style="color: var(--sys-label3)">Item Material Kritis</p>
							<p class="text-[14px] font-bold" style="color: var(--sys-label)">{kapasitas.material_item_kritis ?? '-'}</p>
						</div>
						<div>
							<p class="text-[10px]" style="color: var(--sys-label3)">Cashflow</p>
							<p class="text-[13px] font-bold flex items-center gap-1.5" style="color: {lampuColor(kapasitas.cashflow_lampu)}">
								<span class="w-2 h-2 rounded-full" style="background: {lampuColor(kapasitas.cashflow_lampu)}"></span>
								{lampuLabel(kapasitas.cashflow_lampu)}
							</p>
						</div>
						<div>
							<p class="text-[10px]" style="color: var(--sys-label3)">Diperbarui</p>
							<p class="text-[13px]" style="color: var(--sys-label2)">{new Date(kapasitas.generated_at).toLocaleString('id-ID')}</p>
						</div>
					</div>
					{#if kapasitas.equipment_catatan}
						<p class="text-[10px] mt-2" style="color: var(--sys-label3)">{kapasitas.equipment_catatan}</p>
					{/if}
				{/if}
			</div>
		{/if}

		{#if loading && !snapshot}
			<div class="flex-1 flex items-center justify-center py-12">
				<CircularProgressGauge
					percent={ccLoadPercent}
					step={ccLoadStep}
					totalSteps={3}
					stepLabel={ccLoadLabel}
					subLabel="Directus Command Center Realtime Feed"
					hint="Menghubungkan snapshot status operasional, radar kapasitas & antrean approval"
					timeoutSeconds={20}
					compact={true}
					onRetry={() => load()}
				/>
			</div>
		{:else if error && !snapshot}
			<div class="rounded-xl p-4 border" style="background: var(--rel); border-color: var(--red)">
				<p class="text-[13px]" style="color: var(--red)">{error}</p>
			</div>
		{:else if snapshot && !snapshot.active}
			<div class="rounded-2xl p-6 text-center space-y-3" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep)">
				<div class="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center text-2xl" style="background: var(--aml); color: var(--amd)">
					📡
				</div>
				<h3 class="text-[15px] font-bold" style="color: var(--sys-label)">Command Center Lapangan Inaktif</h3>
				<p class="text-[12px] leading-relaxed" style="color: var(--sys-label2)">
					Fitur pemantauan Command Center belum diaktifkan oleh admin pusat. Setelah diaktifkan, ringkasan KPI & aksi cepat divisi Anda akan tampil otomatis di sini.
				</p>
			</div>
		{:else if snapshot && !snapshot.department}
			<div class="rounded-2xl p-6 text-center space-y-3" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep)">
				<div class="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center text-2xl" style="background: var(--gl); color: var(--g)">
					🏢
				</div>
				<h3 class="text-[15px] font-bold" style="color: var(--sys-label)">Departemen Belum Terhubung</h3>
				<p class="text-[12px] leading-relaxed" style="color: var(--sys-label2)">
					Divisi profil Anda belum dipetakan ke modul Command Center. Hubungi admin untuk menghubungkan divisi Anda ke KPI operasional.
				</p>
			</div>
		{:else if snapshot}
			{#if stale}
				<div class="rounded-xl p-3 mb-4 flex items-center gap-2 border" style="background: var(--aml); border-color: var(--am)">
					<IconWifiOff size={16} style="color: var(--amd)" />
					<p class="text-[11px]" style="color: var(--amd)">Menampilkan data tersimpan terakhir — sinyal lemah / gagal muat ulang.</p>
				</div>
			{/if}

			<!-- Health score -->
			<div class="rounded-xl p-4 mb-6 flex items-center justify-between" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep)">
				<div>
					<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{snapshot.department?.nama_department}</p>
					<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
						Diperbarui {new Date(snapshot.generated_at).toLocaleTimeString('id-ID')}
					</p>
				</div>
				{#if snapshot.health_score != null}
					<span class="text-lg font-extrabold" style="color: {healthColor(snapshot.health_score)}">{snapshot.health_score}</span>
				{/if}
			</div>

			<!-- Quick Actions -->
			{#if snapshot.widgets.some((w) => w.widget_type === 'quick_action')}
				<div class="mb-6">
					<div class="section-header mt-0 mb-3 text-[13px]">Aksi Cepat</div>
					<div class="grid grid-cols-2 gap-3">
						{#each snapshot.widgets.filter((w) => w.widget_type === 'quick_action') as w (w.id)}
							<button
								class="rounded-2xl p-4 flex flex-col items-center gap-2 text-center transition-all active:scale-[0.98]"
								style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
								onclick={() => w.link_url && goto(w.link_url)}
								disabled={!w.link_url}
							>
								<h3 class="text-[13px] font-semibold" style="color: var(--sys-label)">{w.label}</h3>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Widgets -->
			{#if snapshot.widgets.some((w) => w.widget_type !== 'quick_action')}
				<div class="section-header mt-0 mb-3 text-[13px]">Ringkasan</div>
				<div class="grid grid-cols-2 gap-3">
					{#each snapshot.widgets.filter((w) => w.widget_type !== 'quick_action') as w (w.id)}
						<button
							class="rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
							style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
							onclick={() => w.link_url && goto(w.link_url)}
							disabled={!w.link_url}
						>
							<div class="flex items-center justify-between gap-2">
								<p class="text-[11px] font-semibold truncate" style="color: var(--sys-label3)">{w.label}</p>
								<span class="w-2 h-2 rounded-full shrink-0" style="background: {statusColor(w.status)}"></span>
							</div>
							<p class="text-[18px] font-extrabold mt-1" style="color: {statusColor(w.status)}">{formatValue(w.value)}</p>
							{#if w.source === 'cache'}
								<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)">dari cache</p>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>
