<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { createFormPersist } from '$lib/utils/formPersist';
	import { collectDecisionNotes, waitingInfo, oldestWaitDays } from '$lib/shared/pettyCashRules';
	import { WAITING_STATUSES, buildTimeline, type TimelineEntry } from '$lib/shared/pettyCashUx';
	import {
		getPettyCashData,
		batalkanPettyCash,
		kirimLpjPettyCash,
		atasanApprovePettyCash,
		atasanRejectPettyCash,
		atasanRevisiPettyCash,
		pettyCashStatusLabel,
		SETTLEMENT_LABEL,
		getPettyCashHistory,
		fetchNotaObjectUrl,
		compressPhoto,
		type PettyCashRequestRecord,
		type PettyCashFund,
		type PettyCashListMeta
	} from '$lib/services/ess/pettyCash';
	import {
		IconLoader2,
		IconPlus,
		IconAlertTriangle,
		IconFileExport,
		IconReceiptTax,
		IconWallet,
		IconSearch,
		IconCheck,
		IconX,
		IconClock,
		IconAlertCircle,
		IconBuildingBank,
		IconInfoCircle,
		IconReceipt
	} from '@tabler/icons-svelte';
	import EssExportSheet from '$lib/components/ess/EssExportSheet.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let busyId = $state<number | null>(null);
	let requests = $state<PettyCashRequestRecord[]>([]);
	let atasanRequests = $state<PettyCashRequestRecord[]>([]);
	let funds = $state<PettyCashFund[]>([]);
	let tab = $state<'saya' | 'persetujuan'>('saya');

	// Filter & Search
	let searchQuery = $state('');
	let statusFilter = $state('all');

	// Modal States (Pengganti prompt & alert bawaan browser)
	let lpjModalOpen = $state(false);
	let lpjTarget = $state<PettyCashRequestRecord | null>(null);
	let lpjRealizationInput = $state('');
	let lpjSubmitting = $state(false);
	let lpjError = $state('');

	let atasanModalOpen = $state(false);
	let atasanTarget = $state<PettyCashRequestRecord | null>(null);
	let atasanActionKind = $state<'approve' | 'reject' | 'revisi'>('approve');
	let atasanNote = $state('');
	let atasanSubmitting = $state(false);
	let atasanError = $state('');

	let cancelModalOpen = $state(false);
	let cancelTarget = $state<PettyCashRequestRecord | null>(null);
	let cancelSubmitting = $state(false);

	let sheetOpen = $state(false);

	// PC3-12 — 30 terbaru + "Muat lagi"; KPI & jumlah dari server bila daftar terpotong
	const PAGE_STEP = 30;
	let listLimit = $state(PAGE_STEP);
	let listMeta = $state<PettyCashListMeta | null>(null);
	let loadingMore = $state(false);

	async function loadMore() {
		if (loadingMore) return;
		loadingMore = true;
		listLimit = Math.min(listLimit + PAGE_STEP, 100);
		try {
			await load(true);
		} finally {
			loadingMore = false;
		}
	}

	async function load(silent = false) {
		if (!silent) loading = true;
		errorMsg = '';
		try {
			const res = await getPettyCashData(listLimit);
			listMeta = res.meta || null;
			requests = res.requests || [];
			atasanRequests = res.atasan || [];
			funds = res.funds || [];
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data kas kecil.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	function fundName(r: PettyCashRequestRecord): string {
		const id = r.fund_id && typeof r.fund_id === 'object' ? r.fund_id.id : r.fund_id;
		return funds.find((f) => f.id === id)?.fund_name || `Dana #${id ?? '?'}`;
	}

	function fundDepartment(r: PettyCashRequestRecord): string | null {
		const id = r.fund_id && typeof r.fund_id === 'object' ? r.fund_id.id : r.fund_id;
		return funds.find((f) => f.id === id)?.department || null;
	}

	function statusColor(status: string) {
		if (status === 'rejected' || status === 'cancelled') return { bg: 'var(--rel)', text: 'var(--red)', border: 'rgba(239, 68, 68, 0.3)' };
		if (status === 'posted' || status === 'approved') return { bg: 'var(--gg)', text: 'var(--ggd)', border: 'rgba(16, 185, 129, 0.3)' };
		if (status === 'revisi') return { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B', border: 'rgba(245, 158, 11, 0.3)' };
		return { bg: 'var(--aml)', text: 'var(--amd)', border: 'rgba(59, 130, 246, 0.3)' };
	}

	const rupiah = (n: number) => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');

	function tgl(s: string) {
		if (!s) return '-';
		const p = s.split('-');
		if (p.length !== 3) return s;
		const b = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${parseInt(p[2])} ${b[parseInt(p[1]) - 1] || p[1]} ${p[0]}`;
	}

	// PC3-04: jurnal sudah dibuat (kasir sedang/sudah memproses) → Batal tidak mungkin, sembunyikan.
	const canCancel = (r: PettyCashRequestRecord) =>
		['draft', 'revisi', 'menunggu_atasan', 'menunggu_finance', 'menunggu_kasir'].includes(r.status) &&
		!r.journal_entry_id;

	// PC3-04: 409 'state_changed' = status berubah karena tindakan lain → pesan netral + muat ulang.
	async function handleStateChanged(e: any): Promise<boolean> {
		if (e?.code !== 'state_changed') return false;
		alert(e.message);
		try {
			await load();
		} catch (er) {
			console.error('[ess/petty-cash] muat ulang setelah 409 gagal:', er);
		}
		return true;
	}

	const canLpj = (r: PettyCashRequestRecord) =>
		r.mode === 'advance' &&
		r.status === 'posted' &&
		(!r.advance_settlement_status || ['menunggu_lpj', 'revisi'].includes(r.advance_settlement_status));

	// ── Metrics Ringkasan (KPIs) ──────────────────────────
	const stats = $derived.by(() => {
		// Daftar terpotong → angka dari server (menjumlah 30 baris saja akan salah)
		if (listMeta?.truncated && listMeta.sum_amount != null) {
			return {
				totalNominal: listMeta.sum_amount,
				pendingReview: listMeta.pending_review ?? 0,
				perluLpj: listMeta.perlu_lpj ?? 0,
				cair: listMeta.cair ?? 0
			};
		}
		const totalNominal = requests.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
		const pendingReview = requests.filter((r) => (WAITING_STATUSES as readonly string[]).includes(r.status)).length;
		const perluLpj = requests.filter(canLpj).length;
		const cair = requests.filter((r) => r.status === 'posted').length;
		return { totalNominal, pendingReview, perluLpj, cair };
	});

	// ── Filtering & Searching ────────────────────────────
	const filteredRequests = $derived.by(() => {
		let list = requests;
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			list = list.filter(
				(r) =>
					r.request_number?.toLowerCase().includes(q) ||
					r.description?.toLowerCase().includes(q) ||
					r.payee_name?.toLowerCase().includes(q) ||
					fundName(r).toLowerCase().includes(q)
			);
		}
		if (statusFilter === 'menunggu') {
			list = list.filter((r) => (WAITING_STATUSES as readonly string[]).includes(r.status)); // U6: termasuk Finance Pusat
		} else if (statusFilter === 'revisi') {
			list = list.filter((r) => r.status === 'revisi');
		} else if (statusFilter === 'cair') {
			list = list.filter((r) => ['approved', 'posted'].includes(r.status));
		} else if (statusFilter === 'lpj') {
			list = list.filter(canLpj);
		} else if (statusFilter === 'selesai_batal') {
			list = list.filter((r) => ['rejected', 'cancelled'].includes(r.status));
		}
		return list;
	});

	// ── Export Handling ──────────────────────────────────
	const exportColumns = [
		{ key: 'request_number', label: 'No. Tiket' },
		{ key: 'request_date', label: 'Tanggal' },
		{ key: 'mode', label: 'Jenis' },
		{ key: 'fund_name', label: 'Dana Kas Kecil' },
		{ key: 'description', label: 'Uraian Keperluan' },
		{ key: 'amount', label: 'Nominal Diajukan (Rp)' },
		{ key: 'approved_amount', label: 'Nominal Disetujui (Rp)' },
		{ key: 'status', label: 'Status' },
		{ key: 'payee_name', label: 'Penerima / Vendor' }
	];

	const exportRows = $derived(
		requests.map((r) => ({
			request_number: r.request_number,
			request_date: tgl(r.request_date),
			mode: r.mode === 'advance' ? 'Uang Muka' : 'Reimburse',
			fund_name: fundName(r),
			description: r.description,
			amount: r.amount,
			approved_amount: r.approved_amount ?? r.amount,
			status: pettyCashStatusLabel(r),
			payee_name: r.payee_name || '-'
		}))
	);

	// ── Modal Handlers ────────────────────────────────────
	// PC3-14 — LPJ lapangan setara admin: nominal TIDAK diisi otomatis (dulu prefill = uang muka penuh → "habis semua",
	// kembalian tak pernah ditagih), foto nota (maks 5, tahan sinyal putus lewat draf lokal), cek outlier, alasan kelebihan.
	const LPJ_MAX_FILES = 5;
	let lpjFiles = $state<File[]>([]);
	let lpjPreviews = $state<string[]>([]);
	let lpjOverageReason = $state('');
	let lpjOutlierMessage = $state('');
	let lpjCompressing = $state(false);
	const lpjPersist = (id: number) => createFormPersist<{ amount: string; reason: string }>(`ess_petty_cash_lpj_${id}`);

	function lpjPhotoKey(i: number) {
		return `nota_${i}`;
	}

	async function openLpjModal(r: PettyCashRequestRecord) {
		lpjTarget = r;
		lpjRealizationInput = '';
		lpjOverageReason = '';
		lpjOutlierMessage = '';
		lpjFiles = [];
		lpjPreviews.forEach((u) => URL.revokeObjectURL(u));
		lpjPreviews = [];
		lpjError = '';
		lpjModalOpen = true;
		// pulihkan draf lokal (angka, alasan, foto) bila sinyal putus / aplikasi tertutup di tengah
		try {
			const persist = lpjPersist(r.id);
			const draft = persist.restore();
			if (draft) {
				lpjRealizationInput = draft.amount || '';
				lpjOverageReason = draft.reason || '';
				for (let i = 0; i < LPJ_MAX_FILES; i++) {
					const blob = await persist.restorePhoto(lpjPhotoKey(i));
					if (blob && blob.size > 0) {
						const f = new File([blob], `nota-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' });
						lpjFiles = [...lpjFiles, f];
						lpjPreviews = [...lpjPreviews, URL.createObjectURL(f)];
					}
				}
			}
		} catch (e) {
			console.warn('[ess/petty-cash] gagal memulihkan draf LPJ:', e);
		}
	}

	function saveLpjDraft() {
		if (!lpjTarget) return;
		lpjPersist(lpjTarget.id).save({ amount: lpjRealizationInput, reason: lpjOverageReason });
	}

	async function onLpjPhotos(e: Event) {
		const input = e.target as HTMLInputElement;
		const picked = Array.from(input.files || []);
		input.value = '';
		if (!picked.length || !lpjTarget) return;
		const room = LPJ_MAX_FILES - lpjFiles.length;
		if (picked.length > room) lpjError = `Maksimal ${LPJ_MAX_FILES} foto nota; sisanya diabaikan.`;
		lpjCompressing = true;
		const persist = lpjPersist(lpjTarget.id);
		try {
			for (const f of picked.slice(0, Math.max(0, room))) {
				try {
					const c = await compressPhoto(f); // perkecil saat dipilih: ukuran akhir terlihat & sinyal lemah tak menambah beban
					const idx = lpjFiles.length;
					lpjFiles = [...lpjFiles, c];
					lpjPreviews = [...lpjPreviews, URL.createObjectURL(c)];
					void persist.savePhoto(lpjPhotoKey(idx), c);
				} catch (err: any) {
					// Aturan #6: foto bermasalah tidak mematikan tombol Kirim — pesan jelas, boleh lanjut tanpa foto ini
					lpjError = err?.message || 'Foto tidak bisa diproses. Coba foto ulang.';
				}
			}
			saveLpjDraft();
		} finally {
			lpjCompressing = false;
		}
	}

	function removeLpjPhoto(i: number) {
		URL.revokeObjectURL(lpjPreviews[i]);
		lpjFiles = lpjFiles.filter((_, k) => k !== i);
		lpjPreviews = lpjPreviews.filter((_, k) => k !== i);
		if (lpjTarget) {
			const persist = lpjPersist(lpjTarget.id);
			void persist.clearPhotos().then(() => Promise.all(lpjFiles.map((f, k) => persist.savePhoto(lpjPhotoKey(k), f))));
		}
	}

	let lpjRealizationNum = $derived(Number(lpjRealizationInput.replace(/\D/g, '')) || 0);
	let lpjAdvance = $derived(lpjTarget ? Number(lpjTarget.approved_amount ?? lpjTarget.amount) || 0 : 0);
	let lpjDifference = $derived(lpjAdvance - lpjRealizationNum);
	let lpjTargetFund = $derived(
		lpjTarget ? funds.find((f) => String(f.id) === String(typeof lpjTarget!.fund_id === 'object' ? (lpjTarget!.fund_id as any)?.id : lpjTarget!.fund_id)) : null
	);
	let lpjWajibBukti = $derived(Number(lpjTargetFund?.wajib_bukti_diatas) || 0);
	let lpjBatasHari = $derived(Number(lpjTargetFund?.lpj_batas_hari) || 0);
	let lpjNeedsPhoto = $derived(lpjWajibBukti > 0 && lpjRealizationNum >= lpjWajibBukti && lpjFiles.length === 0);
	let lpjOverage = $derived(lpjDifference < 0 && lpjAdvance > 0);

	async function submitLpj(confirmOutlier = false) {
		if (!lpjTarget) return;
		if (lpjRealizationNum <= 0) {
			lpjError = 'Masukkan total belanja sesuai nota.';
			return;
		}
		lpjSubmitting = true;
		lpjError = '';
		try {
			await kirimLpjPettyCash(lpjTarget.id, {
				amount: lpjRealizationNum,
				files: lpjFiles,
				confirmOutlier,
				overageReason: lpjOverage ? lpjOverageReason : undefined
			});
			const persist = lpjPersist(lpjTarget.id);
			persist.clear();
			await persist.clearPhotos();
			lpjModalOpen = false;
			lpjOutlierMessage = '';
			await load();
		} catch (e: any) {
			if (e?.code === 'LPJ_OUTLIER') {
				lpjOutlierMessage = e.message; // modal konfirmasi (bukan alert)
			} else if (await handleStateChanged(e)) {
				lpjModalOpen = false;
				return;
			} else {
				lpjError = e?.message || 'Gagal mengirim LPJ.';
			}
		} finally {
			lpjSubmitting = false;
		}
	}

	// ── U7 Riwayat tiket & U2 foto nota (dimuat HANYA saat diminta — hemat kuota/API) ───────────────────────────
	let historyTarget = $state<PettyCashRequestRecord | null>(null);
	let historyRows = $state<TimelineEntry[]>([]);
	let historyLoading = $state(false);
	let historyError = $state('');
	async function openHistory(r: PettyCashRequestRecord) {
		historyTarget = r;
		historyRows = [];
		historyError = '';
		historyLoading = true;
		try {
			historyRows = buildTimeline(await getPettyCashHistory(r.id));
		} catch (e: any) {
			historyError = e?.message || 'Riwayat tidak bisa dimuat.';
		} finally {
			historyLoading = false;
		}
	}
	const fmtWhen = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

	let notaUrl = $state<string | null>(null);
	let notaLoadingId = $state<number | null>(null);
	let notaError = $state('');
	async function openNota(r: PettyCashRequestRecord, idx = 0) {
		const ids = [...(r.bukti_file || []), ...(r.lpj_bukti_file || [])];
		if (!ids[idx]) return;
		notaError = '';
		notaLoadingId = r.id;
		try {
			if (notaUrl) URL.revokeObjectURL(notaUrl);
			notaUrl = await fetchNotaObjectUrl(r.id, String(ids[idx]));
		} catch (e: any) {
			notaError = e?.message || 'Foto nota tidak bisa dimuat.';
			alert(notaError);
		} finally {
			notaLoadingId = null;
		}
	}
	function closeNota() {
		if (notaUrl) URL.revokeObjectURL(notaUrl);
		notaUrl = null;
	}

	function openCancelModal(r: PettyCashRequestRecord) {
		cancelTarget = r;
		cancelModalOpen = true;
	}

	async function submitCancel() {
		if (!cancelTarget) return;
		cancelSubmitting = true;
		try {
			await batalkanPettyCash(cancelTarget.id);
			cancelModalOpen = false;
			await load();
		} catch (e: any) {
			if (await handleStateChanged(e)) { cancelModalOpen = false; return; }
			alert(e?.message || 'Gagal membatalkan pengajuan.');
		} finally {
			cancelSubmitting = false;
		}
	}

	function openAtasanModal(r: PettyCashRequestRecord, kind: 'approve' | 'reject' | 'revisi') {
		atasanTarget = r;
		atasanActionKind = kind;
		atasanNote = '';
		atasanError = '';
		atasanModalOpen = true;
	}

	async function submitAtasanAction() {
		if (!atasanTarget) return;
		if (atasanActionKind !== 'approve' && !atasanNote.trim()) {
			atasanError = 'Alasan wajib diisi untuk tolak atau minta revisi.';
			return;
		}
		atasanSubmitting = true;
		atasanError = '';
		try {
			if (atasanActionKind === 'approve') await atasanApprovePettyCash(atasanTarget.id);
			else if (atasanActionKind === 'reject') await atasanRejectPettyCash(atasanTarget.id, atasanNote.trim());
			else await atasanRevisiPettyCash(atasanTarget.id, atasanNote.trim());
			atasanModalOpen = false;
			await load();
		} catch (e: any) {
			if (await handleStateChanged(e)) { atasanModalOpen = false; return; }
			atasanError = e?.message || 'Gagal memproses persetujuan.';
		} finally {
			atasanSubmitting = false;
		}
	}
</script>

<div class="w-full max-w-6xl mx-auto p-4 md:p-6 pb-28">
	<!-- Top Title & Action Header -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
		<div>
			<h1 class="text-2xl md:text-3xl font-black tracking-tight gradient-text">Kas Kecil</h1>
			<p class="text-xs md:text-sm mt-1 font-medium text-slate-400">
				Pengeluaran operasional lapangan & kasbon darurat — persetujuan atasan & pencairan kasir
			</p>
		</div>
		<div class="flex items-center gap-2.5 shrink-0">
			<!-- Export Button -->
			<button
				type="button"
				class="h-11 px-3.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white flex items-center gap-2 text-xs font-bold transition-all disabled:opacity-40 shadow-sm"
				onclick={() => (sheetOpen = true)}
				disabled={requests.length === 0}
				title="Ekspor riwayat kas kecil (PDF / CSV)"
			>
				<IconFileExport size={18} />
				<span class="hidden sm:inline">Ekspor</span>
			</button>

			<!-- New Request CTA -->
			<button
				type="button"
				class="h-11 px-4 md:px-5 rounded-xl text-xs md:text-sm font-extrabold text-white gradient-bg hover:opacity-90 active:scale-95 flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
				onclick={() => goto('/ess/petty-cash/baru')}
			>
				<IconPlus size={18} stroke={3} />
				<span>Ajukan Kas Kecil</span>
			</button>
		</div>
	</div>

	<!-- Top Metric KPI Cards -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
		<!-- KPI 1: Total Pengajuan -->
		<div class="glass-panel rounded-2xl p-4 md:p-5 border border-slate-700/60 relative overflow-hidden">
			<div class="flex items-center justify-between text-slate-400 mb-2">
				<span class="text-xs font-bold uppercase tracking-wider">Total Nilai</span>
				<div class="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
					<IconReceiptTax size={18} />
				</div>
			</div>
			<p class="text-lg md:text-xl font-black text-slate-100 tracking-tight">{rupiah(stats.totalNominal)}</p>
			<p class="text-[11px] text-slate-400 mt-1">{listMeta?.total ?? requests.length} pengajuan diajukan</p>
		</div>

		<!-- KPI 2: Menunggu Review -->
		<div class="glass-panel rounded-2xl p-4 md:p-5 border border-slate-700/60 relative overflow-hidden">
			<div class="flex items-center justify-between text-slate-400 mb-2">
				<span class="text-xs font-bold uppercase tracking-wider">Menunggu Review</span>
				<div class="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
					<IconClock size={18} />
				</div>
			</div>
			<p class="text-lg md:text-xl font-black text-amber-400 tracking-tight">{stats.pendingReview}</p>
			<p class="text-[11px] text-slate-400 mt-1">Antrean atasan / kasir</p>
		</div>

		<!-- KPI 3: Perlu LPJ -->
		<div class="glass-panel rounded-2xl p-4 md:p-5 border border-slate-700/60 relative overflow-hidden">
			<div class="flex items-center justify-between text-slate-400 mb-2">
				<span class="text-xs font-bold uppercase tracking-wider">Uang Muka Aktif</span>
				<div class="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
					<IconWallet size={18} />
				</div>
			</div>
			<p class="text-lg md:text-xl font-black text-purple-400 tracking-tight">{stats.perluLpj}</p>
			<p class="text-[11px] text-slate-400 mt-1">Wajib lapor nota (LPJ)</p>
		</div>

		<!-- KPI 4: Disetujui / Cair -->
		<div class="glass-panel rounded-2xl p-4 md:p-5 border border-slate-700/60 relative overflow-hidden">
			<div class="flex items-center justify-between text-slate-400 mb-2">
				<span class="text-xs font-bold uppercase tracking-wider">Cair / Selesai</span>
				<div class="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
					<IconCheck size={18} />
				</div>
			</div>
			<p class="text-lg md:text-xl font-black text-emerald-400 tracking-tight">{stats.cair}</p>
			<p class="text-[11px] text-slate-400 mt-1">Dana telah dibukukan</p>
		</div>
	</div>

	<!-- Tab Switcher: Pengajuan Saya vs Persetujuan Tim -->
	<div class="flex items-center gap-2 mb-4">
		<button
			type="button"
			class="px-4 py-2 rounded-xl text-xs md:text-sm font-bold transition-all flex items-center gap-2 {tab === 'saya'
				? 'gradient-bg text-white shadow-md'
				: 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/60'}"
			onclick={() => (tab = 'saya')}
		>
			<IconReceipt size={16} />
			<span>Pengajuan Saya</span>
			<span class="px-2 py-0.5 rounded-full text-[11px] {tab === 'saya' ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-300'}">
				{listMeta?.total ?? requests.length}
			</span>
		</button>

		<button
			type="button"
			class="px-4 py-2 rounded-xl text-xs md:text-sm font-bold transition-all flex items-center gap-2 relative {tab === 'persetujuan'
				? 'gradient-bg text-white shadow-md'
				: 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/60'}"
			onclick={() => (tab = 'persetujuan')}
		>
			<IconCheck size={16} />
			<span>Persetujuan Tim</span>
			{#if atasanRequests.length > 0}
				<span class="px-2 py-0.5 rounded-full text-[11px] bg-amber-500 text-slate-900 font-black animate-pulse">
					{atasanRequests.length}
				</span>
				{#if oldestWaitDays(atasanRequests) >= 1}
					<Tooltip text="Umur tiket tertua yang menunggu Anda (hari kerja)" position="bottom"><span class="text-[10px] opacity-80">tertua {oldestWaitDays(atasanRequests)} hari</span></Tooltip>
				{/if}
			{/if}
		</button>
	</div>

	<!-- Loading State -->
	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data kas kecil ESS..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-6 border border-red-500/30 text-center max-w-lg mx-auto">
			<div class="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-3">
				<IconAlertTriangle size={24} />
			</div>
			<p class="text-sm font-bold text-red-400 mb-2">Gagal Memuat Kas Kecil</p>
			<p class="text-xs text-slate-400 mb-4">{errorMsg}</p>
			<button class="px-4 py-2 rounded-xl text-xs font-bold text-white gradient-bg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else if tab === 'persetujuan'}
		<!-- TAB 2: PERSETUJUAN TIM (ATASAN) -->
		<div class="mb-4">
			<p class="text-xs text-slate-400">
				Pengajuan kas kecil dari anggota tim yang membutuhkan persetujuan Anda sebagai atasan langsung. Tiket ini juga tampil di Approval Center — cukup putuskan di salah satu. Periksa foto nota &amp; keperluan; Tolak bila bukan kebutuhan kantor, Minta Revisi bila data kurang.
			</p>
		</div>

		{#if atasanRequests.length === 0}
			<div class="glass-panel rounded-3xl p-12 text-center border border-slate-800">
				<div class="w-16 h-16 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto mb-4">
					<IconCheck size={32} />
				</div>
				<h3 class="text-base font-extrabold text-slate-200">Tidak Ada Antrean Persetujuan</h3>
				<p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
					Semua pengajuan kas kecil dari tim Anda telah diproses.
				</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each atasanRequests as r (r.id)}
					<div class="hover-lift glass-panel rounded-2xl p-5 border border-slate-700/60 relative overflow-hidden">
						<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
							<div class="min-w-0">
								<div class="flex items-center gap-2 flex-wrap mb-1">
									<span class="text-sm font-black text-slate-100">#{r.request_number}</span>
									<span class="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
										{r.requester_name || 'Anggota Tim'}
									</span>
									{#if r.delegated_from_name}
										<Tooltip text="Atasan aslinya sedang cuti; tiket dialihkan ke Anda lewat delegasi." position="bottom"><span class="text-[10px] font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">Atas nama {r.delegated_from_name} (delegasi)</span></Tooltip>
									{/if}
									{#if waitingInfo(r)}
										<span class="text-[10px] text-amber-400">⏳ {waitingInfo(r)?.label}</span>
									{/if}
									{#if (r.bukti_file || []).length}
										<button type="button" class="text-[10px] font-bold text-emerald-300 underline disabled:opacity-40" disabled={notaLoadingId === r.id} title="Periksa foto nota sebelum menyetujui" onclick={() => openNota(r)}>
											{notaLoadingId === r.id ? 'Memuat nota…' : `🧾 Lihat nota (${(r.bukti_file || []).length})`}
										</button>
									{:else}
										<span class="text-[10px] text-slate-500">Tanpa foto nota</span>
									{/if}
									{#if r.receipt_number}<span class="text-[10px] text-slate-400">No. nota {r.receipt_number}</span>{/if}
									{#if r.payee_name}<span class="text-[10px] text-slate-400">Penerima: {r.payee_name}</span>{/if}
									<button type="button" class="text-[10px] font-bold text-sky-300 underline" onclick={() => openHistory(r)}>Riwayat</button>
									<span class="text-[10px] font-bold px-2 py-0.5 rounded-md {r.mode === 'advance' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'}">
										{r.mode === 'advance' ? 'UANG MUKA' : 'REIMBURSE'}
									</span>
								</div>

								<div class="flex items-center gap-2 text-xs text-slate-400 mb-2">
									<span>{fundName(r)}</span>
									<span>•</span>
									<span>{tgl(r.request_date)}</span>
									{#if r.needed_date}
										<span>•</span>
										<span class="text-purple-400">Dibutuhkan: {tgl(r.needed_date)}</span>
									{/if}
								</div>

								<p class="text-sm text-slate-300 font-medium leading-relaxed bg-slate-900/50 p-3 rounded-xl border border-slate-800">
									{r.description}
								</p>

								{#if r.payee_name}
									<p class="text-xs text-slate-400 mt-2">
										Dibayarkan ke: <strong class="text-slate-300">{r.payee_name}</strong>
									</p>
								{/if}
							</div>

							<div class="sm:text-right shrink-0">
								<p class="text-xs text-slate-400">Nominal Diajukan</p>
								<p class="text-xl font-black text-slate-100 mt-0.5">{rupiah(r.amount)}</p>
							</div>
						</div>

						<!-- Atasan Actions -->
						<div class="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-slate-800">
							<button
								type="button"
								class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-all disabled:opacity-40"
								disabled={busyId === r.id}
								onclick={() => openAtasanModal(r, 'revisi')}
							>
								Minta Revisi
							</button>
							<button
								type="button"
								class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 transition-all disabled:opacity-40"
								disabled={busyId === r.id}
								onclick={() => openAtasanModal(r, 'reject')}
							>
								Tolak
							</button>
							<button
								type="button"
								class="px-4 py-1.5 rounded-xl text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-500 transition-all shadow-md disabled:opacity-40"
								disabled={busyId === r.id}
								onclick={() => openAtasanModal(r, 'approve')}
							>
								Setujui
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<!-- TAB 1: PENGAJUAN SAYA -->
		<!-- Search & Filter Controls -->
		<div class="glass-panel rounded-2xl p-3 md:p-4 border border-slate-700/60 mb-5 space-y-3">
			<div class="flex flex-col sm:flex-row gap-2.5">
				<!-- Search Box -->
				<div class="relative flex-1">
					<IconSearch size={16} class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
					<input
						type="text"
						class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-700/80 bg-slate-900/80 text-xs md:text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
						placeholder="Cari nomor tiket, keperluan, atau dana kas..."
						bind:value={searchQuery}
					/>
					{#if searchQuery}
						<button
							type="button"
							class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
							onclick={() => (searchQuery = '')}
						>
							<IconX size={14} />
						</button>
					{/if}
				</div>

				<!-- Status Filter Pills -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 hide-scrollbar">
					{#each [
						['all', 'Semua'],
						['menunggu', 'Menunggu Review'],
						['revisi', 'Perlu Revisi'],
						['cair', 'Disetujui / Cair'],
						['lpj', 'Perlu LPJ'],
						['selesai_batal', 'Ditolak / Batal']
					] as [val, label]}
						<button
							type="button"
							class="px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all {statusFilter === val
								? 'bg-blue-600 text-white shadow-sm'
								: 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 border border-slate-700/40'}"
							onclick={() => (statusFilter = val)}
						>
							{label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<p class="text-[11px] text-slate-400 mb-3">💡 Status kuning = perlu tindakan Anda. Tekan <b>Riwayat</b> untuk melihat siapa yang sedang memproses.</p>

		<!-- Empty State (No Data) -->
		{#if requests.length === 0}
			<div class="glass-panel rounded-3xl p-10 md:p-16 text-center border border-slate-700/60 relative overflow-hidden">
				<div class="w-20 h-20 rounded-3xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-5 text-blue-400 shadow-inner">
					<IconReceiptTax size={40} />
				</div>
				<h3 class="text-xl font-black text-slate-100 tracking-tight">Belum Ada Pengajuan Kas Kecil</h3>
				<p class="text-xs md:text-sm text-slate-400 max-w-md mx-auto mt-2 leading-relaxed">
					Ajukan klaim reimbursement pengeluaran pribadi yang sudah dibayar, atau ajukan uang muka kas kecil untuk keperluan dinas/proyek.
				</p>
				<button
					type="button"
					class="mt-6 px-6 py-3 rounded-2xl text-sm font-extrabold text-white gradient-bg shadow-xl hover:opacity-90 active:scale-95 transition-all inline-flex items-center gap-2"
					onclick={() => goto('/ess/petty-cash/baru')}
				>
					<IconPlus size={18} stroke={3} />
					<span>Buat Pengajuan Pertama</span>
				</button>
			</div>
		{:else if filteredRequests.length === 0}
			<!-- Empty Filter State -->
			<div class="glass-panel rounded-3xl p-10 text-center border border-slate-800">
				<IconInfoCircle size={32} class="text-slate-500 mx-auto mb-3" />
				<p class="text-sm font-bold text-slate-300">Tidak ada data yang cocok</p>
				<p class="text-xs text-slate-500 mt-1">Coba sesuaikan kata kunci pencarian atau filter status Anda.</p>
				<button
					type="button"
					class="mt-4 px-4 py-2 rounded-xl text-xs font-bold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 transition-all"
					onclick={() => { searchQuery = ''; statusFilter = 'all'; }}
				>
					Reset Filter
				</button>
			</div>
		{:else}
			<!-- Request List Cards -->
			<div class="space-y-3.5">
				{#each filteredRequests as r (r.id)}
					{@const sc = statusColor(r.status)}
					{@const dept = fundDepartment(r)}
					<div class="hover-lift glass-panel rounded-2xl p-4 md:p-5 border border-slate-700/60 relative overflow-hidden transition-all">
						<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
							<!-- Left Column -->
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2 flex-wrap mb-1.5">
									<span class="text-sm md:text-base font-black text-slate-100">#{r.request_number}</span>

									<!-- Mode Badge -->
									<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-md {r.mode === 'advance'
										? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
										: 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
										{r.mode === 'advance' ? 'UANG MUKA' : 'REIMBURSE'}
									</span>

									<!-- Status Badge -->
									<span
										class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border shadow-sm"
										style="background: {sc.bg}; color: {sc.text}; border-color: {sc.border}"
									>
										{pettyCashStatusLabel(r)}
									</span>
									{#if r.is_inventory_in}
										<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
											📦 STOK GUDANG
										</span>
									{/if}
									<!-- PC3-15: lama menunggu + pengingat otomatis → tak perlu bertanya manual -->
									{#if waitingInfo(r)}
										<Tooltip text="Sistem mengirim pengingat otomatis ke orang yang perlu memutuskan." position="bottom"><span class="text-[10px] text-amber-400">⏳ {waitingInfo(r)?.label}</span></Tooltip>
									{/if}
									<button type="button" class="text-[10px] font-bold text-sky-300 underline" title="Lihat siapa yang sedang memproses pengajuan ini" onclick={() => openHistory(r)}>Riwayat</button>
								</div>

								<!-- Fund & Date Info -->
								<div class="flex items-center gap-2 text-xs text-slate-400 mb-2 flex-wrap">
									<span class="flex items-center gap-1 font-semibold text-slate-300">
										<IconBuildingBank size={14} class="text-slate-400" />
										{fundName(r)}
									</span>
									{#if dept}
										<span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-medium">
											{dept}
										</span>
									{/if}
									<span>•</span>
									<span>Diajukan {tgl(r.request_date)}</span>
									{#if r.needed_date}
										<span>•</span>
										<span class="text-purple-400">Target cair: {tgl(r.needed_date)}</span>
									{/if}
								</div>

								<!-- Description -->
								<p class="text-xs md:text-sm text-slate-200 font-medium leading-relaxed bg-slate-900/60 p-3 rounded-xl border border-slate-800/90">
									{r.description}
								</p>

								<!-- Stock-IN Details Badge -->
								{#if r.is_inventory_in}
									<div class="mt-2 px-3 py-1.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-xs text-emerald-300 flex items-center justify-between flex-wrap gap-2">
										<span class="flex items-center gap-1.5 font-medium">
											<span>📦</span>
											<span>Masuk Stok Persediaan: <strong class="text-emerald-200">{typeof r.inventory_item_id === 'object' && r.inventory_item_id ? ((r.inventory_item_id as any).nama_barang_lengkap || 'Barang Inventori') : 'Barang Inventori'}</strong></span>
										</span>
										{#if r.inventory_qty}
											<span class="font-bold text-emerald-200 bg-emerald-500/20 px-2 py-0.5 rounded text-[11px]">
												Qty: {r.inventory_qty} {typeof r.inventory_item_id === 'object' && (r.inventory_item_id as any)?.satuan ? (r.inventory_item_id as any).satuan : ''}
											</span>
										{/if}
									</div>
								{/if}

								<!-- Extra Details (Vendor & Nota) -->
								{#if r.payee_name || r.receipt_number}
									<div class="flex items-center gap-3 text-xs text-slate-400 mt-2 flex-wrap">
										{#if r.payee_name}
											<span>Vendor / Penerima: <strong class="text-slate-300">{r.payee_name}</strong></span>
										{/if}
										{#if r.receipt_number}
											<span>No. Nota: <strong class="text-slate-300">{r.receipt_number}</strong></span>
										{/if}
									</div>
								{/if}

								<!-- BUG-15: alasan revisi/tolak dari atasan, Finance Pusat, atau kasir (bukan hanya reject_reason) -->
								{#each collectDecisionNotes(r) as n (n.role + n.text)}
									<div class="mt-3 p-3 rounded-xl border text-xs flex items-start gap-2 {r.status === 'revisi' || n.role === 'kasir_lpj' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-red-500/10 border-red-500/30 text-red-400'}">
										<IconAlertCircle size={16} class="shrink-0 mt-0.5" />
										<div>
											<span class="font-bold">{r.status === 'revisi' || n.role === 'kasir_lpj' ? 'Perlu diperbaiki' : 'Alasan penolakan'} — {n.label}:</span> {n.text}
										</div>
									</div>
								{/each}

								<!-- LPJ Status Alert -->
								{#if r.mode === 'advance' && r.advance_settlement_status}
									<div class="mt-2 text-xs flex items-center gap-2">
										<span class="text-slate-400">Status LPJ:</span>
										<span class="font-bold px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30">
											{SETTLEMENT_LABEL[r.advance_settlement_status] || r.advance_settlement_status}
										</span>
										{#if r.settlement_amount}
											<span class="text-slate-400">
												Realisasi: <strong class="text-slate-200">{rupiah(r.settlement_amount)}</strong>
											</span>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Right Column: Amount & Difference -->
							<div class="sm:text-right shrink-0 flex flex-row sm:flex-col justify-between sm:justify-start items-center sm:items-end border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-800">
								<div>
									<p class="text-[11px] text-slate-400 sm:text-right">Nominal Pengajuan</p>
									<p class="text-base md:text-xl font-black text-slate-100 tracking-tight">{rupiah(r.amount)}</p>
									{#if r.approved_amount != null && Number(r.approved_amount) !== Number(r.amount)}
										<p class="text-[11px] font-bold text-emerald-400 mt-0.5">
											Disetujui {rupiah(r.approved_amount)}
										</p>
									{/if}
								</div>
							</div>
						</div>

						<!-- Action Footer (LPJ / Cancel) -->
						{#if canCancel(r) || canLpj(r)}
							<div class="flex items-center justify-end gap-2.5 mt-3 pt-3 border-t border-slate-800">
								{#if canLpj(r)}
									<button
										type="button"
										class="px-4 py-1.5 rounded-xl text-xs font-extrabold text-white bg-purple-600 hover:bg-purple-500 transition-all shadow-md flex items-center gap-1.5 active:scale-95"
										disabled={busyId === r.id}
										onclick={() => openLpjModal(r)}
									>
										<IconWallet size={15} />
										<span>{r.advance_settlement_status === 'revisi' ? 'Perbaiki & Kirim Ulang LPJ' : 'Laporkan Nota (LPJ)'}</span>
									</button>
								{/if}
								{#if r.status === 'revisi'}
									<!-- FLD-01: perbaiki & kirim ulang (nomor tiket tetap) — sebelumnya hanya bisa Batalkan -->
									<button
										type="button"
										class="px-4 py-1.5 rounded-xl text-xs font-extrabold text-white bg-blue-600 hover:bg-blue-500 transition-all shadow-md active:scale-95 disabled:opacity-40"
										disabled={busyId === r.id}
										onclick={() => goto(`/ess/petty-cash/baru?edit=${r.id}`)}
									>
										Perbaiki &amp; Kirim Ulang
									</button>
								{/if}
								{#if canCancel(r)}
									<button
										type="button"
										class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30 transition-all disabled:opacity-40 active:scale-95"
										disabled={busyId === r.id}
										onclick={() => openCancelModal(r)}
									>
										Batalkan
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="flex items-center justify-between text-[11px] text-slate-400 mt-3">
				<span>
					Menampilkan {requests.length} dari {listMeta?.total ?? requests.length}
					{#if (listMeta?.pinned ?? 0) > 0}· <b class="text-amber-400">{listMeta?.pinned} perlu tindakan Anda ada di atas</b>{/if}
				</span>
				{#if (listMeta?.total ?? 0) > listLimit && listLimit < 100}
					<button class="px-3 py-1.5 rounded-xl border border-slate-600 text-slate-200 font-semibold disabled:opacity-40" disabled={loadingMore} onclick={loadMore}>
						{loadingMore ? 'Memuat…' : 'Muat lagi'}
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- MODAL 1: LPJ Pelaporan Nota Uang Muka -->
{#if lpjModalOpen && lpjTarget}
	<div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="relative max-w-md w-full bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden">
			<div class="p-5 border-b border-slate-800 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<div class="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
						<IconWallet size={18} />
					</div>
					<div>
						<h3 class="text-sm font-extrabold text-slate-100">{lpjTarget.advance_settlement_status === 'revisi' ? 'Perbaiki & Kirim Ulang LPJ' : 'Kirim LPJ Kas Kecil'}</h3>
						<p class="text-[10px] text-slate-400 mt-0.5">
							Serahkan sisa uang &amp; nota asli ke kasir.{lpjBatasHari > 0 ? ` LPJ paling lambat ${lpjBatasHari} hari setelah uang cair.` : ''}
						</p>
					</div>
				</div>
				<button
					class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
					onclick={() => (lpjModalOpen = false)}
				>
					<IconX size={16} />
				</button>
			</div>

			<div class="p-5 space-y-4">
				<div class="p-3.5 rounded-2xl bg-slate-800/70 border border-slate-700/60 text-xs space-y-1.5">
					<div class="flex justify-between text-slate-400">
						<span>Nomor Tiket:</span>
						<strong class="text-slate-200">#{lpjTarget.request_number}</strong>
					</div>
					<div class="flex justify-between text-slate-400">
						<span>Uang muka yang Anda terima:</span>
						<strong class="text-purple-400 text-sm">{rupiah(lpjTarget.approved_amount ?? lpjTarget.amount)}</strong>
					</div>
				</div>

				<div>
					<label class="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-1.5" for="lpj-amount">
						Total belanja sesuai nota (Rp) <span class="text-red-400">*</span>
					</label>
					<input
						id="lpj-amount"
						type="text"
						inputmode="numeric"
						class="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-950 text-base font-black text-slate-100 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none"
						placeholder="0"
						value={lpjRealizationInput}
						oninput={(e) => {
							const clean = (e.target as HTMLInputElement).value.replace(/\D/g, '');
							lpjRealizationInput = clean ? Number(clean).toLocaleString('id-ID') : '';
							saveLpjDraft();
						}}
					/>
					<p class="text-[10px] text-slate-500 mt-1">Isi sesuai total di nota — angka tidak terisi otomatis.</p>
				</div>

				<!-- Kalkulasi Selisih -->
				{#if lpjRealizationNum > 0}
					<div class="p-3 rounded-xl text-xs border {lpjDifference > 0
						? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
						: lpjDifference < 0
							? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
							: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}">
						<div class="flex justify-between font-bold">
							<span>{lpjDifference > 0 ? 'Sisa yang harus dikembalikan ke kasir:' : lpjDifference < 0 ? 'Kurang bayar (klaim tambahan) — wajib isi alasan:' : 'Realisasi pas:'}</span>
							<span>{rupiah(Math.abs(lpjDifference))}</span>
						</div>
					</div>
				{/if}

				<!-- Alasan kelebihan (muncul saat belanja melebihi uang muka) -->
				{#if lpjOverage}
					<div>
						<label class="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-1.5" for="lpj-overage">Alasan kelebihan</label>
						<input
							id="lpj-overage"
							type="text"
							class="w-full px-3 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-xs text-slate-100 focus:border-amber-500 outline-none"
							placeholder="Contoh: harga material naik mendadak"
							bind:value={lpjOverageReason}
							oninput={saveLpjDraft}
						/>
					</div>
				{/if}

				<!-- Foto nota (maks 5) -->
				<div>
					<div class="flex items-center justify-between mb-1.5">
						<span class="text-xs font-bold uppercase tracking-wider text-slate-300">Foto nota ({lpjFiles.length}/{LPJ_MAX_FILES})</span>
						{#if lpjCompressing}<span class="text-[11px] text-amber-400 font-semibold">Memperkecil foto…</span>{/if}
					</div>
					{#if lpjPreviews.length}
						<div class="grid grid-cols-3 gap-2 mb-2">
							{#each lpjPreviews as src, i (src)}
								<div class="relative rounded-xl overflow-hidden border border-slate-700 aspect-square">
									<img {src} alt="Nota {i + 1}" class="w-full h-full object-cover" />
									<button type="button" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs" onclick={() => removeLpjPhoto(i)} aria-label="Hapus foto {i + 1}">✕</button>
									<span class="absolute bottom-1 left-1 text-[9px] px-1 rounded bg-black/70 text-slate-200">± {Math.max(1, Math.round((lpjFiles[i]?.size || 0) / 1024))} KB</span>
								</div>
							{/each}
						</div>
					{/if}
					{#if lpjFiles.length < LPJ_MAX_FILES}
						<label class="block w-full text-center px-3 py-2.5 rounded-xl border border-dashed border-slate-600 text-xs font-semibold text-slate-300 cursor-pointer hover:border-purple-500">
							📷 Ambil / pilih foto nota
							<input type="file" accept="image/*" capture="environment" multiple class="hidden" onchange={onLpjPhotos} />
						</label>
					{/if}
					{#if lpjNeedsPhoto}
						<p class="text-[11px] text-amber-400 mt-1.5">Foto nota wajib untuk nominal ini. Bila foto gagal, kasir tetap menerima nota asli — tetapi LPJ bisa ditolak bila aturan sudah ketat.</p>
					{:else}
						<p class="text-[10px] text-slate-500 mt-1.5">Foto membantu kasir mencocokkan angka dengan nota; tersimpan di HP bila sinyal putus.</p>
					{/if}
				</div>

				{#if lpjError}
					<p class="text-xs text-red-400">{lpjError}</p>
				{/if}
			</div>

			<div class="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-950/40">
				<button
					class="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200"
					onclick={() => (lpjModalOpen = false)}
				>
					Batal
				</button>
				<button
					class="px-5 py-2.5 rounded-xl text-xs font-extrabold text-white bg-purple-600 hover:bg-purple-500 transition-all flex items-center gap-2 disabled:opacity-40"
					disabled={lpjSubmitting || lpjRealizationNum <= 0}
					onclick={() => submitLpj(false)}
				>
					{#if lpjSubmitting}<IconLoader2 size={15} class="animate-spin" />{/if}
					<span>{lpjTarget.advance_settlement_status === 'revisi' ? 'Kirim Ulang LPJ' : 'Kirim Laporan LPJ'}</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- U7: Riwayat tiket -->
{#if historyTarget}
	<div class="fixed inset-0 z-[60] bg-black/80 flex items-end sm:items-center justify-center p-4">
		<div class="max-w-md w-full max-h-[80vh] overflow-y-auto bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl p-5">
			<div class="flex items-center justify-between mb-3">
				<h3 class="text-sm font-extrabold text-slate-100">Riwayat #{historyTarget.request_number}</h3>
				<button class="w-8 h-8 rounded-full bg-slate-800 text-slate-400" onclick={() => (historyTarget = null)} aria-label="Tutup">✕</button>
			</div>
			{#if historyLoading}
				<p class="text-xs text-slate-400">Memuat riwayat…</p>
			{:else if historyError}
				<p class="text-xs text-red-400">{historyError}</p>
			{:else if historyRows.length === 0}
				<p class="text-xs text-slate-400">Belum ada catatan.</p>
			{:else}
				<ol class="space-y-2.5 border-l border-slate-700 pl-4">
					{#each historyRows as h, i (i)}
						<li class="relative text-xs">
							<span class="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-sky-500"></span>
							<div class="font-semibold text-slate-100">{h.label}</div>
							<div class="text-slate-400">{fmtWhen(h.when)}{h.who ? ` · ${h.who}` : ''}</div>
							{#if h.note}<div class="text-slate-300 mt-0.5">"{h.note}"</div>{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	</div>
{/if}

<!-- U2: foto nota (diperbesar) -->
{#if notaUrl}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-3" onclick={closeNota}>
		<img src={notaUrl} alt="Foto nota" class="max-h-[90vh] max-w-full rounded-xl" />
		<button class="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/70 text-white" onclick={closeNota} aria-label="Tutup">✕</button>
	</div>
{/if}

<!-- MODAL: konfirmasi nominal tak wajar (LPJ_OUTLIER) — pengganti alert() -->
{#if lpjOutlierMessage}
	<div class="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
		<div class="max-w-sm w-full bg-slate-900 rounded-3xl border border-amber-500/40 shadow-2xl p-5 space-y-3">
			<h3 class="text-sm font-extrabold text-amber-300">Periksa angka Anda</h3>
			<p class="text-xs text-slate-300 leading-relaxed">{lpjOutlierMessage}</p>
			<div class="flex justify-end gap-2 pt-1">
				<button class="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 border border-slate-600" onclick={() => (lpjOutlierMessage = '')}>Perbaiki angka</button>
				<button class="px-4 py-2 rounded-xl text-xs font-extrabold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-40" disabled={lpjSubmitting} onclick={() => { lpjOutlierMessage = ''; void submitLpj(true); }}>Ya, angka ini benar</button>
			</div>
		</div>
	</div>
{/if}

<!-- MODAL 2: Aksi Atasan (Setuju / Tolak / Minta Revisi) -->
{#if atasanModalOpen && atasanTarget}
	<div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="relative max-w-md w-full bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden">
			<div class="p-5 border-b border-slate-800 flex items-center justify-between">
				<h3 class="text-sm font-extrabold text-slate-100">
					{atasanActionKind === 'approve' ? 'Konfirmasi Persetujuan Atasan' : atasanActionKind === 'reject' ? 'Tolak Pengajuan Kas Kecil' : 'Minta Revisi Pengajuan'}
				</h3>
				<button
					class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
					onclick={() => (atasanModalOpen = false)}
				>
					<IconX size={16} />
				</button>
			</div>

			<div class="p-5 space-y-4">
				<div class="p-3.5 rounded-2xl bg-slate-800/70 border border-slate-700/60 text-xs space-y-1">
					<p class="font-bold text-slate-200">#{atasanTarget.request_number} · {atasanTarget.requester_name || 'Pemohon'}</p>
					<p class="text-slate-400">{fundName(atasanTarget)} · {rupiah(atasanTarget.amount)}</p>
					<p class="text-slate-300 italic mt-1">"{atasanTarget.description}"</p>
				</div>

				{#if atasanActionKind !== 'approve'}
					<div>
						<label class="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-1.5" for="atasan-note">
							{atasanActionKind === 'reject' ? 'Alasan Penolakan' : 'Bagian yang Perlu Diperbaiki'} <span class="text-red-400">*</span>
						</label>
						<textarea
							id="atasan-note"
							rows="3"
							class="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-xs text-slate-100 focus:border-blue-500 outline-none resize-none"
							placeholder={atasanActionKind === 'reject' ? 'Tuliskan alasan penolakan...' : 'Tuliskan catatan perbaikan untuk pemohon...'}
							bind:value={atasanNote}
						></textarea>
					</div>
				{:else}
					<p class="text-xs text-slate-300 leading-relaxed">
						Dengan menyetujui, pengajuan ini akan diteruskan ke <strong>Kasir Kas Kecil</strong> untuk pencairan dana operasional.
					</p>
				{/if}

				{#if atasanError}
					<p class="text-xs text-red-400">{atasanError}</p>
				{/if}
			</div>

			<div class="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-950/40">
				<button
					class="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200"
					onclick={() => (atasanModalOpen = false)}
				>
					Batal
				</button>
				<button
					class="px-5 py-2.5 rounded-xl text-xs font-extrabold text-white transition-all flex items-center gap-2 disabled:opacity-40 {atasanActionKind === 'approve'
						? 'bg-emerald-600 hover:bg-emerald-500'
						: atasanActionKind === 'reject'
							? 'bg-red-600 hover:bg-red-500'
							: 'bg-amber-600 hover:bg-amber-500'}"
					disabled={atasanSubmitting || (atasanActionKind !== 'approve' && !atasanNote.trim())}
					onclick={submitAtasanAction}
				>
					{#if atasanSubmitting}<IconLoader2 size={15} class="animate-spin" />{/if}
					<span>{atasanActionKind === 'approve' ? 'Ya, Setujui' : atasanActionKind === 'reject' ? 'Tolak Pengajuan' : 'Kirim Catatan Revisi'}</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- MODAL 3: Konfirmasi Pembatalan -->
{#if cancelModalOpen && cancelTarget}
	<div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="relative max-w-sm w-full bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden p-6 text-center">
			<div class="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-3">
				<IconAlertTriangle size={24} />
			</div>
			<h3 class="text-base font-black text-slate-100">Batalkan Pengajuan?</h3>
			<p class="text-xs text-slate-400 mt-1.5 leading-relaxed">
				Tiket <strong class="text-slate-200">#{cancelTarget.request_number}</strong> sebesar {rupiah(cancelTarget.amount)} akan dibatalkan secara permanen.
			</p>
			<div class="flex items-center justify-center gap-2.5 mt-6">
				<button
					class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 bg-slate-800/80"
					onclick={() => (cancelModalOpen = false)}
				>
					Jangan Batalkan
				</button>
				<button
					class="px-5 py-2.5 rounded-xl text-xs font-extrabold text-white bg-red-600 hover:bg-red-500 transition-all flex items-center gap-1.5 disabled:opacity-40"
					disabled={cancelSubmitting}
					onclick={submitCancel}
				>
					{#if cancelSubmitting}<IconLoader2 size={15} class="animate-spin" />{/if}
					<span>Ya, Batalkan</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Ekspor Sheet -->
<EssExportSheet
	open={sheetOpen}
	onClose={() => (sheetOpen = false)}
	judul="Riwayat Kas Kecil Lapangan"
	filename="kas-kecil-saya"
	columns={exportColumns}
	rows={exportRows}
	watermark="Dokumen Internal Lapangan — PT Eltama Prima Indo"
/>
