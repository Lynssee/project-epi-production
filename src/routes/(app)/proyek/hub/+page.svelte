<script lang="ts">
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import ModuleMenuGrid, { type MenuCategory } from '$lib/components/navigation/ModuleMenuGrid.svelte';

	import IconBuildingFactory2 from '@tabler/icons-svelte/icons/building-factory-2';
	import IconClipboardList from '@tabler/icons-svelte/icons/clipboard-list';
	import IconUsersGroup from '@tabler/icons-svelte/icons/users-group';
	import IconCalendarTime from '@tabler/icons-svelte/icons/calendar-time';
	import IconCash from '@tabler/icons-svelte/icons/cash';
	import IconReceipt2 from '@tabler/icons-svelte/icons/receipt-2';
	import IconChartBar from '@tabler/icons-svelte/icons/chart-bar';
	import IconTable from '@tabler/icons-svelte/icons/table';
	import IconFileText from '@tabler/icons-svelte/icons/file-text';
	import IconPackage from '@tabler/icons-svelte/icons/package';
	import IconBox from '@tabler/icons-svelte/icons/box';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconHelmet from '@tabler/icons-svelte/icons/helmet';
	import IconClockExclamation from '@tabler/icons-svelte/icons/clock-exclamation';
	import IconGitCompare from '@tabler/icons-svelte/icons/git-compare';
	import IconShieldExclamation from '@tabler/icons-svelte/icons/shield-exclamation';

	function canView(permissions?: FeatureKey[], roles?: string[]): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		if (roles && roles.length > 0 && !roles.includes($authStore.roleId || '')) return false;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some((p) => hasPermission($authStore.roleId, p, $rolesStore, $authStore.roleIds));
	}

	let categories: MenuCategory[] = $derived([
		{
			title: 'Operasional Proyek',
			items: [
				{
					id: 'list-project',
					label: 'List Project',
					desc: 'Daftar keseluruhan proyek & progress',
					href: '/proyek',
					icon: IconBuildingFactory2,
					show: canView(['view_all_projects', 'view_own_projects'])
				},
				{
					id: 'laporan-harian',
					label: 'Laporan Harian',
					desc: 'Input & review laporan harian lapangan',
					href: '/laporan',
					icon: IconClipboardList,
					show: canView(['input_laporan', 'approve_laporan'])
				},
				{
					id: 'leader-hub',
					label: 'Leader Hub & Regu',
					desc: 'Kelola regu kerja & koordinasi leader',
					href: '/leader',
					icon: IconUsersGroup,
					show: canView(['view_own_projects', 'view_all_projects'])
				},
				{
					id: 'timeline-jadwal',
					label: 'Timeline & Jadwal',
					desc: 'Gantt chart & milestone pelaksanaan',
					href: '/timeline',
					icon: IconCalendarTime,
					show: canView(['view_own_projects', 'view_all_projects'])
				}
			]
		},
		{
			title: 'Keuangan & Biaya Proyek',
			items: [
				{
					id: 'keuangan-anggaran',
					label: 'Keuangan & Anggaran',
					desc: 'Pengajuan & approval anggaran proyek',
					href: '/anggaran',
					icon: IconCash,
					show: canView(['request_budget', 'approve_budget'])
				},
				{
					id: 'biaya-lapangan',
					label: 'Biaya Lapangan',
					desc: 'Pencatatan pengeluaran riil lapangan',
					href: '/biaya-lapangan',
					icon: IconReceipt2,
					show: canView(['access_ess'])
				},
				{
					id: 'rap-realisasi',
					label: 'RAP vs Realisasi',
					desc: 'Analisa efisiensi RAP terhadap aktual',
					href: '/rap-aktual',
					icon: IconChartBar,
					show: canView(['view_rap'])
				},
				{
					id: 'rab-terpusat',
					label: 'RAP & Realisasi Terpusat',
					desc: 'Rekapitulasi RAP terpusat lintas proyek',
					href: '/rap-aktual/terpusat',
					icon: IconTable,
					show: canView(['view_rap'])
				},
				{
					id: 'kontrak-jatuh-tempo',
					label: 'Kontrak Jatuh Tempo',
					desc: 'Monitoring masa berlaku kontrak proyek',
					href: '/kontrak-terpusat',
					icon: IconFileText,
					show: canView(['view_own_projects', 'view_all_projects'])
				}
			]
		},
		{
			title: 'Logistik & Material Proyek',
			items: [
				{
					id: 'packing-list',
					label: 'Packing List',
					desc: 'Pengiriman & penerimaan material proyek',
					href: '/packing-list',
					icon: IconPackage,
					show: canView(['manage_packing'])
				},
				{
					id: 'opname-inventaris',
					label: 'Opname Inventaris Proyek',
					desc: 'Pengecekan fisik aset & alat di lokasi',
					href: '/inventory-proyek/opname',
					icon: IconBox,
					show: canView(['view_own_projects', 'view_all_projects'])
				},
				{
					id: 'stok-kritis',
					label: 'Stok Kritis Terpusat',
					desc: 'Peringatan material minimum di proyek',
					href: '/inventory-proyek/kritis-terpusat',
					icon: IconAlertTriangle,
					show: canView(['view_own_projects', 'view_all_projects'])
				},
				{
					id: 'barang-menganggur',
					label: 'Barang Menganggur Lintas Proyek',
					desc: 'Stok proyek Anda yang tidak bergerak >30 hari — tawarkan ke proyek lain',
					href: '/inventory-proyek/barang-menganggur',
					icon: IconBox,
					show: canView(['view_own_projects', 'view_all_projects'])
				},
				{
					id: 'saldo-semua',
					label: 'Saldo Stok Semua Proyek',
					desc: 'Cek barang yang masih ada di site sebelum minta kirim/beli lagi',
					href: '/inventory-proyek/saldo-semua',
					icon: IconTable,
					show: canView(['view_own_projects', 'view_all_projects'])
				}
			]
		},
		{
			title: 'Manpower Proyek',
			items: [
				{
					id: 'manpower',
					label: 'Manpower & Tim',
					desc: 'Alokasi tenaga kerja & tim proyek',
					href: '/manpower',
					icon: IconHelmet,
					show: canView(['view_manpower'])
				},
				{
					id: 'spk-jatuh-tempo',
					label: 'SPK Jatuh Tempo',
					desc: 'Monitoring masa berlaku SPK manpower',
					href: '/spk-terpusat',
					icon: IconClockExclamation,
					show: canView(['view_own_projects', 'view_all_projects', 'view_manpower'])
				},
				{
					id: 'manpower-rencana-realisasi',
					label: 'Manpower Rencana vs Realisasi',
					desc: 'Bandingkan SPK aktif dengan kehadiran riil',
					href: '/manpower-rencana-realisasi',
					icon: IconGitCompare,
					show: canView(['view_own_projects', 'view_all_projects', 'view_manpower'])
				},
				{
					id: 'manpower-dobel-override-log',
					label: 'Audit Log Override Dobel-Proyek',
					desc: 'Riwayat pekerja yang tetap ditambahkan meski sudah absen di proyek lain',
					href: '/manpower-dobel-override-log',
					icon: IconShieldExclamation,
					show: canView(['view_own_projects', 'view_all_projects', 'view_manpower'])
				}
			]
		}
	]);
</script>

<svelte:head>
	<title>Hub Departemen Project — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400">
				<IconBuildingFactory2 size={26} />
			</div>
			<div>
				<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Hub Departemen Project</h1>
				<p class="text-xs md:text-sm font-medium mt-0.5" style="color: var(--sys-label3)">
					Manajemen operasional proyek, laporan, keuangan, logistik, dan tim
				</p>
			</div>
		</div>
	</div>

	<ModuleMenuGrid {categories} />
</div>
