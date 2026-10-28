<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		IconShoppingCart, IconClipboardCheck, IconTruckDelivery, IconRoute, IconChevronRight, IconBuildingStore, IconWallet
	} from '@tabler/icons-svelte';
	import { SectionGuide } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { procurementLapanganHints } from '$lib/data/hints/procurementLapangan';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint Procurement Lapangan; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(procurementLapanganHints, key, 'procurementLapangan');

	let canAccess = $derived(
		hasPermission($authStore.roleId, 'submit_pengajuan_pembelian', $rolesStore) ||
		hasPermission($authStore.roleId, 'approve_pengajuan_pembelian', $rolesStore) ||
		hasPermission($authStore.roleId, 'terima_barang_po', $rolesStore)
	);

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !canAccess) goto('/');
	});

	let menuItems = $derived(
		[
			{
				href: '/procurement/ajukan',
				label: 'Ajukan Pembelian',
				icon: IconShoppingCart,
				desc: 'Buat PR — wajib lewat cek stok Inventory',
				feature: 'submit_pengajuan_pembelian' as const
			},
			{
				href: '/procurement/approval',
				label: 'Approval Saya',
				icon: IconClipboardCheck,
				desc: 'Setujui/tolak PR dari HP',
				feature: 'approve_pengajuan_pembelian' as const
			},
			{
				href: '/procurement/terima',
				label: 'Terima Barang (PO)',
				icon: IconTruckDelivery,
				desc: 'Konfirmasi barang PO sampai + foto',
				feature: 'terima_barang_po' as const
			},
			{
				href: '/procurement/lacak',
				label: 'Lacak Pesanan',
				icon: IconRoute,
				desc: 'Status PO real-time',
				feature: 'submit_pengajuan_pembelian' as const
			},
			{
				href: '/procurement/beli-lokal',
				label: 'Beli Lokal (Reimburse)',
				icon: IconBuildingStore,
				desc: 'Sudah beli di lokasi? Ajukan reimburse di sini',
				feature: 'submit_pengajuan_pembelian' as const
			},
			{
				href: '/procurement/vendor',
				label: 'Direktori Vendor',
				icon: IconBuildingStore,
				desc: 'Cari toko/vendor resmi terdekat · usulkan vendor baru',
				feature: 'submit_pengajuan_pembelian' as const
			},
			{
				href: '/procurement/keluar-uang',
				label: 'Saya Keluar Uang Duluan',
				icon: IconWallet,
				desc: 'Bingung lewat mana? Jawab 3 pertanyaan, kami arahkan',
				feature: 'submit_pengajuan_pembelian' as const
			}
		].filter((item) => hasPermission($authStore.roleId, item.feature, $rolesStore))
	);
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm">
		<div class="px-6 py-4 flex items-center gap-4">
			<div class="w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white">
				<IconShoppingCart size={24} />
			</div>
			<div>
				<h1 class="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-blue-600 tracking-tight">Procurement Lapangan</h1>
				<p class="text-xs font-medium" style="color: var(--sys-label3)">Ajukan, setujui, terima, lacak — dari HP</p>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto px-4 sm:px-6 py-6 pb-24">
		<div class="max-w-5xl mx-auto w-full">
			<SectionGuide
				id="procurementLapangan.menu.page"
				title={h('menu.page').sectionGuide?.title}
				steps={h('menu.page').sectionGuide?.steps ?? []}
			/>
		</div>
		<div class="max-w-5xl mx-auto w-full grid grid-cols-1 sm:grid-cols-2 gap-4">
			{#each menuItems as item}
				<button
					class="glass-panel hover-lift rounded-2xl p-5 flex items-center gap-4 text-left border border-white/50 shadow-sm group focus:outline-none relative overflow-hidden"
					onclick={() => goto(item.href)}
				>
					<div class="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shadow-sm text-blue-600 group-hover:scale-110 transition-transform shrink-0">
						<item.icon size={24} />
					</div>
					<div class="flex-1 min-w-0">
						<p class="text-base font-bold mb-0.5" style="color: var(--sys-label)">{item.label}</p>
						<p class="text-xs font-medium" style="color: var(--sys-label3)">{item.desc}</p>
					</div>
					<IconChevronRight size={18} style="color: var(--sys-label4)" />
				</button>
			{/each}
		</div>
	</div>
</div>
