<script lang="ts">
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import ModuleMenuGrid, { type MenuCategory } from '$lib/components/navigation/ModuleMenuGrid.svelte';
	import { getMyPoStatusSummary } from '$lib/services/salesPo';
	import { getMyProspectsWithFollowUps, getUpcomingFollowUps } from '$lib/services/sales';

	import {
		IconMapPin,
		IconUserSearch,
		IconPlus,
		IconAlertCircle,
		IconHeartHandshake,
		IconBuildingStore,
		IconFileUpload,
		IconClipboardList,
		IconClipboardCheck,
		IconFileDollar,
		IconFlask,
		IconTruckDelivery,
		IconChevronRight,
		IconSparkles
	} from '@tabler/icons-svelte';
	const IconHandshake = IconHeartHandshake;

	let poNeedsAttention = $state(0);
	let activeProspectsCount = $state(0);
	let upcomingFollowupsCount = $state(0);
	let showSopHint = $state(false);

	onMount(async () => {
		const karyawanId = $authStore.karyawanId;
		const salesName = $authStore.karyawanName;
		try {
			const [summaryRes, prospectsRes, followupsRes] = await Promise.allSettled([
				karyawanId ? getMyPoStatusSummary(karyawanId) : Promise.resolve({}),
				getMyProspectsWithFollowUps(salesName),
				getUpcomingFollowUps(salesName)
			]);

			if (summaryRes.status === 'fulfilled') {
				const summary = summaryRes.value as any;
				poNeedsAttention = (summary.belum_ada || 0) + (summary.revisi || 0);
			}
			if (prospectsRes.status === 'fulfilled') {
				const prospects = prospectsRes.value as any[];
				activeProspectsCount = prospects.filter((p) => p.stage !== 'won' && p.stage !== 'lost').length;
			}
			if (followupsRes.status === 'fulfilled') {
				const followups = followupsRes.value as any[];
				upcomingFollowupsCount = followups.length;
			}
		} catch {}
	});

	function canView(permissions?: FeatureKey[], roles?: string[]): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		if (roles && roles.length > 0 && !roles.includes($authStore.roleId || '')) return false;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some((p) => hasPermission($authStore.roleId, p, $rolesStore, $authStore.roleIds));
	}

	let categories: MenuCategory[] = $derived([
		{
			title: 'Aktivitas Sales Lapangan',
			items: [
				{
					id: 'sales-log',
					label: 'Log Kunjungan Sales',
					desc: 'Daftar riwayat kunjungan & status verifikasi',
					href: '/sales',
					icon: IconMapPin,
					show: canView(['input_sales'])
				},
				{
					id: 'sales-prospek',
					label: 'Pipeline Prospek',
					desc: 'Pipeline & follow-up prospek klien CRM',
					href: '/sales/prospek',
					icon: IconUserSearch,
					show: canView(['input_sales'])
				},
				{
					id: 'sales-laporan',
					label: 'Laporan Harian',
					desc: 'Rekap aktivitas harian & capaian omzet',
					href: '/sales/laporan-harian',
					icon: IconClipboardList,
					show: canView(['input_sales'])
				},
				{
					id: 'sales-survey',
					label: 'Survey Lokasi',
					desc: 'Data teknis, utilitas & dokumentasi lapangan',
					href: '/sales/survey',
					icon: IconClipboardCheck,
					show: canView(['input_sales'])
				},
				{
					id: 'sales-penawaran',
					label: 'Kalkulator Penawaran',
					desc: 'Kalkulasi harga blasting, coating & RAB',
					href: '/sales/penawaran',
					icon: IconFileDollar,
					show: canView(['input_sales'])
				},
				{
					id: 'sales-po',
					label: 'PO Customer',
					desc: 'Unggah dokumen PO langsung dari lokasi customer',
					href: '/sales/po',
					icon: IconFileUpload,
					badge: poNeedsAttention,
					show: canView(['input_sales'])
				},
				{
					id: 'sales-baru',
					label: 'Input Kunjungan Baru',
					desc: 'Check-in kunjungan lapangan dengan GPS',
					href: '/sales/baru',
					icon: IconPlus,
					show: canView(['input_sales'])
				},
				{
					id: 'komplain-customer',
					label: 'Komplain Customer',
					desc: 'Laporan feedback & keluhan customer',
					href: '/komplain-customer',
					icon: IconAlertCircle,
					show: canView(['input_komplain_customer'])
				}
			]
		},
		{
			title: 'Kemitraan & Program',
			items: [
				{
					id: 'kemitraan',
					label: 'Kemitraan & Atribusi',
					desc: 'Database mitra & program kemitraan',
					href: '/kemitraan',
					icon: IconHandshake,
					show: canView(['view_all_projects', 'input_sales'])
				},
				{
					id: 'csr',
					label: 'CSR & TJSL',
					desc: 'Kegiatan tanggung jawab sosial & lingkungan',
					href: '/csr',
					icon: IconHeartHandshake,
					show: canView(['access_csr'])
				}
			]
		}
	]);
</script>

<svelte:head>
	<title>Hub Sales & Marketing — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400">
				<IconBuildingStore size={26} />
			</div>
			<div>
				<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Hub Sales & Marketing</h1>
				<p class="text-xs md:text-sm font-medium mt-0.5" style="color: var(--sys-label3)">
					Kunjungan sales, pipeline prospek, survey lokasi, kalkulator penawaran & PO
				</p>
			</div>
		</div>
	</div>

	<!-- Alert PO Perlu Perhatian -->
	{#if poNeedsAttention > 0}
		<a
			href="/sales/po"
			class="mb-5 p-3.5 rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/40 flex items-center justify-between gap-3 text-rose-800 dark:text-rose-200 transition-all hover:shadow-xs active:scale-[0.99]"
		>
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center shrink-0 text-rose-600 dark:text-rose-400">
					<IconAlertCircle size={22} />
				</div>
				<div>
					<p class="text-xs sm:text-sm font-bold">Ada {poNeedsAttention} SO Membutuhkan Dokumen / Revisi PO</p>
					<p class="text-[11px] text-rose-600 dark:text-rose-400">Segera lengkapi atau perbaiki dokumen PO agar pekerjaan dapat diteruskan ke workshop/pabrik.</p>
				</div>
			</div>
			<div class="flex items-center gap-1 text-xs font-bold shrink-0 bg-rose-600 text-white px-3 py-1.5 rounded-xl">
				<span>Buka PO</span>
				<IconChevronRight size={14} />
			</div>
		</a>
	{/if}

	<!-- Customer Journey & Pipeline Estafet (6 Langkah Hulu ke Hilir) -->
	<div class="mb-6 p-4 rounded-3xl border shadow-xs" style="border-color: var(--sys-sep); background: var(--sys-bg-card, var(--sys-bg))">
		<div class="flex items-center justify-between gap-2 mb-3">
			<div class="flex items-center gap-2">
				<div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
					<IconSparkles size={18} />
				</div>
				<div>
					<h2 class="text-xs sm:text-sm font-bold" style="color: var(--sys-label)">Estafet Siklus Penjualan (Customer Journey)</h2>
					<p class="text-[10.5px]" style="color: var(--sys-label3)">Alur standar hulu-ke-hilir untuk sales lapangan</p>
				</div>
			</div>
			<button
				type="button"
				onclick={() => (showSopHint = !showSopHint)}
				class="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
			>
				<span>{showSopHint ? 'Tutup Panduan' : '💡 Panduan SOP'}</span>
			</button>
		</div>

		{#if showSopHint}
			<div class="mb-3 p-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 text-blue-900 dark:text-blue-200 text-[11px] leading-relaxed">
				<strong>Tips Efisiensi Lapangan:</strong> Setelah selesai melakukan check-in visit atau survey, buka detail prospek terkait untuk menggunakan tombol <em>1-Tap Action</em>. Sistem akan otomatis mengisi nama customer, PIC, telepon, dan lokasi sehingga Anda tidak perlu mengetik ulang saat membuat SPH atau request sample.
			</div>
		{/if}

		<!-- Stepper Horizontal 6 Langkah -->
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
			<a
				href="/sales/prospek"
				class="p-2.5 rounded-2xl border transition-all hover:border-blue-500 active:scale-[0.98] flex flex-col justify-between"
				style="border-color: var(--sys-sep); background: var(--sys-fill)"
			>
				<div class="flex items-center justify-between text-[10px] font-bold text-gray-400 mb-1">
					<span>TAHAP 1</span>
					{#if activeProspectsCount > 0}
						<span class="px-1.5 py-0.2 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono">{activeProspectsCount}</span>
					{/if}
				</div>
				<div class="flex items-center gap-1.5 mb-1 text-blue-600 dark:text-blue-400 font-bold text-xs">
					<IconUserSearch size={15} />
					<span>Prospek CRM</span>
				</div>
				<p class="text-[10px] line-clamp-1" style="color: var(--sys-label3)">Inbound &amp; Follow-up</p>
			</a>

			<a
				href="/sales/baru"
				class="p-2.5 rounded-2xl border transition-all hover:border-emerald-500 active:scale-[0.98] flex flex-col justify-between"
				style="border-color: var(--sys-sep); background: var(--sys-fill)"
			>
				<div class="flex items-center justify-between text-[10px] font-bold text-gray-400 mb-1">
					<span>TAHAP 2</span>
					<span class="text-emerald-500">GPS</span>
				</div>
				<div class="flex items-center gap-1.5 mb-1 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
					<IconMapPin size={15} />
					<span>Visit Lapangan</span>
				</div>
				<p class="text-[10px] line-clamp-1" style="color: var(--sys-label3)">Check-in &amp; Diskusi</p>
			</a>

			<a
				href="/sales/survey"
				class="p-2.5 rounded-2xl border transition-all hover:border-indigo-500 active:scale-[0.98] flex flex-col justify-between"
				style="border-color: var(--sys-sep); background: var(--sys-fill)"
			>
				<div class="flex items-center justify-between text-[10px] font-bold text-gray-400 mb-1">
					<span>TAHAP 3</span>
					<span class="text-indigo-500">Teknis</span>
				</div>
				<div class="flex items-center gap-1.5 mb-1 text-indigo-600 dark:text-indigo-400 font-bold text-xs">
					<IconClipboardCheck size={15} />
					<span>Survey / Sample</span>
				</div>
				<p class="text-[10px] line-clamp-1" style="color: var(--sys-label3)">Spek &amp; Uji Lapangan</p>
			</a>

			<a
				href="/sales/penawaran"
				class="p-2.5 rounded-2xl border transition-all hover:border-amber-500 active:scale-[0.98] flex flex-col justify-between"
				style="border-color: var(--sys-sep); background: var(--sys-fill)"
			>
				<div class="flex items-center justify-between text-[10px] font-bold text-gray-400 mb-1">
					<span>TAHAP 4</span>
					<span class="text-amber-500">RAB</span>
				</div>
				<div class="flex items-center gap-1.5 mb-1 text-amber-600 dark:text-amber-400 font-bold text-xs">
					<IconFileDollar size={15} />
					<span>Kalkulator SPH</span>
				</div>
				<p class="text-[10px] line-clamp-1" style="color: var(--sys-label3)">Hitung Margin &amp; Kirim</p>
			</a>

			<a
				href="/sales/po"
				class="p-2.5 rounded-2xl border transition-all hover:border-purple-500 active:scale-[0.98] flex flex-col justify-between"
				style="border-color: var(--sys-sep); background: var(--sys-fill)"
			>
				<div class="flex items-center justify-between text-[10px] font-bold text-gray-400 mb-1">
					<span>TAHAP 5</span>
					{#if poNeedsAttention > 0}
						<span class="px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-mono">{poNeedsAttention}</span>
					{/if}
				</div>
				<div class="flex items-center gap-1.5 mb-1 text-purple-600 dark:text-purple-400 font-bold text-xs">
					<IconFileUpload size={15} />
					<span>PO &amp; Approval</span>
				</div>
				<p class="text-[10px] line-clamp-1" style="color: var(--sys-label3)">Unggah Bukti Resmi</p>
			</a>

			<a
				href="/sales/po"
				class="p-2.5 rounded-2xl border transition-all hover:border-teal-500 active:scale-[0.98] flex flex-col justify-between"
				style="border-color: var(--sys-sep); background: var(--sys-fill)"
			>
				<div class="flex items-center justify-between text-[10px] font-bold text-gray-400 mb-1">
					<span>TAHAP 6</span>
					<span class="text-teal-500">Hilir</span>
				</div>
				<div class="flex items-center gap-1.5 mb-1 text-teal-600 dark:text-teal-400 font-bold text-xs">
					<IconTruckDelivery size={15} />
					<span>Kirim &amp; Faktur</span>
				</div>
				<p class="text-[10px] line-clamp-1" style="color: var(--sys-label3)">Surat Jalan &amp; AR</p>
			</a>
		</div>

		<!-- 1-Tap Quick Action Launcher -->
		<div class="pt-3 border-t flex items-center justify-between gap-2 flex-wrap" style="border-color: var(--sys-sep)">
			<span class="text-[11px] font-bold uppercase tracking-wider text-gray-400">⚡ 1-Tap Aksi Cepat:</span>
			<div class="flex items-center gap-2 flex-wrap">
				<a
					href="/sales/baru"
					class="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold text-xs hover:bg-emerald-500/20 flex items-center gap-1 transition-colors"
				>
					<IconPlus size={14} />
					<span>Check-in Visit GPS</span>
				</a>
				<a
					href="/sales/survey/baru"
					class="px-3 py-1.5 rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300 font-bold text-xs hover:bg-blue-500/20 flex items-center gap-1 transition-colors"
				>
					<IconClipboardCheck size={14} />
					<span>Input Survey Lokasi</span>
				</a>
				<a
					href="/sales/sample-request"
					class="px-3 py-1.5 rounded-xl bg-purple-500/10 text-purple-700 dark:text-purple-300 font-bold text-xs hover:bg-purple-500/20 flex items-center gap-1 transition-colors"
				>
					<IconFlask size={14} />
					<span>Request Sample Cat</span>
				</a>
				<a
					href="/sales/penawaran/baru"
					class="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-xs hover:bg-amber-500/20 flex items-center gap-1 transition-colors"
				>
					<IconFileDollar size={14} />
					<span>Kalkulator Penawaran</span>
				</a>
				<a
					href="/sales/po"
					class="px-3 py-1.5 rounded-xl bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-bold text-xs hover:bg-indigo-500/20 flex items-center gap-1 transition-colors"
				>
					<IconFileUpload size={14} />
					<span>Unggah PO Customer</span>
				</a>
			</div>
		</div>
	</div>

	<ModuleMenuGrid {categories} />
</div>
