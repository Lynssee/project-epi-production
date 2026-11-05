<!-- PlGateNotice.svelte — banner mencolok untuk leader: aturan tautan Master Barang + hitung mundur ke tanggal gate berlaku.
     Sumber: GET /api/packing-list/gate-notice (konfigurasi gate_definitions/gate_enforcement, bukan hardcode).
     Tampil hanya saat gate G_PKL_INVENTORY_LINK berstatus hard (masa tenggang atau sudah berlaku). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { gatePhase, leaderNoticeText, type GatePhase } from '$lib/shared/plGatePhase';

	let phase = $state<GatePhase | null>(null);
	let text = $state<string | null>(null);

	onMount(async () => {
		try {
			const token = await getIdToken();
			const res = await fetch('/api/packing-list/gate-notice', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
			if (!res.ok) return;
			const j = await res.json();
			const p = gatePhase(j?.inventoryLink);
			phase = p;
			text = leaderNoticeText(p, j?.inventoryLink?.enforceFrom ?? null);
		} catch (e) {
			console.warn('[PlGateNotice] gagal memuat info gate:', e);
		}
	});
</script>

{#if text && phase}
	<div
		role="alert"
		class="rounded-xl border-2 px-3 py-2.5 shadow-lg {phase.tone === 'red'
			? 'bg-red-600 text-white border-red-700 animate-pulse'
			: 'bg-amber-300 text-amber-950 border-amber-500'}"
	>
		<div class="flex items-start gap-2">
			<span class="text-lg leading-none">{phase.tone === 'red' ? '⛔' : '⚠️'}</span>
			<div class="min-w-0 text-[12px] leading-snug">
				<div class="font-black">
					{phase.tone === 'red' ? 'Aturan baru berlaku: barang wajib tertaut Master Barang' : 'Segera biasakan: barang wajib tertaut Master Barang'}
				</div>
				<div class="mt-0.5">{text}</div>
				<div class="mt-1 text-[11px] opacity-90">
					Cara: ketik nama barang, lalu pilih dari saran. Label hijau "✓ Tertaut" artinya aman; label kuning "Belum tertaut" perlu dibenahi.
				</div>
			</div>
		</div>
	</div>
{/if}
