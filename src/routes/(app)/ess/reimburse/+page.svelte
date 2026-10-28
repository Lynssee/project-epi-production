<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getReimburseStatus, type ReimburseRecord } from '$lib/services/ess/reimburse';
	import { secureAssetSrc, openSecureAsset } from '$lib/actions/secureAsset';
	import {
		IconLoader2,
		IconPlus,
		IconAlertTriangle,
		IconFileExport,
		IconSearch,
		IconX,
		IconRotate2,
		IconReceipt,
		IconClock,
		IconCheck,
		IconEye,
		IconExternalLink,
		IconInfoCircle,
		IconChevronDown,
		IconChevronUp,
		IconCar,
		IconBriefcase,
		IconPhone,
		IconStethoscope,
		IconFileText,
		IconCalendar,
		IconCamera,
		IconShieldCheck,
		IconFilter
	} from '@tabler/icons-svelte';
	import EssExportSheet from '$lib/components/ess/EssExportSheet.svelte';

	let loading = $state(true);
	let refreshing = $state(false);
	let errorMsg = $state('');
	let riwayat = $state<ReimburseRecord[]>([]);

	// Filter & Search states
	let searchQuery = $state('');
	let statusFilter = $state<'all' | 'diajukan' | 'disetujui' | 'ditolak'>('all');
	let kategoriFilter = $state<string>('all');
	let sortBy = $state<'terbaru' | 'terlama' | 'tertinggi' | 'terendah'>('terbaru');

	// Detail Modal
	let detailModalRecord = $state<ReimburseRecord | null>(null);

	// Collapsible Guide
	let showGuide = $state(false);

	// Export Sheet
	let sheetOpen = $state(false);

	async function load(isRefresh = false) {
		if (isRefresh) refreshing = true;
		else loading = true;
		errorMsg = '';
		try {
			const res = await getReimburseStatus();
			riwayat = res.riwayat || [];
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data reimbursement.';
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	onMount(() => {
		load();
	});

	// Metrics Ringkasan (KPIs)
	const stats = $derived.by(() => {
		let approvedSum = 0;
		let approvedCount = 0;
		let pendingSum = 0;
		let pendingCount = 0;
		let rejectedCount = 0;
		let totalSum = 0;

		for (const r of riwayat) {
			const jml = Number(r.jumlah) || 0;
			totalSum += jml;
			const st = (r.status || '').toLowerCase();
			if (st === 'disetujui' || st === 'sudah dibayarkan') {
				approvedSum += jml;
				approvedCount++;
			} else if (st === 'ditolak') {
				rejectedCount++;
			} else {
				pendingSum += jml;
				pendingCount++;
			}
		}

		return {
			approvedSum,
			approvedCount,
			pendingSum,
			pendingCount,
			rejectedCount,
			totalSum,
			totalCount: riwayat.length
		};
	});

	// Filtered & Sorted Records
	const filteredRiwayat = $derived.by(() => {
		let list = riwayat;

		// Status filter
		if (statusFilter !== 'all') {
			list = list.filter((r) => {
				const st = (r.status || '').toLowerCase();
				if (statusFilter === 'diajukan') return st === 'diajukan' || st === 'pending';
				if (statusFilter === 'disetujui') return st === 'disetujui' || st === 'sudah dibayarkan';
				if (statusFilter === 'ditolak') return st === 'ditolak';
				return true;
			});
		}

		// Kategori filter
		if (kategoriFilter !== 'all') {
			list = list.filter((r) => r.kategori === kategoriFilter);
		}

		// Search query
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			list = list.filter((r) => {
				const kat = (r.kategori || '').toLowerCase();
				const cat = (r.catatan || '').toLowerCase();
				const jml = String(r.jumlah || '');
				const tgl = (r.tanggal_pengajuan || '').toLowerCase();
				const id = String(r.id || '').toLowerCase();
				return kat.includes(q) || cat.includes(q) || jml.includes(q) || tgl.includes(q) || id.includes(q);
			});
		}

		// Sorting
		return [...list].sort((a, b) => {
			if (sortBy === 'terbaru') {
				return (b.tanggal_pengajuan || '').localeCompare(a.tanggal_pengajuan || '');
			} else if (sortBy === 'terlama') {
				return (a.tanggal_pengajuan || '').localeCompare(b.tanggal_pengajuan || '');
			} else if (sortBy === 'tertinggi') {
				return (Number(b.jumlah) || 0) - (Number(a.jumlah) || 0);
			} else if (sortBy === 'terendah') {
				return (Number(a.jumlah) || 0) - (Number(b.jumlah) || 0);
			}
			return 0;
		});
	});

	function resetFilters() {
		searchQuery = '';
		statusFilter = 'all';
		kategoriFilter = 'all';
		sortBy = 'terbaru';
	}

	function statusColor(status: string) {
		const s = (status || '').toLowerCase();
		if (s === 'disetujui' || s === 'sudah dibayarkan') {
			return { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981', border: 'rgba(16, 185, 129, 0.3)' };
		}
		if (s === 'ditolak') {
			return { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444', border: 'rgba(239, 68, 68, 0.3)' };
		}
		return { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B', border: 'rgba(245, 158, 11, 0.3)' };
	}

	function getCategoryMeta(cat: string) {
		switch (cat) {
			case 'Transport':
				return { icon: IconCar, color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)' };
			case 'Perjalanan Dinas':
				return { icon: IconBriefcase, color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.12)' };
			case 'Kesehatan':
				return { icon: IconStethoscope, color: '#EC4899', bg: 'rgba(236, 72, 153, 0.12)' };
			case 'Komunikasi':
				return { icon: IconPhone, color: '#06B6D4', bg: 'rgba(6, 182, 212, 0.12)' };
			default:
				return { icon: IconReceipt, color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' };
		}
	}

	function formatRupiah(n: number) {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	function formatDate(dateStr: string) {
		if (!dateStr) return '-';
		const parts = dateStr.split('-');
		if (parts.length !== 3) return dateStr;
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${parseInt(parts[2])} ${monthNames[parseInt(parts[1]) - 1] || parts[1]} ${parts[0]}`;
	}

	// Export Data Definitions
	const exportColumns = [
		{ key: 'tanggal', label: 'Tanggal' },
		{ key: 'kategori', label: 'Kategori' },
		{ key: 'jumlah', label: 'Jumlah (Rp)' },
		{ key: 'status', label: 'Status' },
		{ key: 'catatan', label: 'Catatan' }
	];
	const exportRows = $derived(
		riwayat.map((r) => ({
			tanggal: formatDate(r.tanggal_pengajuan),
			kategori: r.kategori ?? '-',
			jumlah: r.jumlah ?? 0,
			status: r.status ?? '-',
			catatan: r.catatan ?? '-'
		}))
	);
</script>

<div class="w-full p-4 md:p-6 pb-28 max-w-7xl mx-auto space-y-6">
	<!-- Top Navigation & Actions Bar -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
		<div>
			<div class="flex items-center gap-2">
				<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Reimbursement</h1>
				<span class="px-2.5 py-0.5 rounded-full text-xs font-bold border" style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label2)">
					ESS
				</span>
			</div>
			<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">
				Pengajuan & riwayat klaim biaya operasional karyawan
			</p>
		</div>

		<div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
			<!-- Tombol Refresh Data -->
			<button
				class="w-11 h-11 md:w-12 md:h-12 rounded-2xl flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:scale-105 transition-all shadow-sm"
				onclick={() => load(true)}
				disabled={refreshing || loading}
				aria-label="Muat ulang data"
				title="Muat ulang data klaim"
			>
				<IconRotate2 size={20} class={refreshing ? 'animate-spin text-blue-500' : ''} />
			</button>

			<!-- Tombol Ekspor -->
			<button
				class="w-11 h-11 md:w-12 md:h-12 rounded-2xl flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 text-slate-500 disabled:opacity-40 hover:scale-105 transition-all shadow-sm"
				onclick={() => (sheetOpen = true)}
				disabled={riwayat.length === 0}
				aria-label="Ekspor riwayat reimbursement"
				title="Ekspor riwayat klaim (PDF / CSV)"
			>
				<IconFileExport size={20} />
			</button>

			<!-- Tombol Ajukan Klaim Baru -->
			<button
				class="h-11 md:h-12 px-4 md:px-5 rounded-2xl flex items-center gap-2 text-white gradient-bg btn-pulse hover:scale-[1.02] transition-all shadow-lg font-bold text-xs md:text-sm"
				onclick={() => goto('/ess/reimburse/baru')}
				aria-label="Ajukan klaim baru"
			>
				<IconPlus size={20} />
				<span>Ajukan Klaim</span>
			</button>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-24">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data klaim reimbursement..." />
		</div>
	{:else if errorMsg}
		<!-- Error State -->
		<div class="glass-panel rounded-3xl p-8 md:p-12 text-center max-w-md mx-auto space-y-4 border border-red-500/30">
			<div class="w-16 h-16 rounded-3xl bg-red-100 dark:bg-red-950/50 flex items-center justify-center mx-auto shadow-inner">
				<IconAlertTriangle size={32} class="text-red-500" />
			</div>
			<h3 class="text-lg font-bold text-red-600">Gagal Memuat Data</h3>
			<p class="text-xs md:text-sm text-red-500/90 leading-relaxed">{errorMsg}</p>
			<button
				class="px-6 py-2.5 rounded-xl text-xs font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-md"
				onclick={() => load(false)}
			>
				Coba Lagi
			</button>
		</div>
	{:else}
		<!-- Summary Metrics (KPI Cards) -->
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
			<!-- Card 1: Disetujui / Cair -->
			<div class="glass-panel rounded-3xl p-5 relative overflow-hidden flex flex-col justify-between group">
				<div class="absolute top-0 right-0 w-28 h-28 bg-emerald-500/10 rounded-full blur-2xl -mr-6 -mt-6 group-hover:scale-125 transition-transform"></div>
				<div class="relative z-10 flex items-center justify-between mb-3">
					<span class="text-xs font-bold uppercase tracking-wider text-emerald-500">Klaim Disetujui</span>
					<div class="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-500/15 text-emerald-500">
						<IconCheck size={18} />
					</div>
				</div>
				<div class="relative z-10 space-y-1">
					<p class="text-2xl md:text-3xl font-black gradient-text tracking-tight">
						{formatRupiah(stats.approvedSum)}
					</p>
					<p class="text-xs font-medium" style="color: var(--sys-label4)">
						{stats.approvedCount} transaksi telah disetujui / cair
					</p>
				</div>
			</div>

			<!-- Card 2: Dalam Proses (Pending) -->
			<div class="glass-panel rounded-3xl p-5 relative overflow-hidden flex flex-col justify-between group">
				<div class="absolute top-0 right-0 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl -mr-6 -mt-6 group-hover:scale-125 transition-transform"></div>
				<div class="relative z-10 flex items-center justify-between mb-3">
					<span class="text-xs font-bold uppercase tracking-wider text-amber-500">Menunggu Approval</span>
					<div class="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-500/15 text-amber-500">
						<IconClock size={18} />
					</div>
				</div>
				<div class="relative z-10 space-y-1">
					<p class="text-2xl md:text-3xl font-black gradient-text tracking-tight">
						{formatRupiah(stats.pendingSum)}
					</p>
					<p class="text-xs font-medium" style="color: var(--sys-label4)">
						{stats.pendingCount} transaksi dalam proses verifikasi
					</p>
				</div>
			</div>

			<!-- Card 3: Total Pengajuan -->
			<div class="glass-panel rounded-3xl p-5 relative overflow-hidden flex flex-col justify-between group">
				<div class="absolute top-0 right-0 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl -mr-6 -mt-6 group-hover:scale-125 transition-transform"></div>
				<div class="relative z-10 flex items-center justify-between mb-3">
					<span class="text-xs font-bold uppercase tracking-wider text-blue-500">Total Pengajuan</span>
					<div class="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-500/15 text-blue-500">
						<IconReceipt size={18} />
					</div>
				</div>
				<div class="relative z-10 space-y-1">
					<p class="text-2xl md:text-3xl font-black gradient-text tracking-tight">
						{formatRupiah(stats.totalSum)}
					</p>
					<p class="text-xs font-medium" style="color: var(--sys-label4)">
						{stats.totalCount} pengajuan diajukan secara keseluruhan
					</p>
				</div>
			</div>
		</div>

		<!-- Search, Filters, and Sorting Controls -->
		<div class="glass-panel rounded-3xl p-4 md:p-5 border space-y-4" style="border-color: var(--sys-sep)">
			<div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
				<!-- Search Input -->
				<div class="relative flex-1">
					<IconSearch size={18} class="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
					<input
						type="text"
						placeholder="Cari berdasarkan kategori, catatan, nominal..."
						bind:value={searchQuery}
						class="w-full h-11 pl-10 pr-9 rounded-2xl border text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
						style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
					/>
					{#if searchQuery}
						<button
							class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
							onclick={() => (searchQuery = '')}
							aria-label="Bersihkan pencarian"
						>
							<IconX size={16} />
						</button>
					{/if}
				</div>

				<div class="flex items-center gap-2.5 flex-wrap">
					<!-- Dropdown Kategori -->
					<select
						bind:value={kategoriFilter}
						class="h-11 px-3.5 rounded-2xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
						style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
					>
						<option value="all">Semua Kategori</option>
						<option value="Transport">Transport</option>
						<option value="Perjalanan Dinas">Perjalanan Dinas</option>
						<option value="Kesehatan">Kesehatan</option>
						<option value="Komunikasi">Komunikasi</option>
						<option value="Lainnya">Lainnya</option>
					</select>

					<!-- Dropdown Urutan -->
					<select
						bind:value={sortBy}
						class="h-11 px-3.5 rounded-2xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
						style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
					>
						<option value="terbaru">Terbaru</option>
						<option value="terlama">Terlama</option>
						<option value="tertinggi">Nominal Tertinggi</option>
						<option value="terendah">Nominal Terendah</option>
					</select>
				</div>
			</div>

			<!-- Status Filter Pills -->
			<div class="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
				<button
					class="px-3.5 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all"
					style={statusFilter === 'all'
						? 'background: var(--p, var(--g)); color: #fff; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25)'
						: 'background: var(--sys-fill); color: var(--sys-label3)'}
					onclick={() => (statusFilter = 'all')}
				>
					Semua ({riwayat.length})
				</button>
				<button
					class="px-3.5 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all flex items-center gap-1.5"
					style={statusFilter === 'diajukan'
						? 'background: #D97706; color: #fff; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.25)'
						: 'background: var(--sys-fill); color: var(--sys-label3)'}
					onclick={() => (statusFilter = 'diajukan')}
				>
					<span class="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
					Menunggu ({stats.pendingCount})
				</button>
				<button
					class="px-3.5 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all flex items-center gap-1.5"
					style={statusFilter === 'disetujui'
						? 'background: #16A34A; color: #fff; box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25)'
						: 'background: var(--sys-fill); color: var(--sys-label3)'}
					onclick={() => (statusFilter = 'disetujui')}
				>
					<span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
					Disetujui ({stats.approvedCount})
				</button>
				{#if stats.rejectedCount > 0}
					<button
						class="px-3.5 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all flex items-center gap-1.5"
						style={statusFilter === 'ditolak'
							? 'background: #DC2626; color: #fff; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25)'
							: 'background: var(--sys-fill); color: var(--sys-label3)'}
						onclick={() => (statusFilter = 'ditolak')}
					>
						<span class="w-2 h-2 rounded-full bg-red-400 inline-block"></span>
						Ditolak ({stats.rejectedCount})
					</button>
				{/if}
			</div>
		</div>

		<!-- Content Section: List or Empty State -->
		{#if riwayat.length === 0}
			<!-- Empty State 1: Belum pernah ada klaim sama sekali (Sharp & Modern Hero Card) -->
			<div class="glass-panel rounded-3xl p-8 md:p-14 border text-center space-y-8 relative overflow-hidden" style="border-color: var(--sys-sep)">
				<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

				<div class="relative z-10 max-w-lg mx-auto space-y-4">
					<div class="w-20 h-20 rounded-3xl mx-auto flex items-center justify-center bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-xl shadow-blue-500/20 group">
						<IconReceipt size={38} class="group-hover:scale-110 transition-transform" />
					</div>
					<div class="space-y-1">
						<h2 class="text-xl md:text-2xl font-black tracking-tight" style="color: var(--sys-label)">
							Belum Ada Pengajuan Reimbursement
						</h2>
						<p class="text-xs md:text-sm leading-relaxed" style="color: var(--sys-label3)">
							Ajukan klaim penggantian biaya operasional, transport kunjungan proyek, atau perjalanan dinas dengan mudah dan transparan.
						</p>
					</div>

					<button
						class="inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-white gradient-bg btn-pulse hover:scale-105 transition-all shadow-xl shadow-blue-500/25"
						onclick={() => goto('/ess/reimburse/baru')}
					>
						<IconPlus size={20} />
						<span>Ajukan Klaim Sekarang</span>
					</button>
				</div>

				<!-- Quick Highlights -->
				<div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-left relative z-10 pt-4 border-t border-white/10 dark:border-slate-800">
					<div class="p-4 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
						<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-500/10 text-blue-500">
							<IconCamera size={18} />
						</div>
						<h4 class="text-xs font-bold" style="color: var(--sys-label)">1. Simpan Foto Struk</h4>
						<p class="text-[11px] leading-relaxed" style="color: var(--sys-label3)">
							Lampirkan foto nota, invoice, atau karcis transaksi fisik yang jelas dan terbaca.
						</p>
					</div>

					<div class="p-4 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
						<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-emerald-500/10 text-emerald-500">
							<IconCar size={18} />
						</div>
						<h4 class="text-xs font-bold" style="color: var(--sys-label)">2. Terintegrasi Lokasi</h4>
						<p class="text-[11px] leading-relaxed" style="color: var(--sys-label3)">
							Kategori transport otomatis memvalidasi riwayat check-in kunjungan lapangan Anda.
						</p>
					</div>

					<div class="p-4 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
						<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-purple-500/10 text-purple-500">
							<IconShieldCheck size={18} />
						</div>
						<h4 class="text-xs font-bold" style="color: var(--sys-label)">3. Persetujuan Cepat</h4>
						<p class="text-[11px] leading-relaxed" style="color: var(--sys-label3)">
							Diverifikasi atasan divisi dan diteruskan ke bagian keuangan untuk pencairan.
						</p>
					</div>
				</div>
			</div>
		{:else if filteredRiwayat.length === 0}
			<!-- Empty State 2: Hasil filter kosong -->
			<div class="glass-panel rounded-3xl p-12 text-center space-y-4 border" style="border-color: var(--sys-sep)">
				<div class="w-16 h-16 rounded-3xl mx-auto flex items-center justify-center bg-slate-500/10 text-slate-400">
					<IconFilter size={32} />
				</div>
				<div class="space-y-1 max-w-sm mx-auto">
					<h3 class="text-base font-bold" style="color: var(--sys-label)">Tidak Ada Klaim Ditemukan</h3>
					<p class="text-xs" style="color: var(--sys-label3)">
						Tidak ada data klaim yang sesuai dengan kriteria filter atau pencarian Anda.
					</p>
				</div>
				<button
					class="px-4 py-2 rounded-xl text-xs font-bold text-blue-500 bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
					onclick={resetFilters}
				>
					Reset Filter & Pencarian
				</button>
			</div>
		{:else}
			<!-- Grid of Reimbursement Records -->
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#each filteredRiwayat as r (r.id)}
					{@const c = statusColor(r.status)}
					{@const catMeta = getCategoryMeta(r.kategori)}
					{@const CatIcon = catMeta.icon}
					<div class="hover-lift glass-panel rounded-3xl p-5 relative overflow-hidden flex flex-col justify-between border group transition-all" style="border-color: var(--sys-sep)">
						<!-- Top Header -->
						<div class="flex items-start justify-between gap-3 mb-3 relative z-10">
							<div class="flex items-center gap-3">
								<div class="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style="background: {catMeta.bg}; color: {catMeta.color}">
									<CatIcon size={22} />
								</div>
								<div>
									<h3 class="text-sm md:text-base font-bold tracking-tight" style="color: var(--sys-label)">
										{r.kategori}
									</h3>
									<div class="flex items-center gap-2 text-xs font-medium" style="color: var(--sys-label3)">
										<IconCalendar size={13} />
										<span>{formatDate(r.tanggal_pengajuan)}</span>
									</div>
								</div>
							</div>

							<!-- Status Badge -->
							<span
								class="text-[11px] font-extrabold px-3 py-1 rounded-full border shadow-sm flex items-center gap-1.5 shrink-0"
								style="background: {c.bg}; color: {c.text}; border-color: {c.border}"
							>
								{#if (r.status || '').toLowerCase() === 'ditolak'}
									<IconX size={12} />
								{:else if (r.status || '').toLowerCase().includes('setuju') || (r.status || '').toLowerCase().includes('bayar')}
									<IconCheck size={12} />
								{:else}
									<IconClock size={12} />
								{/if}
								<span>{r.status}</span>
							</span>
						</div>

						<!-- Amount Display -->
						<div class="my-2 p-3 rounded-2xl bg-slate-500/5 border relative z-10 flex items-baseline justify-between" style="border-color: var(--sys-sep)">
							<span class="text-xs font-semibold" style="color: var(--sys-label3)">Nominal Klaim</span>
							<p class="text-2xl font-black gradient-text tracking-tight">
								{formatRupiah(r.jumlah)}
							</p>
						</div>

						<!-- Notes if any -->
						{#if r.catatan}
							<div class="text-xs p-3 rounded-2xl border bg-white/40 dark:bg-slate-800/40 relative z-10 my-1 line-clamp-2 leading-relaxed" style="border-color: var(--sys-sep); color: var(--sys-label2)">
								"{r.catatan}"
							</div>
						{/if}

						<!-- Rejection Note if Ditolak -->
						{#if (r.status || '').toLowerCase() === 'ditolak' && r.catatan}
							<div class="mt-2 p-2.5 rounded-xl border bg-red-500/10 border-red-500/20 text-xs text-red-500 flex items-start gap-2 relative z-10">
								<IconAlertTriangle size={15} class="shrink-0 mt-0.5" />
								<div class="leading-relaxed">
									<span class="font-bold">Alasan Penolakan:</span> {r.catatan}
								</div>
							</div>
						{/if}

						<!-- Card Footer / Actions -->
						<div class="flex items-center justify-between pt-3 mt-2 border-t border-slate-200/50 dark:border-slate-800/50 relative z-10 gap-2">
							<div class="flex items-center gap-2">
								{#if r.bukti_pendukung}
									<span class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-xl">
										<IconReceipt size={13} />
										Bukti Ada
									</span>
								{:else}
									<span class="text-[11px] font-medium text-slate-400">
										Tanpa Lampiran
									</span>
								{/if}
							</div>

							<div class="flex items-center gap-2">
								{#if r.bukti_pendukung}
									<button
										class="px-2.5 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1 text-blue-500 hover:bg-blue-500/10 transition-colors"
										style="border-color: rgba(59, 130, 246, 0.3)"
										onclick={() => (detailModalRecord = r)}
										title="Lihat foto bukti struk"
									>
										<IconEye size={14} />
										<span>Bukti</span>
									</button>
								{/if}

								<button
									class="px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 hover:bg-slate-500/10 transition-colors"
									style="border-color: var(--sys-sep); color: var(--sys-label)"
									onclick={() => (detailModalRecord = r)}
								>
									<IconFileText size={14} />
									<span>Detail</span>
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Collapsible Guidelines / Ketentuan Reimbursement -->
		<div class="glass-panel rounded-3xl border overflow-hidden transition-all" style="border-color: var(--sys-sep)">
			<button
				class="w-full p-5 flex items-center justify-between text-left hover:bg-slate-500/5 transition-colors"
				onclick={() => (showGuide = !showGuide)}
			>
				<div class="flex items-center gap-3">
					<div class="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-500/10 text-blue-500">
						<IconInfoCircle size={20} />
					</div>
					<div>
						<h3 class="text-sm font-bold" style="color: var(--sys-label)">Panduan & Ketentuan Klaim Reimbursement</h3>
						<p class="text-[11px]" style="color: var(--sys-label3)">Pelajari syarat bukti transaksi & alur persetujuan</p>
					</div>
				</div>
				<div class="text-slate-400">
					{#if showGuide}
						<IconChevronUp size={20} />
					{:else}
						<IconChevronDown size={20} />
					{/if}
				</div>
			</button>

			{#if showGuide}
				<div class="p-5 pt-0 border-t border-slate-200/50 dark:border-slate-800/50 space-y-4 text-xs leading-relaxed" style="color: var(--sys-label2)">
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
						<div class="p-4 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-2 font-bold text-blue-500">
								<IconCamera size={16} />
								<span>Keabsahan Struk & Bukti Nota</span>
							</div>
							<p>
								Unggah foto struk/nota fisik yang jelas, tidak buram, dan memperlihatkan tanggal transaksi, nama vendor, rincian barang/jasa, serta total nominal secara utuh.
							</p>
						</div>

						<div class="p-4 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-2 font-bold text-emerald-500">
								<IconCar size={16} />
								<span>Klaim Transport & Kunjungan Lapangan</span>
							</div>
							<p>
								Klaim dengan kategori <strong>Transport</strong> atau <strong>Perjalanan Dinas</strong> wajib ditautkan dengan data Site Visit (Check-in kunjungan lapangan) dalam 7 hari terakhir.
							</p>
						</div>

						<div class="p-4 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-2 font-bold text-amber-500">
								<IconClock size={16} />
								<span>Batas Waktu Pengajuan</span>
							</div>
							<p>
								Pengajuan klaim disarankan dilakukan sesegera mungkin pada bulan transaksi yang sama sebelum tanggal tutup buku (cut-off) payroll bulanan.
							</p>
						</div>

						<div class="p-4 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-2 font-bold text-purple-500">
								<IconShieldCheck size={16} />
								<span>Alur Persetujuan & Pencairan</span>
							</div>
							<p>
								Klaim diverifikasi berjenjang oleh Kepala Divisi / Project Leader Anda. Setelah disetujui, kasir / finance akan memproses pencairan ke rekening terdaftar.
							</p>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Modal Detail & Viewer Bukti Struk -->
{#if detailModalRecord}
	{@const c = statusColor(detailModalRecord.status)}
	{@const catMeta = getCategoryMeta(detailModalRecord.kategori)}
	{@const CatIcon = catMeta.icon}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
		onclick={(e) => {
			if (e.target === e.currentTarget) detailModalRecord = null;
		}}
		role="dialog"
		aria-modal="true"
	>
		<div
			class="glass-panel rounded-3xl max-w-lg w-full border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
			style="border-color: var(--sys-sep); background: var(--sys-bg, #1e293b)"
		>
			<!-- Modal Header -->
			<div class="p-5 border-b flex items-center justify-between" style="border-color: var(--sys-sep)">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-2xl flex items-center justify-center" style="background: {catMeta.bg}; color: {catMeta.color}">
						<CatIcon size={20} />
					</div>
					<div>
						<h3 class="text-base font-bold" style="color: var(--sys-label)">Detail Reimbursement</h3>
						<p class="text-[11px]" style="color: var(--sys-label3)">Diajukan {formatDate(detailModalRecord.tanggal_pengajuan)}</p>
					</div>
				</div>
				<button
					class="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-white transition-colors"
					onclick={() => (detailModalRecord = null)}
					aria-label="Tutup modal"
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Modal Body -->
			<div class="p-5 overflow-y-auto space-y-4">
				<!-- Status Banner -->
				<div class="p-4 rounded-2xl border flex items-center justify-between" style="background: {c.bg}; border-color: {c.border}">
					<div>
						<span class="text-[10px] font-bold uppercase tracking-wider block" style="color: {c.text}">Status Pengajuan</span>
						<p class="text-sm font-bold" style="color: {c.text}">{detailModalRecord.status}</p>
					</div>
					<div class="w-9 h-9 rounded-xl flex items-center justify-center bg-white/20 text-white">
						{#if (detailModalRecord.status || '').toLowerCase() === 'ditolak'}
							<IconX size={18} />
						{:else if (detailModalRecord.status || '').toLowerCase().includes('setuju')}
							<IconCheck size={18} />
						{:else}
							<IconClock size={18} />
						{/if}
					</div>
				</div>

				<!-- Detail Data Nominal & Kategori -->
				<div class="grid grid-cols-2 gap-3">
					<div class="p-3.5 rounded-2xl border bg-slate-500/5 space-y-1" style="border-color: var(--sys-sep)">
						<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Kategori</span>
						<p class="text-sm font-bold" style="color: var(--sys-label)">{detailModalRecord.kategori}</p>
					</div>
					<div class="p-3.5 rounded-2xl border bg-slate-500/5 space-y-1" style="border-color: var(--sys-sep)">
						<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Biaya</span>
						<p class="text-sm font-black gradient-text">{formatRupiah(detailModalRecord.jumlah)}</p>
					</div>
				</div>

				<!-- Catatan Klaim -->
				<div class="space-y-1.5">
					<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Catatan Pengajuan:</span>
					<p class="text-xs p-3.5 rounded-2xl border bg-slate-500/5 leading-relaxed" style="border-color: var(--sys-sep); color: var(--sys-label)">
						{detailModalRecord.catatan || 'Tidak ada catatan tambahan.'}
					</p>
				</div>

				<!-- Lampiran Bukti Struk / Nota -->
				<div class="space-y-2">
					<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lampiran Bukti Transaksi:</span>
					{#if detailModalRecord.bukti_pendukung}
						<div class="rounded-2xl border overflow-hidden bg-black/20 text-center relative group" style="border-color: var(--sys-sep)">
							<img
								use:secureAssetSrc={detailModalRecord.bukti_pendukung}
								alt="Bukti Struk Reimbursement"
								class="w-full max-h-72 object-contain mx-auto bg-slate-950/40"
							/>
							<div class="p-3 bg-slate-900/90 flex items-center justify-center gap-2 border-t border-white/10">
								<button
									type="button"
									class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 flex items-center gap-1.5 transition-colors shadow-md"
									onclick={() => openSecureAsset(detailModalRecord?.bukti_pendukung)}
								>
									<IconExternalLink size={15} />
									<span>Buka Resolusi Penuh</span>
								</button>
							</div>
						</div>
					{:else}
						<div class="p-4 rounded-2xl border border-dashed text-center text-xs text-slate-400" style="border-color: var(--sys-sep)">
							Tidak ada foto bukti nota atau kuitansi yang dilampirkan.
						</div>
					{/if}
				</div>

				<!-- Metadata ID & Verifikasi -->
				<div class="p-3 rounded-xl bg-slate-500/5 border text-[11px] space-y-1 text-slate-400" style="border-color: var(--sys-sep)">
					<p>• ID Pengajuan: <span class="font-mono text-slate-300">{detailModalRecord.id}</span></p>
					{#if detailModalRecord.approved_at}
						<p>• Waktu Verifikasi: <span class="text-slate-300">{detailModalRecord.approved_at}</span></p>
					{/if}
				</div>
			</div>

			<!-- Modal Footer -->
			<div class="p-4 border-t flex justify-end" style="border-color: var(--sys-sep)">
				<button
					class="px-5 py-2 rounded-xl text-xs font-bold border transition-colors hover:bg-slate-500/10"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => (detailModalRecord = null)}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}

<EssExportSheet
	open={sheetOpen}
	onClose={() => (sheetOpen = false)}
	judul="Riwayat Reimbursement Saya"
	filename="reimburse-saya"
	columns={exportColumns}
	rows={exportRows}
	watermark="Dokumen pribadi — bukan bukti pembayaran"
/>
