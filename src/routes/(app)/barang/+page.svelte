<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore, getUserDisplay } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import { fetchMyPengajuan } from '$lib/services/procurementApi';
	import ModuleMenuGrid, { type MenuCategory } from '$lib/components/navigation/ModuleMenuGrid.svelte';

	import IconStack2 from '@tabler/icons-svelte/icons/stack-2';
	import IconPackage from '@tabler/icons-svelte/icons/package';
	import IconReceipt2 from '@tabler/icons-svelte/icons/receipt-2';
	import IconTruck from '@tabler/icons-svelte/icons/truck';
	import IconChartBar from '@tabler/icons-svelte/icons/chart-bar';
	import IconScan from '@tabler/icons-svelte/icons/scan';
	import IconClipboardList from '@tabler/icons-svelte/icons/clipboard-list';
	import IconFileText from '@tabler/icons-svelte/icons/file-text';
	import IconSteeringWheel from '@tabler/icons-svelte/icons/steering-wheel';
	import IconChecklist from '@tabler/icons-svelte/icons/checklist';
	import IconBoxCheck from '@tabler/icons-svelte/icons/box-align-bottom';
	import IconArrowBackUp from '@tabler/icons-svelte/icons/arrow-back-up';
	import IconTool from '@tabler/icons-svelte/icons/tool';
	import { getIdToken } from '$lib/services/secureDirectus';

	// §7 Rekomendasi L2/L3 (Fase 4, rencana "Pengeluaran Barang Terpusat v2"): kartu
	// "Kiriman menuju proyek saya" (SJ material proyek "Barang Dalam Perjalanan") + badge
	// "alat belum kembali" di kartu Pinjaman. Reuse fungsi yang SUDAH ADA
	// (fetchInTransitShipments di goodsReceived.ts, fetchReturAlertCount di packingList.ts)
	// -- tidak ada query/API baru.
	let kirimanTransit = $state<any[]>([]);
	let alatBelumKembali = $state(0);

	async function loadKirimanTransit() {
		try {
			// fetchInTransitShipments() SUDAH tepat scope-nya: SJ material proyek berstatus
			// "Barang Dalam Perjalanan" untuk proyek leader yang login (1 panggilan API,
			// dipakai juga oleh /stock-lapangan/masuk). Tidak perlu query/API baru.
			const { fetchInTransitShipments } = await import('$lib/services/goodsReceived');
			kirimanTransit = await fetchInTransitShipments();
		} catch {
			/* diam-diam — kartu ringkasan, bukan alur utama */
		}
	}

	async function loadAlatBelumKembali() {
		try {
			const { getProjectsForCurrentUser } = await import('$lib/services/projectScope');
			const { fetchReturAlertCount } = await import('$lib/services/packingList');
			const projects = await getProjectsForCurrentUser(false);
			const r = await fetchReturAlertCount((projects || []).map((p: any) => p.id));
			alatBelumKembali = r.overdueEquipment;
		} catch {
			/* diam-diam — badge, bukan alur utama */
		}
	}

	// BK Gate v2 Fase 7 — "Kiriman ke Saya" & "Lembar yang Harus Dikembalikan".
	let rangkapSaya = $state<{ kiriman: any[]; kembalikan: any[] }>({ kiriman: [], kembalikan: [] });

	async function loadRangkapSaya() {
		try {
			const token = await getIdToken();
			const res = await fetch('/api/barang/rangkap-saya', { headers: { Authorization: `Bearer ${token}` } });
			if (res.ok) rangkapSaya = await res.json();
		} catch {
			/* diam-diam — bukan bagian utama layar hub */
		}
	}

	function canView(permissions?: FeatureKey[], roles?: string[]): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		if (roles && roles.length > 0 && !roles.includes($authStore.roleId || '')) return false;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some((p) => hasPermission($authStore.roleId, p, $rolesStore, $authStore.roleIds));
	}

	let badges = $state<Record<string, number>>({});

	// SJ-06: kartu "Cek Barang Kirim" (verifikasi fisik SJ proyek). Tampil hanya untuk PL / staf backup / admin; badge = jumlah SJ yang perlu dicek.
	let verifBisa = $state(false);
	let verifCount = $state(0);
	onMount(async () => {
		try {
			const res = await fetch('/api/lacak-sj?count_only=1');
			if (!res.ok) return;
			const d = await res.json();
			verifBisa = !!d.bisa_verifikasi;
			verifCount = Number(d.perlu_verifikasi_count) || 0;
		} catch (e) {
			console.error('[barang] gagal memuat jumlah SJ perlu cek:', e);
		}
	});

	onMount(async () => {
		if (!canView(['submit_pengajuan_pembelian'], ['leader'])) return;
		try {
			const namaPengaju = getUserDisplay($authStore.user);
			if (!namaPengaju) return;
			const rows = await fetchMyPengajuan(namaPengaju);
			const aktif = rows.filter((r) => r.status !== 'Barang Diterima & Lunas').length;
			badges = { ...badges, pengajuanAktif: aktif };
		} catch {
			// Diam-diam gagal
		}
		loadRangkapSaya();
		loadKirimanTransit();
		loadAlatBelumKembali();
	});

	let categories: MenuCategory[] = $derived([
		{
			title: 'Stok & Lapangan',
			items: [
				{
					id: 'stok-lapangan',
					label: 'Stok Lapangan',
					desc: 'Persiapan, masuk, output, opname & riwayat',
					href: '/stock-lapangan',
					icon: IconStack2,
					show: canView(['view_stock_lapangan', 'input_stock_lapangan'])
				},
				{
					id: 'requisition',
					label: 'Requisition Proyek',
					desc: 'Permintaan material & kebutuhan proyek',
					href: '/requisition',
					icon: IconClipboardList,
					show: canView(['access_requisition'])
				},
				{
					id: 'field-report',
					label: 'Ringkasan Barang',
					desc: 'Dashboard pergerakan material & kebutuhan urgent',
					href: '/field-report',
					icon: IconChartBar,
					show: canView(['view_field_report'])
				}
			]
		},
		{
			title: 'Pengiriman & Logistik',
			items: [
				{
					id: 'packing-list',
					label: 'Packing List',
					desc: 'Ajukan & lacak pengiriman barang proyek',
					href: '/packing-list',
					icon: IconPackage,
					show: canView(['manage_packing'])
				},
				{
					id: 'picking-barcode',
					label: 'Picking Barcode',
					desc: 'Scan & ambil barang sesuai permintaan',
					href: '/packing-list/pick',
					icon: IconScan,
					show: canView(['manage_inventory_picking'])
				},
				{
					id: 'sji',
					label: 'Surat Jalan Internal',
					desc: 'Terima & konfirmasi kiriman antar lokasi',
					href: '/sji',
					icon: IconTruck,
					show: canView(['view_sji', 'input_sji'])
				},
				{
					id: 'cek-barang-kirim',
					label: 'Cek Barang Kirim',
					desc: 'Cocokkan barang di gudang dengan SJ sebelum dicetak',
					href: '/lacak-sj?stage=perlu_verifikasi',
					icon: IconChecklist,
					badge: verifCount > 0 ? verifCount : undefined,
					show: verifBisa
				},
				{
					id: 'sj-manual',
					label: 'Surat Jalan Manual',
					desc: 'Pembuatan surat jalan manual lapangan',
					href: '/sj-manual',
					icon: IconFileText,
					show: canView(['view_sji', 'input_sji'])
				},
				{
					id: 'driver',
					label: 'Driver App (Logistik)',
					desc: 'Pengantaran & delegasi trip logistik',
					href: '/driver',
					icon: IconSteeringWheel,
					show: canView(['access_driver'])
				},
				{
					// §7 Rekomendasi L1: route sudah ada (packing-list/return) tapi tak
					// terlihat dari hub — cuma dipindah ke sini, bukan fitur baru.
					id: 'packing-list-return',
					label: 'Retur ke Gudang',
					desc: 'Pakai ini bila barang sisa/rusak perlu dikembalikan ke gudang pusat',
					href: '/packing-list/return',
					icon: IconArrowBackUp,
					show: canView(['manage_packing']),
					badge: () => alatBelumKembali || 0
				},
				{
					// §7 Rekomendasi L1: idem — route sudah ada (maintenance/pinjaman-saya).
					id: 'pinjaman-saya',
					label: 'Pinjaman Alat Saya',
					desc: 'Pakai ini untuk lihat alat yang sedang Anda pinjam & batas kembalinya',
					href: '/maintenance/pinjaman-saya',
					icon: IconTool,
					show: canView([])
				}
			]
		},
		{
			title: 'Pengadaan & Pembelian',
			items: [
				{
					id: 'procurement',
					label: 'Ajukan Beli',
					desc: 'Pengajuan pembelian barang lapangan',
					href: '/procurement',
					icon: IconReceipt2,
					show: canView(['submit_pengajuan_pembelian']),
					badge: () => badges.pengajuanAktif || 0
				},
				{
					id: 'procurement-approval',
					label: 'Approval Pembelian',
					desc: 'Persetujuan pengajuan barang',
					href: '/procurement/approval',
					icon: IconChecklist,
					show: canView(['approve_pengajuan_pembelian'])
				},
				{
					id: 'procurement-terima',
					label: 'Konfirmasi Terima PO',
					desc: 'Penerimaan barang pembelian di lapangan',
					href: '/procurement/terima',
					icon: IconBoxCheck,
					show: canView(['terima_barang_po'])
				}
			]
		}
	]);
</script>

<svelte:head>
	<title>Hub Inventory & Logistik — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400">
				<IconPackage size={26} />
			</div>
			<div>
				<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Hub Barang & Logistik</h1>
				<p class="text-xs md:text-sm font-medium mt-0.5" style="color: var(--sys-label3)">
					Kebutuhan stok, pengiriman barang, dan logistik proyek
				</p>
			</div>
		</div>
	</div>

	{#if kirimanTransit.length > 0}
		<!-- §7 Rekomendasi L2: "Kiriman menuju proyek saya" -- SJ material proyek berstatus
		     "Barang Dalam Perjalanan", reuse fetchInTransitShipments() (dipakai juga oleh
		     /stock-lapangan/masuk). Konfirmasi terima jadi proaktif, bukan nunggu dicari manual. -->
		<button
			class="w-full text-left rounded-2xl p-4 mb-4 flex items-center justify-between gap-3"
			style="background: var(--sys-fill)"
			onclick={() => goto('/stock-lapangan/masuk')}
		>
			<div class="flex items-center gap-3 min-w-0">
				<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600">
					<IconTruck size={20} />
				</div>
				<div class="min-w-0">
					<p class="text-sm font-bold truncate" style="color: var(--sys-label)">
						Kiriman menuju proyek saya ({kirimanTransit.length})
					</p>
					<p class="text-xs truncate" style="color: var(--sys-label3)">
						Sedang dalam perjalanan — ketuk untuk konfirmasi terima saat tiba
					</p>
				</div>
			</div>
		</button>
	{/if}

	{#if rangkapSaya.kiriman.length > 0 || rangkapSaya.kembalikan.length > 0}
		<div class="grid gap-3 sm:grid-cols-2 mb-6">
			{#if rangkapSaya.kiriman.length > 0}
				<div class="rounded-2xl p-4" style="background: var(--sys-fill)">
					<div class="flex items-center gap-2 mb-2">
						<IconTruck size={18} class="text-blue-600" />
						<span class="text-sm font-bold" style="color: var(--sys-label)">Kiriman ke Saya ({rangkapSaya.kiriman.length})</span>
					</div>
					<div class="flex flex-col gap-1.5">
						{#each rangkapSaya.kiriman as k}
							<button class="w-full text-left rounded-lg p-2.5" style="background: var(--sys-bg)" onclick={() => goto(`/lacak-sj/${k.surat_jalan_id}`)}>
								<p class="text-xs font-semibold truncate" style="color: var(--sys-label)">{k.nomor_sj}</p>
								{#if k.tujuan}<p class="text-[10px] truncate" style="color: var(--sys-label3)">{k.tujuan}</p>{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}
			{#if rangkapSaya.kembalikan.length > 0}
				<div class="rounded-2xl p-4" style="background: var(--sys-fill)">
					<div class="flex items-center gap-2 mb-2">
						<IconFileText size={18} class="text-amber-600" />
						<span class="text-sm font-bold" style="color: var(--sys-label)">Lembar Harus Dikembalikan ({rangkapSaya.kembalikan.length})</span>
					</div>
					<div class="flex flex-col gap-1.5">
						{#each rangkapSaya.kembalikan as l}
							<button class="w-full text-left rounded-lg p-2.5" style="background: var(--sys-bg)" onclick={() => goto(`/lacak-sj/${l.surat_jalan_id}`)}>
								<p class="text-xs font-semibold truncate" style="color: var(--sys-label)">{l.nomor_sj} — {l.lembar}</p>
								{#if l.deadline_kembali}<p class="text-[10px]" style="color: var(--sys-label3)">Batas: {new Date(l.deadline_kembali).toLocaleDateString('id-ID')}</p>{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<ModuleMenuGrid {categories} />
</div>
