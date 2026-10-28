<!-- src/lib/components/DisiplinKesiapanWidget.svelte -->
<!-- Fase 5 "Rencana Gate Disiplin Lapangan (P2H · Visit · Dokumen Jalan & Retur)" (5 Okt 2026):
     kartu "Kesiapan Hari Ini" — P2H alat, Check-in Visit, Dokumen Jalan, Retur tertunda.
     Komponen mandiri, onMount sendiri, non-blocking (pola sama PersonalWidget.svelte /
     KesiapanProyekWidget.svelte). Semua gate sumbernya masih MODE SHADOW di erp-epi —
     kartu ini murni informasi/pengingat, TIDAK ADA yang diblokir dari sini.
     Tidak tampil sama sekali bila SEMUA baris applicable:false (profil mobile_role_policy
     tidak mewajibkan apa pun untuk karyawan ini — default aman, bukan bug). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchKesiapanHariIni, type KesiapanHariIni, type KesiapanItem } from '$lib/services/disiplinKesiapan';

	let loading = $state(true);
	let data = $state<KesiapanHariIni | null>(null);
	let errorMsg = $state('');

	async function load(force = false) {
		loading = true;
		errorMsg = '';
		try {
			data = await fetchKesiapanHariIni(force);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
	});

	const ROWS: Array<{ key: keyof KesiapanHariIni; icon: string; label: string }> = [
		{ key: 'p2h', icon: '🔧', label: 'P2H Alat' },
		{ key: 'visit', icon: '📍', label: 'Check-in Visit' },
		{ key: 'dokumen_jalan', icon: '📄', label: 'Dokumen Jalan' },
		{ key: 'retur', icon: '📦', label: 'Retur Barang' }
	];

	let visibleRows = $derived.by(() => {
		if (!data) return [];
		return ROWS.map((r) => ({ ...r, item: data![r.key] as KesiapanItem })).filter((r) => r.item?.applicable);
	});
	let issueCount = $derived(visibleRows.filter((r) => !r.item.ok).length);

	function handleAction(url?: string | null) {
		if (!url) return;
		if (url.startsWith('LAPANGAN:')) {
			goto(url.replace('LAPANGAN:', ''));
		} else {
			goto(url);
		}
	}
</script>

{#if loading}
	<div class="dk-card dk-muted"><CircularProgressGauge size={40} strokeWidth={3} label="Memuat kesiapan hari ini..." /></div>
{:else if errorMsg}
	<!-- Fail-open dan tenang: tidak memblokir apa pun di Home, hanya informasi. -->
	<div class="dk-card dk-muted">
		Kesiapan hari ini belum bisa dimuat ({errorMsg}).
		<button class="dk-btn" onclick={() => load(true)}>Coba lagi</button>
	</div>
{:else if visibleRows.length > 0}
	<div class="dk-card">
		<div class="dk-head">
			<span>🚦 Kesiapan Hari Ini</span>
			<button class="dk-btn" title="Ambil ulang data terbaru" onclick={() => load(true)}>Segarkan</button>
		</div>
		<p class="dk-hint">
			Pengingat kepatuhan lapangan (P2H/Visit/Dokumen Jalan/Retur) — belum ada yang diblokir, semua masih mode percobaan.
		</p>
		{#if issueCount > 0}
			<div class="dk-alert">⚠️ {issueCount} hal perlu perhatian sebelum klaim BBM/eToll/uang muka berikutnya.</div>
		{/if}
		{#each visibleRows as row (row.key)}
			<div class="dk-row">
				<span class="dk-dot" style="background:{row.item.ok ? '#22c55e' : '#ef4444'}"></span>
				<div class="dk-main">
					<div class="dk-name">{row.icon} {row.label}</div>
					<div class="dk-detail">{row.item.detail}</div>
				</div>
				{#if !row.item.ok && row.item.actionUrl}
					<button class="dk-action" onclick={() => handleAction(row.item.actionUrl)}>Selesaikan</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.dk-card { background: var(--sys-bg2, white); border: 1px solid var(--sys-sep, #e2e8f0); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
	.dk-muted { font-size: 12px; color: #64748b; flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
	.dk-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; color: var(--sys-label, #1e293b); }
	.dk-btn { font-size: 11px; font-weight: 600; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px 8px; cursor: pointer; }
	.dk-hint { font-size: 11px; color: #64748b; line-height: 1.5; margin: 0; }
	.dk-alert { font-size: 12px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 7px 10px; }
	.dk-row { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; border-top: 1px solid #f1f5f9; }
	.dk-dot { width: 11px; height: 11px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
	.dk-main { flex: 1; min-width: 0; }
	.dk-name { font-size: 12.5px; font-weight: 600; color: var(--sys-label, #1e293b); }
	.dk-detail { font-size: 11px; color: #64748b; margin-top: 1px; }
	.dk-action { font-size: 11px; font-weight: 700; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
</style>
