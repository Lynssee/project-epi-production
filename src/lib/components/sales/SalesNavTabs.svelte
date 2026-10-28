<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		IconMapPin,
		IconUserSearch,
		IconClipboardList,
		IconClipboardCheck,
		IconFileDollar,
		IconFileUpload,
		IconFlask
	} from '@tabler/icons-svelte';

	interface Props {
		active: 'kunjungan' | 'prospek' | 'laporan' | 'survey' | 'penawaran' | 'po' | 'sample';
		remindersCount?: number;
		poCount?: number;
		pendingCount?: number;
		sampleApprovalCount?: number;
	}

	let { active, remindersCount = 0, poCount = 0, pendingCount = 0, sampleApprovalCount = 0 }: Props = $props();

	const tabs = $derived([
		{
			id: 'kunjungan',
			label: 'Kunjungan',
			href: '/sales',
			icon: IconMapPin,
			badge: pendingCount > 0 ? pendingCount : null,
			badgeColor: 'bg-amber-500 text-white'
		},
		{
			id: 'prospek',
			label: 'Prospek',
			href: '/sales/prospek',
			icon: IconUserSearch,
			badge: remindersCount > 0 ? remindersCount : null,
			badgeColor: 'bg-rose-500 text-white'
		},
		{
			id: 'laporan',
			label: 'Laporan Harian',
			href: '/sales/laporan-harian',
			icon: IconClipboardList,
			badge: null,
			badgeColor: ''
		},
		{
			id: 'survey',
			label: 'Survey',
			href: '/sales/survey',
			icon: IconClipboardCheck,
			badge: null,
			badgeColor: ''
		},
		{
			id: 'penawaran',
			label: 'Penawaran',
			href: '/sales/penawaran',
			icon: IconFileDollar,
			badge: null,
			badgeColor: ''
		},
		{
			id: 'po',
			label: 'PO Customer',
			href: '/sales/po',
			icon: IconFileUpload,
			badge: poCount > 0 ? poCount : null,
			badgeColor: 'bg-rose-500 text-white'
		},
		{
			id: 'sample',
			label: 'Sample Cat',
			href: '/sales/sample-request',
			icon: IconFlask,
			badge: sampleApprovalCount > 0 ? sampleApprovalCount : null,
			badgeColor: 'bg-amber-500 text-white'
		}
	]);
</script>

<div class="w-full mb-4">
	<div class="flex items-center gap-1.5 overflow-x-auto pb-1.5 no-scrollbar -mx-1 px-1">
		{#each tabs as tab (tab.id)}
			{@const isActive = active === tab.id}
			{@const Icon = tab.icon}
			<button
				type="button"
				class="shrink-0 h-9 px-3 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 transition-all active:scale-95 {isActive
					? 'bg-[var(--p,var(--g))] text-white shadow-sm shadow-[var(--p,var(--g))]/25 font-bold'
					: 'border hover:bg-black/5 dark:hover:bg-white/5'}"
				style={!isActive ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label2)' : ''}
				onclick={() => goto(tab.href)}
			>
				<Icon size={14} class={isActive ? 'text-white' : 'opacity-70'} />
				<span>{tab.label}</span>
				{#if tab.badge}
					<span class="text-[9px] font-extrabold px-1.5 py-0.2 rounded-full {tab.badgeColor}">
						{tab.badge}
					</span>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
