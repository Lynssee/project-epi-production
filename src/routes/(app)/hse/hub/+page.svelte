<script lang="ts">
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import ModuleMenuGrid, { type MenuCategory } from '$lib/components/navigation/ModuleMenuGrid.svelte';

	import IconShieldCheck from '@tabler/icons-svelte/icons/shield-check';
	import IconFlame from '@tabler/icons-svelte/icons/flame';
	import IconUsersGroup from '@tabler/icons-svelte/icons/users-group';
	import IconClipboardCheck from '@tabler/icons-svelte/icons/clipboard-check';
	import IconChecklist from '@tabler/icons-svelte/icons/checklist';

	function canView(permissions?: FeatureKey[], roles?: string[]): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		if (roles && roles.length > 0 && !roles.includes($authStore.roleId || '')) return false;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some((p) => hasPermission($authStore.roleId, p, $rolesStore, $authStore.roleIds));
	}

	let categories: MenuCategory[] = $derived([
		{
			title: 'Keselamatan & K3',
			items: [
				{
					id: 'hse-dashboard',
					label: 'Dashboard HSE & Insiden',
					desc: 'Laporan insiden, near miss & investigasi',
					href: '/hse',
					icon: IconShieldCheck,
					show: canView(['access_hse'])
				},
				{
					id: 'jsa',
					label: 'Job Safety Analysis (JSA)',
					desc: 'Analisa keselamatan kerja sebelum tugas',
					href: '/jsa',
					icon: IconFlame,
					show: canView(['access_hse', 'hse_jsa_create'])
				},
				{
					id: 'toolbox-meeting',
					label: 'Toolbox Meeting',
					desc: 'Briefing harian keselamatan kerja tim',
					href: '/toolbox',
					icon: IconUsersGroup,
					show: canView(['access_hse', 'hse_toolbox_lead'])
				}
			]
		},
		{
			title: 'Inspeksi & Mutu',
			items: [
				{
					id: 'inspection-bpir',
					label: 'Inspection Report (BPIR)',
					desc: 'Laporan inspeksi & pengecekan mutu',
					href: '/inspection',
					icon: IconClipboardCheck,
					show: canView(['input_inspection'])
				},
				{
					id: 'ga-checklist',
					label: 'GA Checklist Fasilitas & K3',
					desc: 'Pengecekan fasilitas kerja & housekeeping',
					href: '/ga-checklist',
					icon: IconChecklist,
					show: canView(['access_ga_checklist'])
				}
			]
		}
	]);
</script>

<svelte:head>
	<title>Hub HSE & Mutu — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400">
				<IconShieldCheck size={26} />
			</div>
			<div>
				<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Hub HSE & Mutu</h1>
				<p class="text-xs md:text-sm font-medium mt-0.5" style="color: var(--sys-label3)">
					Keselamatan kerja (K3), JSA, toolbox meeting, dan inspeksi mutu
				</p>
			</div>
		</div>
	</div>

	<ModuleMenuGrid {categories} />
</div>
