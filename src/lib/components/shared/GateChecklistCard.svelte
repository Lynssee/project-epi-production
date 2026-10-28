<script lang="ts">
	// GateChecklistCard.svelte — Fase 4 v2 "Perketat Gate BBM & E-Toll" (9 Sep 2026).
	// Checklist HIDUP: tampil sejak form dibuka (via preflight), bukan cuma setelah submit
	// gagal (Aturan #6 — selalu ada jalan keluar, bukan blokir diam-diam).
	//
	// Kontrak GateResult sama dengan src/lib/server/gates/expenseGate.ts (GateResult).
	// Ikon BEDA untuk 3 kondisi (jangan disamakan, ini keluhan v1 di rencana §4):
	//   ❌ wajib GAGAL (mode='hard' && status='failed') — benar-benar memblokir submit.
	//   ⚠️ belum wajib / masih shadow-soft (mode!=='hard' && status='failed') — user
	//      TIDAK salah, syarat ini belum ditegakkan; tetap ditampilkan supaya user tahu
	//      lebih awal sebelum mode dinaikkan nanti.
	//   ➖ tidak relevan (status='not_applicable').
	//   ✅ lolos (status='passed').
	import { IconCheck, IconX, IconAlertTriangle, IconMinus, IconInfoCircle } from '@tabler/icons-svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';

	interface GateResultView {
		key: string;
		status: 'passed' | 'failed' | 'not_applicable';
		mode: 'shadow' | 'soft' | 'hard';
		message: string;
		action?: { label: string; href: string };
	}

	const GATE_LABELS: Record<string, string> = {
		G_BBM_VISIT: 'Kunjungan / peminjaman kendaraan',
		G_P2H_UNIT_LAPANGAN: 'P2H kendaraan',
		G_SJ_KIRIM: 'Surat jalan (kirim barang)',
		G_BUKTI_BBM: 'Bukti BBM (struk + odometer)',
		G_BUKTI_STRUK: 'Foto struk'
	};

	let { gates = [] as GateResultView[], onAction }: { gates: GateResultView[]; onAction?: (href: string) => void } = $props();

	function iconOf(g: GateResultView) {
		if (g.status === 'not_applicable') return { Icon: IconMinus, color: 'var(--sys-label4)' };
		if (g.status === 'passed') return { Icon: IconCheck, color: 'var(--green, #16a34a)' };
		// status === 'failed'
		if (g.mode === 'hard') return { Icon: IconX, color: 'var(--red, #dc2626)' };
		return { Icon: IconAlertTriangle, color: 'var(--orange, #d97706)' };
	}

	const wajibGagal = $derived(gates.filter((g) => g.status === 'failed' && g.mode === 'hard'));
	const belumWajibGagal = $derived(gates.filter((g) => g.status === 'failed' && g.mode !== 'hard'));
</script>

<div class="glass-panel rounded-2xl p-4" style={wajibGagal.length > 0 ? 'border: 1px solid var(--red)' : ''}>
	<div class="flex items-center gap-1.5 mb-3">
		<p class="text-xs font-bold uppercase tracking-widest" style="color: var(--sys-label3)">
			Syarat Pengajuan
		</p>
		<Tooltip text="Syarat ini menentukan apakah pengajuan bisa diproses lebih lanjut. Tanda kuning berarti belum wajib sekarang, tapi sebaiknya dilengkapi." position="right">
			<IconInfoCircle size={13} style="color: var(--sys-label4)" />
		</Tooltip>
	</div>

	<div class="space-y-2">
		{#each gates as g (g.key)}
			{@const { Icon, color } = iconOf(g)}
			<div class="flex items-start gap-2">
				<Icon size={16} style="color: {color}" class="shrink-0 mt-0.5" />
				<div class="flex-1 min-w-0">
					<p class="text-xs font-semibold" style="color: var(--sys-label)">
						{GATE_LABELS[g.key] || g.key}
						{#if g.status === 'failed' && g.mode !== 'hard'}
							<span class="font-normal" style="color: var(--sys-label4)">— belum wajib</span>
						{/if}
					</p>
					<p class="text-xs leading-snug" style="color: var(--sys-label3)">{g.message}</p>
					{#if g.status === 'failed' && g.action}
						<button
							type="button"
							class="text-xs font-bold mt-1"
							style="color: var(--blue)"
							onclick={() => onAction?.(g.action!.href)}
						>
							{g.action.label} →
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	{#if wajibGagal.length > 0}
		<p class="text-xs font-bold mt-3 pt-3 border-t" style="color: var(--red); border-color: var(--sys-sep)">
			{wajibGagal.length} syarat wajib belum terpenuhi — belum bisa dikirim.
		</p>
	{:else if belumWajibGagal.length > 0}
		<p class="text-xs mt-3 pt-3 border-t" style="color: var(--sys-label3); border-color: var(--sys-sep)">
			Boleh dikirim sekarang — {belumWajibGagal.length} syarat di atas belum wajib, tapi sebaiknya dilengkapi sebelum ditegakkan penuh.
		</p>
	{/if}
</div>
