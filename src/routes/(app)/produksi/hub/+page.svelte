<script lang="ts">
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import ModuleMenuGrid, { type MenuCategory } from '$lib/components/navigation/ModuleMenuGrid.svelte';

	import IconBuildingFactory2 from '@tabler/icons-svelte/icons/building-factory-2';
	import IconClipboardList from '@tabler/icons-svelte/icons/clipboard-list';
	import IconClipboardCheck from '@tabler/icons-svelte/icons/clipboard-check';
	import IconPackageImport from '@tabler/icons-svelte/icons/package-import';
	import IconFlask from '@tabler/icons-svelte/icons/flask';
	import IconFlame from '@tabler/icons-svelte/icons/flame';
	import IconPrinter from '@tabler/icons-svelte/icons/printer';
	import IconRepeat from '@tabler/icons-svelte/icons/repeat';
	import IconRecycle from '@tabler/icons-svelte/icons/recycle';

	function canView(permissions?: FeatureKey[], roles?: string[]): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		if (roles && roles.length > 0 && !roles.includes($authStore.roleId || '')) return false;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some((p) => hasPermission($authStore.roleId, p, $rolesStore, $authStore.roleIds));
	}

	let categories: MenuCategory[] = $derived([
		{
			title: 'Produksi Lapangan & Pabrik',
			items: [
				{
					id: 'input-produksi',
					label: 'Input Produksi Harian',
					desc: 'Form pencatatan hasil produksi & batch harian',
					href: '/produksi/input-harian',
					icon: IconBuildingFactory2,
					show: canView(['input_produksi_harian'])
				},
				{
					id: 'riwayat-produksi',
					label: 'Monitoring Produksi',
					desc: 'Riwayat dan log output produksi',
					href: '/produksi',
					icon: IconClipboardList,
					show: canView(['input_produksi_harian'])
				},
				{
					id: 'cetak-label',
					label: 'Cetak Label Produk',
					desc: 'Cetak label produk self-service dari lapangan (SPK QC Pending/Selesai)',
					href: '/produksi/cetak-label',
					icon: IconPrinter,
					show: canView(['production_label_print'])
				},
				{
					id: 'serah-terima-shift',
					label: 'Serah-Terima Shift',
					desc: 'Ringkasan output/reject/waste otomatis + konfirmasi terima shift',
					href: '/produksi/serah-terima',
					icon: IconRepeat,
					show: canView(['input_produksi_harian'])
				},
				{
					id: 'terima-bahan-spk',
					label: 'Terima Bahan Baku SPK',
					desc: 'Konfirmasi bahan dari gudang atas nama Anda & lapor sisa bahan',
					href: '/produksi/terima-bahan',
					icon: IconPackageImport,
					show: canView(['input_produksi_harian'])
				},
				{
					id: 'pelarut-daur-ulang',
					label: 'Pelarut Daur Ulang',
					desc: 'Catat pelarut (Xylene/thinner) yang dikumpulkan & dipakai ulang',
					href: '/produksi/pelarut',
					icon: IconRecycle,
					show: canView(['input_produksi_harian'])
				},
				{
					id: 'kiosk-qc',
					label: 'Kiosk QC',
					desc: 'Uji parameter QC SPK yang menunggu (butuh sesi PIN kiosk)',
					href: '/kiosk/qc',
					icon: IconClipboardCheck,
					// B7/Fase 6 (24 Sep 2026): dulu tidak ada jalan dari hub ke Kiosk QC —
					// akses sebenarnya digerbang di kiosk_menu_access (per-operator, tidak
					// bisa dicek dari sini), jadi kartu ini selalu tampil; kalau operator
					// belum diizinkan, kiosk sendiri yang menolak dengan pesan jelas.
					show: true
				},
				{
					id: 'kiosk-fg-terima',
					label: 'Terima FG',
					desc: 'Terima barang jadi hasil produksi ke gudang (butuh sesi PIN kiosk)',
					href: '/kiosk/fg-terima',
					icon: IconPackageImport,
					show: true
				}
			]
		},
		{
			title: 'R&D & Formulasi',
			items: [
				{
					id: 'rnd-dokumen',
					label: 'R&D — Dokumen TDS / MSDS',
					desc: 'Technical data sheet & material safety data',
					href: '/rnd',
					icon: IconFlask,
					show: canView(['access_rnd'])
				}
			]
		}
	]);
</script>

<svelte:head>
	<title>Hub Produksi & R&D — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400">
				<IconFlame size={26} />
			</div>
			<div>
				<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Hub Produksi & R&D</h1>
				<p class="text-xs md:text-sm font-medium mt-0.5" style="color: var(--sys-label3)">
					Pencatatan produksi harian, monitoring batch, dan dokumen R&D
				</p>
			</div>
		</div>
	</div>

	<ModuleMenuGrid {categories} />
</div>
