<script lang="ts">
	// B3/B7 Fase 4 restrukturisasi navigasi Lapangan (5 Agustus 2026): dulu scan QR equipment
	// SELALU langsung ke P2H (satu-satunya tujuan hardcode). Bottom-sheet ini kasih pilihan
	// aksi kontekstual sesudah scan, supaya mekanik tidak perlu hafal URL untuk Lapor/Riwayat/PM.
	import { goto } from '$app/navigation';
	import { IconTool, IconAlertTriangle, IconClock, IconClipboardCheck, IconX } from '@tabler/icons-svelte';

	let { equipment, onClose }: { equipment: { id: string; name: string; code?: string | null }; onClose: () => void } = $props();

	const actions = [
		{ id: 'p2h', label: 'Isi P2H', icon: IconClipboardCheck, href: (id: string) => `/preventive/p2h/${id}` },
		{ id: 'lapor', label: 'Lapor Kerusakan', icon: IconAlertTriangle, href: (id: string) => `/maintenance/survey/baru?equipment_id=${id}` },
		{ id: 'pm', label: 'Cek PM', icon: IconTool, href: (id: string) => `/preventive/pm/${id}` },
		{ id: 'riwayat', label: 'Info Unit', icon: IconClock, href: (id: string) => `/preventive/riwayat/${id}` }
	];

	function pick(href: string) {
		onClose();
		goto(href);
	}
</script>

<div class="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
	<button
		class="absolute inset-0 bg-black/40"
		aria-label="Tutup"
		onclick={onClose}
	></button>
	<div class="relative w-full max-w-md bg-white rounded-t-3xl p-5 pb-8 shadow-xl" style="background: var(--sys-bg-secondary, #fff)">
		<div class="flex items-center justify-between mb-1">
			<div class="min-w-0">
				<p class="text-[15px] font-bold truncate" style="color: var(--sys-label)">{equipment.name}</p>
				{#if equipment.code}
					<p class="text-[11px]" style="color: var(--sys-label3)">{equipment.code}</p>
				{/if}
			</div>
			<button class="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style="background: var(--sys-fill, #f1f5f9)" onclick={onClose} aria-label="Tutup">
				<IconX size={16} style="color: var(--sys-label3)" />
			</button>
		</div>
		<p class="text-[12px] mb-4" style="color: var(--sys-label3)">Pilih tindakan untuk unit ini</p>

		<div class="grid grid-cols-2 gap-3">
			{#each actions as a}
				<button
					class="glass-panel hover-lift rounded-2xl p-4 flex flex-col items-center gap-2 focus:outline-none"
					onclick={() => pick(a.href(equipment.id))}
				>
					<div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: var(--gl)">
						<a.icon size={20} style="color: var(--g)" />
					</div>
					<span class="text-[12px] font-semibold" style="color: var(--sys-label)">{a.label}</span>
				</button>
			{/each}
		</div>
	</div>
</div>
