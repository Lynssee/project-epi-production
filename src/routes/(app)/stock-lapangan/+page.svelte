<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getRiwayat, STOCK_LAPANGAN_CATEGORY, type StockTransactionRow } from '$lib/services/stockLapangan';
	import { getAntrianList } from '$lib/services/gudangAntrian';
	import { loadInventorySettings, getInventorySetting } from '$lib/services/inventorySettings';
	import { resolveItemLajur } from '$lib/services/persiapanProgress';
	import { SectionGuide } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { stockLapanganHints } from '$lib/data/hints/stockLapangan';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul Stock Lapangan; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(stockLapanganHints, key, 'stock-lapangan');
	import { parseEpiQr } from '$lib/utils/qrParse';
	import {
		IconStack2, IconClipboardList, IconTruck, IconPackageExport,
		IconClipboardCheck, IconHistory, IconChevronRight, IconLoader2, IconAlertTriangle,
		IconListDetails, IconQrcode, IconMapPin, IconArrowsExchange
	} from '@tabler/icons-svelte';

	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	let showScanner = $state(false);
	let scanNotFound = $state('');

	async function onScanDetect(raw: string) {
		const parsed = parseEpiQr(raw);
		showScanner = false;
		if (!parsed) {
			scanNotFound = 'QR tidak dikenali.';
			return;
		}
		if (parsed.type !== 'ITEM') {
			// Tipe lain (SJ/PJM/SJI/LOC/BATCH/SOP) — pakai resolver generik yang sudah ada.
			goto(`/scan/${encodeURIComponent(raw)}`);
			return;
		}
		const lajur = await resolveItemLajur(parsed.id);
		if (lajur === 'bahan_baku_spk') goto(`/stock-lapangan/persiapan/bahan-baku?itemId=${parsed.id}`);
		else if (lajur === 'finish_good') goto(`/stock-lapangan/persiapan/finish-good?itemId=${parsed.id}`);
		else scanNotFound = 'Barang ini tidak ada di antrian persiapan manapun saat ini.';
	}

	let canAccess = $derived(
		hasPermission($authStore.roleId, 'input_stock_lapangan', $rolesStore) ||
		hasPermission($authStore.roleId, 'view_stock_lapangan', $rolesStore)
	);

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !canAccess) goto('/');
	});

	let loading = $state(true);
	let todayRows = $state<StockTransactionRow[]>([]);
	let gudangHqEnabled = $state(false);
	let antrianCount = $state(0);
	// SJ-06: kartu "Cek Barang Kirim" — hanya untuk PL / staf backup / admin; badge = SJ yang perlu dicek.
	let verifBisa = $state(false);
	let verifCount = $state(0);

	let todayCounts = $derived.by(() => {
		const counts = { masuk: 0, output: 0, opname: 0 };
		for (const row of todayRows) {
			if (row.categoryTransaction === STOCK_LAPANGAN_CATEGORY.FIELD_RECEIPT) counts.masuk++;
			else if (row.categoryTransaction === STOCK_LAPANGAN_CATEGORY.PRODUCTION_OUTPUT) counts.output++;
			else if (row.categoryTransaction === STOCK_LAPANGAN_CATEGORY.OPNAME_ADJ) counts.opname++;
		}
		return counts;
	});

	onMount(async () => {
		fetch('/api/lacak-sj?count_only=1').then((r) => (r.ok ? r.json() : null)).then((d) => {
			if (d) { verifBisa = !!d.bisa_verifikasi; verifCount = Number(d.perlu_verifikasi_count) || 0; }
		}).catch((e) => console.error('[stock-lapangan] gagal memuat jumlah SJ perlu cek:', e));
		try {
			const rows = await getRiwayat({ limit: 200 });
			const todayStr = new Date().toISOString().split('T')[0];
			todayRows = rows.filter((r) => (r.transactionDate || '').startsWith(todayStr));

			await loadInventorySettings();
			gudangHqEnabled = getInventorySetting('inventory.gudang_hq.enabled');
			if (gudangHqEnabled) {
				const antrian = await getAntrianList();
				antrianCount = antrian.length;
			}
		} finally {
			loading = false;
		}
	});

	let menuItems = $derived([
		...(gudangHqEnabled
			? [{ href: '/stock-lapangan/antrian', label: 'Antrian Gudang Pusat', icon: IconListDetails, desc: 'Packing list yang perlu disiapkan', badge: antrianCount }]
			: []),
		{ href: '/stock-lapangan/persiapan', label: 'Persiapan', icon: IconClipboardList, desc: 'Bahan baku, finish good & packing list' },
		...(verifBisa ? [{ href: '/lacak-sj?stage=perlu_verifikasi', label: 'Cek Barang Kirim', icon: IconClipboardCheck, desc: 'Cocokkan barang di gudang dengan SJ sebelum dicetak', badge: verifCount || undefined }] : []),
		{ href: '/stock-lapangan/masuk', label: 'Barang Masuk', icon: IconTruck, desc: 'Catat penerimaan barang' },
		{ href: '/stock-lapangan/output', label: 'Hasil Produksi', icon: IconPackageExport, desc: 'Catat finish good' },
		{ href: '/stock-lapangan/opname-sesi', label: 'Tugas Opname Saya', icon: IconClipboardCheck, desc: 'Hitung fisik untuk sesi opname dari admin' },
		{ href: '/stock-lapangan/opname', label: 'Opname Harian', icon: IconClipboardCheck, desc: 'Hitung fisik vs sistem' },
		{ href: '/stock-lapangan/komplain', label: 'Komplain Barang', icon: IconAlertTriangle, desc: 'Lapor mutu/salah barang setelah diterima' },
		{ href: '/stock-lapangan/cek-area', label: 'Cek Area / Genba', icon: IconMapPin, desc: 'Verifikasi isi rak sesuai QR lokasi' },
		{ href: '/stock-lapangan/pindah-rak', label: 'Pindah Rak (dari Kiosk)', icon: IconArrowsExchange, desc: 'Rekap barang yang dipindah antar rak oleh tim gudang' }
	]);
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm">
		<div class="px-6 py-4 flex items-center justify-between">
			<div class="flex items-center gap-4">
				<div class="w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white">
					<IconStack2 size={24} />
				</div>
				<div>
					<h1 class="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-blue-600 tracking-tight">Stock Lapangan</h1>
					<p class="text-xs font-medium" style="color: var(--sys-label3)">Manajemen inventaris harian</p>
				</div>
			</div>
			<button
				class="w-11 h-11 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0"
				onclick={async () => { await loadQrScannerModal(); scanNotFound = ''; showScanner = true; }}
				aria-label="Scan QR"
			>
				<IconQrcode size={20} />
			</button>
		</div>
	</div>

	{#if showScanner && QrScannerModal}
		<QrScannerModal expectedPrefix="EPI:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
	{/if}
	{#if scanNotFound}
		<div class="px-4 pt-2">
			<p class="text-[11px] text-center" style="color: #DC2626">{scanNotFound}</p>
		</div>
	{/if}

	<div class="flex-1 overflow-y-auto px-4 sm:px-6 py-6 pb-24">
		<div class="max-w-5xl mx-auto w-full">
			<SectionGuide
				id="stockLapangan.menu.page"
				title={h('menu.page').sectionGuide?.title}
				steps={h('menu.page').sectionGuide?.steps ?? []}
			/>

			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
				{#each menuItems as item}
					<button
						class="glass-panel hover-lift rounded-2xl p-5 flex flex-col items-start gap-4 text-left border border-white/50 shadow-sm group focus:outline-none relative overflow-hidden"
						onclick={() => goto(item.href)}
					>
						<div class="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl -mr-8 -mt-8 transition-opacity group-hover:opacity-100"></div>
						<div class="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shadow-sm text-blue-600 group-hover:scale-110 transition-transform relative z-10">
							<item.icon size={24} />
							{#if item.badge}
								<span class="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9.5px] font-bold flex items-center justify-center">{item.badge}</span>
							{/if}
						</div>
						<div class="relative z-10">
							<p class="text-base font-bold mb-1" style="color: var(--sys-label)">{item.label}</p>
							<p class="text-xs font-medium" style="color: var(--sys-label3)">{item.desc}</p>
						</div>
					</button>
				{/each}
			</div>

			<div class="flex items-center gap-2 mb-4 px-2">
				<div class="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
					<IconHistory size={18} class="text-blue-600" />
				</div>
				<h2 class="text-lg font-bold" style="color: var(--sys-label)">Ringkasan Hari Ini</h2>
			</div>

			<div class="glass-panel rounded-3xl p-6 mb-6 border border-white/50 shadow-sm relative overflow-hidden">
				<div class="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent pointer-events-none"></div>
				
				<div class="flex items-center justify-between gap-4 relative z-10">
					{#if loading}
						<div class="w-full py-4 flex justify-center">
							<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Ringkasan..." sublabel="Sinkronisasi mutasi hari ini" />
						</div>
					{:else}
						<div class="text-center flex-1">
							<div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 border border-slate-200 shadow-inner">
								<p class="text-2xl font-black text-sky-600">{todayCounts.masuk}</p>
							</div>
							<p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Masuk</p>
						</div>
						
						<div class="text-center flex-1">
							<div class="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-2 border border-emerald-200 shadow-inner">
								<p class="text-2xl font-black text-emerald-600">{todayCounts.output}</p>
							</div>
							<p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Output</p>
						</div>
						
						<div class="text-center flex-1">
							<div class="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-2 border border-amber-200 shadow-inner">
								<p class="text-2xl font-black text-amber-600">{todayCounts.opname}</p>
							</div>
							<p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Opname</p>
						</div>
					{/if}
				</div>
			</div>

			<button
				class="w-full glass-panel hover-lift h-16 rounded-2xl flex items-center justify-between px-5 group focus:outline-none border border-white/50 shadow-sm"
				onclick={() => goto('/stock-lapangan/riwayat')}
			>
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
						<IconHistory size={20} class="text-slate-600 group-hover:text-blue-600" />
					</div>
					<span class="text-sm font-bold" style="color: var(--sys-label)">Lihat Riwayat & Antrian</span>
				</div>
				<div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center transition-transform group-hover:translate-x-1">
					<IconChevronRight size={18} style="color: var(--sys-label4)" />
				</div>
			</button>
		</div>
	</div>
</div>
