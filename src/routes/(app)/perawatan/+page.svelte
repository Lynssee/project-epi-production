<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore, isLeaderRole } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import { resolveOperatorId } from '$lib/services/preventive';
	import { getMyWorkOrders, getCategoryNamesMap } from '$lib/services/maintenance';
	import ModuleMenuGrid, { type MenuCategory } from '$lib/components/navigation/ModuleMenuGrid.svelte';

	import IconTool from '@tabler/icons-svelte/icons/tool';
	import IconLayoutGrid from '@tabler/icons-svelte/icons/layout-grid';
	import IconClipboardList from '@tabler/icons-svelte/icons/clipboard-list';
	import IconClipboardCheck from '@tabler/icons-svelte/icons/clipboard-check';
	import IconUsersGroup from '@tabler/icons-svelte/icons/users-group';
	import IconHeadset from '@tabler/icons-svelte/icons/headset';
	import IconBuildingWarehouse from '@tabler/icons-svelte/icons/building-warehouse';

	function canView(permissions?: FeatureKey[], roles?: string[]): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		if (roles && roles.length > 0 && !roles.includes($authStore.roleId || '')) return false;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some((p) => hasPermission($authStore.roleId, p, $rolesStore, $authStore.roleIds));
	}

	let badges = $state<Record<string, number>>({});

	onMount(async () => {
		if (!canView(['input_maintenance'])) return;
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) return;
			const personnelId = await resolveOperatorId(karyawanName);
			const workOrders = await getMyWorkOrders(personnelId);
			const categoryMap = await getCategoryNamesMap(workOrders.map((w) => w.order_status));
			const aktif = workOrders.filter((wo) => {
				const statusName = (categoryMap[wo.order_status || ''] || '').toLowerCase();
				return !statusName.includes('closed') && !statusName.includes('qc');
			}).length;
			badges = { ...badges, workOrderAktif: aktif };
		} catch {
			// Diam-diam gagal
		}
	});

	let categories: MenuCategory[] = $derived([
		{
			title: 'Pekerjaan & Perawatan',
			items: [
				{
					id: 'preventive',
					label: 'Preventive Maintenance',
					desc: 'Jadwal & pengerjaan preventive maintenance',
					href: '/preventive',
					icon: IconTool,
					show: canView(['input_preventive'])
				},
				{
					id: 'work-order',
					label: 'Work Order Saya',
					desc: 'Perbaikan yang ditugaskan ke Anda',
					href: '/maintenance/work-order',
					icon: IconClipboardList,
					show: canView(['input_maintenance']),
					badge: () => badges.workOrderAktif || 0
				},
				{
					id: 'survey-tiket',
					label: 'Survey / Tiket Saya',
					desc: 'Laporan kerusakan & tiket yang Anda buat',
					href: '/maintenance/survey',
					icon: IconClipboardCheck,
					show: canView(['input_maintenance'])
				},
				{
					id: 'dashboard-maintenance',
					label: 'Dashboard Maintenance',
					desc: 'Ringkasan status equipment & pekerjaan',
					href: '/maintenance',
					icon: IconLayoutGrid,
					show: canView(['input_maintenance'])
				}
			]
		},
		{
			title: 'Layanan & Leader',
			items: [
				{
					id: 'support-tiket',
					label: 'Support & Tiket Lapangan',
					desc: 'Pengajuan bantuan teknis & support',
					href: '/support',
					icon: IconHeadset,
					show: canView(['input_support'])
				},
				{
					id: 'leader-hub',
					label: 'Dashboard Project Leader',
					desc: 'KPI proyek, review laporan mekanik & jadwal PM',
					href: '/leader',
					icon: IconUsersGroup,
					show: canView([], ['leader'])
				}
			]
		}
	]);
</script>

<svelte:head>
	<title>Hub Perawatan & Bengkel — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400">
				<IconTool size={26} />
			</div>
			<div>
				<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Hub Perawatan & Bengkel</h1>
				<p class="text-xs md:text-sm font-medium mt-0.5" style="color: var(--sys-label3)">
					Preventive maintenance, work order, tiket kerusakan & peralatan
				</p>
			</div>
		</div>
	</div>

	<ModuleMenuGrid {categories} />
</div>
