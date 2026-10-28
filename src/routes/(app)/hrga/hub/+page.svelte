<!-- src/routes/(app)/hrga/hub/+page.svelte -->
<script lang="ts">
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import ModuleMenuGrid, { type MenuCategory } from '$lib/components/navigation/ModuleMenuGrid.svelte';

	import IconBuildingSkyscraper from '@tabler/icons-svelte/icons/building-skyscraper';
	import IconChecklist from '@tabler/icons-svelte/icons/checklist';
	import IconClipboardList from '@tabler/icons-svelte/icons/clipboard-list';
	import IconCar from '@tabler/icons-svelte/icons/car';
	import IconShieldCheck from '@tabler/icons-svelte/icons/shield-check';
	import IconUserCheck from '@tabler/icons-svelte/icons/user-check';
	import IconClock from '@tabler/icons-svelte/icons/clock';
	import IconCalendarEvent from '@tabler/icons-svelte/icons/calendar-event';
	import IconHourglass from '@tabler/icons-svelte/icons/hourglass';
	import IconCash from '@tabler/icons-svelte/icons/cash';
	import IconSchool from '@tabler/icons-svelte/icons/school';
	import IconTrophy from '@tabler/icons-svelte/icons/trophy';
	import IconFileText from '@tabler/icons-svelte/icons/file-text';
	import IconSpeakerphone from '@tabler/icons-svelte/icons/speakerphone';
	import IconHelmet from '@tabler/icons-svelte/icons/helmet';
	import IconGavel from '@tabler/icons-svelte/icons/gavel';
	import IconPackage from '@tabler/icons-svelte/icons/package';

	function canView(permissions?: FeatureKey[], roles?: string[]): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		if (roles && roles.length > 0 && !roles.includes($authStore.roleId || '')) return false;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some((p) => hasPermission($authStore.roleId, p, $rolesStore, $authStore.roleIds));
	}

	let categories: MenuCategory[] = $derived([
		{
			title: 'General Affairs (GA) & Operasional Kantor',
			items: [
				{
					id: 'ga-checklist',
					label: 'GA Checklist Fasilitas & K3',
					desc: 'Pengecekan kebersihan, fasilitas kerja & housekeeping',
					href: '/ga-checklist',
					icon: IconChecklist,
					show: canView(['access_ga_checklist'])
				},
				{
					id: 'ga-request',
					label: 'Permintaan Layanan GA',
					desc: 'Pengajuan ATK, perbaikan fasilitas & layanan kantor',
					href: '/ga-request',
					icon: IconClipboardList,
					show: canView(['access_ess'])
				},
				{
					id: 'ga-barang-ruangan',
					label: 'Barang per Ruangan',
					desc: 'Scan QR patroli / pilih ruangan untuk lihat daftar barang di dalamnya',
					href: '/ruangan',
					icon: IconPackage,
					show: canView(['access_ess'])
				},
				{
					id: 'fleet-booking',
					label: 'Peminjaman Kendaraan (Fleet)',
					desc: 'Booking kendaraan operasional & perjalanan dinas',
					href: '/fleet-booking',
					icon: IconCar,
					show: canView(['access_fleet_booking', 'access_ess'])
				},
				{
					id: 'satpam',
					label: 'Keamanan & Satpam',
					desc: 'Patroli QR, buku tamu, gate log & serah terima jaga',
					href: '/satpam',
					icon: IconShieldCheck,
					show: canView(['access_security'])
				}
			]
		},
		{
			title: 'Portal Karyawan (Pintasan ESS)',
			items: [
				{
					id: 'ess-beranda',
					label: 'Buka Portal Karyawan (ESS)',
					desc: 'Absensi harian, cuti, lembur, keuangan, pelatihan & dokumen saya',
					href: '/ess',
					icon: IconUserCheck,
					show: canView(['access_ess'])
				}
			]
		},
		{
			title: 'Manpower & Tim Lapangan',
			items: [
				{
					id: 'manpower',
					label: 'Manpower & Alokasi Tim',
					desc: 'Data personel, alokasi regu proyek & absensi lapangan',
					href: '/manpower',
					icon: IconHelmet,
					show: canView(['view_manpower'])
				}
			]
		},
		{
			title: 'Legal & Kepatuhan',
			items: [
				{
					id: 'legal-hak-cipta',
					label: 'Legal & Hak Cipta Perusahaan',
					desc: 'Informasi legalitas, hak cipta & kepatuhan regulasi',
					href: '/legal/hak-cipta',
					icon: IconGavel,
					show: true
				}
			]
		}
	]);
</script>

<svelte:head>
	<title>Hub Departemen HRD & GA — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-teal-500/10 text-teal-600 dark:text-teal-400">
				<IconBuildingSkyscraper size={26} />
			</div>
			<div>
				<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Hub Departemen HRD & GA</h1>
				<p class="text-xs md:text-sm font-medium mt-0.5" style="color: var(--sys-label3)">
					Layanan umum (General Affairs), keamanan/satpam, kendaraan operasional, dan manajemen manpower
				</p>
			</div>
		</div>
	</div>

	<ModuleMenuGrid {categories} />
</div>
