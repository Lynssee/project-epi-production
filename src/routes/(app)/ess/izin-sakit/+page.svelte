<!-- src/routes/(app)/ess/izin-sakit/+page.svelte -->
<!-- Modul Izin & Sakit ESS (Fase 1) - Terintegrasi dengan absensi_harian & Kebijakan Kedisiplinan HRD -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		ajukanIzinSakit,
		getIzinSakitHistory,
		type IzinSakitRecord,
		type IzinSakitSummary
	} from '$lib/services/ess/izinSakit';
	import { fetchDelegasiKandidat, type DelegasiKandidat } from '$lib/services/ess/cuti';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCircleCheck,
		IconCamera,
		IconX,
		IconCalendar,
		IconCalendarEvent,
		IconClock,
		IconFileText,
		IconAlertCircle,
		IconAlertTriangle,
		IconInfoCircle,
		IconCheck,
		IconSearch,
		IconEye,
		IconDownload,
		IconHelp,
		IconStethoscope,
		IconCalendarStats,
		IconRotate2,
		IconFileCheck,
		IconShieldCheck
	} from '@tabler/icons-svelte';

	// Tab navigasi aktif
	let activeTab = $state<'form' | 'riwayat' | 'panduan'>('form');

	// Form states
	let jenis = $state<'izin' | 'sakit' | 'izin_setengah_hari' | 'izin_terlambat'>('izin');
	let sesi = $state<'PAGI' | 'SIANG'>('PAGI'); // hanya dipakai saat jenis === 'izin_setengah_hari'
	let alasan = $state('');
	let suratFile = $state<File | null>(null);
	let suratPreview = $state<string | null>(null);
	let tanggalSelesai = $state('');
	let delegasiKaryawanId = $state('');
	let delegasiCatatan = $state('');
	let rekanKerja = $state<DelegasiKandidat[]>([]);

	let submitting = $state(false);
	let submitErrorMsg = $state('');
	let submitSuccess = $state(false);

	// Data riwayat & KPI states
	let loadingHistory = $state(true);
	let historyErrorMsg = $state('');
	let records = $state<IzinSakitRecord[]>([]);
	let summary = $state<IzinSakitSummary>({
		totalIzinBulanIni: 0,
		sakitTerverifikasiBulanIni: 0,
		sakitPendingBulanIni: 0,
		izinTerlambatBulanIni: 0
	});

	// Filter & Search states
	let searchQuery = $state('');
	let filterJenis = $state<string>('all');

	// Modal Preview Surat Dokter
	let previewModalRecord = $state<IzinSakitRecord | null>(null);

	const todayIso = new Date().toISOString().slice(0, 10);
	const maxSakitIso = (() => {
		const d = new Date();
		d.setDate(d.getDate() + 4); // maksimal 5 hari kalender termasuk hari ini
		return d.toISOString().slice(0, 10);
	})();

	const JENIS_CARDS: {
		value: 'izin' | 'sakit' | 'izin_setengah_hari' | 'izin_terlambat';
		label: string;
		subtitle: string;
		icon: any;
		badge: string;
		badgeColor: string;
	}[] = [
		{
			value: 'izin',
			label: 'Izin (1 Hari)',
			subtitle: 'Tidak masuk kerja 1 hari penuh untuk keperluan mendesak.',
			icon: IconCalendarEvent,
			badge: 'Potong 1 Hari',
			badgeColor: '#2563EB'
		},
		{
			value: 'izin_setengah_hari',
			label: 'Izin 1/2 Hari',
			subtitle: 'Izin masuk siang atau pulang lebih awal (maks 4 jam kerja).',
			icon: IconClock,
			badge: 'Potong 0.5 Hari',
			badgeColor: '#0891B2'
		},
		{
			value: 'izin_terlambat',
			label: 'Akan Terlambat',
			subtitle: 'Pemberitahuan datang terlambat sebelum shift dimulai.',
			icon: IconAlertCircle,
			badge: 'Potong Proporsional',
			badgeColor: '#EA580C'
		},
		{
			value: 'sakit',
			label: 'Sakit (Surat Dokter)',
			subtitle: 'Kondisi kesehatan tidak fit. Wajib lampirkan surat dokter.',
			icon: IconStethoscope,
			badge: 'Bebas Potongan',
			badgeColor: '#16A34A'
		}
	];

	async function loadHistoryData() {
		loadingHistory = true;
		historyErrorMsg = '';
		try {
			const res = await getIzinSakitHistory();
			records = res.records || [];
			summary = res.summary || {
				totalIzinBulanIni: 0,
				sakitTerverifikasiBulanIni: 0,
				sakitPendingBulanIni: 0,
				izinTerlambatBulanIni: 0
			};
		} catch (err: any) {
			historyErrorMsg = err?.message || 'Gagal memuat riwayat izin dan sakit.';
		} finally {
			loadingHistory = false;
		}
	}

	onMount(() => {
		loadHistoryData();
		fetchDelegasiKandidat()
			.then((res) => (rekanKerja = res))
			.catch((e) => console.error('Gagal memuat daftar rekan kerja:', e));
	});

	function handleSuratChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (file.size > 10 * 1024 * 1024) {
			alert('Ukuran file maksimal 10MB.');
			return;
		}
		suratFile = file;
		suratPreview = URL.createObjectURL(file);
	}

	function clearSurat() {
		suratFile = null;
		if (suratPreview) {
			URL.revokeObjectURL(suratPreview);
			suratPreview = null;
		}
	}

	let canSubmit = $derived(
		!!alasan.trim() &&
		(jenis !== 'sakit' || !!suratFile) &&
		(jenis !== 'sakit' || !tanggalSelesai || tanggalSelesai <= maxSakitIso) &&
		!!delegasiKaryawanId && delegasiCatatan.trim().length >= 5 &&
		!submitting
	);

	// Hitung perkiraan hari kerja sakit jika tanggalSelesai dipilih
	let perkiraanHariSakit = $derived.by(() => {
		if (jenis !== 'sakit') return 1;
		if (!tanggalSelesai || tanggalSelesai === todayIso) return 1;
		const start = new Date(`${todayIso}T00:00:00`);
		const end = new Date(`${tanggalSelesai}T00:00:00`);
		if (end < start) return 1;
		let count = 0;
		const cur = new Date(start);
		while (cur <= end) {
			const day = cur.getDay();
			if (day !== 0 && day !== 6) count++; // exclude weekend
			cur.setDate(cur.getDate() + 1);
		}
		return Math.max(1, count);
	});

	async function handleSubmit() {
		if (!canSubmit) return;
		submitting = true;
		submitErrorMsg = '';
		try {
			await ajukanIzinSakit({
				jenis,
				alasan: alasan.trim(),
				suratFile,
				tanggalSelesai: jenis === 'sakit' ? tanggalSelesai || null : null,
				sesi: jenis === 'izin_setengah_hari' ? sesi : null,
				delegasiKaryawanId,
				delegasiCatatan: delegasiCatatan.trim()
			});
			submitSuccess = true;
			// Reset form
			alasan = '';
			tanggalSelesai = '';
			delegasiKaryawanId = '';
			delegasiCatatan = '';
			clearSurat();
			// Reload riwayat
			await loadHistoryData();
		} catch (err: any) {
			submitErrorMsg = err?.message || 'Gagal mengirim pengajuan.';
		} finally {
			submitting = false;
		}
	}

	function formatTanggalIndo(dStr: string | null | undefined): string {
		if (!dStr) return '-';
		const parts = dStr.split('-');
		if (parts.length !== 3) return dStr;
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
		const d = new Date(`${dStr}T00:00:00`);
		const dayName = isNaN(d.getTime()) ? '' : dayNames[d.getDay()] + ', ';
		return `${dayName}${parseInt(parts[2])} ${monthNames[parseInt(parts[1]) - 1] || parts[1]} ${parts[0]}`;
	}

	function getStatusMeta(status: string, rec?: { sesi?: string | null }) {
		const st = (status || '').toUpperCase();
		if (st === 'SAKIT') {
			return {
				label: 'Sakit (Terverifikasi)',
				color: '#16A34A',
				bg: 'rgba(22, 163, 74, 0.12)',
				border: 'rgba(22, 163, 74, 0.3)',
				desc: 'Surat dokter telah diverifikasi HRD. Bebas dari potongan payroll.'
			};
		}
		if (st.includes('SAKIT') && (st.includes('BELUM') || st.includes('IZIN'))) {
			return {
				label: 'Menunggu Verifikasi HRD',
				color: '#D97706',
				bg: 'rgba(217, 119, 6, 0.12)',
				border: 'rgba(217, 119, 6, 0.3)',
				desc: 'Surat dokter sedang ditinjau HRD (maks 2 hari kerja sebelum status turun ke ALPA).'
			};
		}
		if (st === 'IZIN') {
			return {
				label: 'Izin (1 Hari)',
				color: '#2563EB',
				bg: 'rgba(37, 99, 235, 0.12)',
				border: 'rgba(37, 99, 235, 0.3)',
				desc: 'Izin 1 hari kerja tercatat. Berlaku potongan upah 1 hari.'
			};
		}
		if (st === 'IZIN 1/2 HARI') {
			const sesiTxt = rec?.sesi === 'PAGI' ? ' — Pagi' : rec?.sesi === 'SIANG' ? ' — Siang' : '';
			return {
				label: `Izin 1/2 Hari${sesiTxt}`,
				color: '#0891B2',
				bg: 'rgba(8, 145, 178, 0.12)',
				border: 'rgba(8, 145, 178, 0.3)',
				desc: 'Izin setengah hari. Berlaku potongan upah proporsional 0.5 hari.'
			};
		}
		if (st === 'IZIN TERLAMBAT') {
			return {
				label: 'Izin Terlambat',
				color: '#EA580C',
				bg: 'rgba(234, 88, 12, 0.12)',
				border: 'rgba(234, 88, 12, 0.3)',
				desc: 'Pemberitahuan terlambat. Potongan dihitung proporsional dari selisih menit/jam.'
			};
		}
		if (st === 'ALPA') {
			return {
				label: 'Tidak Sah (Alpa)',
				color: '#DC2626',
				bg: 'rgba(220, 38, 38, 0.12)',
				border: 'rgba(220, 38, 38, 0.3)',
				desc: 'Surat dokter ditolak atau melewati batas verifikasi tanpa bukti sah.'
			};
		}
		return {
			label: status || 'Tercatat',
			color: '#6B7280',
			bg: 'rgba(107, 114, 128, 0.12)',
			border: 'rgba(107, 114, 128, 0.3)',
			desc: 'Pengajuan telah tersimpan di sistem.'
		};
	}

	let filteredRecords = $derived.by(() => {
		return records.filter((r) => {
			const st = (r.status || '').toUpperCase();
			const ket = (r.keterangan || '').toLowerCase();
			const tgl = (r.tanggal || '').toLowerCase();
			const q = searchQuery.trim().toLowerCase();

			// Match query
			const matchQuery = !q || ket.includes(q) || tgl.includes(q) || st.includes(q);

			// Match filter jenis
			let matchFilter = true;
			if (filterJenis === 'sakit') {
				matchFilter = st.includes('SAKIT');
			} else if (filterJenis === 'sakit_pending') {
				matchFilter = st.includes('SAKIT') && st.includes('BELUM');
			} else if (filterJenis === 'izin') {
				matchFilter = st === 'IZIN' || st === 'IZIN 1/2 HARI';
			} else if (filterJenis === 'terlambat') {
				matchFilter = st === 'IZIN TERLAMBAT';
			}

			return matchQuery && matchFilter;
		});
	});
</script>

<svelte:head>
	<title>Izin & Sakit — Portal Karyawan</title>
</svelte:head>

<div class="w-full p-4 md:p-6 pb-28 max-w-7xl mx-auto space-y-6">
	<!-- Top Bar Navigation -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
		<div>
			<button
				class="flex items-center gap-1.5 text-xs font-semibold mb-2 transition-colors hover:opacity-80"
				style="color: var(--sys-label3)"
				onclick={() => goto('/ess')}
			>
				<IconArrowLeft size={16} /> Kembali ke Portal Karyawan
			</button>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">
				Izin & Sakit
			</h1>
			<p class="text-xs md:text-sm mt-1 font-medium" style="color: var(--sys-label3)">
				Laporkan izin, keterlambatan, sakit, dan pantau status verifikasi surat dokter oleh HRD.
			</p>
		</div>

		<!-- Quick Action Button to toggle Tab -->
		<div class="flex items-center gap-2 self-start sm:self-auto">
			<button
				class="px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2"
				style={activeTab === 'form' ? 'background: var(--p, var(--g)); color: #fff' : 'background: var(--sys-fill); color: var(--sys-label)'}
				onclick={() => { activeTab = 'form'; submitSuccess = false; }}
			>
				<IconFileText size={16} /> Ajukan Baru
			</button>
			<button
				class="px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 relative"
				style={activeTab === 'riwayat' ? 'background: var(--p, var(--g)); color: #fff' : 'background: var(--sys-fill); color: var(--sys-label)'}
				onclick={() => (activeTab = 'riwayat')}
			>
				<IconCalendarStats size={16} /> Riwayat
				{#if summary.sakitPendingBulanIni > 0}
					<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
				{/if}
			</button>
			<button
				class="px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2"
				style={activeTab === 'panduan' ? 'background: var(--p, var(--g)); color: #fff' : 'background: var(--sys-fill); color: var(--sys-label)'}
				onclick={() => (activeTab = 'panduan')}
			>
				<IconHelp size={16} /> Panduan & SOP
			</button>
		</div>
	</div>

	<!-- KPI Summary Banner -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
		<!-- Card 1: Total Izin -->
		<div class="glass-panel rounded-2xl p-4 relative overflow-hidden flex flex-col justify-between border" style="border-color: var(--sys-sep)">
			<div class="flex items-center justify-between mb-2">
				<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Izin Bulan Ini</span>
				<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-500/10 text-blue-500">
					<IconCalendarEvent size={18} />
				</div>
			</div>
			<div>
				<div class="text-2xl md:text-3xl font-black" style="color: var(--sys-label)">
					{summary.totalIzinBulanIni} <span class="text-xs font-semibold text-slate-400">Hari</span>
				</div>
				<p class="text-[11px] mt-1" style="color: var(--sys-label4)">Izin 1 Hari & 1/2 Hari</p>
			</div>
		</div>

		<!-- Card 2: Sakit Terverifikasi -->
		<div class="glass-panel rounded-2xl p-4 relative overflow-hidden flex flex-col justify-between border" style="border-color: var(--sys-sep)">
			<div class="flex items-center justify-between mb-2">
				<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Sakit Sah (HRD)</span>
				<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-emerald-500/10 text-emerald-500">
					<IconCircleCheck size={18} />
				</div>
			</div>
			<div>
				<div class="text-2xl md:text-3xl font-black text-emerald-500">
					{summary.sakitTerverifikasiBulanIni} <span class="text-xs font-semibold text-slate-400">Hari</span>
				</div>
				<p class="text-[11px] mt-1 text-emerald-600">Surat dokter diverifikasi</p>
			</div>
		</div>

		<!-- Card 3: Menunggu Verifikasi -->
		<div class="glass-panel rounded-2xl p-4 relative overflow-hidden flex flex-col justify-between border" style="border-color: var(--sys-sep)">
			<div class="flex items-center justify-between mb-2">
				<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Pending Surat</span>
				<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-500/10 text-amber-500">
					<IconClock size={18} />
				</div>
			</div>
			<div>
				<div class="text-2xl md:text-3xl font-black text-amber-500">
					{summary.sakitPendingBulanIni} <span class="text-xs font-semibold text-slate-400">Berkas</span>
				</div>
				<p class="text-[11px] mt-1 text-amber-600">Pemeriksaan max 2 hari HRD</p>
			</div>
		</div>

		<!-- Card 4: Izin Terlambat -->
		<div class="glass-panel rounded-2xl p-4 relative overflow-hidden flex flex-col justify-between border" style="border-color: var(--sys-sep)">
			<div class="flex items-center justify-between mb-2">
				<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Izin Terlambat</span>
				<div class="w-8 h-8 rounded-xl flex items-center justify-center bg-orange-500/10 text-orange-500">
					<IconAlertCircle size={18} />
				</div>
			</div>
			<div>
				<div class="text-2xl md:text-3xl font-black text-orange-500">
					{summary.izinTerlambatBulanIni} <span class="text-xs font-semibold text-slate-400">Kali</span>
				</div>
				<p class="text-[11px] mt-1" style="color: var(--sys-label4)">Potongan jam proporsional</p>
			</div>
		</div>
	</div>

	<!-- TAB 1: FORM PENGAJUAN -->
	{#if activeTab === 'form'}
		<div class="glass-panel rounded-3xl p-5 md:p-8 border shadow-lg space-y-6" style="border-color: var(--sys-sep)">
			{#if submitSuccess}
				<div class="text-center py-12 space-y-4 max-w-md mx-auto">
					<div class="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto shadow-inner">
						<IconCircleCheck size={40} />
					</div>
					<h3 class="text-xl font-bold" style="color: var(--sys-label)">Pengajuan Berhasil Terkirim!</h3>
					<p class="text-xs md:text-sm leading-relaxed" style="color: var(--sys-label3)">
						Pengajuan Anda telah tercatat di sistem presensi. Data telah diteruskan ke Atasan Langsung dan HRD.
						{#if jenis === 'sakit'}
							<br /><span class="font-semibold text-amber-500 mt-2 block">
								Status Anda saat ini adalah "Sakit (Menunggu Verifikasi Surat Dokter)". Setelah HRD menyetujui surat dokter, status akan bebas potongan.
							</span>
						{/if}
					</p>
					<div class="flex items-center justify-center gap-3 pt-4">
						<button
							class="px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-transform hover:scale-105"
							style="background: var(--p, var(--g))"
							onclick={() => { submitSuccess = false; }}
						>
							Ajukan Izin Lain
						</button>
						<button
							class="px-5 py-2.5 rounded-xl text-xs font-bold border transition-colors hover:bg-slate-500/10"
							style="border-color: var(--sys-sep); color: var(--sys-label)"
							onclick={() => (activeTab = 'riwayat')}
						>
							Lihat Riwayat Saya
						</button>
					</div>
				</div>
			{:else}
				<div class="border-b pb-4" style="border-color: var(--sys-sep)">
					<div class="flex items-center justify-between flex-wrap gap-2">
						<div>
							<h2 class="text-lg font-bold" style="color: var(--sys-label)">Formulir Pengajuan Izin / Sakit</h2>
							<p class="text-xs font-medium mt-0.5" style="color: var(--sys-label3)">
								Wajib dilaporkan sebelum jam kerja dimulai (sebelum jam shift aktif).
							</p>
						</div>
						<div class="px-3 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-500 flex items-center gap-1.5">
							<IconCalendar size={14} /> {formatTanggalIndo(todayIso)}
						</div>
					</div>
				</div>

				<!-- Selector Jenis Pengajuan Card Grid -->
				<div class="space-y-2">
					<span class="text-xs font-bold uppercase tracking-wider block" style="color: var(--sys-label2)">
						Pilih Jenis Pengajuan <span class="text-red-500">*</span>
					</span>
					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
						{#each JENIS_CARDS as opt}
							<button
								type="button"
								class="rounded-2xl p-4 text-left border transition-all relative flex flex-col justify-between group hover:border-blue-500"
								style={jenis === opt.value
									? 'border-color: var(--p, var(--g)); background: rgba(59, 130, 246, 0.08); box-shadow: 0 0 0 1px var(--p, var(--g))'
									: 'border-color: var(--sys-sep); background: var(--sys-fill)'}
								onclick={() => (jenis = opt.value)}
							>
								<div class="flex items-center justify-between mb-3">
									<div
										class="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105"
										style="background: {opt.badgeColor}18; color: {opt.badgeColor}"
									>
										<svelte:component this={opt.icon} size={20} />
									</div>
									<span
										class="text-[10px] font-extrabold px-2 py-0.5 rounded-md"
										style="background: {opt.badgeColor}20; color: {opt.badgeColor}"
									>
										{opt.badge}
									</span>
								</div>
								<div>
									<p class="text-sm font-bold" style="color: var(--sys-label)">{opt.label}</p>
									<p class="text-[11px] mt-1 leading-relaxed" style="color: var(--sys-label3)">{opt.subtitle}</p>
								</div>
								{#if jenis === opt.value}
									<div class="absolute top-2 right-2 w-2 h-2 rounded-full" style="background: var(--p, var(--g))"></div>
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<!-- Form Fields -->
				<div class="space-y-4 pt-2">
					<!-- Jika Jenis Sakit: Opsi Multi-hari -->
					{#if jenis === 'sakit'}
						<div class="p-4 rounded-2xl border bg-emerald-500/5 space-y-3" style="border-color: rgba(16, 185, 129, 0.3)">
							<div class="flex items-center justify-between flex-wrap gap-2">
								<div class="flex items-center gap-2 text-emerald-600 font-bold text-xs">
									<IconStethoscope size={18} />
									<span>Periode Istirahat Sakit</span>
								</div>
								<span class="text-[11px] font-semibold text-emerald-700">
									Estimasi: {perkiraanHariSakit} Hari Kerja
								</span>
							</div>

							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
								<div>
									<span class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Mulai Tanggal</span>
									<input
										type="date"
										class="w-full h-11 rounded-xl border text-xs px-3 font-semibold bg-slate-500/10 cursor-not-allowed"
										style="border-color: var(--sys-sep); color: var(--sys-label)"
										value={todayIso}
										disabled
									/>
									<span class="text-[10px] mt-1 block" style="color: var(--sys-label4)">Sesuai tanggal hari ini (server)</span>
								</div>

								<div>
									<label for="tgl-selesai" class="block text-[10px] font-bold uppercase tracking-wider mb-1" style="color: var(--sys-label2)">
										Sampai Tanggal (Opsional)
									</label>
									<input
										id="tgl-selesai"
										type="date"
										class="w-full h-11 rounded-xl border text-xs px-3 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
										style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
										min={todayIso}
										max={maxSakitIso}
										bind:value={tanggalSelesai}
									/>
									<span class="text-[10px] mt-1 block text-slate-400">
										Maksimal 5 hari kalender ({formatTanggalIndo(maxSakitIso)}). Lebih dari 5 hari wajib jalur Cuti Sakit.
									</span>
								</div>
							</div>
						</div>
					{/if}

					<!-- Jika Izin 1/2 Hari: pilih sesi Pagi / Siang -->
					{#if jenis === 'izin_setengah_hari'}
						<div class="p-4 rounded-2xl border bg-blue-500/5 space-y-2" style="border-color: rgba(59, 130, 246, 0.3)">
							<span class="block text-xs font-bold uppercase tracking-wider" style="color: var(--sys-label2)">
								Sesi Izin <span class="text-red-500">*</span>
							</span>
							<div class="grid grid-cols-2 gap-2">
								{#each [{ v: 'PAGI', t: 'Sesi Pagi', j: '08:00 – 12:00' }, { v: 'SIANG', t: 'Sesi Siang', j: '13:00 – 17:00' }] as s}
									<button
										type="button"
										class="rounded-xl px-3 py-2.5 text-left border transition-all"
										style={sesi === s.v
											? 'border-color: var(--p, var(--g)); background: rgba(59, 130, 246, 0.1)'
											: 'border-color: var(--sys-sep); background: var(--sys-fill)'}
										onclick={() => (sesi = s.v as 'PAGI' | 'SIANG')}
									>
										<span class="block text-sm font-bold" style="color: var(--sys-label)">{s.t}</span>
										<span class="block text-[11px] mt-0.5" style="color: var(--sys-label3)">{s.j}</span>
									</button>
								{/each}
							</div>
							<span class="text-[10px] block" style="color: var(--sys-label4)">
								Potongan upah proporsional 0,5 hari kerja. Separuh sesi lainnya tetap wajib hadir & absen.
							</span>
						</div>
					{/if}

					<!-- Alasan / Keluhan -->
					<div>
						<div class="flex items-center justify-between mb-1.5">
							<label for="alasan-input" class="text-xs font-bold uppercase tracking-wider" style="color: var(--sys-label2)">
								{jenis === 'sakit' ? 'Keluhan & Diagnosa Singkat' : 'Alasan Izin / Keterlambatan'} <span class="text-red-500">*</span>
							</label>
							<span class="text-[10px]" style="color: var(--sys-label4)">{alasan.length} karakter</span>
						</div>
						<textarea
							id="alasan-input"
							class="w-full rounded-2xl border text-xs md:text-sm p-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all leading-relaxed"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							rows="3"
							placeholder={jenis === 'sakit'
								? 'Jelaskan keluhan sakit (contoh: demam tinggi, flu berat, disarankan istirahat oleh dokter).'
								: jenis === 'izin_terlambat'
								? 'Jelaskan alasan keterlambatan & perkiraan jam tiba di lokasi kerja.'
								: 'Jelaskan alasan izin secara rinci dan jelas.'}
							bind:value={alasan}
						></textarea>
					</div>

					<!-- Upload Surat Dokter (Wajib untuk Sakit, Opsional untuk lainnya) -->
					<div class="space-y-2">
						<span class="text-xs font-bold uppercase tracking-wider block" style="color: var(--sys-label2)">
							Surat Keterangan Dokter {jenis === 'sakit' ? '(Wajib Diunggah)' : '(Opsional / Lampiran Pendukung)'}
							{#if jenis === 'sakit'}<span class="text-red-500">*</span>{/if}
						</span>

						{#if suratPreview}
							<div class="flex items-start gap-4 p-4 rounded-2xl border bg-slate-500/5" style="border-color: var(--sys-sep)">
								<div class="relative w-28 h-28 shrink-0 rounded-xl overflow-hidden border shadow-sm" style="border-color: var(--sys-sep)">
									<img src={suratPreview} alt="Preview Surat Dokter" class="w-full h-full object-cover" />
									<button
										type="button"
										class="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center shadow-md hover:scale-110 transition-transform"
										onclick={clearSurat}
										aria-label="Hapus surat"
									>
										<IconX size={14} />
									</button>
								</div>
								<div class="flex-1 space-y-1">
									<div class="flex items-center gap-1.5 text-emerald-500 text-xs font-bold">
										<IconCheck size={16} /> File siap diunggah
									</div>
									<p class="text-xs font-semibold truncate max-w-xs" style="color: var(--sys-label)">{suratFile?.name}</p>
									<p class="text-[10px]" style="color: var(--sys-label4)">
										Ukuran: {Math.round((suratFile?.size || 0) / 1024)} KB · Otomatis terkompresi
									</p>
									<button
										type="button"
										class="text-xs font-bold text-red-500 hover:underline pt-2 block"
										onclick={clearSurat}
									>
										Ganti Foto / Hapus
									</button>
								</div>
							</div>
						{:else}
							<label
								class="border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors hover:border-blue-500 hover:bg-blue-500/5 text-center group"
								style="border-color: var(--sys-sep); background: var(--sys-fill)"
							>
								<div class="w-12 h-12 rounded-2xl flex items-center justify-center bg-blue-500/10 text-blue-500 group-hover:scale-110 transition-transform">
									<IconCamera size={24} />
								</div>
								<div>
									<p class="text-xs font-bold" style="color: var(--sys-label)">
										Ambil Foto atau Unggah Dokumen Surat Dokter
									</p>
									<p class="text-[10px] mt-0.5" style="color: var(--sys-label4)">
										Mendukung JPG, PNG, WEBP, atau PDF (Maks 10MB)
									</p>
								</div>
								<input
									type="file"
									accept="image/*,application/pdf"
									class="hidden"
									onchange={handleSuratChange}
								/>
							</label>
						{/if}
					</div>

					<!-- Delegasi Tugas (Wajib) -->
					<div class="p-4 rounded-2xl border bg-slate-500/5 space-y-3" style="border-color: var(--sys-sep)">
						<div class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style="color: var(--sys-label2)">
							<IconShieldCheck size={16} />
							<span>Delegasi Tugas Selama Tidak Hadir <span class="text-red-500">*</span></span>
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<div>
								<label for="delegasi-select" class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
									Delegasi Kepada
								</label>
								<select
									id="delegasi-select"
									class="w-full h-11 rounded-xl border text-xs px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
									style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
									bind:value={delegasiKaryawanId}
								>
									<option value="">-- Pilih rekan kerja --</option>
									{#each rekanKerja as k}
										<option value={k.id}>{k.nama_karyawan}</option>
									{/each}
								</select>
							</div>
							<div>
								<label for="delegasi-catatan" class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
									Tugas yang Didelegasikan
								</label>
								<textarea
									id="delegasi-catatan"
									class="w-full rounded-xl border text-xs p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
									style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
									rows="1"
									placeholder="Tugas/tanggung jawab yang dialihkan…"
									bind:value={delegasiCatatan}
								></textarea>
							</div>
						</div>
					</div>

					<!-- Payroll Policy Notice Box -->
					<div class="p-4 rounded-2xl border flex items-start gap-3 bg-blue-500/5 text-blue-900" style="border-color: rgba(59, 130, 246, 0.2)">
						<IconInfoCircle size={20} class="text-blue-500 shrink-0 mt-0.5" />
						<div class="text-xs leading-relaxed" style="color: var(--sys-label2)">
							<p class="font-bold mb-0.5">Ketentuan Pemrosesan Pengajuan:</p>
							{#if jenis === 'sakit'}
								<span>Pengajuan sakit akan masuk dengan status <strong>"Sakit (Menunggu Verifikasi HRD)"</strong>. HRD akan memvalidasi keabsahan klinik/dokter dalam 2x24 jam sebelum mengubahnya menjadi <strong>Sakit Sah (Bebas Potongan)</strong>.</span>
							{:else if jenis === 'izin_setengah_hari'}
								<span>Izin 1/2 hari berlaku pemotongan proporsional setengah hari kerja (bukan 1 hari penuh).</span>
							{:else if jenis === 'izin_terlambat'}
								<span>Izin terlambat dihitung berdasarkan selisih menit keterlambatan saat absen masuk vs jam mulai shift Anda.</span>
							{:else}
								<span>Izin 1 hari penuh akan dicatat sebagai ketidakhadiran dengan izin resmi dan diberlakukan pemotongan gaji harian sesuai aturan perusahaan.</span>
							{/if}
						</div>
					</div>

					{#if submitErrorMsg}
						<div class="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-500 text-xs font-semibold">
							<IconAlertTriangle size={18} class="shrink-0" />
							<span>{submitErrorMsg}</span>
						</div>
					{/if}

					<!-- Submit Action -->
					<div class="pt-2 flex justify-end">
						<button
							type="button"
							class="w-full sm:w-auto px-8 h-12 rounded-xl text-sm font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-95"
							style="background: var(--p, var(--g))"
							disabled={!canSubmit}
							onclick={handleSubmit}
						>
							{#if submitting}
								<IconLoader2 size={18} class="animate-spin" />
								<span>Mengirim Pengajuan...</span>
							{:else}
								<IconFileCheck size={18} />
								<span>Kirim Pengajuan Izin / Sakit</span>
							{/if}
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- TAB 2: RIWAYAT & STATUS PENGAJUAN (90 HARI) -->
	{#if activeTab === 'riwayat'}
		<div class="space-y-4">
			<!-- Filter & Search Toolbar -->
			<div class="glass-panel rounded-2xl p-4 border flex flex-col md:flex-row md:items-center justify-between gap-3" style="border-color: var(--sys-sep)">
				<div class="relative flex-1">
					<IconSearch size={16} class="absolute left-3.5 top-3 text-slate-400" />
					<input
						type="text"
						placeholder="Cari berdasarkan keterangan, tanggal, status..."
						class="w-full h-10 pl-9 pr-4 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						bind:value={searchQuery}
					/>
				</div>

				<div class="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
					<button
						class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
						style={filterJenis === 'all' ? 'background: var(--p, var(--g)); color: #fff' : 'background: var(--sys-fill); color: var(--sys-label3)'}
						onclick={() => (filterJenis = 'all')}
					>
						Semua ({records.length})
					</button>
					<button
						class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
						style={filterJenis === 'sakit_pending' ? 'background: #D97706; color: #fff' : 'background: var(--sys-fill); color: var(--sys-label3)'}
						onclick={() => (filterJenis = 'sakit_pending')}
					>
						Pending HRD ({summary.sakitPendingBulanIni})
					</button>
					<button
						class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
						style={filterJenis === 'sakit' ? 'background: #16A34A; color: #fff' : 'background: var(--sys-fill); color: var(--sys-label3)'}
						onclick={() => (filterJenis = 'sakit')}
					>
						Sakit
					</button>
					<button
						class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
						style={filterJenis === 'izin' ? 'background: #2563EB; color: #fff' : 'background: var(--sys-fill); color: var(--sys-label3)'}
						onclick={() => (filterJenis = 'izin')}
					>
						Izin
					</button>
					<button
						class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
						style={filterJenis === 'terlambat' ? 'background: #EA580C; color: #fff' : 'background: var(--sys-fill); color: var(--sys-label3)'}
						onclick={() => (filterJenis = 'terlambat')}
					>
						Terlambat
					</button>
					<button
						class="p-2 rounded-lg border text-slate-400 hover:text-slate-200 transition-colors"
						style="border-color: var(--sys-sep)"
						title="Muat Ulang Data"
						onclick={loadHistoryData}
					>
						<IconRotate2 size={16} />
					</button>
				</div>
			</div>

			<!-- Riwayat Content List -->
			{#if loadingHistory}
				<CircularProgressGauge size={52} strokeWidth={4} label="Memuat riwayat izin & sakit..." />
			{:else if historyErrorMsg}
				<div class="glass-panel rounded-2xl p-6 border border-red-500/30 text-center space-y-3">
					<IconAlertTriangle size={32} class="text-red-500 mx-auto" />
					<p class="text-xs text-red-500 font-semibold">{historyErrorMsg}</p>
					<button
						class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-red-600 shadow"
						onclick={loadHistoryData}
					>
						Coba Lagi
					</button>
				</div>
			{:else if filteredRecords.length === 0}
				<div class="glass-panel rounded-3xl p-16 flex flex-col items-center justify-center text-center space-y-3">
					<div class="w-14 h-14 rounded-2xl flex items-center justify-center bg-slate-500/10 text-slate-400">
						<IconFileText size={28} />
					</div>
					<h4 class="text-base font-bold" style="color: var(--sys-label)">Tidak Ada Riwayat Pengajuan</h4>
					<p class="text-xs max-w-sm" style="color: var(--sys-label3)">
						Belum ditemukan data pengajuan izin atau sakit dalam 90 hari terakhir sesuai kriteria filter.
					</p>
					<button
						class="mt-2 px-4 py-2 rounded-xl text-xs font-bold text-white shadow"
						style="background: var(--p, var(--g))"
						onclick={() => (activeTab = 'form')}
					>
						+ Buat Pengajuan Baru
					</button>
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-3">
					{#each filteredRecords as r (r.id)}
						{@const meta = getStatusMeta(r.status, r)}
						<div
							class="glass-panel rounded-2xl p-4 md:p-5 border transition-all hover:border-slate-400 flex flex-col md:flex-row md:items-center justify-between gap-4"
							style="border-color: var(--sys-sep)"
						>
							<div class="flex items-start gap-3.5">
								<div
									class="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 mt-0.5"
									style="background: {meta.bg}; color: {meta.color}"
								>
									{#if r.status.includes('SAKIT')}
										<IconStethoscope size={22} />
									{:else if r.status.includes('TERLAMBAT')}
										<IconAlertCircle size={22} />
									{:else}
										<IconCalendarEvent size={22} />
									{/if}
								</div>
								<div class="space-y-1">
									<div class="flex items-center gap-2 flex-wrap">
										<span class="text-sm font-bold" style="color: var(--sys-label)">
											{formatTanggalIndo(r.tanggal)}
										</span>
										<span
											class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border"
											style="background: {meta.bg}; color: {meta.color}; border-color: {meta.border}"
										>
											{meta.label}
										</span>
										{#if r.kelompok_sakit_id}
											<span class="text-[9px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
												Multi-Hari
											</span>
										{/if}
									</div>
									<p class="text-xs leading-relaxed" style="color: var(--sys-label2)">
										{r.keterangan || 'Tidak ada catatan alasan.'}
									</p>
									<p class="text-[10px] font-medium" style="color: var(--sys-label4)">
										{meta.desc}
									</p>
								</div>
							</div>

							<!-- Action Buttons -->
							<div class="flex items-center gap-2 self-end md:self-center shrink-0 pt-2 md:pt-0 border-t md:border-t-0 w-full md:w-auto justify-end" style="border-color: var(--sys-sep)">
								{#if r.foto_surat_dokter}
									<button
										class="px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-colors hover:bg-slate-500/10 text-emerald-500 border-emerald-500/30"
										onclick={() => (previewModalRecord = r)}
									>
										<IconEye size={14} /> Lihat Surat Dokter
									</button>
								{/if}
								<button
									class="px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-colors hover:bg-slate-500/10"
									style="border-color: var(--sys-sep); color: var(--sys-label)"
									onclick={() => (previewModalRecord = r)}
								>
									<IconFileText size={14} /> Detail
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- TAB 3: PANDUAN & SOP HRD -->
	{#if activeTab === 'panduan'}
		<div class="glass-panel rounded-3xl p-6 md:p-8 border space-y-6" style="border-color: var(--sys-sep)">
			<div>
				<h2 class="text-lg font-bold" style="color: var(--sys-label)">Panduan & Kebijakan Kedisiplinan HRD</h2>
				<p class="text-xs mt-1" style="color: var(--sys-label3)">
					Referensi: Standard Operating Procedure (SOP) & Memo Internal No. 001/MEMO/HRD/I/2026 mengenai Absensi & Kedisiplinan.
				</p>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<!-- Card 1 -->
				<div class="p-5 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
					<div class="flex items-center gap-2 text-blue-500 font-bold text-sm">
						<IconClock size={20} />
						<span>1. Batas Waktu Pelaporan</span>
					</div>
					<p class="text-xs leading-relaxed" style="color: var(--sys-label2)">
						Seluruh pengajuan izin tidak masuk, izin setengah hari, sakit, atau keterlambatan wajib diajukan melalui portal ini <strong>sebelum jam kerja / shift Anda dimulai</strong>. Apabila Anda sudah melakukan absensi masuk, pengajuan izin hari tersebut akan terkunci secara otomatis.
					</p>
				</div>

				<!-- Card 2 -->
				<div class="p-5 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
					<div class="flex items-center gap-2 text-emerald-500 font-bold text-sm">
						<IconStethoscope size={20} />
						<span>2. Aturan Surat Sakit (Maks 5 Hari)</span>
					</div>
					<p class="text-xs leading-relaxed" style="color: var(--sys-label2)">
						Pengajuan sakit singkat maksimal <strong>5 hari kalender</strong> dapat diajukan via modul ini dengan melampirkan foto Surat Keterangan Dokter resmi (ada cap klinik/RS & tanda tangan dokter). Sakit lebih dari 5 hari wajib menggunakan jalur <strong>Cuti Sakit</strong> formal.
					</p>
				</div>

				<!-- Card 3 -->
				<div class="p-5 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
					<div class="flex items-center gap-2 text-amber-500 font-bold text-sm">
						<IconAlertTriangle size={20} />
						<span>3. Verifikasi 2x24 Jam & Penurunan Alpa</span>
					</div>
					<p class="text-xs leading-relaxed" style="color: var(--sys-label2)">
						Status sakit akan tercatat sementara sebagai <em>"Sakit Belum Surat Dokter"</em>. Tim HRD memvalidasi keabsahan surat maksimal dalam 2 hari kerja. Apabila surat tidak sah atau tidak diverifikasi dalam 2 hari, sistem otomatis menurunkan status menjadi <strong>ALPA (Tidak Hadir Tanpa Izin)</strong>.
					</p>
				</div>

				<!-- Card 4 -->
				<div class="p-5 rounded-2xl border bg-slate-500/5 space-y-2" style="border-color: var(--sys-sep)">
					<div class="flex items-center gap-2 text-purple-500 font-bold text-sm">
						<IconFileCheck size={20} />
						<span>4. Skema Dampak Pemotongan Upah</span>
					</div>
					<ul class="text-xs leading-relaxed space-y-1 list-disc list-inside" style="color: var(--sys-label2)">
						<li><strong>Sakit Sah (Surat Dokter):</strong> Bebas dari segala potongan upah harian.</li>
						<li><strong>Izin 1/2 Hari:</strong> Dikenakan pemotongan 0.5 hari kerja secara proporsional.</li>
						<li><strong>Izin Terlambat:</strong> Dikenakan pemotongan proporsional menit keterlambatan.</li>
						<li><strong>Izin 1 Hari:</strong> Dikenakan pemotongan upah 1 hari kerja penuh.</li>
					</ul>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- MODAL DETAIL & PREVIEW SURAT DOKTER -->
{#if previewModalRecord}
	{@const meta = getStatusMeta(previewModalRecord.status, previewModalRecord)}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
		<div
			class="glass-panel rounded-3xl max-w-lg w-full border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
			style="border-color: var(--sys-sep); background: var(--sys-bg, #1e293b)"
		>
			<!-- Modal Header -->
			<div class="p-5 border-b flex items-center justify-between" style="border-color: var(--sys-sep)">
				<div>
					<h3 class="text-base font-bold" style="color: var(--sys-label)">Detail Pengajuan Izin / Sakit</h3>
					<p class="text-[11px]" style="color: var(--sys-label3)">{formatTanggalIndo(previewModalRecord.tanggal)}</p>
				</div>
				<button
					class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white transition-colors"
					onclick={() => (previewModalRecord = null)}
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Modal Body -->
			<div class="p-5 overflow-y-auto space-y-4">
				<!-- Status Card -->
				<div class="p-3.5 rounded-xl border flex items-center justify-between" style="background: {meta.bg}; border-color: {meta.border}">
					<div>
						<span class="text-[10px] font-bold uppercase tracking-wider block" style="color: {meta.color}">Status Kehadiran</span>
						<p class="text-sm font-bold" style="color: {meta.color}">{meta.label}</p>
					</div>
					<div class="w-8 h-8 rounded-lg flex items-center justify-center bg-white/20 text-white">
						{#if previewModalRecord.status.includes('SAKIT')}
							<IconStethoscope size={18} />
						{:else}
							<IconCalendarEvent size={18} />
						{/if}
					</div>
				</div>

				<!-- Detail Keterangan -->
				<div class="space-y-1">
					<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Alasan / Diagnosa:</span>
					<p class="text-xs p-3 rounded-xl border bg-slate-500/5 leading-relaxed" style="border-color: var(--sys-sep); color: var(--sys-label)">
						{previewModalRecord.keterangan || '-'}
					</p>
				</div>

				<!-- Foto Surat Dokter -->
				{#if previewModalRecord.foto_surat_dokter}
					<div class="space-y-2">
						<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lampiran Surat Dokter:</span>
						<div class="rounded-2xl border overflow-hidden bg-black/20 text-center relative group" style="border-color: var(--sys-sep)">
							<img
								src={`/api/directus/assets/${previewModalRecord.foto_surat_dokter}`}
								alt="Surat Dokter"
								class="w-full max-h-72 object-contain mx-auto"
							/>
							<div class="p-2 bg-slate-900/80 flex items-center justify-center gap-2">
								<a
									href={`/api/directus/assets/${previewModalRecord.foto_surat_dokter}`}
									target="_blank"
									rel="noreferrer"
									class="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 flex items-center gap-1.5"
								>
									<IconDownload size={14} /> Buka / Unduh Surat Asli
								</a>
							</div>
						</div>
					</div>
				{:else}
					<div class="p-3 rounded-xl border border-dashed text-center text-xs text-slate-400" style="border-color: var(--sys-sep)">
						Tidak ada lampiran surat dokter pada pengajuan ini.
					</div>
				{/if}

				<!-- Informasi Tambahan -->
				<div class="p-3 rounded-xl bg-slate-500/5 border text-[11px] space-y-1 text-slate-400" style="border-color: var(--sys-sep)">
					<p>• ID Transaksi: <span class="font-mono text-slate-300">{previewModalRecord.id}</span></p>
					{#if previewModalRecord.kelompok_sakit_id}
						<p>• ID Kelompok Multi-Hari: <span class="font-mono text-slate-300">{previewModalRecord.kelompok_sakit_id}</span></p>
					{/if}
					<p>• Sumber Input: <span class="text-slate-300">{previewModalRecord.sumber || 'ESS'}</span></p>
				</div>
			</div>

			<!-- Modal Footer -->
			<div class="p-4 border-t flex justify-end" style="border-color: var(--sys-sep)">
				<button
					class="px-5 py-2 rounded-xl text-xs font-bold border transition-colors hover:bg-slate-500/10"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => (previewModalRecord = null)}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}
