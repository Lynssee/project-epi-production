<!-- src/routes/kiosk/roll-call/+page.svelte -->
<!-- Rencana Absensi Istirahat v2, Fase 1 P2 — roll-call supervisor (cadangan saat kiosk
  badge mati atau area belum kebagian kiosk). Supervisor sudah login kiosk dengan badge+PIN
  miliknya sendiri (lihat +layout.server.ts) — akuntabilitas jatuh ke supervisor ini, BUKAN
  anonim. Pindai badge anggota regu satu per satu ke daftar, lalu kirim sebagai satu batch. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import QrCameraScanner from '$lib/components/ui/QrCameraScanner.svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { hapticOk, hapticError } from '$lib/utils/haptic';
	import IconTrash from '@tabler/icons-svelte/icons/circle-x';
	import IconScan from '@tabler/icons-svelte/icons/scan';
	import IconSend from '@tabler/icons-svelte/icons/arrow-right';

	const STORAGE_KEY = 'epi_kiosk_workstation_id';

	interface PendingItem {
		no_badge: string;
		badge_token: string;
		label: string; // no_badge saja — nama baru diketahui setelah dikirim
	}
	interface ResultItem {
		no_badge: string;
		success: boolean;
		nama?: string;
		message?: string;
		overrunMenit?: number;
	}

	let { data } = $props();

	let pending = $state<PendingItem[]>([]);
	let scanning = $state(false);
	let submitting = $state(false);
	let results = $state<ResultItem[] | null>(null);
	let workstationId = '';

	onMount(() => {
		workstationId = localStorage.getItem(STORAGE_KEY) || '';
	});

	function handleDetect(raw: string) {
		const parsed = parseEpiQr(raw);
		if (!parsed || parsed.type !== 'BADGE' || !parsed.token) return;
		const noBadge = String(parsed.id);
		if (pending.some((p) => p.no_badge === noBadge)) return; // sudah ada di daftar
		hapticOk();
		pending = [...pending, { no_badge: noBadge, badge_token: parsed.token, label: noBadge }];
	}

	function removeItem(noBadge: string) {
		pending = pending.filter((p) => p.no_badge !== noBadge);
	}

	async function kirimSemua() {
		if (pending.length === 0) return;
		submitting = true;
		results = null;
		try {
			const res = await fetch('/api/kiosk/roll-call', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					items: pending.map((p) => ({ no_badge: p.no_badge, badge_token: p.badge_token })),
					workstation_id: workstationId || null
				})
			});
			const data = await res.json().catch(() => null);
			const newResults: ResultItem[] = data?.results || [];
			results = newResults;
			const anySuccess = newResults.some((r) => r.success);
			if (anySuccess) hapticOk();
			else hapticError();
			pending = [];
		} catch {
			hapticError();
			results = [{ no_badge: '-', success: false, message: 'Gagal mengirim — periksa koneksi lalu coba lagi.' }];
		} finally {
			submitting = false;
			scanning = false;
		}
	}
</script>

<div class="wrap">
	<h1>Roll Call Supervisor</h1>
	<p class="hint">Cadangan saat kiosk badge mati. Pindai badge anggota regu satu per satu, lalu kirim sebagai satu batch. Tercatat atas nama Anda ({data?.kioskSession?.nama || 'supervisor'}).</p>

	{#if scanning}
		<QrCameraScanner onDetect={handleDetect} onClose={() => (scanning = false)} expectedPrefix="EPI:BADGE:" continuous={true} debounceMs={1200} />
	{:else}
		<button class="scan-btn" onclick={() => (scanning = true)}>
			<IconScan size={28} /> Mulai Pindai Badge
		</button>
	{/if}

	{#if pending.length > 0}
		<div class="pending-list">
			<p class="pending-title">{pending.length} badge siap dikirim</p>
			{#each pending as item (item.no_badge)}
				<div class="pending-item">
					<span>{item.label}</span>
					<button class="remove-btn" onclick={() => removeItem(item.no_badge)} aria-label="Hapus">
						<IconTrash size={18} />
					</button>
				</div>
			{/each}
			<button class="send-btn" disabled={submitting} onclick={kirimSemua}>
				<IconSend size={20} />
				{submitting ? 'Mengirim...' : `Kirim Semua (${pending.length})`}
			</button>
		</div>
	{/if}

	{#if results}
		<div class="results">
			<p class="results-title">Hasil</p>
			{#each results as r}
				<div class="result-row" class:ok={r.success} class:fail={!r.success}>
					<strong>{r.nama || r.no_badge}</strong>
					<span>{r.success ? 'Tercatat kembali dari istirahat' + (r.overrunMenit ? ` (telat ${r.overrunMenit} mnt)` : '') : r.message}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.wrap { padding: 1rem 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 100%; box-sizing: border-box; min-height: 100%; }
	h1 { font-size: 1.3rem; text-align: center; margin: 0; }
	.hint { text-align: center; color: #64748b; font-size: 0.9rem; margin: 0; }
	.scan-btn {
		display: flex; align-items: center; justify-content: center; gap: 0.5rem;
		min-height: 90px; border-radius: 1rem; border: none; background: #0ea5e9; color: white;
		font-size: 1.1rem; font-weight: 800; cursor: pointer;
	}
	.pending-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.pending-title { font-weight: 700; color: #334155; margin: 0; }
	.pending-item {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.75rem 1rem; background: white; border: 1px solid #e2e8f0; border-radius: 0.75rem;
		font-family: monospace; font-size: 1rem;
	}
	.remove-btn { border: none; background: none; color: #dc2626; cursor: pointer; padding: 0.25rem; }
	.send-btn {
		display: flex; align-items: center; justify-content: center; gap: 0.5rem;
		min-height: 64px; border-radius: 0.75rem; border: none; background: #16a34a; color: white;
		font-weight: 800; font-size: 1.05rem; cursor: pointer; margin-top: 0.5rem;
	}
	.send-btn:disabled { opacity: 0.6; }
	.results { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
	.results-title { font-weight: 700; color: #334155; margin: 0; }
	.result-row { padding: 0.75rem 1rem; border-radius: 0.75rem; font-size: 0.9rem; }
	.result-row.ok { background: #dcfce7; color: #14532d; }
	.result-row.fail { background: #fee2e2; color: #7f1d1d; }
	.result-row strong { display: block; margin-bottom: 0.15rem; }
</style>
