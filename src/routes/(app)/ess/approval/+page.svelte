<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getApprovalInbox, approveCuti, rejectCuti, type CutiRecord } from '$lib/services/ess/cuti';
	import { getLemburApprovalInbox, approveLembur, rejectLembur, type LemburRecord } from '$lib/services/ess/lembur';
	import { getReimburseApprovalInbox, approveReimburse, rejectReimburse, type ReimburseRecord } from '$lib/services/ess/reimburse';
	import { getKasbonApprovalInbox, approveKasbon, rejectKasbon, type KasbonRecord } from '$lib/services/ess/kasbon';
	import { openSecureAsset } from '$lib/actions/secureAsset';
	import {
		IconLoader2,
		IconAlertTriangle,
		IconCheck,
		IconX,
		IconRefresh,
		IconCalendarEvent,
		IconClock,
		IconReceipt,
		IconCash,
		IconBuilding,
		IconPaperclip,
		IconHistory,
		IconHourglassHigh,
		IconFilter
	} from '@tabler/icons-svelte';

	type Tab = 'cuti' | 'lembur' | 'reimburse' | 'kasbon';
	type ViewMode = 'pending' | 'history';
	type HistoryFilter = 'semua' | 'disetujui' | 'ditolak';

	let activeTab = $state<Tab>('cuti');
	let viewMode = $state<ViewMode>('pending');
	let historyFilter = $state<HistoryFilter>('semua');
	let loading = $state(true);
	let errorMsg = $state('');
	let processingId = $state<string | null>(null);
	let toastMsg = $state<string | null>(null);

	let cutiInbox = $state<CutiRecord[]>([]);
	let lemburInbox = $state<LemburRecord[]>([]);
	let reimburseInbox = $state<ReimburseRecord[]>([]);
	let kasbonInbox = $state<KasbonRecord[]>([]);

	let cutiHistory = $state<CutiRecord[]>([]);
	let lemburHistory = $state<LemburRecord[]>([]);
	let reimburseHistory = $state<ReimburseRecord[]>([]);
	let kasbonHistory = $state<KasbonRecord[]>([]);

	let rejectTarget = $state<{ tab: Tab; id: string } | null>(null);
	let rejectReason = $state('');
	let rejectSubmitting = $state(false);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'approve_cuti_ess', roles)) {
			goto('/ess');
		}
	});

	function showToast(msg: string) {
		toastMsg = msg;
		setTimeout(() => {
			if (toastMsg === msg) toastMsg = null;
		}, 3500);
	}

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const [cuti, lembur, reimburse, kasbon] = await Promise.all([
				getApprovalInbox(),
				getLemburApprovalInbox(),
				getReimburseApprovalInbox(),
				getKasbonApprovalInbox()
			]);
			cutiInbox = cuti.inbox;
			cutiHistory = cuti.history || [];
			lemburInbox = lembur.inbox;
			lemburHistory = lembur.history || [];
			reimburseInbox = reimburse.inbox;
			reimburseHistory = reimburse.history || [];
			kasbonInbox = kasbon.inbox;
			kasbonHistory = kasbon.history || [];
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat daftar approval.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function handleApprove(tab: Tab, id: string | number) {
		if (processingId) return;
		processingId = String(id);
		try {
			const approvedAt = new Date().toISOString();
			if (tab === 'cuti') {
				const item = cutiInbox.find((r) => String(r.id) === String(id));
				await approveCuti(String(id));
				cutiInbox = cutiInbox.filter((r) => String(r.id) !== String(id));
				if (item) {
					cutiHistory = [{ ...item, status: 'Disetujui', approved_at: approvedAt }, ...cutiHistory];
				}
				showToast('Pengajuan cuti berhasil disetujui.');
			} else if (tab === 'lembur') {
				const item = lemburInbox.find((r) => String(r.id) === String(id));
				await approveLembur(String(id));
				lemburInbox = lemburInbox.filter((r) => String(r.id) !== String(id));
				if (item) {
					lemburHistory = [{ ...item, status: 'Disetujui Atasan', approved_at: approvedAt }, ...lemburHistory];
				}
				showToast('Pengajuan lembur berhasil disetujui.');
			} else if (tab === 'reimburse') {
				const item = reimburseInbox.find((r) => String(r.id) === String(id));
				await approveReimburse(String(id));
				reimburseInbox = reimburseInbox.filter((r) => String(r.id) !== String(id));
				if (item) {
					reimburseHistory = [{ ...item, status: 'Disetujui', approved_at: approvedAt }, ...reimburseHistory];
				}
				showToast('Klaim reimbursement berhasil disetujui.');
			} else {
				const item = kasbonInbox.find((r) => String(r.id) === String(id));
				await approveKasbon(id);
				kasbonInbox = kasbonInbox.filter((r) => String(r.id) !== String(id));
				if (item) {
					kasbonHistory = [{ ...item, status: 'Disetujui Atasan', last_payment_date: approvedAt }, ...kasbonHistory];
				}
				showToast('Pengajuan kasbon berhasil disetujui.');
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyetujui pengajuan.';
		} finally {
			processingId = null;
		}
	}

	function openReject(tab: Tab, id: string | number) {
		rejectTarget = { tab, id: String(id) };
		rejectReason = '';
	}

	async function confirmReject() {
		if (!rejectTarget || !rejectReason.trim()) return;
		rejectSubmitting = true;
		try {
			const { tab, id } = rejectTarget;
			const reasonText = rejectReason.trim();
			const approvedAt = new Date().toISOString();

			if (tab === 'cuti') {
				const item = cutiInbox.find((r) => String(r.id) === id);
				await rejectCuti(id, reasonText);
				cutiInbox = cutiInbox.filter((r) => String(r.id) !== id);
				if (item) {
					cutiHistory = [{ ...item, status: 'Ditolak', catatan_hr: reasonText, approved_at: approvedAt }, ...cutiHistory];
				}
				showToast('Pengajuan cuti telah ditolak.');
			} else if (tab === 'lembur') {
				const item = lemburInbox.find((r) => String(r.id) === id);
				await rejectLembur(id, reasonText);
				lemburInbox = lemburInbox.filter((r) => String(r.id) !== id);
				if (item) {
					lemburHistory = [{ ...item, status: 'Ditolak', catatan_approval: reasonText, approved_at: approvedAt }, ...lemburHistory];
				}
				showToast('Pengajuan lembur telah ditolak.');
			} else if (tab === 'reimburse') {
				const item = reimburseInbox.find((r) => String(r.id) === id);
				await rejectReimburse(id, reasonText);
				reimburseInbox = reimburseInbox.filter((r) => String(r.id) !== id);
				if (item) {
					reimburseHistory = [{ ...item, status: 'Ditolak', catatan: reasonText, approved_at: approvedAt }, ...reimburseHistory];
				}
				showToast('Klaim reimbursement telah ditolak.');
			} else {
				const item = kasbonInbox.find((r) => String(r.id) === id);
				await rejectKasbon(id, reasonText);
				kasbonInbox = kasbonInbox.filter((r) => String(r.id) !== id);
				if (item) {
					kasbonHistory = [{ ...item, status: 'Ditolak', catatan_penolakan: reasonText }, ...kasbonHistory];
				}
				showToast('Pengajuan kasbon telah ditolak.');
			}
			rejectTarget = null;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menolak pengajuan.';
		} finally {
			rejectSubmitting = false;
		}
	}

	function formatDate(dateStr: string) {
		if (!dateStr) return '-';
		const parts = dateStr.split('T')[0].split('-');
		if (parts.length !== 3) return dateStr;
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${parseInt(parts[2])} ${monthNames[parseInt(parts[1]) - 1] || parts[1]} ${parts[0]}`;
	}

	function formatRupiah(n: number) {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	function getInitials(name: string): string {
		if (!name) return 'K';
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) {
			return (parts[0][0] + parts[1][0]).toUpperCase();
		}
		return name.slice(0, 2).toUpperCase();
	}

	function calcLemburDuration(jamMulai?: string | null, jamSelesai?: string | null): string {
		if (!jamMulai || !jamSelesai) return '';
		const [h1, m1] = jamMulai.split(':').map(Number);
		const [h2, m2] = jamSelesai.split(':').map(Number);
		if (isNaN(h1) || isNaN(h2)) return '';
		let diffMinutes = (h2 * 60 + (m2 || 0)) - (h1 * 60 + (m1 || 0));
		if (diffMinutes < 0) diffMinutes += 24 * 60;
		const hours = Math.floor(diffMinutes / 60);
		const mins = diffMinutes % 60;
		if (hours > 0 && mins > 0) return `${hours} jam ${mins} mnt`;
		if (hours > 0) return `${hours} jam`;
		return `${mins} mnt`;
	}

	function isApprovedStatus(status: string): boolean {
		const s = (status || '').toLowerCase();
		return s.includes('setuju') || s === 'approved' || s === 'lunas';
	}

	function filterByStatus<T extends { status: string }>(items: T[]): T[] {
		if (historyFilter === 'disetujui') {
			return items.filter((i) => isApprovedStatus(i.status));
		}
		if (historyFilter === 'ditolak') {
			return items.filter((i) => !isApprovedStatus(i.status));
		}
		return items;
	}

	const tabs: { key: Tab; label: string; icon: any }[] = [
		{ key: 'cuti', label: 'Cuti', icon: IconCalendarEvent },
		{ key: 'lembur', label: 'Lembur', icon: IconClock },
		{ key: 'reimburse', label: 'Reimburse', icon: IconReceipt },
		{ key: 'kasbon', label: 'Kasbon', icon: IconCash }
	];

	function tabCount(key: Tab) {
		if (viewMode === 'pending') {
			if (key === 'cuti') return cutiInbox.length;
			if (key === 'lembur') return lemburInbox.length;
			if (key === 'reimburse') return reimburseInbox.length;
			return kasbonInbox.length;
		} else {
			if (key === 'cuti') return filterByStatus(cutiHistory).length;
			if (key === 'lembur') return filterByStatus(lemburHistory).length;
			if (key === 'reimburse') return filterByStatus(reimburseHistory).length;
			return filterByStatus(kasbonHistory).length;
		}
	}

	let totalPending = $derived(cutiInbox.length + lemburInbox.length + reimburseInbox.length + kasbonInbox.length);
	let totalHistory = $derived(cutiHistory.length + lemburHistory.length + reimburseHistory.length + kasbonHistory.length);
</script>

<div class="w-full p-4 md:p-6 pb-28 max-w-7xl mx-auto">
	<!-- Top Notification Toast -->
	{#if toastMsg}
		<div class="fixed top-5 right-5 z-50 flex items-center gap-3 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl border border-emerald-400/30 transition-all transform animate-bounce">
			<IconCheck size={20} class="text-emerald-100" />
			<span class="text-sm font-semibold">{toastMsg}</span>
		</div>
	{/if}

	<!-- Header Area -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
		<div>
			<div class="flex items-center gap-3 flex-wrap">
				<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Approval Atasan</h1>
				{#if totalPending > 0}
					<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">
						{totalPending} Menunggu
					</span>
				{:else if !loading}
					<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
						<IconCheck size={14} /> Semua Selesai
					</span>
				{/if}
			</div>
			<p class="text-sm md:text-base mt-1 font-medium text-slate-400">
				Kelola dan setujui pengajuan cuti, lembur, reimbursement & kasbon dari tim Anda.
			</p>
		</div>

		<button
			onclick={load}
			disabled={loading}
			class="self-start md:self-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-200 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
			title="Perbarui data"
		>
			<IconRefresh size={16} class={loading ? 'animate-spin text-sky-400' : 'text-slate-400'} />
			<span>{loading ? 'Memuat...' : 'Refresh'}</span>
		</button>
	</div>

	<!-- Mode Switcher: Menunggu vs Riwayat -->
	<div class="flex items-center justify-between gap-3 mb-6 bg-slate-950/70 p-1.5 rounded-2xl border border-slate-800/80 flex-wrap backdrop-blur-md">
		<div class="flex gap-1.5 w-full sm:w-auto">
			<button
				onclick={() => (viewMode = 'pending')}
				class="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl text-xs md:text-sm font-extrabold flex items-center justify-center gap-2 transition-all {viewMode === 'pending'
					? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
					: 'text-slate-400 hover:text-slate-200'}"
			>
				<IconHourglassHigh size={18} class={viewMode === 'pending' ? 'text-white' : 'text-amber-400'} />
				<span>Menunggu Approval</span>
				{#if totalPending > 0}
					<span class="px-2 py-0.5 rounded-full text-[11px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/30">
						{totalPending}
					</span>
				{/if}
			</button>

			<button
				onclick={() => (viewMode = 'history')}
				class="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl text-xs md:text-sm font-extrabold flex items-center justify-center gap-2 transition-all {viewMode === 'history'
					? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
					: 'text-slate-400 hover:text-slate-200'}"
			>
				<IconHistory size={18} class={viewMode === 'history' ? 'text-white' : 'text-sky-400'} />
				<span>Riwayat Approval</span>
				{#if totalHistory > 0}
					<span class="px-2 py-0.5 rounded-full text-[11px] font-black bg-slate-800 text-slate-300 border border-slate-700">
						{totalHistory}
					</span>
				{/if}
			</button>
		</div>

		<!-- Status Filter for History View -->
		{#if viewMode === 'history'}
			<div class="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 hide-scrollbar">
				<span class="text-[11px] font-bold text-slate-400 flex items-center gap-1 mr-1">
					<IconFilter size={14} class="text-slate-400" /> Status:
				</span>
				<button
					onclick={() => (historyFilter = 'semua')}
					class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border {historyFilter === 'semua'
						? 'bg-slate-800 text-slate-100 border-slate-700'
						: 'text-slate-400 border-transparent'}"
				>
					Semua
				</button>
				<button
					onclick={() => (historyFilter = 'disetujui')}
					class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border {historyFilter === 'disetujui'
						? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
						: 'text-slate-400 border-transparent'}"
				>
					Disetujui
				</button>
				<button
					onclick={() => (historyFilter = 'ditolak')}
					class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border {historyFilter === 'ditolak'
						? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
						: 'text-slate-400 border-transparent'}"
				>
					Ditolak
				</button>
			</div>
		{/if}
	</div>

	<!-- Navigation Tabs -->
	<div class="flex gap-2 mb-8 bg-slate-900/60 p-1.5 rounded-2xl border border-slate-800/80 overflow-x-auto hide-scrollbar backdrop-blur-md">
		{#each tabs as t}
			{@const TabIcon = t.icon}
			{@const count = tabCount(t.key)}
			<button
				class="flex-1 h-12 rounded-xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all min-w-[125px] px-3 relative"
				style={activeTab === t.key
					? 'background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; box-shadow: 0 4px 14px rgba(3, 105, 161, 0.4);'
					: 'color: #94a3b8; hover:background: rgba(255,255,255,0.05);'}
				onclick={() => (activeTab = t.key)}
			>
				<TabIcon size={18} class={activeTab === t.key ? 'text-white' : 'text-slate-400'} />
				<span>{t.label}</span>
				{#if count > 0}
					<span
						class="text-[11px] font-extrabold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 shadow-sm"
						style={activeTab === t.key
							? 'background: rgba(255,255,255,0.25); color: #fff'
							: viewMode === 'pending'
							? 'background: #ef4444; color: #fff; box-shadow: 0 2px 6px rgba(239, 68, 68, 0.4);'
							: 'background: #334155; color: #cbd5e1;'}
					>
						{count}
					</span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Content Area -->
	{#if loading}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4 py-6">
			{#each Array(4) as _}
				<div class="glass-panel rounded-2xl p-5 border border-slate-800 animate-pulse flex flex-col justify-between h-48">
					<div class="flex items-center gap-3">
						<div class="w-10 h-10 rounded-full bg-slate-800"></div>
						<div class="space-y-2 flex-1">
							<div class="h-4 bg-slate-800 rounded w-1/3"></div>
							<div class="h-3 bg-slate-800/60 rounded w-1/4"></div>
						</div>
					</div>
					<div class="h-10 bg-slate-800/80 rounded-xl mt-4"></div>
				</div>
			{/each}
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-8 border border-red-500/20 bg-red-950/20">
			<div class="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4 text-red-400">
				<IconAlertTriangle size={32} />
			</div>
			<h3 class="text-lg font-bold text-red-400 mb-2">Gagal Memuat Approval</h3>
			<p class="text-sm text-red-300/80 mb-6">{errorMsg}</p>
			<button
				class="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-500 transition-all shadow-lg shadow-red-600/30"
				onclick={load}
			>
				Coba Lagi
			</button>
		</div>

	<!-- =================== MODE: PENDING =================== -->
	{:else if viewMode === 'pending'}
		{#if activeTab === 'cuti'}
			{#if cutiInbox.length === 0}
				<div class="glass-panel rounded-2xl p-12 text-center border border-slate-800/80 my-4">
					<div class="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto mb-4 text-slate-400">
						<IconCalendarEvent size={32} />
					</div>
					<h3 class="text-base font-bold text-slate-200 mb-1">Tidak Ada Pengajuan Cuti Menunggu</h3>
					<p class="text-xs text-slate-400 max-w-sm mx-auto">
						Semua pengajuan cuti anggota divisi Anda telah diproses.
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each cutiInbox as r (r.id)}
						<div class="hover-lift glass-panel rounded-2xl p-5 border border-slate-800/80 bg-slate-900/70 flex flex-col justify-between space-y-4">
							<div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white text-xs font-black shadow-md overflow-hidden">
										{#if r.karyawan?.foto}
											<img src={r.karyawan.foto} alt={r.karyawan.nama_karyawan} class="w-full h-full object-cover" />
										{:else}
											{getInitials(r.karyawan?.nama_karyawan || 'Karyawan')}
										{/if}
									</div>
									<div>
										<h4 class="text-sm font-bold text-slate-100">{r.karyawan?.nama_karyawan || 'Karyawan Divisi'}</h4>
										<p class="text-[11px] text-slate-400 flex items-center gap-1">
											<IconBuilding size={12} class="text-sky-400" />
											<span>{r.karyawan?.posisi || r.karyawan?.divisi || 'Tim Divisi'}</span>
										</p>
									</div>
								</div>
								<span class="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-sky-500/10 text-sky-400 border border-sky-500/20">
									{r.jenis_cuti}
								</span>
							</div>

							<div class="space-y-2">
								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium flex items-center gap-1.5">
										<IconCalendarEvent size={14} class="text-slate-400" /> Tanggal Cuti:
									</span>
									<span class="font-bold text-slate-200">
										{formatDate(r.tanggal_mulai)} <span class="text-sky-400 mx-1">→</span> {formatDate(r.tanggal_selesai)}
									</span>
								</div>

								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium">Durasi:</span>
									<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-sky-300 border border-slate-700">
										{r.jumlah_hari} hari kerja
									</span>
								</div>

								{#if r.alasan}
									<div class="mt-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs">
										<span class="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Alasan Cuti</span>
										<p class="text-slate-200 font-medium italic">"{r.alasan}"</p>
									</div>
								{/if}
								{#if r.jenis_cuti === 'Cuti Sakit'}
									{#if r.lampiran}
										<button
											type="button"
											class="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-sky-400"
											onclick={() => openSecureAsset(r.lampiran)}
										>
											<IconPaperclip size={14} /> Lihat Surat Dokter
										</button>
									{:else}
										<p class="mt-2 text-xs font-bold text-rose-400">⚠ Belum ada lampiran surat dokter</p>
									{/if}
								{/if}
							</div>

							<div class="flex gap-2.5 pt-2 border-t border-slate-800/80">
								<button
									class="flex-1 h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-white bg-emerald-600 hover:bg-emerald-500 transition-all shadow-md shadow-emerald-900/30 disabled:opacity-40"
									disabled={processingId === String(r.id)}
									onclick={() => handleApprove('cuti', r.id)}
								>
									{#if processingId === String(r.id)}
										<IconLoader2 size={16} class="animate-spin" />
									{:else}
										<IconCheck size={16} />
									{/if}
									Setujui
								</button>
								<button
									class="flex-1 h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all disabled:opacity-40"
									disabled={processingId === String(r.id)}
									onclick={() => openReject('cuti', r.id)}
								>
									<IconX size={16} /> Tolak
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if activeTab === 'lembur'}
			{#if lemburInbox.length === 0}
				<div class="glass-panel rounded-2xl p-12 text-center border border-slate-800/80 my-4">
					<div class="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto mb-4 text-slate-400">
						<IconClock size={32} />
					</div>
					<h3 class="text-base font-bold text-slate-200 mb-1">Tidak Ada Pengajuan Lembur Menunggu</h3>
					<p class="text-xs text-slate-400 max-w-sm mx-auto">
						Tidak ada pengajuan lembur yang menunggu persetujuan.
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each lemburInbox as r (r.id)}
						{@const durationStr = calcLemburDuration(r.jam_mulai, r.jam_selesai)}
						<div class="hover-lift glass-panel rounded-2xl p-5 border border-slate-800/80 bg-slate-900/70 flex flex-col justify-between space-y-4">
							<div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-600 to-orange-600 flex items-center justify-center text-white text-xs font-black shadow-md overflow-hidden">
										{#if r.karyawan?.foto}
											<img src={r.karyawan.foto} alt={r.karyawan.nama_karyawan} class="w-full h-full object-cover" />
										{:else}
											{getInitials(r.karyawan?.nama_karyawan || 'Karyawan')}
										{/if}
									</div>
									<div>
										<h4 class="text-sm font-bold text-slate-100">{r.karyawan?.nama_karyawan || 'Karyawan Divisi'}</h4>
										<p class="text-[11px] text-slate-400 flex items-center gap-1">
											<IconBuilding size={12} class="text-amber-400" />
											<span>{r.karyawan?.posisi || r.karyawan?.divisi || 'Tim Divisi'}</span>
										</p>
									</div>
								</div>
								<span class="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-500/10 text-amber-400 border border-amber-500/20">
									{formatDate(r.tanggal)}
								</span>
							</div>

							<div class="space-y-2">
								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium flex items-center gap-1.5">
										<IconClock size={14} class="text-amber-400" /> Jam Lembur:
									</span>
									<span class="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-amber-500/10 text-amber-300 border border-amber-500/20">
										{r.jam_mulai} — {r.jam_selesai}
									</span>
								</div>

								{#if durationStr}
									<div class="flex items-center justify-between text-xs">
										<span class="text-slate-400 font-medium">Estimasi Durasi:</span>
										<span class="font-semibold text-slate-200">{durationStr}</span>
									</div>
								{/if}

								{#if r.alasan}
									<div class="mt-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs">
										<span class="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Uraian Tugas / Alasan</span>
										<p class="text-slate-200 font-medium italic">"{r.alasan}"</p>
									</div>
								{/if}
							</div>

							<div class="flex gap-2.5 pt-2 border-t border-slate-800/80">
								<button
									class="flex-1 h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-white bg-emerald-600 hover:bg-emerald-500 transition-all shadow-md shadow-emerald-900/30 disabled:opacity-40"
									disabled={processingId === String(r.id)}
									onclick={() => handleApprove('lembur', r.id)}
								>
									{#if processingId === String(r.id)}
										<IconLoader2 size={16} class="animate-spin" />
									{:else}
										<IconCheck size={16} />
									{/if}
									Setujui
								</button>
								<button
									class="flex-1 h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all disabled:opacity-40"
									disabled={processingId === String(r.id)}
									onclick={() => openReject('lembur', r.id)}
								>
									<IconX size={16} /> Tolak
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if activeTab === 'reimburse'}
			{#if reimburseInbox.length === 0}
				<div class="glass-panel rounded-2xl p-12 text-center border border-slate-800/80 my-4">
					<div class="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto mb-4 text-slate-400">
						<IconReceipt size={32} />
					</div>
					<h3 class="text-base font-bold text-slate-200 mb-1">Tidak Ada Klaim Reimbursement Menunggu</h3>
					<p class="text-xs text-slate-400 max-w-sm mx-auto">
						Semua pengajuan klaim reimbursement telah selesai diproses.
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each reimburseInbox as r (r.id)}
						<div class="hover-lift glass-panel rounded-2xl p-5 border border-slate-800/80 bg-slate-900/70 flex flex-col justify-between space-y-4">
							<div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-600 flex items-center justify-center text-white text-xs font-black shadow-md overflow-hidden">
										{#if r.karyawan?.foto}
											<img src={r.karyawan.foto} alt={r.karyawan.nama_karyawan} class="w-full h-full object-cover" />
										{:else}
											{getInitials(r.karyawan?.nama_karyawan || 'Karyawan')}
										{/if}
									</div>
									<div>
										<h4 class="text-sm font-bold text-slate-100">{r.karyawan?.nama_karyawan || 'Karyawan Divisi'}</h4>
										<p class="text-[11px] text-slate-400 flex items-center gap-1">
											<IconBuilding size={12} class="text-emerald-400" />
											<span>{r.karyawan?.posisi || r.karyawan?.divisi || 'Tim Divisi'}</span>
										</p>
									</div>
								</div>
								<span class="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
									{r.kategori}
								</span>
							</div>

							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-xs text-slate-400 font-medium">Nominal Klaim:</span>
									<span class="text-base font-black text-emerald-400 tracking-tight">
										{formatRupiah(r.jumlah)}
									</span>
								</div>

								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium">Tanggal Diajukan:</span>
									<span class="font-semibold text-slate-300">{formatDate(r.tanggal_pengajuan)}</span>
								</div>

								{#if r.catatan}
									<div class="mt-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs">
										<span class="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Catatan Pengajuan</span>
										<p class="text-slate-200 font-medium italic">"{r.catatan}"</p>
									</div>
								{/if}

								{#if r.bukti_pendukung}
									<div class="mt-2">
										<a
											href={r.bukti_pendukung}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors"
										>
											<IconPaperclip size={14} /> Lihat Bukti Pendukung
										</a>
									</div>
								{/if}
							</div>

							<div class="flex gap-2.5 pt-2 border-t border-slate-800/80">
								<button
									class="flex-1 h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-white bg-emerald-600 hover:bg-emerald-500 transition-all shadow-md shadow-emerald-900/30 disabled:opacity-40"
									disabled={processingId === String(r.id)}
									onclick={() => handleApprove('reimburse', r.id)}
								>
									{#if processingId === String(r.id)}
										<IconLoader2 size={16} class="animate-spin" />
									{:else}
										<IconCheck size={16} />
									{/if}
									Setujui
								</button>
								<button
									class="flex-1 h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all disabled:opacity-40"
									disabled={processingId === String(r.id)}
									onclick={() => openReject('reimburse', r.id)}
								>
									<IconX size={16} /> Tolak
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if activeTab === 'kasbon'}
			{#if kasbonInbox.length === 0}
				<div class="glass-panel rounded-2xl p-12 text-center border border-slate-800/80 my-4">
					<div class="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto mb-4 text-slate-400">
						<IconCash size={32} />
					</div>
					<h3 class="text-base font-bold text-slate-200 mb-1">Tidak Ada Pengajuan Kasbon Menunggu</h3>
					<p class="text-xs text-slate-400 max-w-sm mx-auto">
						Semua pengajuan kasbon telah selesai diproses.
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each kasbonInbox as r (r.id)}
						{@const estCicilan = r.tenor ? Math.round(r.nominal / r.tenor) : 0}
						<div class="hover-lift glass-panel rounded-2xl p-5 border border-slate-800/80 bg-slate-900/70 flex flex-col justify-between space-y-4">
							<div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white text-xs font-black shadow-md overflow-hidden">
										{#if r.karyawan?.foto}
											<img src={r.karyawan.foto} alt={r.karyawan.nama_karyawan} class="w-full h-full object-cover" />
										{:else}
											{getInitials(r.karyawan?.nama_karyawan || 'Karyawan')}
										{/if}
									</div>
									<div>
										<h4 class="text-sm font-bold text-slate-100">{r.karyawan?.nama_karyawan || 'Karyawan Divisi'}</h4>
										<p class="text-[11px] text-slate-400 flex items-center gap-1">
											<IconBuilding size={12} class="text-purple-400" />
											<span>{r.karyawan?.posisi || r.karyawan?.divisi || 'Tim Divisi'}</span>
										</p>
									</div>
								</div>
								<span class="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-purple-500/10 text-purple-400 border border-purple-500/20">
									Tenor {r.tenor} Bulan
								</span>
							</div>

							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-xs text-slate-400 font-medium">Nominal Kasbon:</span>
									<span class="text-base font-black text-purple-300 tracking-tight">
										{formatRupiah(r.nominal)}
									</span>
								</div>

								{#if estCicilan > 0}
									<div class="flex items-center justify-between text-xs">
										<span class="text-slate-400 font-medium">Est. Angsuran:</span>
										<span class="font-semibold text-slate-200">{formatRupiah(estCicilan)} / bulan</span>
									</div>
								{/if}

								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium">Tanggal Diajukan:</span>
									<span class="font-semibold text-slate-300">{formatDate(r.tanggal_pengajuan)}</span>
								</div>

								{#if r.keterangan}
									<div class="mt-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs">
										<span class="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Keperluan / Keterangan</span>
										<p class="text-slate-200 font-medium italic">"{r.keterangan}"</p>
									</div>
								{/if}
							</div>

							<div class="flex gap-2.5 pt-2 border-t border-slate-800/80">
								<button
									class="flex-1 h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-white bg-emerald-600 hover:bg-emerald-500 transition-all shadow-md shadow-emerald-900/30 disabled:opacity-40"
									disabled={processingId === String(r.id)}
									onclick={() => handleApprove('kasbon', r.id)}
								>
									{#if processingId === String(r.id)}
										<IconLoader2 size={16} class="animate-spin" />
									{:else}
										<IconCheck size={16} />
									{/if}
									Setujui (Atasan)
								</button>
								<button
									class="flex-1 h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all disabled:opacity-40"
									disabled={processingId === String(r.id)}
									onclick={() => openReject('kasbon', r.id)}
								>
									<IconX size={16} /> Tolak
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}

	<!-- =================== MODE: HISTORY =================== -->
	{:else if viewMode === 'history'}
		{#if activeTab === 'cuti'}
			{@const list = filterByStatus(cutiHistory)}
			{#if list.length === 0}
				<div class="glass-panel rounded-2xl p-12 text-center border border-slate-800/80 my-4">
					<div class="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto mb-4 text-slate-400">
						<IconHistory size={32} />
					</div>
					<h3 class="text-base font-bold text-slate-200 mb-1">Tidak Ada Riwayat Cuti</h3>
					<p class="text-xs text-slate-400 max-w-sm mx-auto">
						Belum ada riwayat pengajuan cuti yang diproses untuk filter ini.
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each list as r (r.id)}
						{@const isApprove = isApprovedStatus(r.status)}
						<div class="hover-lift glass-panel rounded-2xl p-5 border border-slate-800/80 bg-slate-900/70 flex flex-col justify-between space-y-4">
							<div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white text-xs font-black shadow-md overflow-hidden">
										{#if r.karyawan?.foto}
											<img src={r.karyawan.foto} alt={r.karyawan.nama_karyawan} class="w-full h-full object-cover" />
										{:else}
											{getInitials(r.karyawan?.nama_karyawan || 'Karyawan')}
										{/if}
									</div>
									<div>
										<h4 class="text-sm font-bold text-slate-100">{r.karyawan?.nama_karyawan || 'Karyawan Divisi'}</h4>
										<p class="text-[11px] text-slate-400 flex items-center gap-1">
											<IconBuilding size={12} class="text-sky-400" />
											<span>{r.karyawan?.posisi || r.karyawan?.divisi || 'Tim Divisi'}</span>
										</p>
									</div>
								</div>
								<div class="flex items-center gap-2">
									<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-sky-500/10 text-sky-400 border border-sky-500/20">
										{r.jenis_cuti}
									</span>
									<span class="px-2.5 py-1 rounded-full text-[11px] font-black border flex items-center gap-1 {isApprove ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}">
										{#if isApprove}<IconCheck size={13} />{:else}<IconX size={13} />{/if}
										{r.status}
									</span>
								</div>
							</div>

							<div class="space-y-2">
								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium flex items-center gap-1.5">
										<IconCalendarEvent size={14} class="text-slate-400" /> Tanggal Cuti:
									</span>
									<span class="font-bold text-slate-200">
										{formatDate(r.tanggal_mulai)} <span class="text-sky-400 mx-1">→</span> {formatDate(r.tanggal_selesai)}
									</span>
								</div>

								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium">Durasi:</span>
									<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-sky-300 border border-slate-700">
										{r.jumlah_hari} hari kerja
									</span>
								</div>

								{#if r.alasan}
									<div class="mt-2 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs">
										<span class="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Alasan Cuti</span>
										<p class="text-slate-200 font-medium italic">"{r.alasan}"</p>
									</div>
								{/if}
								{#if r.jenis_cuti === 'Cuti Sakit' && r.lampiran}
									<button
										type="button"
										class="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-sky-400"
										onclick={() => openSecureAsset(r.lampiran)}
									>
										<IconPaperclip size={14} /> Lihat Surat Dokter
									</button>
								{/if}

								{#if !isApprove && r.catatan_hr}
									<div class="mt-2 p-3 rounded-xl bg-rose-950/30 border border-rose-500/20 text-xs">
										<span class="text-[10px] uppercase font-bold text-rose-400 block mb-0.5">Alasan Penolakan</span>
										<p class="text-rose-200 font-medium italic">"{r.catatan_hr}"</p>
									</div>
								{/if}

								{#if r.approved_at}
									<div class="pt-2 text-[10px] text-slate-500 flex items-center justify-between border-t border-slate-800/60">
										<span>Diproses pada:</span>
										<span class="font-semibold text-slate-400">{formatDate(r.approved_at)}</span>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if activeTab === 'lembur'}
			{@const list = filterByStatus(lemburHistory)}
			{#if list.length === 0}
				<div class="glass-panel rounded-2xl p-12 text-center border border-slate-800/80 my-4">
					<div class="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto mb-4 text-slate-400">
						<IconHistory size={32} />
					</div>
					<h3 class="text-base font-bold text-slate-200 mb-1">Tidak Ada Riwayat Lembur</h3>
					<p class="text-xs text-slate-400 max-w-sm mx-auto">
						Belum ada riwayat pengajuan lembur yang diproses untuk filter ini.
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each list as r (r.id)}
						{@const isApprove = isApprovedStatus(r.status)}
						{@const durationStr = calcLemburDuration(r.jam_mulai, r.jam_selesai)}
						<div class="hover-lift glass-panel rounded-2xl p-5 border border-slate-800/80 bg-slate-900/70 flex flex-col justify-between space-y-4">
							<div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-600 to-orange-600 flex items-center justify-center text-white text-xs font-black shadow-md overflow-hidden">
										{#if r.karyawan?.foto}
											<img src={r.karyawan.foto} alt={r.karyawan.nama_karyawan} class="w-full h-full object-cover" />
										{:else}
											{getInitials(r.karyawan?.nama_karyawan || 'Karyawan')}
										{/if}
									</div>
									<div>
										<h4 class="text-sm font-bold text-slate-100">{r.karyawan?.nama_karyawan || 'Karyawan Divisi'}</h4>
										<p class="text-[11px] text-slate-400 flex items-center gap-1">
											<IconBuilding size={12} class="text-amber-400" />
											<span>{r.karyawan?.posisi || r.karyawan?.divisi || 'Tim Divisi'}</span>
										</p>
									</div>
								</div>
								<span class="px-2.5 py-1 rounded-full text-[11px] font-black border flex items-center gap-1 {isApprove ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}">
									{#if isApprove}<IconCheck size={13} />{:else}<IconX size={13} />{/if}
									{r.status}
								</span>
							</div>

							<div class="space-y-2">
								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium">Tanggal Lembur:</span>
									<span class="font-bold text-slate-200">{formatDate(r.tanggal)}</span>
								</div>

								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium flex items-center gap-1.5">
										<IconClock size={14} class="text-amber-400" /> Jam Lembur:
									</span>
									<span class="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
										{r.jam_mulai} — {r.jam_selesai}
									</span>
								</div>

								{#if durationStr}
									<div class="flex items-center justify-between text-xs">
										<span class="text-slate-400 font-medium">Estimasi Durasi:</span>
										<span class="font-semibold text-slate-200">{durationStr}</span>
									</div>
								{/if}

								{#if r.alasan}
									<div class="mt-2 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs">
										<span class="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Uraian Tugas / Alasan</span>
										<p class="text-slate-200 font-medium italic">"{r.alasan}"</p>
									</div>
								{/if}

								{#if !isApprove && r.catatan_approval}
									<div class="mt-2 p-3 rounded-xl bg-rose-950/30 border border-rose-500/20 text-xs">
										<span class="text-[10px] uppercase font-bold text-rose-400 block mb-0.5">Alasan Penolakan</span>
										<p class="text-rose-200 font-medium italic">"{r.catatan_approval}"</p>
									</div>
								{/if}

								{#if r.approved_at}
									<div class="pt-2 text-[10px] text-slate-500 flex items-center justify-between border-t border-slate-800/60">
										<span>Diproses pada:</span>
										<span class="font-semibold text-slate-400">{formatDate(r.approved_at)}</span>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if activeTab === 'reimburse'}
			{@const list = filterByStatus(reimburseHistory)}
			{#if list.length === 0}
				<div class="glass-panel rounded-2xl p-12 text-center border border-slate-800/80 my-4">
					<div class="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto mb-4 text-slate-400">
						<IconHistory size={32} />
					</div>
					<h3 class="text-base font-bold text-slate-200 mb-1">Tidak Ada Riwayat Reimbursement</h3>
					<p class="text-xs text-slate-400 max-w-sm mx-auto">
						Belum ada riwayat klaim reimbursement yang diproses untuk filter ini.
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each list as r (r.id)}
						{@const isApprove = isApprovedStatus(r.status)}
						<div class="hover-lift glass-panel rounded-2xl p-5 border border-slate-800/80 bg-slate-900/70 flex flex-col justify-between space-y-4">
							<div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-600 flex items-center justify-center text-white text-xs font-black shadow-md overflow-hidden">
										{#if r.karyawan?.foto}
											<img src={r.karyawan.foto} alt={r.karyawan.nama_karyawan} class="w-full h-full object-cover" />
										{:else}
											{getInitials(r.karyawan?.nama_karyawan || 'Karyawan')}
										{/if}
									</div>
									<div>
										<h4 class="text-sm font-bold text-slate-100">{r.karyawan?.nama_karyawan || 'Karyawan Divisi'}</h4>
										<p class="text-[11px] text-slate-400 flex items-center gap-1">
											<IconBuilding size={12} class="text-emerald-400" />
											<span>{r.karyawan?.posisi || r.karyawan?.divisi || 'Tim Divisi'}</span>
										</p>
									</div>
								</div>
								<div class="flex items-center gap-2">
									<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
										{r.kategori}
									</span>
									<span class="px-2.5 py-1 rounded-full text-[11px] font-black border flex items-center gap-1 {isApprove ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}">
										{#if isApprove}<IconCheck size={13} />{:else}<IconX size={13} />{/if}
										{r.status}
									</span>
								</div>
							</div>

							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-xs text-slate-400 font-medium">Nominal Klaim:</span>
									<span class="text-base font-black text-emerald-400 tracking-tight">
										{formatRupiah(r.jumlah)}
									</span>
								</div>

								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium">Tanggal Diajukan:</span>
									<span class="font-semibold text-slate-300">{formatDate(r.tanggal_pengajuan)}</span>
								</div>

								{#if r.catatan}
									<div class="mt-2 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs">
										<span class="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Catatan / Keterangan</span>
										<p class="text-slate-200 font-medium italic">"{r.catatan}"</p>
									</div>
								{/if}

								{#if r.bukti_pendukung}
									<div class="mt-1">
										<a
											href={r.bukti_pendukung}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors"
										>
											<IconPaperclip size={14} /> Lihat Bukti Pendukung
										</a>
									</div>
								{/if}

								{#if r.approved_at}
									<div class="pt-2 text-[10px] text-slate-500 flex items-center justify-between border-t border-slate-800/60">
										<span>Diproses pada:</span>
										<span class="font-semibold text-slate-400">{formatDate(r.approved_at)}</span>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if activeTab === 'kasbon'}
			{@const list = filterByStatus(kasbonHistory)}
			{#if list.length === 0}
				<div class="glass-panel rounded-2xl p-12 text-center border border-slate-800/80 my-4">
					<div class="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto mb-4 text-slate-400">
						<IconHistory size={32} />
					</div>
					<h3 class="text-base font-bold text-slate-200 mb-1">Tidak Ada Riwayat Kasbon</h3>
					<p class="text-xs text-slate-400 max-w-sm mx-auto">
						Belum ada riwayat pengajuan kasbon yang diproses untuk filter ini.
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each list as r (r.id)}
						{@const isApprove = isApprovedStatus(r.status)}
						{@const estCicilan = r.tenor ? Math.round(r.nominal / r.tenor) : 0}
						<div class="hover-lift glass-panel rounded-2xl p-5 border border-slate-800/80 bg-slate-900/70 flex flex-col justify-between space-y-4">
							<div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white text-xs font-black shadow-md overflow-hidden">
										{#if r.karyawan?.foto}
											<img src={r.karyawan.foto} alt={r.karyawan.nama_karyawan} class="w-full h-full object-cover" />
										{:else}
											{getInitials(r.karyawan?.nama_karyawan || 'Karyawan')}
										{/if}
									</div>
									<div>
										<h4 class="text-sm font-bold text-slate-100">{r.karyawan?.nama_karyawan || 'Karyawan Divisi'}</h4>
										<p class="text-[11px] text-slate-400 flex items-center gap-1">
											<IconBuilding size={12} class="text-purple-400" />
											<span>{r.karyawan?.posisi || r.karyawan?.divisi || 'Tim Divisi'}</span>
										</p>
									</div>
								</div>
								<div class="flex items-center gap-2">
									<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-500/10 text-purple-400 border border-purple-500/20">
										Tenor {r.tenor} Bulan
									</span>
									<span class="px-2.5 py-1 rounded-full text-[11px] font-black border flex items-center gap-1 {isApprove ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}">
										{#if isApprove}<IconCheck size={13} />{:else}<IconX size={13} />{/if}
										{r.status}
									</span>
								</div>
							</div>

							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-xs text-slate-400 font-medium">Nominal Kasbon:</span>
									<span class="text-base font-black text-purple-300 tracking-tight">
										{formatRupiah(r.nominal)}
									</span>
								</div>

								{#if estCicilan > 0}
									<div class="flex items-center justify-between text-xs">
										<span class="text-slate-400 font-medium">Est. Angsuran:</span>
										<span class="font-semibold text-slate-200">{formatRupiah(estCicilan)} / bulan</span>
									</div>
								{/if}

								<div class="flex items-center justify-between text-xs">
									<span class="text-slate-400 font-medium">Tanggal Diajukan:</span>
									<span class="font-semibold text-slate-300">{formatDate(r.tanggal_pengajuan)}</span>
								</div>

								{#if r.keterangan}
									<div class="mt-2 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs">
										<span class="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Keperluan / Keterangan</span>
										<p class="text-slate-200 font-medium italic">"{r.keterangan}"</p>
									</div>
								{/if}

								{#if !isApprove && r.catatan_penolakan}
									<div class="mt-2 p-3 rounded-xl bg-rose-950/30 border border-rose-500/20 text-xs">
										<span class="text-[10px] uppercase font-bold text-rose-400 block mb-0.5">Alasan Penolakan</span>
										<p class="text-rose-200 font-medium italic">"{r.catatan_penolakan}"</p>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}

	<!-- Rejection Modal -->
	{#if rejectTarget}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-200">
			<div class="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-6 transform transition-all">
				<div class="flex items-center justify-between mb-4">
					<h3 class="text-lg font-bold text-slate-100 flex items-center gap-2">
						<IconAlertTriangle size={20} class="text-rose-500" />
						Alasan Penolakan
					</h3>
					<button
						onclick={() => (rejectTarget = null)}
						class="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
					>
						<IconX size={18} />
					</button>
				</div>

				<textarea
					class="w-full rounded-xl border border-slate-700/80 text-sm p-4 bg-slate-950 text-slate-100 placeholder-slate-500 transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none resize-none"
					rows="4"
					placeholder="Tuliskan alasan penolakan agar diketahui oleh pemohon..."
					bind:value={rejectReason}
				></textarea>

				<div class="flex gap-3 mt-6">
					<button
						class="flex-1 h-11 rounded-xl text-xs font-bold text-slate-300 hover:bg-slate-800 transition-colors border border-slate-700/50"
						onclick={() => (rejectTarget = null)}
					>
						Batal
					</button>
					<button
						class="flex-1 h-11 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 transition-all shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2"
						disabled={!rejectReason.trim() || rejectSubmitting}
						onclick={confirmReject}
					>
						{#if rejectSubmitting}
							<IconLoader2 size={16} class="animate-spin" />
							<span>Mengirim...</span>
						{:else}
							<IconX size={16} />
							<span>Tolak Pengajuan</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
