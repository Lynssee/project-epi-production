<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getDisiplinStatus, type DisiplinStatus, type TelatItem } from '$lib/services/ess/disiplinStatus';
	import { getMySanksi, acknowledgeSanksi, submitBanding, type SanksiRecord } from '$lib/services/ess/sanksi';
	import {
		getMyDendaProsedural,
		ajukanKlarifikasiDenda,
		type DendaProseduralLog
	} from '$lib/services/ess/dendaProsedural';
	import {
		IconArrowLeft,
		IconLoader2,
		IconAlertTriangle,
		IconClock,
		IconCoin,
		IconFileCheck,
		IconGavel,
		IconShieldCheck,
		IconInfoCircle,
		IconRefresh,
		IconCalendarTime,
		IconCalendar,
		IconCheck,
		IconX,
		IconChevronRight,
		IconFileDescription,
		IconAlertCircle,
		IconTrendingUp
	} from '@tabler/icons-svelte';

	// State Utama
	let loading = $state(true);
	let errorMsg = $state('');
	let data = $state<DisiplinStatus | null>(null);

	// State Sanksi
	let sanksiList = $state<SanksiRecord[]>([]);
	let sanksiLoading = $state(true);
	let sanksiError = $state('');
	let ackingId = $state<number | null>(null);
	let bandingOpenId = $state<number | null>(null);
	let bandingAlasan = $state('');
	let bandingSubmitting = $state(false);

	// Tab Navigasi Aktif
	let activeTab = $state<'log' | 'sanksi' | 'prosedural' | 'kebijakan'>('log');

	// Fase 3 — Catatan Prosedural (denda prosedural, read-only + ajukan klarifikasi)
	let dendaLogs = $state<DendaProseduralLog[]>([]);
	let dendaLoading = $state(true);
	let dendaError = $state('');
	let klarifikasiOpenId = $state<number | null>(null);
	let klarifikasiAlasan = $state('');
	let klarifikasiSubmitting = $state(false);

	// Helper format Rupiah
	function formatRupiah(n: number | null | undefined): string {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	// Helper format tanggal Indonesia
	function formatTanggalIndo(dateStr: string | null | undefined): string {
		if (!dateStr) return '-';
		try {
			const [y, m, d] = dateStr.split('-');
			if (!y || !m || !d) return dateStr;
			const date = new Date(Number(y), Number(m) - 1, Number(d));
			return date.toLocaleDateString('id-ID', {
				weekday: 'short',
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			});
		} catch {
			return dateStr;
		}
	}

	// Helper format nama bulan periode
	function formatNamaPeriode(periodeStr: string | undefined): string {
		if (!periodeStr) return 'Bulan Ini';
		try {
			const [y, m] = periodeStr.split('-');
			const date = new Date(Number(y), Number(m) - 1, 1);
			return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
		} catch {
			return periodeStr;
		}
	}

	async function loadAll() {
		loading = true;
		errorMsg = '';
		try {
			const [statusRes] = await Promise.all([getDisiplinStatus(), loadSanksi(), loadDenda()]);
			data = statusRes;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat status kedisiplinan.';
		} finally {
			loading = false;
		}
	}

	async function loadSanksi() {
		sanksiLoading = true;
		sanksiError = '';
		try {
			sanksiList = await getMySanksi();
		} catch (err: any) {
			sanksiError = err?.message || 'Gagal memuat riwayat sanksi.';
		} finally {
			sanksiLoading = false;
		}
	}

	async function loadDenda() {
		dendaLoading = true;
		dendaError = '';
		try {
			dendaLogs = await getMyDendaProsedural();
		} catch (err: any) {
			dendaError = err?.message || 'Gagal memuat catatan prosedural.';
		} finally {
			dendaLoading = false;
		}
	}

	function toggleKlarifikasi(id: number) {
		klarifikasiOpenId = klarifikasiOpenId === id ? null : id;
		klarifikasiAlasan = '';
	}

	async function handleSubmitKlarifikasi(id: number) {
		if (klarifikasiAlasan.trim().length < 10) {
			dendaError = 'Alasan klarifikasi wajib diisi minimal 10 karakter.';
			return;
		}
		klarifikasiSubmitting = true;
		dendaError = '';
		try {
			await ajukanKlarifikasiDenda(id, klarifikasiAlasan.trim());
			klarifikasiOpenId = null;
			klarifikasiAlasan = '';
			await loadDenda();
		} catch (err: any) {
			dendaError = err?.message || 'Gagal mengajukan klarifikasi.';
		} finally {
			klarifikasiSubmitting = false;
		}
	}

	const DENDA_STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
		pending: { txt: 'Tercatat — menunggu tinjauan HRD', cls: 'bg-slate-500/15 text-slate-500' },
		dikonfirmasi: { txt: 'Dikonfirmasi HRD', cls: 'bg-amber-500/15 text-amber-600' },
		dibebaskan: { txt: 'Dibebaskan HRD', cls: 'bg-emerald-500/15 text-emerald-600' },
		dibatalkan: { txt: 'Dibatalkan', cls: 'bg-slate-400/15 text-slate-400 line-through' }
	};

	async function handleAck(id: number) {
		ackingId = id;
		try {
			await acknowledgeSanksi(id);
			await loadSanksi();
		} catch (err: any) {
			sanksiError = err?.message || 'Gagal konfirmasi terima sanksi.';
		} finally {
			ackingId = null;
		}
	}

	function toggleBandingForm(id: number) {
		if (bandingOpenId === id) {
			bandingOpenId = null;
			bandingAlasan = '';
		} else {
			bandingOpenId = id;
			bandingAlasan = '';
		}
	}

	async function handleSubmitBanding(id: number) {
		if (bandingAlasan.trim().length < 30) {
			sanksiError = 'Alasan banding wajib diisi minimal 30 karakter agar dapat ditinjau oleh HRD.';
			return;
		}
		bandingSubmitting = true;
		sanksiError = '';
		try {
			await submitBanding(id, bandingAlasan.trim());
			bandingOpenId = null;
			bandingAlasan = '';
			await loadSanksi();
		} catch (err: any) {
			sanksiError = err?.message || 'Gagal mengajukan banding sanksi.';
		} finally {
			bandingSubmitting = false;
		}
	}

	onMount(loadAll);

	// Estimasi dampak sanksi aktif ke KPI General
	let sanksiAktifCount = $derived(sanksiList.filter((s) => s.status === 'Aktif').length);
	let poinHilangEstimasi = $derived(
		sanksiAktifCount <= 0 ? 0 : Math.round((100 - 100 / (1 + sanksiAktifCount)) * 10) / 10
	);

	const SANKSI_STATUS_STYLE: Record<string, { text: string; bg: string; border: string }> = {
		Aktif: { text: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.25)' },
		Banding: { text: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.25)' },
		Selesai: { text: '#10B981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.25)' },
		Dibatalkan: { text: '#94A3B8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.25)' }
	};

	// 4 Level Ambang Kedisiplinan
	type LevelTier = 'aman' | 'mendekati_teguran_lisan' | 'mendekati_teguran_tertulis' | 'mendekati_sp';

	interface TierConfig {
		label: string;
		shortLabel: string;
		badgeBg: string;
		badgeText: string;
		borderColor: string;
		description: string;
		guidance: string;
		levelIndex: number;
	}

	const TIERS: Record<LevelTier, TierConfig> = {
		aman: {
			label: 'Status Aman & Disiplin Terjaga',
			shortLabel: 'Aman',
			badgeBg: 'rgba(16, 185, 129, 0.15)',
			badgeText: '#10B981',
			borderColor: 'rgba(16, 185, 129, 0.3)',
			description: 'Tingkat kehadiran Anda memenuhi standar kedisiplinan perusahaan.',
			guidance: 'Pertahankan jam kehadiran tepat waktu untuk menjaga performa skor KPI.',
			levelIndex: 0
		},
		mendekati_teguran_lisan: {
			label: 'Peringatan: Ambang Teguran Lisan',
			shortLabel: 'Teguran Lisan',
			badgeBg: 'rgba(245, 158, 11, 0.15)',
			badgeText: '#F59E0B',
			borderColor: 'rgba(245, 158, 11, 0.35)',
			description: 'Akumulasi keterlambatan telah menyentuh batas Teguran Lisan.',
			guidance: 'Tingkatkan ketepatan waktu hadir agar tidak meningkat ke Teguran Tertulis.',
			levelIndex: 1
		},
		mendekati_teguran_tertulis: {
			label: 'Peringatan Serius: Ambang Teguran Tertulis',
			shortLabel: 'Teguran Tertulis',
			badgeBg: 'rgba(249, 115, 22, 0.15)',
			badgeText: '#F97316',
			borderColor: 'rgba(249, 115, 22, 0.35)',
			description: 'Akumulasi keterlambatan telah menyentuh batas Teguran Tertulis resmi.',
			guidance: 'Waspada eskalasi sanksi ke Surat Peringatan (SP) bila terus berulang.',
			levelIndex: 2
		},
		mendekati_sp: {
			label: 'Risiko Kritis: Ambang Surat Peringatan (SP)',
			shortLabel: 'Surat Peringatan',
			badgeBg: 'rgba(239, 68, 68, 0.18)',
			badgeText: '#EF4444',
			borderColor: 'rgba(239, 68, 68, 0.4)',
			description: 'Akumulasi keterlambatan berada pada level kritis penerbitan SP.',
			guidance: 'Harap segera berkoordinasi dengan atasan dan HRD terkait kendala kehadiran.',
			levelIndex: 3
		}
	};

	let currentTier = $derived<TierConfig>(TIERS[data?.posisiSaatIni || 'aman'] || TIERS.aman);

	// Hitung sisa toleransi sebelum ambang sanksi berikutnya
	let sisaSampaiNext = $derived.by(() => {
		if (!data) return null;
		const telat = data.hariTerlambat || 0;
		const lisan = data.ambang?.teguranLisan || 3;
		const tertulis = data.ambang?.teguranTertulis || 5;
		const sp = data.ambang?.sp || 8;

		if (telat < lisan) {
			return { label: `Sisa ${lisan - telat}x telat lagi menuju ambang Teguran Lisan (${lisan}x)`, sisa: lisan - telat };
		} else if (telat < tertulis) {
			return { label: `Sisa ${tertulis - telat}x telat lagi menuju ambang Teguran Tertulis (${tertulis}x)`, sisa: tertulis - telat };
		} else if (telat < sp) {
			return { label: `Sisa ${sp - telat}x telat lagi menuju ambang Surat Peringatan SP (${sp}x)`, sisa: sp - telat };
		} else {
			return { label: `Telah melampaui batas ambang SP (${sp}x)`, sisa: 0 };
		}
	});
</script>

<div class="w-full max-w-5xl mx-auto p-3 sm:p-5 md:p-6 pb-28 space-y-4 sm:space-y-5">
	<!-- Top Navigation & Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-1 border-b" style="border-color: var(--sys-sep)">
		<div>
			<button
				class="inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors hover:opacity-80 mb-2"
				style="color: var(--sys-label3)"
				onclick={() => goto('/ess')}
			>
				<IconArrowLeft size={16} /> Kembali ke Portal Karyawan
			</button>
			<div class="flex flex-wrap items-center gap-2.5">
				<h1 class="text-lg sm:text-xl font-bold tracking-tight" style="color: var(--sys-label)">
					Status Kehadiran & Kedisiplinan
				</h1>
				{#if data?.periode}
					<span
						class="px-2.5 py-0.5 rounded-full text-[11px] font-bold inline-flex items-center gap-1"
						style="background: var(--pl, rgba(59, 130, 246, 0.12)); color: var(--p, #3B82F6)"
					>
						<IconCalendar size={12} /> {formatNamaPeriode(data.periode)}
					</span>
				{/if}
			</div>
			<p class="text-[11px] sm:text-[12px] mt-0.5" style="color: var(--sys-label3)">
				Monitoring kehadiran dan kalkulasi denda real-time &bull; Estimasi berjalan sebelum payroll final
			</p>
		</div>

		<div class="flex items-center gap-2">
			<button
				class="px-3 py-1.5 rounded-xl text-[12px] font-semibold inline-flex items-center gap-1.5 transition-all glass-panel hover:bg-white/5 active:scale-95"
				style="color: var(--sys-label2); border: 1px solid var(--sys-sep)"
				onclick={loadAll}
				disabled={loading}
			>
				<IconRefresh size={14} class={loading ? 'animate-spin' : ''} />
				<span>Refresh Data</span>
			</button>
		</div>
	</div>

	{#if loading && !data}
		<div class="glass-panel rounded-2xl p-12 flex flex-col items-center justify-center text-center">
			<IconLoader2 size={36} class="animate-spin mb-3" style="color: var(--p, #3B82F6)" />
			<p class="text-[13px] font-bold" style="color: var(--sys-label)">Memuat Status Kedisiplinan...</p>
			<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Mengambil data absensi, riwayat keterlambatan, dan sanksi terbaru</p>
		</div>
	{:else if errorMsg}
		<div class="rounded-2xl p-4 sm:p-5 flex items-start gap-3.5" style="background: var(--rel, rgba(239, 68, 68, 0.1)); border: 1px solid rgba(239, 68, 68, 0.3)">
			<IconAlertTriangle size={20} class="shrink-0 mt-0.5 text-red-500" />
			<div class="flex-1">
				<h4 class="text-[13px] font-bold text-red-600">Gagal Mengambil Data</h4>
				<p class="text-[11px] mt-0.5 text-red-500/90">{errorMsg}</p>
				<button
					class="mt-2.5 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-lg transition-colors"
					onclick={loadAll}
				>
					Coba Lagi
				</button>
			</div>
		</div>
	{:else if data && !data.aktif}
		<div class="glass-panel rounded-2xl p-8 sm:p-12 text-center max-w-lg mx-auto">
			<div class="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-3.5" style="background: var(--pl, rgba(59, 130, 246, 0.12)); color: var(--p, #3B82F6)">
				<IconInfoCircle size={28} />
			</div>
			<h3 class="text-[15px] font-bold" style="color: var(--sys-label)">Kebijakan Belum Diaktifkan</h3>
			<p class="text-[12px] mt-1 leading-relaxed" style="color: var(--sys-label3)">
				Konfigurasi kebijakan kedisiplinan dan denda keterlambatan tahun ini belum diaktifkan oleh HRD. Halaman ini akan menampilkan data secara otomatis setelah kebijakan aktif.
			</p>
		</div>
	{:else if data}
		<!-- 1. Interactive 4-Tier Risk Stepper Banner -->
		<div
			class="glass-panel rounded-2xl p-4 sm:p-5 relative overflow-hidden transition-all"
			style="border: 1px solid {currentTier.borderColor}; background: linear-gradient(135deg, {currentTier.badgeBg} 0%, transparent 65%)"
		>
			<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
				<div class="space-y-1">
					<div class="flex items-center gap-2">
						<span
							class="px-2.5 py-0.5 rounded-md text-[11px] font-black uppercase tracking-wider inline-flex items-center gap-1.5"
							style="background: {currentTier.badgeBg}; color: {currentTier.badgeText}; border: 1px solid {currentTier.borderColor}"
						>
							{#if currentTier.levelIndex === 0}
								<IconShieldCheck size={13} />
							{:else}
								<IconAlertTriangle size={13} />
							{/if}
							{currentTier.label}
						</span>
					</div>
					<p class="text-[12px] font-medium" style="color: var(--sys-label)">
						{currentTier.description}
					</p>
					{#if sisaSampaiNext}
						<p class="text-[11px] font-semibold" style="color: {currentTier.badgeText}">
							&bull; {sisaSampaiNext.label}
						</p>
					{/if}
				</div>

				<!-- Stepper 4 Tingkatan -->
				<div class="flex items-center gap-1.5 sm:gap-2 shrink-0 bg-black/20 p-2 sm:p-2.5 rounded-xl border border-white/5">
					<!-- Step 1: Aman -->
					<div class="flex flex-col items-center text-center px-1 sm:px-2">
						<div
							class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mb-1 transition-all"
							style="background: {currentTier.levelIndex >= 0 ? '#10B981' : 'rgba(255,255,255,0.1)'}; color: #FFFFFF"
						>
							{#if currentTier.levelIndex > 0}
								<IconCheck size={12} />
							{:else}
								1
							{/if}
						</div>
						<span class="text-[9px] font-bold leading-tight" style="color: {currentTier.levelIndex === 0 ? '#10B981' : 'var(--sys-label4)'}">
							Aman<br><span class="text-[8px] opacity-75">0-2x</span>
						</span>
					</div>

					<div class="w-3 sm:w-5 h-0.5 rounded" style="background: {currentTier.levelIndex >= 1 ? '#F59E0B' : 'rgba(255,255,255,0.1)'}"></div>

					<!-- Step 2: Teguran Lisan -->
					<div class="flex flex-col items-center text-center px-1 sm:px-2">
						<div
							class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mb-1 transition-all"
							style="background: {currentTier.levelIndex >= 1 ? '#F59E0B' : 'rgba(255,255,255,0.1)'}; color: #FFFFFF"
						>
							{#if currentTier.levelIndex > 1}
								<IconCheck size={12} />
							{:else}
								2
							{/if}
						</div>
						<span class="text-[9px] font-bold leading-tight" style="color: {currentTier.levelIndex === 1 ? '#F59E0B' : 'var(--sys-label4)'}">
							Lisan<br><span class="text-[8px] opacity-75">{data.ambang?.teguranLisan || 3}x</span>
						</span>
					</div>

					<div class="w-3 sm:w-5 h-0.5 rounded" style="background: {currentTier.levelIndex >= 2 ? '#F97316' : 'rgba(255,255,255,0.1)'}"></div>

					<!-- Step 3: Teguran Tertulis -->
					<div class="flex flex-col items-center text-center px-1 sm:px-2">
						<div
							class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mb-1 transition-all"
							style="background: {currentTier.levelIndex >= 2 ? '#F97316' : 'rgba(255,255,255,0.1)'}; color: #FFFFFF"
						>
							{#if currentTier.levelIndex > 2}
								<IconCheck size={12} />
							{:else}
								3
							{/if}
						</div>
						<span class="text-[9px] font-bold leading-tight" style="color: {currentTier.levelIndex === 2 ? '#F97316' : 'var(--sys-label4)'}">
							Tertulis<br><span class="text-[8px] opacity-75">{data.ambang?.teguranTertulis || 5}x</span>
						</span>
					</div>

					<div class="w-3 sm:w-5 h-0.5 rounded" style="background: {currentTier.levelIndex >= 3 ? '#EF4444' : 'rgba(255,255,255,0.1)'}"></div>

					<!-- Step 4: SP -->
					<div class="flex flex-col items-center text-center px-1 sm:px-2">
						<div
							class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mb-1 transition-all"
							style="background: {currentTier.levelIndex >= 3 ? '#EF4444' : 'rgba(255,255,255,0.1)'}; color: #FFFFFF"
						>
							4
						</div>
						<span class="text-[9px] font-bold leading-tight" style="color: {currentTier.levelIndex === 3 ? '#EF4444' : 'var(--sys-label4)'}">
							SP<br><span class="text-[8px] opacity-75">&ge;{data.ambang?.sp || 8}x</span>
						</span>
					</div>
				</div>
			</div>
		</div>

		<!-- 2. Primary Metrics Cards Grid -->
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
			{#if data.isLeader}
				<!-- Card 1 (Leader): Kepatuhan Kuota 8 Jam & Laporan ERP (Memo HRD 018/MEMO/HRD/VIII/2026) -->
				<div class="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden group">
					<div class="flex items-center justify-between gap-2 mb-2">
						<div class="flex items-center gap-1.5">
							<div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(59, 130, 246, 0.15); color: #3B82F6">
								<IconClock size={16} />
							</div>
							<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">
								Kuota 8 Jam & Laporan ERP
							</span>
						</div>
						<span
							class="px-2 py-0.5 rounded-full text-[10px] font-bold"
							style="background: {data.kepatuhanLaporan?.sudahLaporHariIni ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)'}; color: {data.kepatuhanLaporan?.sudahLaporHariIni ? '#10B981' : '#F59E0B'}"
						>
							{data.kepatuhanLaporan?.sudahLaporHariIni
								? 'Lapor Hari Ini ✓'
								: data.kepatuhanLaporan?.wajibLaporHariIni
									? `Belum Lapor (batas ${data.kepatuhanLaporan?.batasJam || '22:00'})`
									: 'Bukan Hari Wajib'}
						</span>
					</div>

					<div class="my-1.5">
						<div class="flex items-baseline gap-1.5">
							<span class="text-3xl font-black tracking-tight" style="color: {(data.kuotaKerja?.hariKurangKuota || 0) > 0 ? '#F59E0B' : 'var(--sys-label)'}">
								{data.kuotaKerja?.hariKurangKuota || 0}
							</span>
							<span class="text-sm font-bold" style="color: var(--sys-label3)">hari &lt; 8 jam</span>
						</div>
						<p class="text-[10px] mt-1" style="color: var(--sys-label4)">
							Dari {data.kuotaKerja?.hariDievaluasi || 0} hari kerja tercatat bulan ini &bull; {data.kepatuhanLaporan?.hariBolongBulanIni || 0}x laporan bolong
						</p>
					</div>

					<div class="pt-2 border-t mt-1 flex items-center justify-between text-[10px]" style="border-color: var(--sys-sep); color: var(--sys-label4)">
						<span>Jam masuk fleksibel &bull; tanpa denda</span>
						<span class="font-bold" style="color: #10B981">Memo 018</span>
					</div>
				</div>

				<!-- Card 2 (Leader): Bebas Denda Jam Masuk -->
				<div class="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden">
					<div class="flex items-center justify-between gap-2 mb-2">
						<div class="flex items-center gap-1.5">
							<div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(16, 185, 129, 0.15); color: #10B981">
								<IconShieldCheck size={16} />
							</div>
							<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">
								Denda Jam Masuk
							</span>
						</div>
					</div>

					<div class="my-1.5">
						<div class="flex items-baseline gap-1">
							<span class="text-2xl sm:text-3xl font-black tracking-tight" style="color: #10B981">Rp 0</span>
						</div>
						<p class="text-[10px] mt-1" style="color: var(--sys-label4)">
							Project Leader/Coordinator bebas denda keterlambatan & upah lembur reguler — kepatuhan diukur dari kuota 8 jam kerja & laporan harian.
						</p>
					</div>

					<div class="pt-2 border-t mt-1 flex items-center justify-between text-[10px]" style="border-color: var(--sys-sep); color: var(--sys-label4)">
						<span>Referensi</span>
						<span class="italic" style="color: var(--sys-label4)">Memo HRD 018/MEMO/HRD/VIII/2026</span>
					</div>
				</div>
			{:else}
				<!-- Card 1: Akumulasi Terlambat -->
				<div class="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden group">
					<div class="flex items-center justify-between gap-2 mb-2">
						<div class="flex items-center gap-1.5">
							<div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(245, 158, 11, 0.15); color: #F59E0B">
								<IconClock size={16} />
							</div>
							<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">
								Telat Bulan Ini
							</span>
						</div>
						{#if (data.maxMenitTelat || 0) > 0}
							<span class="px-2 py-0.5 rounded-full text-[10px] font-bold" style="background: var(--sys-fill2); color: var(--sys-label3)">
								Max {data.maxMenitTelat} mnt
							</span>
						{/if}
					</div>

					<div class="my-1.5">
						<div class="flex items-baseline gap-1.5">
							<span class="text-3xl font-black tracking-tight" style="color: {(data.hariTerlambat || 0) > 0 ? '#F59E0B' : 'var(--sys-label)'}">
								{data.hariTerlambat || 0}
							</span>
							<span class="text-sm font-bold" style="color: var(--sys-label3)">kali</span>
						</div>

						<!-- Mini Progress Bar towards next tier -->
						<div class="w-full bg-black/20 h-1.5 rounded-full mt-2 overflow-hidden">
							<div
								class="h-full rounded-full transition-all duration-500"
								style="width: {Math.min(100, ((data.hariTerlambat || 0) / (data.ambang?.sp || 8)) * 100)}%; background: {currentTier.badgeText}"
							></div>
						</div>
					</div>

					<div class="pt-2 border-t mt-1 flex items-center justify-between text-[10px]" style="border-color: var(--sys-sep); color: var(--sys-label4)">
						<span>Toleransi: {data.toleransiMenit ?? 5} mnt</span>
						<span>Ambang Lisan: {data.ambang?.teguranLisan || 3}x</span>
					</div>
				</div>

				<!-- Card 2: Estimasi Denda Terlambat -->
				<div class="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden">
					<div class="flex items-center justify-between gap-2 mb-2">
						<div class="flex items-center gap-1.5">
							<div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(239, 68, 68, 0.15); color: #EF4444">
								<IconCoin size={16} />
							</div>
							<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">
								Estimasi Denda
							</span>
						</div>
						{#if data.tarifPerJam}
							<span class="px-2 py-0.5 rounded-full text-[10px] font-bold" style="background: rgba(239, 68, 68, 0.1); color: #EF4444">
								{formatRupiah(data.tarifPerJam)}/jam
							</span>
						{/if}
					</div>

					<div class="my-1.5">
						<div class="flex items-baseline gap-1">
							<span class="text-2xl sm:text-3xl font-black tracking-tight text-red-500">
								{formatRupiah(data.estimasiDendaTerlambat)}
							</span>
						</div>
						<p class="text-[10px] mt-1" style="color: var(--sys-label4)">
							{data.metodePembulatan === 'prorata_menit' ? 'Dihitung prorata menit telat' : 'Dibulatkan ke atas per jam keterlambatan'}
						</p>
					</div>

					<div class="pt-2 border-t mt-1 flex items-center justify-between text-[10px]" style="border-color: var(--sys-sep); color: var(--sys-label4)">
						<span>Potongan Payroll</span>
						<span class="italic text-amber-500/90 font-medium">Bukan angka final</span>
					</div>
				</div>
			{/if}

			<!-- Card 3: Kuota Toleransi Izin Bulanan -->
			<div class="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden">
				<div class="flex items-center justify-between gap-2 mb-2">
					<div class="flex items-center gap-1.5">
						<div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(59, 130, 246, 0.15); color: #3B82F6">
							<IconCalendarTime size={16} />
						</div>
						<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">
							Toleransi Izin
						</span>
					</div>
					<span class="px-2 py-0.5 rounded-full text-[10px] font-bold" style="background: var(--sys-fill2); color: var(--sys-label3)">
						Kuota {data.toleransiIzinQuota || 1}x/bln
					</span>
				</div>

				<div class="my-1.5">
					<div class="flex items-baseline gap-1.5">
						<span class="text-3xl font-black tracking-tight" style="color: {(data.sisaToleransiIzin || 0) > 0 ? '#10B981' : 'var(--sys-label)'}">
							{data.sisaToleransiIzin || 0}
						</span>
						<span class="text-sm font-bold" style="color: var(--sys-label3)">x tersisa</span>
					</div>

					<p class="text-[10px] mt-1" style="color: var(--sys-label4)">
						Sudah terpakai {data.izinTerpakaiBulanIni || 0}x bulan ini (bebas denda)
					</p>
				</div>

				<div class="pt-2 border-t mt-1 flex items-center justify-between text-[10px]" style="border-color: var(--sys-sep); color: var(--sys-label4)">
					<span>Status Kuota</span>
					<span class="font-bold" style="color: {(data.sisaToleransiIzin || 0) > 0 ? '#10B981' : '#F59E0B'}">
						{(data.sisaToleransiIzin || 0) > 0 ? 'Tersedia' : 'Habis'}
					</span>
				</div>
			</div>
		</div>

		<!-- 3. Alert Dampak KPI General (Jika ada sanksi aktif) -->
		{#if !sanksiLoading && sanksiAktifCount > 0}
			<div
				class="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5"
				style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25)"
			>
				<div class="flex items-start gap-3">
					<div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style="background: rgba(239, 68, 68, 0.15); color: #EF4444">
						<IconAlertTriangle size={18} />
					</div>
					<div>
						<h4 class="text-[12px] font-bold text-red-500">Dampak Sanksi Aktif ke KPI General</h4>
						<p class="text-[11px] mt-0.5" style="color: var(--sys-label2)">
							Terdapat <strong>{sanksiAktifCount} sanksi aktif</strong>. Mengakibatkan estimasi penurunan Skor Disiplin sebesar
							<strong class="text-red-500 font-black">-{poinHilangEstimasi} poin</strong> pada KPI General.
						</p>
					</div>
				</div>
				<button
					class="px-3.5 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 transition-all text-white bg-red-600 hover:bg-red-700 shrink-0 self-start sm:self-auto"
					onclick={() => goto('/ess/kinerja')}
				>
					<IconTrendingUp size={14} /> Lihat Kinerja Saya
				</button>
			</div>
		{/if}

		<!-- 4. Interactive Tabs Section -->
		<div class="space-y-3 pt-2">
			<!-- Tab Buttons Bar -->
			<div class="flex items-center gap-2 border-b overflow-x-auto no-scrollbar" style="border-color: var(--sys-sep)">
				<button
					class="pb-2.5 px-3 text-[12px] font-bold border-b-2 transition-all flex items-center gap-2 shrink-0"
					style="border-color: {activeTab === 'log' ? 'var(--p, #3B82F6)' : 'transparent'}; color: {activeTab === 'log' ? 'var(--p, #3B82F6)' : 'var(--sys-label3)'}"
					onclick={() => (activeTab = 'log')}
				>
					<IconClock size={15} />
					<span>Log Keterlambatan</span>
					{#if (data.rincianTelat?.length || 0) > 0}
						<span class="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-500">
							{data.rincianTelat?.length}
						</span>
					{/if}
				</button>

				<button
					class="pb-2.5 px-3 text-[12px] font-bold border-b-2 transition-all flex items-center gap-2 shrink-0"
					style="border-color: {activeTab === 'sanksi' ? 'var(--p, #3B82F6)' : 'transparent'}; color: {activeTab === 'sanksi' ? 'var(--p, #3B82F6)' : 'var(--sys-label3)'}"
					onclick={() => (activeTab = 'sanksi')}
				>
					<IconGavel size={15} />
					<span>Riwayat Sanksi</span>
					{#if sanksiList.length > 0}
						<span class="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-red-500/20 text-red-500">
							{sanksiList.length}
						</span>
					{/if}
				</button>

				<button
					class="pb-2.5 px-3 text-[12px] font-bold border-b-2 transition-all flex items-center gap-2 shrink-0"
					style="border-color: {activeTab === 'prosedural' ? 'var(--p, #3B82F6)' : 'transparent'}; color: {activeTab === 'prosedural' ? 'var(--p, #3B82F6)' : 'var(--sys-label3)'}"
					onclick={() => (activeTab = 'prosedural')}
				>
					<IconCoin size={15} />
					<span>Catatan Prosedural</span>
					{#if dendaLogs.length > 0}
						<span class="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-500">
							{dendaLogs.length}
						</span>
					{/if}
				</button>

				<button
					class="pb-2.5 px-3 text-[12px] font-bold border-b-2 transition-all flex items-center gap-2 shrink-0"
					style="border-color: {activeTab === 'kebijakan' ? 'var(--p, #3B82F6)' : 'transparent'}; color: {activeTab === 'kebijakan' ? 'var(--p, #3B82F6)' : 'var(--sys-label3)'}"
					onclick={() => (activeTab = 'kebijakan')}
				>
					<IconFileDescription size={15} />
					<span>Kebijakan & Aturan HR</span>
				</button>
			</div>

			<!-- Tab 1: Log & Rincian Keterlambatan -->
			{#if activeTab === 'log'}
				{#if !data.rincianTelat || data.rincianTelat.length === 0}
					<div class="glass-panel rounded-2xl p-8 sm:p-10 text-center flex flex-col items-center justify-center">
						<div class="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style="background: rgba(16, 185, 129, 0.15); color: #10B981">
							<IconShieldCheck size={26} />
						</div>
						<h4 class="text-[14px] font-bold" style="color: var(--sys-label)">Tidak Ada Catatan Keterlambatan</h4>
						<p class="text-[12px] mt-1 max-w-md" style="color: var(--sys-label3)">
							Luar biasa! Anda tidak memiliki catatan keterlambatan pada periode <strong>{formatNamaPeriode(data.periode)}</strong>. Pertahankan disiplin dan ketepatan waktu kerja Anda!
						</p>
					</div>
				{:else}
					<div class="space-y-2.5">
						<div class="flex items-center justify-between px-1">
							<p class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">
								Rincian Hari Terlambat ({data.rincianTelat.length} Catatan)
							</p>
							<span class="text-[10px]" style="color: var(--sys-label4)">
								Jadwal Masuk: {data.jamMasukNormalFormatted || '08:00'} WIB (+{data.toleransiMenit ?? 5} mnt toleransi)
							</span>
						</div>

						<div class="glass-panel rounded-2xl overflow-hidden border" style="border-color: var(--sys-sep)">
							<div class="divide-y" style="border-color: var(--sys-sep)">
								{#each data.rincianTelat as item, idx}
									<div class="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-white/[0.02] transition-colors">
										<div class="flex items-center gap-3">
											<div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 font-black text-[11px]" style="background: rgba(245, 158, 11, 0.15); color: #F59E0B">
												#{idx + 1}
											</div>
											<div>
												<div class="flex items-center gap-2">
													<p class="text-[12px] font-bold" style="color: var(--sys-label)">
														{formatTanggalIndo(item.tanggal)}
													</p>
													<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-500">
														+{item.menitTelat} menit
													</span>
												</div>
												<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)">
													Jam Masuk Aktual: <strong style="color: var(--sys-label2)">{item.jamMasuk} WIB</strong>
												</p>
											</div>
										</div>

										<div class="flex items-center justify-between sm:justify-end gap-3 pl-10 sm:pl-0">
											<div class="text-left sm:text-right">
												<span class="text-[10px] block" style="color: var(--sys-label4)">Estimasi Denda</span>
												<span class="text-[12px] font-black text-red-500">{formatRupiah(item.estimasiDenda)}</span>
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}

				<!-- Log Penggunaan Izin (Jika Ada) -->
				{#if data.rincianIzin && data.rincianIzin.length > 0}
					<div class="space-y-2 mt-4">
						<p class="text-[11px] font-bold uppercase tracking-wider px-1" style="color: var(--sys-label3)">
							Penggunaan Kuota Izin Bulan Ini ({data.rincianIzin.length} Kali)
						</p>
						<div class="glass-panel rounded-2xl p-3 divide-y" style="border-color: var(--sys-sep)">
							{#each data.rincianIzin as izin}
								<div class="py-2 px-1 flex items-center justify-between text-[11px]">
									<div>
										<span class="font-bold" style="color: var(--sys-label)">{formatTanggalIndo(izin.tanggal)}</span>
										<span class="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-semibold">{izin.status}</span>
									</div>
									<span class="text-[10px] text-green-500 font-bold">Bebas Denda</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}

			<!-- Tab 2: Riwayat Sanksi & Banding -->
			{#if activeTab === 'sanksi'}
				{#if sanksiLoading}
					<div class="glass-panel rounded-2xl p-8 flex justify-center">
						<IconLoader2 size={28} class="animate-spin" style="color: var(--sys-label4)" />
					</div>
				{:else if sanksiError}
					<div class="rounded-2xl p-4" style="background: var(--rel, rgba(239, 68, 68, 0.1))">
						<p class="text-[12px] flex items-center gap-2 text-red-500 font-medium">
							<IconAlertTriangle size={15} /> {sanksiError}
						</p>
					</div>
				{:else if sanksiList.length === 0}
					<div class="glass-panel rounded-2xl p-8 sm:p-10 text-center flex flex-col items-center justify-center">
						<div class="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style="background: rgba(16, 185, 129, 0.15); color: #10B981">
							<IconShieldCheck size={26} />
						</div>
						<h4 class="text-[14px] font-bold" style="color: var(--sys-label)">Tidak Ada Riwayat Sanksi</h4>
						<p class="text-[12px] mt-1 max-w-md" style="color: var(--sys-label3)">
							Anda tidak memiliki catatan sanksi disiplin aktif ataupun sanksi terdahulu. Kedisiplinan Anda tercatat sangat baik di sistem HRD.
						</p>
					</div>
				{:else}
					<div class="space-y-3">
						{#each sanksiList as sanksi}
							<div
								class="glass-panel rounded-2xl p-4 sm:p-5 transition-all"
								style="border: 1px solid {SANKSI_STATUS_STYLE[sanksi.status]?.border || 'var(--sys-sep)'}"
							>
								<div class="flex items-start justify-between gap-3 mb-2">
									<div>
										<h4 class="text-[13px] font-bold" style="color: var(--sys-label)">{sanksi.jenis_sanksi}</h4>
										{#if sanksi.kategori_pelanggaran}
											<span class="text-[10px] font-semibold" style="color: var(--sys-label3)">
												Kategori: {sanksi.kategori_pelanggaran}
											</span>
										{/if}
									</div>
									<span
										class="px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0"
										style="color: {SANKSI_STATUS_STYLE[sanksi.status]?.text || '#94A3B8'}; background: {SANKSI_STATUS_STYLE[sanksi.status]?.bg || 'rgba(148, 163, 184, 0.12)'}"
									>
										{sanksi.status}
									</span>
								</div>

								{#if sanksi.deskripsi_pelanggaran}
									<p class="text-[11px] mb-2 leading-relaxed" style="color: var(--sys-label2)">
										{sanksi.deskripsi_pelanggaran}
									</p>
								{/if}

								<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]" style="color: var(--sys-label4)">
									<span>Masa Berlaku: <strong style="color: var(--sys-label3)">{formatTanggalIndo(sanksi.tanggal_berlaku)}</strong> s/d <strong style="color: var(--sys-label3)">{formatTanggalIndo(sanksi.tanggal_berakhir)}</strong></span>
								</div>

								<!-- Catatan Banding Jika Ada -->
								{#if sanksi.catatan_banding}
									<div class="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
										<p class="text-[10px] font-bold text-amber-500 mb-0.5">Alasan Banding yang Diajukan:</p>
										<p class="text-[11px] text-amber-400/90 italic leading-relaxed">"{sanksi.catatan_banding}"</p>
									</div>
								{/if}

								<!-- Action Buttons -->
								<div class="flex flex-wrap items-center gap-3 mt-3.5 pt-3 border-t" style="border-color: var(--sys-sep)">
									{#if sanksi.karyawan_ack_at}
										<span class="inline-flex items-center gap-1.5 text-[11px] font-bold text-green-500">
											<IconFileCheck size={14} /> Dikonfirmasi Terima ({formatTanggalIndo(sanksi.karyawan_ack_at.slice(0, 10))})
										</span>
									{:else}
										<button
											class="px-3 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
											disabled={ackingId === sanksi.id}
											onclick={() => handleAck(sanksi.id)}
										>
											<IconFileCheck size={14} />
											{ackingId === sanksi.id ? 'Memproses...' : 'Tanda Terima Digital'}
										</button>
									{/if}

									{#if sanksi.status === 'Aktif'}
										<button
											class="px-3 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors border"
											style="color: #F59E0B; border-color: rgba(245, 158, 11, 0.3); background: rgba(245, 158, 11, 0.08)"
											onclick={() => toggleBandingForm(sanksi.id)}
										>
											<IconGavel size={14} /> {bandingOpenId === sanksi.id ? 'Batal Banding' : 'Ajukan Banding'}
										</button>
									{/if}
								</div>

								<!-- Form Pengajuan Banding -->
								{#if bandingOpenId === sanksi.id}
									<div class="mt-3 pt-3 border-t space-y-2.5" style="border-color: var(--sys-sep)">
										<div class="flex items-center justify-between">
											<label for="alasan-banding" class="text-[11px] font-bold" style="color: var(--sys-label)">
												Formulir Pengajuan Banding Sanksi
											</label>
											<span class="text-[10px]" style="color: {bandingAlasan.trim().length >= 30 ? '#10B981' : '#EF4444'}">
												{bandingAlasan.trim().length} / 30 karakter min.
											</span>
										</div>

										<textarea
											id="alasan-banding"
											bind:value={bandingAlasan}
											placeholder="Jelaskan alasan keberatan dan kronologi lengkap beserta bukti terkait (minimal 30 karakter)..."
											class="w-full text-[11px] p-3 rounded-xl border bg-black/20 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none leading-relaxed"
											style="border-color: var(--sys-sep); color: var(--sys-label)"
											rows="3"
										></textarea>

										<div class="flex justify-end gap-2">
											<button
												class="px-3 py-1.5 rounded-xl text-[11px] font-bold hover:bg-white/5 transition-colors"
												style="color: var(--sys-label3)"
												onclick={() => (bandingOpenId = null)}
											>
												Batal
											</button>
											<button
												class="px-4 py-1.5 rounded-xl text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
												disabled={bandingSubmitting || bandingAlasan.trim().length < 30}
												onclick={() => handleSubmitBanding(sanksi.id)}
											>
												{#if bandingSubmitting}
													<IconLoader2 size={13} class="animate-spin" /> Mengirim...
												{:else}
													<IconGavel size={13} /> Kirimkan ke HRD
												{/if}
											</button>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/if}

			<!-- Tab 3: Catatan Prosedural (Fase 3 — transparansi denda prosedural) -->
			{#if activeTab === 'prosedural'}
				<div class="space-y-3">
					<div class="glass-panel rounded-2xl p-3.5 text-[11px] leading-relaxed" style="color: var(--sys-label2)">
						<div class="flex items-start gap-2">
							<IconInfoCircle size={16} class="shrink-0 mt-0.5 text-blue-500" />
							<p>
								Ini catatan prosedural Anda bulan ini — mis. lupa absen pulang. Bertanda
								<span class="font-bold text-amber-600">"Belum dipotong — masa sosialisasi"</span>
								berarti <span class="font-bold">tidak ada potongan gaji</span>; sistem hanya mencatat untuk pembelajaran.
								Jika ada yang keliru, tekan <span class="font-bold">Ajukan Klarifikasi</span> — HRD akan meninjau.
							</p>
						</div>
					</div>

					{#if dendaError}
						<div class="glass-panel rounded-xl p-3 text-[11px] font-semibold text-red-500 flex items-center gap-2">
							<IconAlertCircle size={14} /> {dendaError}
						</div>
					{/if}

					{#if dendaLoading}
						<div class="glass-panel rounded-2xl p-8 flex items-center justify-center">
							<IconLoader2 size={22} class="animate-spin" style="color: var(--sys-label3)" />
						</div>
					{:else if dendaLogs.length === 0}
						<div class="glass-panel rounded-2xl p-8 sm:p-10 text-center flex flex-col items-center justify-center">
							<div class="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style="background: rgba(16, 185, 129, 0.15); color: #10B981">
								<IconShieldCheck size={26} />
							</div>
							<h4 class="text-[14px] font-bold" style="color: var(--sys-label)">Tidak Ada Catatan Prosedural</h4>
							<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Bulan ini Anda tertib sepenuhnya. Pertahankan!</p>
						</div>
					{:else}
						<div class="space-y-2.5">
							{#each dendaLogs as log (log.id)}
								{@const st = DENDA_STATUS_LABEL[log.status] ?? { txt: log.status, cls: 'bg-slate-500/15 text-slate-500' }}
								{@const bayangan = Number(log.nominal_efektif) === 0}
								<div class="glass-panel rounded-2xl p-3.5 space-y-2">
									<div class="flex items-start justify-between gap-3">
										<div class="min-w-0">
											<div class="flex items-center gap-2 flex-wrap">
												<span class="text-[12px] font-bold" style="color: var(--sys-label)">{formatTanggalIndo(log.tanggal_kejadian)}</span>
												<span class="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold" style="background: var(--sys-fill3); color: var(--sys-label3)">{log.rule_kode}</span>
											</div>
											<p class="text-[11px] mt-1" style="color: var(--sys-label2)">{log.keterangan_otomatis}</p>
										</div>
										<div class="text-right shrink-0">
											{#if bayangan}
												<span class="inline-block px-2 py-1 rounded-lg text-[9px] font-black bg-amber-500/15 text-amber-600 leading-tight">
													Belum dipotong<br />masa sosialisasi
												</span>
											{:else}
												<span class="text-[13px] font-black text-red-500">-{formatRupiah(log.nominal_efektif)}</span>
											{/if}
										</div>
									</div>
									<div class="flex items-center justify-between gap-2">
										<span class="px-2 py-0.5 rounded-full text-[10px] font-bold {st.cls}">{st.txt}</span>
										{#if (log.status === 'pending' || log.status === 'dikonfirmasi') && !log.potongan_karyawan_id}
											<button
												class="text-[11px] font-bold text-blue-500 flex items-center gap-1"
												onclick={() => toggleKlarifikasi(log.id)}
											>
												<IconInfoCircle size={13} /> {klarifikasiOpenId === log.id ? 'Tutup' : 'Ajukan Klarifikasi'}
											</button>
										{/if}
									</div>

									{#if log.alasan_pembebasan}
										<p class="text-[10px] italic px-2 py-1.5 rounded-lg" style="background: var(--sys-fill3); color: var(--sys-label3)">
											{log.alasan_pembebasan}
										</p>
									{/if}

									{#if klarifikasiOpenId === log.id}
										<div class="space-y-2 pt-1">
											<textarea
												bind:value={klarifikasiAlasan}
												rows="3"
												maxlength="500"
												placeholder="Jelaskan kenapa catatan ini keliru — mis. sudah absen pulang tapi gagal tersimpan, sedang tugas luar, dsb."
												class="w-full text-[11px] rounded-xl p-2.5 border resize-none"
												style="background: var(--sys-bg); border-color: var(--sys-sep); color: var(--sys-label)"
											></textarea>
											<button
												class="w-full py-2 rounded-xl text-[11px] font-bold text-white gradient-bg disabled:opacity-50 flex items-center justify-center gap-2"
												disabled={klarifikasiSubmitting || klarifikasiAlasan.trim().length < 10}
												onclick={() => handleSubmitKlarifikasi(log.id)}
											>
												{#if klarifikasiSubmitting}<IconLoader2 size={13} class="animate-spin" />{:else}<IconCheck size={13} />{/if}
												Kirim ke HRD
											</button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Tab 4: Kebijakan & Aturan HR -->
			{#if activeTab === 'kebijakan'}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
					<!-- Panduan 1: Jam & Toleransi -->
					<div class="glass-panel rounded-2xl p-4 sm:p-5 space-y-2">
						<div class="flex items-center gap-2">
							<div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-blue-500/15 text-blue-500">
								<IconClock size={16} />
							</div>
							<h4 class="text-[12px] font-bold" style="color: var(--sys-label)">Jam Kerja & Toleransi</h4>
						</div>
						<p class="text-[11px] leading-relaxed" style="color: var(--sys-label3)">
							Jam operasional harian dimulai pukul <strong>{data.jamMasukNormalFormatted || '08:00'} WIB</strong> dengan toleransi keterlambatan maksimal <strong>{data.toleransiMenit ?? 5} menit</strong>. Absensi masuk di atas batas toleransi akan dihitung sebagai keterlambatan.
						</p>
					</div>

					<!-- Panduan 2: Perhitungan Denda -->
					<div class="glass-panel rounded-2xl p-4 sm:p-5 space-y-2">
						<div class="flex items-center gap-2">
							<div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-red-500/15 text-red-500">
								<IconCoin size={16} />
							</div>
							<h4 class="text-[12px] font-bold" style="color: var(--sys-label)">Perhitungan Denda Terlambat</h4>
						</div>
						<p class="text-[11px] leading-relaxed" style="color: var(--sys-label3)">
							Tarif denda keterlambatan adalah <strong>{formatRupiah(data.tarifPerJam)} / jam</strong>. Penghitungan menerapkan metode <em>{data.metodePembulatan === 'prorata_menit' ? 'prorata menit telat' : 'pembulatan ke atas per jam (mis. telat 15 menit dihitung 1 jam)'}</em>.
						</p>
					</div>

					<!-- Panduan 3: Kuota Izin Bulanan -->
					<div class="glass-panel rounded-2xl p-4 sm:p-5 space-y-2">
						<div class="flex items-center gap-2">
							<div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-emerald-500/15 text-emerald-500">
								<IconCalendarTime size={16} />
							</div>
							<h4 class="text-[12px] font-bold" style="color: var(--sys-label)">Toleransi Izin Bulanan</h4>
						</div>
						<p class="text-[11px] leading-relaxed" style="color: var(--sys-label3)">
							Setiap karyawan memiliki kuota toleransi izin sebanyak <strong>{data.toleransiIzinQuota || 1}x per bulan</strong> yang bebas dari pemotongan denda keterlambatan (wajib disertai pengajuan form izin resmi yang disetujui atasan).
						</p>
					</div>

					<!-- Panduan 4: Eskalasi Sanksi SP -->
					<div class="glass-panel rounded-2xl p-4 sm:p-5 space-y-2">
						<div class="flex items-center gap-2">
							<div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-amber-500/15 text-amber-500">
								<IconGavel size={16} />
							</div>
							<h4 class="text-[12px] font-bold" style="color: var(--sys-label)">Eskalasi Sanksi Disiplin</h4>
						</div>
						<p class="text-[11px] leading-relaxed" style="color: var(--sys-label3)">
							Akumulasi keterlambatan dalam 1 bulan kalender:<br>
							&bull; <strong>{data.ambang?.teguranLisan || 3}x</strong> = Teguran Lisan<br>
							&bull; <strong>{data.ambang?.teguranTertulis || 5}x</strong> = Teguran Tertulis<br>
							&bull; <strong>&ge;{data.ambang?.sp || 8}x</strong> = Surat Peringatan (SP) resmi
						</p>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

