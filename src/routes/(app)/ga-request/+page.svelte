<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getMyGaRequests,
		cancelGaRequest,
		JENIS_CATEGORIES,
		PRIORITAS_META,
		type GaRequestRow
	} from '$lib/services/gaRequest';
	import {
		IconTool,
		IconPlus,
		IconSearch,
		IconX,
		IconClock,
		IconLoader2,
		IconRefresh,
		IconUser,
		IconMapPin,
		IconCalendarEvent,
		IconChevronRight,
		IconAlertTriangle,
		IconCircleCheck,
		IconNotes,
		IconCup,
		IconCar,
		IconDoor,
		IconDots,
		IconCopy,
		IconHeadset,
		IconTrash
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let refreshing = $state(false);
	let errorMsg = $state('');
	let requests = $state<GaRequestRow[]>([]);

	// Search & Filters
	let searchQuery = $state('');
	let selectedCategory = $state('semua');
	let selectedStatus = $state('semua');

	// Detail Modal
	let selectedRequest = $state<GaRequestRow | null>(null);
	let cancellingId = $state<number | null>(null);
	let cancelError = $state('');
	let copySuccess = $state(false);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_support', roles)) {
			goto('/');
		}
	});

	async function loadData(silent = false) {
		if (silent) refreshing = true;
		else loading = true;
		errorMsg = '';
		try {
			requests = await getMyGaRequests();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat permintaan GA.';
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	onMount(() => {
		loadData();
	});

	// Metrics Calculation
	let totalCount = $derived(requests.length);
	let baruCount = $derived(requests.filter((r) => r.status === 'baru').length);
	let diprosesCount = $derived(requests.filter((r) => r.status === 'diproses').length);
	let selesaiCount = $derived(requests.filter((r) => r.status === 'selesai').length);
	let kritisCount = $derived(
		requests.filter((r) => {
			if (r.status === 'selesai' || r.status === 'ditolak') return false;
			if (r.prioritas === 'kritis') return true;
			if (!r.sla_due) return false;
			const hoursLeft = (new Date(r.sla_due).getTime() - Date.now()) / 3600000;
			return hoursLeft <= 8;
		}).length
	);

	// Category counts
	function getCategoryCount(catValue: string) {
		if (catValue === 'semua') return requests.length;
		return requests.filter((r) => r.jenis === catValue).length;
	}

	// Filtered requests
	let filteredRequests = $derived(
		requests.filter((r) => {
			// Category filter
			if (selectedCategory !== 'semua' && r.jenis !== selectedCategory) {
				return false;
			}
			// Status filter
			if (selectedStatus !== 'semua' && r.status !== selectedStatus) {
				return false;
			}
			// Text search
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase().trim();
				const idMatch = `#${r.id}`.includes(q) || String(r.id).includes(q);
				const deskMatch = (r.deskripsi || '').toLowerCase().includes(q);
				const locMatch = (r.lokasi || r.catatan || '').toLowerCase().includes(q);
				const assignedMatch = (r.assigned_to_nama || '').toLowerCase().includes(q);
				return idMatch || deskMatch || locMatch || assignedMatch;
			}
			return true;
		})
	);

	function getCategoryMeta(jenis: string) {
		const found = JENIS_CATEGORIES.find((c) => c.value === jenis);
		return found || { value: jenis, label: jenis.toUpperCase(), desc: '', color: '#475569', bg: '#F8FAFC', border: '#E2E8F0' };
	}

	function getCategoryIcon(jenis: string) {
		switch (jenis) {
			case 'atk': return IconNotes;
			case 'rtk': return IconCup;
			case 'perbaikan': return IconTool;
			case 'kendaraan': return IconCar;
			case 'ruangan': return IconDoor;
			default: return IconDots;
		}
	}

	function statusBadge(status: string) {
		const map: Record<string, { bg: string; color: string; border: string; label: string }> = {
			baru: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A', label: 'Baru / Menunggu' },
			diproses: { bg: '#DBEAFE', color: '#1E40AF', border: '#BFDBFE', label: 'Sedang Diproses' },
			selesai: { bg: '#DCFCE7', color: '#166534', border: '#BBF7D0', label: 'Selesai' },
			ditolak: { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA', label: 'Ditolak / Batal' }
		};
		return map[status] || { bg: 'var(--sys-fill)', color: 'var(--sys-label3)', border: 'var(--sys-sep)', label: status };
	}

	function slaBadge(r: GaRequestRow) {
		if (r.status === 'selesai') {
			return { label: 'Selesai Tepat Waktu', color: '#166534', bg: '#DCFCE7', icon: IconCircleCheck };
		}
		if (r.status === 'ditolak') {
			return null;
		}
		if (!r.sla_due) return null;
		const hoursLeft = Math.round((new Date(r.sla_due).getTime() - Date.now()) / 3600000);
		if (hoursLeft < 0) {
			return { label: `SLA Lewat ${Math.abs(hoursLeft)} Jam`, color: '#991B1B', bg: '#FEE2E2', icon: IconAlertTriangle };
		}
		if (hoursLeft <= 8) {
			return { label: `Sisa ${hoursLeft} Jam (Mendesak)`, color: '#92400E', bg: '#FEF3C7', icon: IconClock };
		}
		if (hoursLeft <= 24) {
			return { label: `Sisa ${hoursLeft} Jam`, color: '#1E40AF', bg: '#DBEAFE', icon: IconClock };
		}
		const daysLeft = Math.round(hoursLeft / 24);
		return { label: `Sisa ${daysLeft} Hari`, color: 'var(--sys-label3)', bg: 'var(--sys-fill)', icon: IconClock };
	}

	function formatTimestamp(iso: string) {
		if (!iso) return '-';
		try {
			const d = new Date(iso);
			return d.toLocaleDateString('id-ID', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}

	function formatRelativeTime(iso: string) {
		if (!iso) return '';
		try {
			const diffMs = Date.now() - new Date(iso).getTime();
			const diffSec = Math.floor(diffMs / 1000);
			const diffMin = Math.floor(diffSec / 60);
			const diffHour = Math.floor(diffMin / 60);
			const diffDay = Math.floor(diffHour / 24);

			if (diffDay > 30) return formatTimestamp(iso);
			if (diffDay > 0) return `${diffDay} hari lalu`;
			if (diffHour > 0) return `${diffHour} jam lalu`;
			if (diffMin > 0) return `${diffMin} menit lalu`;
			return 'Baru saja';
		} catch {
			return '';
		}
	}

	function getAssignedName(r: GaRequestRow): string {
		if (r.assigned_to_nama) return r.assigned_to_nama;
		if (typeof r.assigned_to === 'object' && r.assigned_to?.nama_karyawan) return r.assigned_to.nama_karyawan;
		return 'Menunggu Penugasan';
	}

	async function handleCancelRequest(req: GaRequestRow) {
		if (req.status !== 'baru') return;
		if (!confirm(`Apakah Anda yakin ingin membatalkan Permintaan GA #${req.id}?`)) return;

		cancellingId = req.id;
		cancelError = '';
		try {
			const ok = await cancelGaRequest(req.id);
			if (ok) {
				selectedRequest = null;
				await loadData(true);
			} else {
				cancelError = 'Gagal membatalkan permintaan.';
			}
		} catch (err: any) {
			cancelError = err?.message || 'Gagal membatalkan permintaan.';
		} finally {
			cancellingId = null;
		}
	}

	function copyTicketDetails(req: GaRequestRow) {
		const text = `[Permintaan GA #${req.id}]\nJenis: ${req.jenis.toUpperCase()}\nDeskripsi: ${req.deskripsi}\nStatus: ${req.status}\nPrioritas: ${req.prioritas}\nTanggal: ${formatTimestamp(req.date_created)}`;
		navigator.clipboard.writeText(text).then(() => {
			copySuccess = true;
			setTimeout(() => (copySuccess = false), 2000);
		});
	}
</script>

<div class="w-full max-w-7xl mx-auto p-4 md:p-6 pb-28">
	<!-- Top Bar / Header -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
		<div>
			<div class="flex items-center gap-2">
				<h1 class="text-xl md:text-2xl font-bold tracking-tight" style="color: var(--sys-label)">
					Permintaan Layanan & Fasilitas GA
				</h1>
				<button
					class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
					style="color: var(--sys-label3)"
					onclick={() => loadData(true)}
					title="Refresh Data"
				>
					<IconRefresh size={18} class={refreshing ? 'animate-spin' : ''} />
				</button>
			</div>
			<p class="text-xs md:text-sm mt-0.5" style="color: var(--sys-label3)">
				Portal mandiri pengajuan ATK, RTK, perbaikan fasilitas, operasional kendaraan, dan booking ruangan meeting.
			</p>
		</div>

		<!-- Action Buttons -->
		<div class="flex items-center gap-2.5 shrink-0 flex-wrap">
			<button
				class="h-10 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-all hover:bg-slate-50 dark:hover:bg-slate-800"
				style="background: var(--sys-fill); color: var(--sys-label); border-color: var(--sys-sep)"
				onclick={() => goto('/support/baru?departemen=IT&tipe=Permintaan')}
			>
				<IconHeadset size={16} class="text-blue-500" />
				Lapor Masalah IT
			</button>

			<button
				class="h-10 px-4 rounded-xl text-xs font-bold text-white flex items-center gap-2 shadow-sm transition-all hover:opacity-95 active:scale-[0.98]"
				style="background: var(--p, #1F6592)"
				onclick={() => goto('/ga-request/baru')}
			>
				<IconPlus size={16} />
				+ Permintaan Baru
			</button>
		</div>
	</div>

	<!-- Executive KPI Stats Row -->
	<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
		<!-- Total -->
		<button
			class="p-3.5 rounded-2xl border text-left transition-all hover:shadow-sm"
			style="background: var(--sys-bg-secondary, #fff); border-color: {selectedStatus === 'semua' ? 'var(--p, #1F6592)' : 'var(--sys-sep)'}"
			onclick={() => { selectedStatus = 'semua'; }}
		>
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-semibold uppercase tracking-wider" style="color: var(--sys-label3)">Total Pengajuan</span>
				<span class="w-2 h-2 rounded-full bg-slate-400"></span>
			</div>
			<div class="text-2xl font-bold mt-1.5" style="color: var(--sys-label)">{totalCount}</div>
			<div class="text-[11px] mt-0.5" style="color: var(--sys-label4)">Seluruh riwayat Anda</div>
		</button>

		<!-- Menunggu / Baru -->
		<button
			class="p-3.5 rounded-2xl border text-left transition-all hover:shadow-sm"
			style="background: var(--sys-bg-secondary, #fff); border-color: {selectedStatus === 'baru' ? '#F59E0B' : 'var(--sys-sep)'}"
			onclick={() => { selectedStatus = 'baru'; }}
		>
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Menunggu / Baru</span>
				<span class="w-2 h-2 rounded-full bg-amber-500"></span>
			</div>
			<div class="text-2xl font-bold mt-1.5 text-amber-600 dark:text-amber-400">{baruCount}</div>
			<div class="text-[11px] mt-0.5" style="color: var(--sys-label4)">Antrean belum diproses</div>
		</button>

		<!-- Sedang Diproses -->
		<button
			class="p-3.5 rounded-2xl border text-left transition-all hover:shadow-sm"
			style="background: var(--sys-bg-secondary, #fff); border-color: {selectedStatus === 'diproses' ? '#3B82F6' : 'var(--sys-sep)'}"
			onclick={() => { selectedStatus = 'diproses'; }}
		>
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Diproses</span>
				<span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
			</div>
			<div class="text-2xl font-bold mt-1.5 text-blue-600 dark:text-blue-400">{diprosesCount}</div>
			<div class="text-[11px] mt-0.5" style="color: var(--sys-label4)">Sedang ditangani PIC</div>
		</button>

		<!-- Selesai -->
		<button
			class="p-3.5 rounded-2xl border text-left transition-all hover:shadow-sm"
			style="background: var(--sys-bg-secondary, #fff); border-color: {selectedStatus === 'selesai' ? '#10B981' : 'var(--sys-sep)'}"
			onclick={() => { selectedStatus = 'selesai'; }}
		>
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Selesai</span>
				<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
			</div>
			<div class="text-2xl font-bold mt-1.5 text-emerald-600 dark:text-emerald-400">{selesaiCount}</div>
			<div class="text-[11px] mt-0.5" style="color: var(--sys-label4)">Layanan terpenuhi</div>
		</button>

		<!-- SLA Kritis / Atensi -->
		<div
			class="p-3.5 rounded-2xl border text-left col-span-2 sm:col-span-1"
			style="background: var(--sys-bg-secondary, #fff); border-color: {kritisCount > 0 ? '#EF4444' : 'var(--sys-sep)'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">SLA Kritis</span>
				{#if kritisCount > 0}
					<span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
				{:else}
					<span class="w-2 h-2 rounded-full bg-slate-300"></span>
				{/if}
			</div>
			<div class="text-2xl font-bold mt-1.5 text-rose-600 dark:text-rose-400">{kritisCount}</div>
			<div class="text-[11px] mt-0.5" style="color: var(--sys-label4)">{kritisCount > 0 ? 'Perlu perhatian cepat' : 'Semua SLA aman'}</div>
		</div>
	</div>

	<!-- Filter & Search Toolbar -->
	<div class="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 mb-5">
		<!-- Category Selector Pills -->
		<div class="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full scrollbar-thin">
			<button
				class="h-8 px-3 rounded-full text-xs font-semibold shrink-0 transition-all border"
				style={selectedCategory === 'semua'
					? 'background: var(--p, #1F6592); color: #fff; border-color: transparent;'
					: 'background: var(--sys-fill); color: var(--sys-label2); border-color: var(--sys-sep);'}
				onclick={() => (selectedCategory = 'semua')}
			>
				Semua ({getCategoryCount('semua')})
			</button>
			{#each JENIS_CATEGORIES as cat}
				{@const count = getCategoryCount(cat.value)}
				<button
					class="h-8 px-3 rounded-full text-xs font-semibold shrink-0 transition-all border flex items-center gap-1.5"
					style={selectedCategory === cat.value
						? 'background: var(--p, #1F6592); color: #fff; border-color: transparent;'
						: 'background: var(--sys-fill); color: var(--sys-label2); border-color: var(--sys-sep);'}
					onclick={() => (selectedCategory = cat.value)}
				>
					<span>{cat.label}</span>
					{#if count > 0}
						<span
							class="text-[10px] px-1.5 py-0.2 rounded-full font-bold"
							style={selectedCategory === cat.value
								? 'background: rgba(255,255,255,0.25); color: #fff'
								: 'background: var(--sys-sep); color: var(--sys-label3)'}
						>
							{count}
						</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Search Bar & Status Dropdown -->
		<div class="flex items-center gap-2 shrink-0">
			<div class="relative flex-1 sm:w-64">
				<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label3)" />
				<input
					type="text"
					placeholder="Cari ID, deskripsi, lokasi..."
					class="w-full h-9 pl-9 pr-8 rounded-xl text-xs border transition-all focus:outline-none focus:ring-1"
					style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff); color: var(--sys-label)"
					bind:value={searchQuery}
				/>
				{#if searchQuery}
					<button
						class="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-slate-200"
						style="color: var(--sys-label3)"
						onclick={() => (searchQuery = '')}
					>
						<IconX size={14} />
					</button>
				{/if}
			</div>

			<select
				class="h-9 px-3 rounded-xl text-xs border font-medium cursor-pointer"
				style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff); color: var(--sys-label)"
				bind:value={selectedStatus}
			>
				<option value="semua">Semua Status</option>
				<option value="baru">Baru / Menunggu</option>
				<option value="diproses">Sedang Diproses</option>
				<option value="selesai">Selesai</option>
				<option value="ditolak">Ditolak / Batal</option>
			</select>
		</div>
	</div>

	<!-- Content Area -->
	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat daftar permintaan GA..." />
		</div>
	{:else if errorMsg}
		<div class="rounded-2xl border p-6 text-center max-w-lg mx-auto my-10" style="border-color: #FECACA; background: #FEF2F2">
			<IconAlertTriangle size={36} class="text-rose-500 mx-auto mb-2" />
			<h3 class="text-sm font-bold text-rose-800">Gagal Memuat Data</h3>
			<p class="text-xs text-rose-600 mt-1">{errorMsg}</p>
			<button
				class="mt-4 px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700"
				onclick={() => loadData()}
			>
				Coba Lagi
			</button>
		</div>
	{:else if filteredRequests.length === 0}
		<div
			class="rounded-3xl border border-dashed p-12 text-center my-6 flex flex-col items-center justify-center"
			style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff)"
		>
			<div class="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style="background: var(--sys-fill)">
				<IconTool size={28} style="color: var(--sys-label3)" />
			</div>
			<h3 class="text-sm font-bold" style="color: var(--sys-label)">
				{searchQuery || selectedCategory !== 'semua' || selectedStatus !== 'semua' ? 'Tidak Ada Permintaan yang Cocok' : 'Belum Ada Permintaan GA'}
			</h3>
			<p class="text-xs max-w-md mt-1 mb-5" style="color: var(--sys-label3)">
				{searchQuery || selectedCategory !== 'semua' || selectedStatus !== 'semua'
					? 'Coba sesuaikan kata kunci pencarian atau reset filter kategori/status.'
					: 'Anda belum mengajukan permintaan fasilitas atau layanan GA. Klik tombol di bawah untuk membuat pengajuan baru.'}
			</p>
			{#if searchQuery || selectedCategory !== 'semua' || selectedStatus !== 'semua'}
				<button
					class="px-4 py-2 rounded-xl text-xs font-semibold border"
					style="background: var(--sys-fill); color: var(--sys-label); border-color: var(--sys-sep)"
					onclick={() => { searchQuery = ''; selectedCategory = 'semua'; selectedStatus = 'semua'; }}
				>
					Reset Filter
				</button>
			{:else}
				<button
					class="px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2 shadow-sm"
					style="background: var(--p, #1F6592)"
					onclick={() => goto('/ga-request/baru')}
				>
					<IconPlus size={16} /> Buat Permintaan Sekarang
				</button>
			{/if}
		</div>
	{:else}
		<!-- Request Cards Grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each filteredRequests as r (r.id)}
				{@const cat = getCategoryMeta(r.jenis)}
				{@const CatIcon = getCategoryIcon(r.jenis)}
				{@const sBadge = statusBadge(r.status)}
				{@const sla = slaBadge(r)}
				{@const prio = PRIORITAS_META[r.prioritas] || PRIORITAS_META.sedang}

				<div
					class="group relative rounded-2xl border p-4 text-left transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between"
					style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff)"
					role="button"
					tabindex="0"
					onclick={() => (selectedRequest = r)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectedRequest = r; }}
				>
					<!-- Top Row: Category + Priority + Status Badge -->
					<div>
						<div class="flex items-center justify-between gap-2 mb-3">
							<div class="flex items-center gap-2">
								<div
									class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
									style="background: {cat.bg}; color: {cat.color}; border: 1px solid {cat.border}"
								>
									<CatIcon size={16} />
								</div>
								<div>
									<div class="flex items-center gap-1.5">
										<span class="text-[11px] font-bold uppercase tracking-wider" style="color: {cat.color}">
											{cat.label}
										</span>
										<span class="text-[11px] font-semibold" style="color: var(--sys-label4)">
											#{r.id}
										</span>
									</div>
									<span class="text-[10px]" style="color: var(--sys-label3)">
										{formatRelativeTime(r.date_created)}
									</span>
								</div>
							</div>

							<!-- Priority Pill -->
							<span
								class="text-[10px] font-bold px-2 py-0.5 rounded-full"
								style="background: {prio.bg}; color: {prio.color}"
							>
								{prio.label}
							</span>
						</div>

						<!-- Description -->
						<p class="text-sm font-semibold line-clamp-2 mb-2.5 leading-snug" style="color: var(--sys-label)" title={r.deskripsi}>
							{r.deskripsi}
						</p>

						<!-- Special Meta: Room Booking or Location -->
						{#if r.jenis === 'ruangan' && r.tanggal_booking}
							<div class="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg mb-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
								<IconCalendarEvent size={14} class="shrink-0" />
								<span class="truncate">{r.tanggal_booking} · {r.jam_mulai || '?'} – {r.jam_selesai || '?'} WIB</span>
							</div>
						{/if}

						{#if r.lokasi}
							<div class="flex items-center gap-1.5 text-[11px] mb-3" style="color: var(--sys-label3)">
								<IconMapPin size={13} class="shrink-0" />
								<span class="truncate">{r.lokasi}</span>
							</div>
						{/if}
					</div>

					<!-- Card Footer: PIC + Status & SLA -->
					<div class="pt-3 border-t mt-2" style="border-color: var(--sys-sep)">
						<div class="flex items-center justify-between gap-2">
							<!-- Assigned PIC -->
							<div class="flex items-center gap-1.5 min-w-0">
								<div class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style="background: var(--sys-fill); color: var(--sys-label2)">
									<IconUser size={12} />
								</div>
								<span class="text-[11px] font-medium truncate" style="color: var(--sys-label2)">
									{getAssignedName(r)}
								</span>
							</div>

							<!-- Status Badge -->
							<span
								class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
								style="background: {sBadge.bg}; color: {sBadge.color}; border: 1px solid {sBadge.border}"
							>
								{sBadge.label}
							</span>
						</div>

						<!-- SLA Live Indicator -->
						{#if sla}
							{@const SlaIcon = sla.icon}
							<div class="flex items-center gap-1 text-[10px] font-medium mt-2 px-2 py-1 rounded-md" style="background: {sla.bg}; color: {sla.color}">
								<SlaIcon size={12} class="shrink-0" />
								<span class="truncate">{sla.label}</span>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Request Detail & Progress Tracker Modal -->
{#if selectedRequest}
	{@const r = selectedRequest}
	{@const cat = getCategoryMeta(r.jenis)}
	{@const CatIcon = getCategoryIcon(r.jenis)}
	{@const sBadge = statusBadge(r.status)}
	{@const prio = PRIORITAS_META[r.prioritas] || PRIORITAS_META.sedang}
	{@const sla = slaBadge(r)}

	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
		onclick={(e) => { if (e.target === e.currentTarget) selectedRequest = null; }}
		onkeydown={(e) => { if (e.key === 'Escape') selectedRequest = null; }}
		tabindex="-1"
	>
		<div
			class="relative w-full max-w-xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
			style="background: var(--sys-bg-secondary, #fff); border-color: var(--sys-sep)"
		>
			<!-- Modal Header -->
			<div class="p-5 border-b flex items-start justify-between gap-3" style="border-color: var(--sys-sep); background: var(--sys-fill)">
				<div class="flex items-center gap-3">
					<div
						class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-xs"
						style="background: {cat.bg}; color: {cat.color}; border: 1px solid {cat.border}"
					>
						<CatIcon size={20} />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<span class="text-xs font-bold uppercase tracking-wider" style="color: {cat.color}">{cat.label}</span>
							<span class="text-xs font-bold" style="color: var(--sys-label3)">#{r.id}</span>
						</div>
						<h2 class="text-base font-bold leading-tight" style="color: var(--sys-label)">Detail Permintaan Layanan</h2>
					</div>
				</div>

				<button
					class="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
					style="color: var(--sys-label3)"
					onclick={() => (selectedRequest = null)}
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Modal Body (Scrollable) -->
			<div class="p-5 overflow-y-auto space-y-5 text-xs">
				<!-- Status & Priority Banner -->
				<div class="flex items-center justify-between gap-2 p-3 rounded-2xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
					<div class="flex items-center gap-2">
						<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Status:</span>
						<span
							class="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
							style="background: {sBadge.bg}; color: {sBadge.color}; border: 1px solid {sBadge.border}"
						>
							{sBadge.label}
						</span>
					</div>

					<div class="flex items-center gap-1.5">
						<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Prioritas:</span>
						<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background: {prio.bg}; color: {prio.color}">
							{prio.label}
						</span>
					</div>
				</div>

				<!-- Step Tracker / Progress Stepper -->
				<div>
					<h4 class="text-[11px] font-bold uppercase tracking-wider mb-3" style="color: var(--sys-label3)">Alur Pengerjaan GA</h4>
					<div class="grid grid-cols-4 gap-2 relative">
						<!-- Step 1: Diajukan -->
						<div class="flex flex-col items-center text-center">
							<div class="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs bg-emerald-500 text-white shadow-xs mb-1">
								✓
							</div>
							<span class="font-bold text-[11px]" style="color: var(--sys-label)">Diajukan</span>
							<span class="text-[9px]" style="color: var(--sys-label4)">{formatRelativeTime(r.date_created)}</span>
						</div>

						<!-- Step 2: Approval GA -->
						<div class="flex flex-col items-center text-center">
							<div
								class="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs mb-1 transition-all"
								style={r.status !== 'baru' ? 'background: #10B981; color: #fff' : 'background: #3B82F6; color: #fff;'}
							>
								{r.status !== 'baru' ? '✓' : '2'}
							</div>
							<span class="font-bold text-[11px]" style="color: var(--sys-label)">Verifikasi GA</span>
							<span class="text-[9px]" style="color: var(--sys-label4)">{r.status === 'baru' ? 'Menunggu' : 'Terverifikasi'}</span>
						</div>

						<!-- Step 3: Pengerjaan / PIC -->
						<div class="flex flex-col items-center text-center">
							<div
								class="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs mb-1 transition-all"
								style={r.status === 'selesai' ? 'background: #10B981; color: #fff' : (r.status === 'diproses' ? 'background: #3B82F6; color: #fff;' : 'background: var(--sys-sep); color: var(--sys-label3);')}
							>
								{r.status === 'selesai' ? '✓' : '3'}
							</div>
							<span class="font-bold text-[11px]" style="color: var(--sys-label)">Pengerjaan</span>
							<span class="text-[9px] truncate max-w-[80px]" style="color: var(--sys-label4)">{getAssignedName(r)}</span>
						</div>

						<!-- Step 4: Selesai -->
						<div class="flex flex-col items-center text-center">
							<div
								class="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs mb-1 transition-all"
								style={r.status === 'selesai' ? 'background: #10B981; color: #fff' : (r.status === 'ditolak' ? 'background: #EF4444; color: #fff' : 'background: var(--sys-sep); color: var(--sys-label3);')}
							>
								{r.status === 'selesai' ? '✓' : (r.status === 'ditolak' ? '✕' : '4')}
							</div>
							<span class="font-bold text-[11px]" style="color: var(--sys-label)">{r.status === 'ditolak' ? 'Ditolak' : 'Selesai'}</span>
							<span class="text-[9px]" style="color: var(--sys-label4)">{r.status === 'selesai' ? 'Terpenuhi' : (r.status === 'ditolak' ? 'Dibatalkan' : 'Menunggu')}</span>
						</div>
					</div>
				</div>

				<!-- Detail Information Fields -->
				<div class="space-y-3 pt-2">
					<div>
						<span class="text-[11px] font-semibold block mb-1" style="color: var(--sys-label3)">Deskripsi Kebutuhan</span>
						<div class="p-3.5 rounded-xl border text-sm leading-relaxed whitespace-pre-wrap font-medium" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)">
							{r.deskripsi}
						</div>
					</div>

					<!-- Meta Grid -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{#if r.lokasi}
							<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep)">
								<span class="text-[10px] font-semibold uppercase tracking-wider block" style="color: var(--sys-label3)">Lokasi Kebutuhan</span>
								<p class="text-xs font-bold mt-1" style="color: var(--sys-label)">{r.lokasi}</p>
							</div>
						{/if}

						<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep)">
							<span class="text-[10px] font-semibold uppercase tracking-wider block" style="color: var(--sys-label3)">Petugas Ditugaskan (PIC)</span>
							<p class="text-xs font-bold mt-1" style="color: var(--sys-label)">{getAssignedName(r)}</p>
						</div>

						<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep)">
							<span class="text-[10px] font-semibold uppercase tracking-wider block" style="color: var(--sys-label3)">Target SLA & Prioritas</span>
							<p class="text-xs font-bold mt-1" style="color: var(--sys-label)">{prio.slaText}</p>
						</div>

						<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep)">
							<span class="text-[10px] font-semibold uppercase tracking-wider block" style="color: var(--sys-label3)">Waktu Pengajuan</span>
							<p class="text-xs font-bold mt-1" style="color: var(--sys-label)">{formatTimestamp(r.date_created)}</p>
						</div>
					</div>

					<!-- Room Booking Information (if applicable) -->
					{#if r.jenis === 'ruangan' && r.tanggal_booking}
						<div class="p-3.5 rounded-xl border bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
							<span class="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 block mb-1">
								Jadwal Booking Ruang Rapat
							</span>
							<p class="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
								Tanggal: <strong class="font-bold">{r.tanggal_booking}</strong> · Pukul: <strong class="font-bold">{r.jam_mulai || '?'} – {r.jam_selesai || '?'} WIB</strong>
							</p>
						</div>
					{/if}

					<!-- Catatan GA / Feedback -->
					{#if r.catatan && !r.catatan.startsWith('Lokasi:')}
						<div class="p-3 rounded-xl border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
							<span class="text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300 block mb-1">
								Catatan Progres Tim GA
							</span>
							<p class="text-xs text-blue-900 dark:text-blue-200">{r.catatan}</p>
						</div>
					{/if}

					{#if cancelError}
						<div class="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
							{cancelError}
						</div>
					{/if}
				</div>
			</div>

			<!-- Modal Footer Actions -->
			<div class="p-4 border-t flex items-center justify-between gap-2" style="border-color: var(--sys-sep); background: var(--sys-fill)">
				<div class="flex items-center gap-2">
					<button
						class="h-9 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors hover:bg-slate-200 dark:hover:bg-slate-700"
						style="border-color: var(--sys-sep); color: var(--sys-label)"
						onclick={() => copyTicketDetails(r)}
					>
						{#if copySuccess}
							<IconCircleCheck size={14} class="text-emerald-500" />
							<span>Tersalin!</span>
						{:else}
							<IconCopy size={14} />
							<span>Salin Info</span>
						{/if}
					</button>

					{#if r.status === 'baru'}
						<button
							class="h-9 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100 transition-colors disabled:opacity-50"
							disabled={cancellingId === r.id}
							onclick={() => handleCancelRequest(r)}
						>
							{#if cancellingId === r.id}
								<IconLoader2 size={14} class="animate-spin" />
							{:else}
								<IconTrash size={14} />
							{/if}
							<span>Batalkan Tiket</span>
						</button>
					{/if}
				</div>

				<button
					class="h-9 px-4 rounded-xl text-xs font-bold text-white shadow-xs"
					style="background: var(--p, #1F6592)"
					onclick={() => (selectedRequest = null)}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}

