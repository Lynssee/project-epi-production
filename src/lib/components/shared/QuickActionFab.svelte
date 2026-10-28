<!-- src/lib/components/shared/QuickActionFab.svelte -->
<!-- L3 "Quick Action Shortcuts" (rencana Personal Admin Dashboard, Fase 2 Lapangan, 25 Agu
     2026): FAB speed-dial mobile ke aksi tersering — Absensi, Laporan Harian, P2H,
     Requisition, Ajukan PA, Scan QR — supaya tidak tergantung urutan/slot bottom nav yang dipotong 4 item
     pertama (lihat baseNavItems.slice(0,4) di (app)/+layout.svelte, bisa menyembunyikan
     Absensi/Laporan di balik menu Hamburger untuk role tertentu).

     Ditaruh di KIRI (left-4) supaya tidak tumpang tindih dengan tombol Scan Universal
     (right-4, khusus role GA/Security) yang sudah ada di layout. Item difilter per-role
     lewat canView() yang direplikasi persis dari (app)/+layout.svelte -- fungsi itu tidak
     diekspor, jadi dependency (authStore, rolesStore, hasPermission) diimpor ulang di sini. -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import QrScannerModal from '$lib/components/scanner/QrScannerModal.svelte';
	// Import per-ikon (bukan barrel), sama seperti (app)/+layout.svelte -- supaya tidak semua
	// ikon Tabler masuk bundel awal.
	import IconPlus from '@tabler/icons-svelte/icons/plus';
	import IconX from '@tabler/icons-svelte/icons/x';
	import IconClock from '@tabler/icons-svelte/icons/clock';
	import IconClipboardList from '@tabler/icons-svelte/icons/clipboard-list';
	import IconClipboardCheck from '@tabler/icons-svelte/icons/clipboard-check';
	import IconPackage from '@tabler/icons-svelte/icons/package';
	import IconQrcode from '@tabler/icons-svelte/icons/qrcode';
	import IconFileInvoice from '@tabler/icons-svelte/icons/file-invoice';

	let expanded = $state(false);
	let showScanner = $state(false);

	function canView(permissions?: FeatureKey[]): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some((p) => hasPermission($authStore.roleId, p, $rolesStore, $authStore.roleIds));
	}

	function go(href: string) {
		expanded = false;
		goto(href);
	}

	function onScanDetect(code: string) {
		showScanner = false;
		expanded = false;
		goto(`/scan/${encodeURIComponent(code)}`);
	}

	const allActions = [
		{ key: 'absen', label: 'Absensi', icon: IconClock, permissions: ['access_ess'] as FeatureKey[], action: () => go('/ess/absen') },
		{ key: 'laporan', label: 'Laporan Harian', icon: IconClipboardList, permissions: ['input_laporan', 'approve_laporan'] as FeatureKey[], action: () => go('/laporan') },
		{ key: 'p2h', label: 'P2H', icon: IconClipboardCheck, permissions: ['input_maintenance'] as FeatureKey[], action: () => go('/preventive') },
		{ key: 'requisition', label: 'Requisition', icon: IconPackage, permissions: ['view_stock_lapangan', 'input_stock_lapangan'] as FeatureKey[], action: () => go('/requisition') },
		// Rencana Pertajam ERP L2 (12 Okt 2026): pembuat pengajuan saja ('request_budget'), sama seperti izin menu Anggaran
		// tanpa 'approve_budget' -- approver murni tidak butuh pintasan membuat PA.
		{ key: 'ajukan-pa', label: 'Ajukan PA', icon: IconFileInvoice, permissions: ['request_budget'] as FeatureKey[], action: () => go('/anggaran/baru') },
		{
			key: 'scan',
			label: 'Scan QR',
			icon: IconQrcode,
			permissions: [] as FeatureKey[],
			action: () => {
				expanded = false;
				showScanner = true;
			}
		}
	];

	let actions = $derived(allActions.filter((a) => canView(a.permissions)));
</script>

{#if actions.length > 0}
	<div class="lg:hidden fixed left-4 bottom-[76px] z-40 flex flex-col items-start gap-2.5">
		{#if expanded}
			{#each actions as a (a.key)}
				<button
					type="button"
					onclick={a.action}
					class="flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-full shadow-lg bg-white dark:bg-slate-800 border transition-transform active:scale-95"
					style="border-color: var(--sys-sep)"
				>
					<span class="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0" style="background: var(--g)">
						<a.icon size={18} />
					</span>
					<span class="text-[12px] font-bold whitespace-nowrap" style="color: var(--sys-label)">{a.label}</span>
				</button>
			{/each}
		{/if}

		<button
			type="button"
			onclick={() => (expanded = !expanded)}
			class="w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform active:scale-95"
			style="background: var(--p)"
			title="Aksi Cepat"
			aria-label="Aksi Cepat"
		>
			{#if expanded}
				<IconX size={22} />
			{:else}
				<IconPlus size={22} />
			{/if}
		</button>
	</div>

	{#if expanded}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="lg:hidden fixed inset-0 z-30" onclick={() => (expanded = false)}></div>
	{/if}

	{#if showScanner}
		<QrScannerModal onDetect={onScanDetect} onClose={() => (showScanner = false)} />
	{/if}
{/if}
