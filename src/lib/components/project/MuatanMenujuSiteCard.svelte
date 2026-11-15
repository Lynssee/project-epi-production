<!-- src/lib/components/project/MuatanMenujuSiteCard.svelte -->
<!-- Kartu "Muatan Menuju Site" (G_MOB_SYNC, sisi Lapangan): ETA material vs tanggal tim mulai, SJ yang masih di jalan
     (resi · ekspedisi · ETA), banner merah bila tim berangkat sebelum material tiba, dan SARAN pekerjaan non-material.
     Data dari erp-epi /fulfillment (read-only). Gagal memuat → kartu ringan, halaman tetap normal. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { onMount } from 'svelte';
	import { IconRefresh } from '@tabler/icons-svelte';
	import { fetchProjectFulfillment, type ProjectFulfillment } from '$lib/services/projectFulfillment';
	import { mobSyncView, mobSyncReason, mobSyncCountdown, listInTransitSj, contingencySuggestions, trackStageLabel } from '$lib/utils/mobSyncLapangan';

	let { projectId }: { projectId: number | string } = $props();

	let data = $state<ProjectFulfillment | null>(null);
	let loading = $state(true);
	let errorMsg = $state('');

	async function load(force = false) {
		loading = true;
		errorMsg = '';
		try {
			data = await fetchProjectFulfillment(projectId, force);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat status muatan.';
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		load();
	});

	let ms = $derived(data?.mobSync ?? null);
	let view = $derived(mobSyncView(ms?.status));
	let waiting = $derived(ms?.status === 'waiting_material');
	let transit = $derived(listInTransitSj(data));
	let suggestions = $derived(contingencySuggestions(data));
	let countdown = $derived(mobSyncCountdown(ms, data?.today || ''));
	let waitDays = $derived(Math.abs(ms?.gap_days ?? 0));
</script>

{#if loading}
	<div class="mm-card mm-muted"><CircularProgressGauge size={42} strokeWidth={3} label="Memuat status muatan..." /></div>
{:else if errorMsg}
	<div class="mm-card mm-muted">
		Status muatan belum bisa dimuat ({errorMsg}).
		<button class="mm-btn" onclick={() => load(true)}>Coba lagi</button>
	</div>
{:else if data && !data.forecastEmpty}
	<div class="mm-card" data-testid="muatan-menuju-site">
		<div class="mm-head">
			<span class="inline-flex items-center gap-1">
				🚚 Muatan Menuju Site
				<Tooltip text="Membandingkan kapan material tiba (ETA ekspedisi dari Logistik) dengan tanggal tim mulai (SPK). Merah = tim berangkat sebelum material tiba, berpotensi menunggu (standby). ETA 'proyeksi' berarti Surat Jalan belum ber-ETA, jadi dipakai tanggal dibutuhkan dari Timeline."><span class="mm-help">?</span></Tooltip>
			</span>
			<button class="mm-btn" onclick={() => load(true)}><IconRefresh size={13} /> Segarkan</button>
		</div>

		{#if waiting}
			<div class="mm-banner" role="alert">
				<b>⚠️ Tim berangkat {ms?.manpower_start}, tetapi material baru tiba {ms?.material_eta}{ms?.projected ? ' (perkiraan)' : ''}.</b>
				<div>Potensi menunggu {waitDays} hari di site. Hubungi admin/logistik untuk konfirmasi ETA atau minta jadwal tim digeser. Catat jam henti di Laporan Harian bila tim sudah menunggu.</div>
			</div>
		{/if}

		<div class="mm-status">
			<span class="mm-chip {view.cls}">{view.icon} {view.label}</span>
			{#if countdown}<span class="mm-count">{countdown}</span>{/if}
		</div>
		{#if ms?.status === 'unknown'}
			<p class="mm-hint">{mobSyncReason(ms?.reason)}</p>
		{:else if !waiting}
			<p class="mm-hint">{view.help}</p>
		{/if}

		{#if transit.length > 0}
			<div class="mm-sec">Pengiriman yang masih di jalan</div>
			{#each transit as s (s.id)}
				<div class="mm-row">
					<div class="mm-main">
						<div class="mm-name">SJ {s.nomor_sj || `#${s.id}`}{#if s.ekspedisi}{' '}· {s.ekspedisi}{/if}</div>
						<div class="mm-sub">
							{#if s.no_resi}Resi {s.no_resi} ·{' '}{/if}{trackStageLabel(s.track_stage) || 'Menunggu pengiriman'}
						</div>
					</div>
					<div class="mm-eta">{s.eta_tiba ? `ETA ${s.eta_tiba}` : 'ETA belum diisi'}</div>
				</div>
			{/each}
		{:else if ms && ms.status !== 'unknown'}
			<p class="mm-hint">Tidak ada Surat Jalan yang sedang di jalan.</p>
		{/if}

		{#if suggestions.length > 0}
			<div class="mm-sec">
				Saran pekerjaan sambil menunggu material
				<Tooltip text="Pekerjaan di Timeline yang tidak butuh material dan jadwalnya mulai sebelum material tiba. Ini hanya SARAN — Anda yang memutuskan; jadwal Timeline tidak berubah otomatis."><span class="mm-help">?</span></Tooltip>
			</div>
			{#each suggestions as s (s.id)}
				<div class="mm-row">
					<div class="mm-main">
						<div class="mm-name">{s.name}</div>
						<div class="mm-sub">{s.category} · {s.first} s/d {s.last}</div>
					</div>
				</div>
			{/each}
		{/if}
	</div>
{/if}

<style>
	.mm-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
	.mm-muted { font-size: 12px; color: #64748b; flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap; }
	.mm-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; color: #1e293b; }
	.mm-btn { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px 8px; cursor: pointer; }
	.mm-help { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; margin-left: 4px; border-radius: 50%; background: #eef2ff; color: #4338ca; font-size: 11px; font-weight: 700; cursor: help; }
	.mm-banner { font-size: 12px; color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
	.mm-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.mm-chip { font-size: 11px; font-weight: 700; border: 1px solid; border-radius: 999px; padding: 2px 8px; }
	.mm-count { font-size: 12px; color: #334155; }
	.mm-hint { font-size: 11px; color: #64748b; line-height: 1.5; margin: 0; }
	.mm-sec { font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; margin-top: 2px; }
	.mm-row { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 6px 0; border-top: 1px solid #f1f5f9; }
	.mm-main { flex: 1; min-width: 0; }
	.mm-name { font-size: 12.5px; font-weight: 600; color: #1e293b; }
	.mm-sub { font-size: 11px; color: #64748b; }
	.mm-eta { font-size: 11.5px; font-weight: 700; color: #1d4ed8; white-space: nowrap; }
</style>
