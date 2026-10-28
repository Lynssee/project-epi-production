<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { authStore, getUserDisplay, getUserInitials } from '$lib/stores/auth';
	import { rolesStore, getRoleLabel } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getTodayStatus, type AbsensiHarianRecord, type TodayStatus } from '$lib/services/ess/attendance';
	import { getPengumumanList } from '$lib/services/ess/pengumuman';
	import { getMyHrDocuments } from '$lib/services/ess/hrDocuments';
	import { getOnboardingStatus, type OnboardingStatus } from '$lib/services/ess/training';
	import { getMentees } from '$lib/services/ess/mentor';
	import { getCutiStatus } from '$lib/services/ess/cuti';
	import { getLemburStatus } from '$lib/services/ess/lembur';
	import { getCalendarEvents, type CalendarEvent } from '$lib/services/ess/calendar';
	import { getNotes, createNote, type PersonalNote } from '$lib/services/ess/notes';
	import { SectionGuide } from '$lib/components/hints';
	import BookmarkBar from '$lib/components/ess/BookmarkBar.svelte';
	import { essHints } from '$lib/data/hints/ess';
	import { getHint } from '$lib/data/hints/getHint';

	import { getActiveCheckin, type SiteCheckinRecord } from '$lib/services/siteCheckin';

	import {
		IconLoader2, IconClock, IconMapPinOff, IconCircleCheck, IconAlertTriangle,
		IconCalendarEvent, IconUserCheck, IconChevronRight, IconReceipt2, IconUserCircle,
		IconTrophy, IconSpeakerphone, IconHourglass, IconCash, IconFileText, IconFilePlus,
		IconMedicalCross, IconGauge, IconWallet, IconSchool, IconChecklist, IconCertificate, IconCalculator,
		IconDoorExit, IconUserX, IconAward, IconGift, IconUsersGroup, IconPlayerPlay, IconTool,
		IconNotes, IconBookmark, IconCalendarMonth, IconCar, IconTruck, IconFileDescription,
		IconSearch, IconX, IconPin, IconSend, IconSparkles, IconArrowRight, IconTrendingUp,
		IconRefresh, IconCheck, IconCalendarTime, IconBriefcase, IconBuildingFactory2, IconMapPin
	} from '@tabler/icons-svelte';

	/** Pintasan pembaca hint modul ESS */
	const h = (key: string) => getHint(essHints, key, 'ess');

	// RBAC & Hak Akses
	let canApproveCutiEss = $derived(hasPermission($authStore.roleId, 'approve_cuti_ess', $rolesStore));
	let canViewSji = $derived(
		$authStore.roleId === 'super_admin' ||
		$authStore.roleIds?.includes('super_admin') ||
		hasPermission($authStore.roleId, 'view_sji', $rolesStore, $authStore.roleIds) ||
		hasPermission($authStore.roleId, 'input_sji', $rolesStore, $authStore.roleIds)
	);
	let canSiteCheckin = $derived(
		$authStore.roleId === 'super_admin' ||
		$authStore.roleIds?.includes('super_admin') ||
		hasPermission($authStore.roleId, 'access_site_checkin', $rolesStore, $authStore.roleIds)
	);
	let canSalesVisit = $derived(
		$authStore.roleId === 'super_admin' ||
		$authStore.roleIds?.includes('super_admin') ||
		hasPermission($authStore.roleId, 'input_sales', $rolesStore, $authStore.roleIds)
	);

	// Status Utama
	let unreadPengumuman = $state(0);
	let pendingSignatures = $state(0);
	let onboarding = $state<OnboardingStatus | null>(null);
	let jumlahMentee = $state(0);

	// Status Absensi Hari Ini
	let loading = $state(true);
	let errorMsg = $state('');
	let record = $state<AbsensiHarianRecord | null>(null);
	let tanggal = $state('');
	let istirahat = $state<TodayStatus['istirahat'] | null>(null);
	let showIstirahatDetail = $state(false);
	let activeSiteCheckin = $state<SiteCheckinRecord | null>(null);

	// Personal Hub Stats
	let sisaCuti = $state<number | null>(null);
	let lemburBulanIniJam = $state<number | null>(null);
	let upcomingEvents = $state<CalendarEvent[]>([]);
	let pinnedNotes = $state<PersonalNote[]>([]);
	let quickLogText = $state('');
	let quickLogSubmitting = $state(false);
	let quickLogSuccess = $state(false);

	// Search & Category Filter
	let searchQuery = $state('');
	let activeCategoryTab = $state('all');

	// Live Clock Real-time
	let currentTime = $state(new Date());
	let clockInterval: any;

	onMount(() => {
		clockInterval = setInterval(() => {
			currentTime = new Date();
		}, 1000);
	});

	onDestroy(() => {
		if (clockInterval) clearInterval(clockInterval);
	});

	function pad2(n: number) {
		return String(n).padStart(2, '0');
	}

	function toISODate(d: Date) {
		return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
	}

	function isEmptyTime(v: string | null | undefined) {
		return !v || v === '-' || v === '--:--';
	}

	let sudahMasuk = $derived(Boolean(record && !isEmptyTime(record.jam_masuk)));
	let sudahPulang = $derived(Boolean(record && !isEmptyTime(record.jam_keluar)));

	// Fase 3 Absensi Istirahat (Foto Wajib): mesin-status Bekerja <-> Istirahat.
	let istirahatAktif = $derived(Boolean(istirahat?.aktif));
	let jedaTerbuka = $derived(istirahat?.jedaTerbuka ?? null);
	let sedangIstirahat = $derived(Boolean(jedaTerbuka));
	let jedaTerbukaKategoriNama = $derived(
		jedaTerbuka?.kategori_id ? istirahat?.kategoriAktif?.find((k) => k.id === jedaTerbuka?.kategori_id)?.nama ?? null : null
	);
	let istirahatMenitBerjalan = $derived.by(() => {
		if (!jedaTerbuka?.jam_keluar) return null;
		const [h, m] = jedaTerbuka.jam_keluar.split(':').map(Number);
		if (Number.isNaN(h) || Number.isNaN(m)) return null;
		const target = new Date(currentTime);
		target.setHours(h, m, 0, 0);
		let diffMin = Math.floor((currentTime.getTime() - target.getTime()) / 60000);
		if (diffMin < 0) diffMin += 1440;
		return diffMin;
	});

	// Durasi Kerja Berjalan (Elapsed Time)
	let workDuration = $derived.by(() => {
		if (!sudahMasuk || !record?.jam_masuk || sudahPulang) return null;
		try {
			const [hStr, mStr] = record.jam_masuk.split(':');
			const h = parseInt(hStr, 10);
			const m = parseInt(mStr, 10);
			if (isNaN(h) || isNaN(m)) return null;

			const startMin = h * 60 + m;
			const curMin = currentTime.getHours() * 60 + currentTime.getMinutes();
			const diffMin = Math.max(0, curMin - startMin);
			const hours = Math.floor(diffMin / 60);
			const mins = diffMin % 60;
			return `${hours}j ${mins}m`;
		} catch {
			return null;
		}
	});

	// Load Data Absensi Utama
	async function loadAttendance() {
		loading = true;
		errorMsg = '';
		try {
			const status = await getTodayStatus();
			record = status.record;
			tanggal = status.tanggal;
			istirahat = status.istirahat;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat status absensi.';
		} finally {
			loading = false;
		}
	}

	// Non-blocking Parallel Loading
	onMount(() => {
		loadAttendance();

		getMentees()
			.then((res) => (jumlahMentee = res.mentees.length))
			.catch(() => {});

		getOnboardingStatus()
			.then((res) => (onboarding = res))
			.catch(() => {});

		getPengumumanList()
			.then((res) => (unreadPengumuman = res.unreadCount))
			.catch(() => {});

		getMyHrDocuments()
			.then((res) => (pendingSignatures = res.pendingCount))
			.catch(() => {});

		// Load Personal Metrics
		getCutiStatus()
			.then((res) => {
				sisaCuti = res?.sisaCuti?.sisa ?? null;
			})
			.catch(() => {});

		getLemburStatus()
			.then((res) => {
				if (res?.riwayat) {
					const today = new Date();
					const monthStart = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-01`;
					lemburBulanIniJam = res.riwayat
						.filter((r) => r.status === 'Disetujui' && r.tanggal >= monthStart)
						.reduce((sum, r) => sum + (r.durasi_jam || 0), 0);
				}
			})
			.catch(() => {});

		// 7 Hari Ke Depan
		const today = new Date();
		const in7 = new Date();
		in7.setDate(in7.getDate() + 7);
		getCalendarEvents(toISODate(today), toISODate(in7))
			.then((events) => {
				upcomingEvents = events.slice(0, 4);
			})
			.catch(() => {});

		// Pinned Notes
		getNotes({ status: 'active' })
			.then((notes) => {
				pinnedNotes = notes.filter((n) => n.is_pinned).slice(0, 3);
			})
			.catch(() => {});

		// Active Site Check-in
		if (canSiteCheckin) {
			getActiveCheckin()
				.then((res) => (activeSiteCheckin = res))
				.catch(() => {});
		}
	});

	async function submitQuickLog() {
		const content = quickLogText.trim();
		if (!content || quickLogSubmitting) return;
		quickLogSubmitting = true;
		try {
			const newNote = await createNote({ content, type: 'quick_log' });
			quickLogText = '';
			quickLogSuccess = true;
			setTimeout(() => (quickLogSuccess = false), 2500);
			pinnedNotes = [newNote, ...pinnedNotes].slice(0, 3);
		} catch {
			// fail silently in quick widget
		} finally {
			quickLogSubmitting = false;
		}
	}

	function formatShortDate(iso: string) {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
	}

	// Menu Data Structure with Thematic Color Accents
	const categories = $derived([
		{
			id: 'waktu',
			title: 'Kehadiran & Waktu',
			accentColor: '#0284c7',
			accentBg: 'rgba(2, 132, 199, 0.12)',
			items: [
				{ id: 'site-checkin', icon: IconBuildingFactory2, label: 'Site Check-in Proyek', desc: 'Check-in kunjungan proyek & GPS', route: '/site-checkin', show: () => canSiteCheckin, badge: () => activeSiteCheckin ? 'Aktif' : null, badgeType: 'alert' },
				{ id: 'sales-visit', icon: IconMapPin, label: 'Kunjungan Sales (Visit)', desc: 'Input log kunjungan customer & prospek', route: '/sales', show: () => canSalesVisit },
				{ id: 'izin-sakit', icon: IconMedicalCross, label: 'Izin / Sakit', desc: 'Ajukan sakit & surat dokter', route: '/ess/izin-sakit', show: true },
				{ id: 'izin-jam', icon: IconClock, label: 'Izin Per Jam', desc: 'Izin keluar dinas / pribadi', route: '/ess/izin-jam', show: true },
				{ id: 'cuti', icon: IconCalendarEvent, label: 'Cuti Saya', desc: 'Saldo cuti tahunan & pengajuan', route: '/ess/cuti', show: true, badge: () => sisaCuti != null ? `${sisaCuti} hr` : null, badgeType: 'info' },
				{ id: 'lembur', icon: IconHourglass, label: 'Lembur Saya', desc: 'Pengajuan & approval lembur', route: '/ess/lembur', show: true },
				{ id: 'shift', icon: IconRefresh, label: 'Jadwal Shift', desc: 'Roster shift & tukar jadwal', route: '/ess/shift', show: true },
				{ id: 'kalender', icon: IconCalendarMonth, label: 'Kalender Saya', desc: 'Jadwal kerja, cuti & event', route: '/ess/kalender', show: true },
				{ id: 'disiplin', icon: IconGauge, label: 'Status Kehadiran', desc: 'Rekap kehadiran & kedisiplinan', route: '/ess/disiplin', show: true },
				{ id: 'kehadiran', icon: IconCalendarTime, label: 'Riwayat Kehadiran', desc: 'Daftar absensi harian & ekspor PDF/CSV', route: '/ess/kehadiran', show: true }
			]
		},
		{
			id: 'keuangan',
			title: 'Keuangan & Payroll',
			accentColor: '#059669',
			accentBg: 'rgba(5, 150, 105, 0.12)',
			items: [
				{ id: 'kasbon', icon: IconWallet, label: 'Kasbon', desc: 'Pinjaman karyawan & cicilan', route: '/ess/kasbon', show: true },
				{ id: 'reimburse', icon: IconCash, label: 'Reimbursement', desc: 'Klaim biaya operasional', route: '/ess/reimburse', show: true },
				{ id: 'petty-cash', icon: IconReceipt2, label: 'Kas Kecil', desc: 'Ajukan pengeluaran kas kecil', route: '/ess/petty-cash', show: true },
				{ id: 'slip', icon: IconReceipt2, label: 'Slip Gaji', desc: 'Rincian gaji bulanan terenkripsi', route: '/ess/slip-gaji', show: true },
				{ id: 'keuangan', icon: IconTrendingUp, label: 'Keuangan Saya', desc: 'Ringkasan kasbon, klaim & THR', route: '/ess/keuangan', show: true }
			]
		},
		{
			id: 'fasilitas',
			title: 'Fasilitas & Operasional',
			accentColor: '#d97706',
			accentBg: 'rgba(217, 119, 6, 0.12)',
			items: [
				{ id: 'kendaraan', icon: IconCar, label: 'Pinjam Kendaraan', desc: 'Pemesanan armada operasional', route: '/ess/kendaraan', show: true },
				{ id: 'ga-request', icon: IconChecklist, label: 'Permintaan GA', desc: 'Pengadaan ATK & fasilitas', route: '/ga-request', show: true }
			]
		},
		{
			id: 'dokumen',
			title: 'Administrasi & Dokumen',
			accentColor: '#6366f1',
			accentBg: 'rgba(99, 102, 241, 0.12)',
			items: [
				{ id: 'dokumen-saya', icon: IconFileText, label: 'Dokumen Saya', desc: 'Arsip & dokumen perlu tanda tangan', route: '/ess/dokumen-saya', show: true, badge: () => pendingSignatures > 0 ? pendingSignatures : null, badgeType: 'alert' },
				{ id: 'dokumen-request', icon: IconFilePlus, label: 'Minta Dokumen', desc: 'SK kerja, referensi & surat tugas', route: '/ess/dokumen-request', show: true },
				{ id: 'sji', icon: IconTruck, label: 'Surat Jalan Internal', desc: 'Distribusi material proyek', route: '/sji', show: () => canViewSji },
				{ id: 'sj-manual', icon: IconFileDescription, label: 'Surat Jalan Manual', desc: 'Form surat jalan fisik', route: '/sj-manual', show: () => canViewSji },
				{ id: 'notes', icon: IconNotes, label: 'Catatan Saya', desc: 'Personal notes & scratchpad', route: '/ess/notes', show: true },
				{ id: 'bookmarks', icon: IconBookmark, label: 'Pintasan Saya', desc: 'Atur menu favorit cepat', route: '/ess/bookmarks', show: true },
				{ id: 'aset-saya', icon: IconBriefcase, label: 'Aset & Alat Saya', desc: 'Barang kantor & alat kerja atas nama Anda', route: '/ess/aset-saya', show: true },
				{ id: 'profil', icon: IconUserCircle, label: 'Profil Saya', desc: 'Data personal & kredensial akun', route: '/ess/profil', show: true }
			]
		},
		{
			id: 'kinerja',
			title: 'Informasi & Kinerja',
			accentColor: '#9333ea',
			accentBg: 'rgba(147, 51, 234, 0.12)',
			items: [
				{ id: 'kinerja', icon: IconTrophy, label: 'Kinerja Saya', desc: 'Scorecard KPI & target capaian', route: '/ess/kinerja', show: true },
				{ id: 'wo-saya', icon: IconTool, label: 'Work Order Saya', desc: 'Khusus personel maintenance', route: '/ess/maintenance-kpi', show: () => ($authStore.karyawanDivisi || '').toUpperCase().includes('MAINTENANCE') },
				{ id: 'gamifikasi', icon: IconAward, label: 'Poin & Badge', desc: 'Leaderboard & capaian prestasi', route: '/ess/gamifikasi', show: true },
				{ id: 'apresiasi-saya', icon: IconGift, label: 'Apresiasi Saya', desc: 'Hadiah & apresiasi dari perusahaan', route: '/ess/apresiasi-saya', show: true },
				{ id: 'penilaian-rekan', icon: IconUsersGroup, label: 'Penilaian Rekan', desc: 'Review 360 antar rekan kerja', route: '/ess/penilaian-rekan', show: true },
				{ id: 'pelatihan', icon: IconSchool, label: 'Pelatihan', desc: 'Silabus keahlian & e-learning', route: '/ess/pelatihan', show: true, badge: () => (onboarding && !onboarding.selesai ? onboarding.totalProgram - onboarding.totalSelesai : null), badgeType: 'alert' },
				{ id: 'buku-saku-cat', icon: IconCalculator, label: 'Buku Saku Cat', desc: 'Kalkulator cat, dew point & kartu cepat', route: '/ess/pelatihan/buku-saku', show: true },
				{ id: 'sertifikasi', icon: IconCertificate, label: 'Sertifikasi', desc: 'Sertifikat keahlian & masa berlaku', route: '/ess/sertifikasi', show: true },
				{ id: 'pengumuman', icon: IconSpeakerphone, label: 'Pengumuman', desc: 'Warta resmi dari HRD & manajemen', route: '/ess/pengumuman', show: true, badge: () => unreadPengumuman > 0 ? unreadPengumuman : null, badgeType: 'alert' },
				{ id: 'approval', icon: IconUserCheck, label: 'Approval Center', desc: 'Persetujuan cuti/lembur bawahan', route: '/ess/approval', show: () => canApproveCutiEss }
			]
		},
		{
			id: 'karir',
			title: 'Onboarding & Karir',
			accentColor: '#e11d48',
			accentBg: 'rgba(225, 29, 72, 0.12)',
			items: [
				{ id: 'onboarding', icon: IconChecklist, label: 'Onboarding Saya', desc: 'Checklist masa orientasi karyawan', route: '/ess/onboarding', show: true },
				{ id: 'mentor', icon: IconUsersGroup, label: 'Dashboard Mentor', desc: 'Bimbingan probation & mentee', route: '/ess/mentor', show: () => jumlahMentee > 0, badge: () => jumlahMentee > 0 ? jumlahMentee : null, badgeType: 'info' },
				{ id: 'offboarding', icon: IconDoorExit, label: 'Offboarding Saya', desc: 'Clearance fasilitas & inventaris', route: '/ess/offboarding', show: true },
				{ id: 'resign', icon: IconUserX, label: 'Ajukan Resign', desc: 'Form pengunduran diri formal', route: '/ess/resign', show: true }
			]
		}
	]);

	// Filtered Category Groups based on Search & Tabs
	let filteredCategories = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		return categories
			.map((cat) => {
				if (activeCategoryTab !== 'all' && cat.id !== activeCategoryTab) {
					return { ...cat, visibleItems: [] };
				}
				const visibleItems = cat.items.filter((item) => {
					const isAllowed = typeof item.show === 'function' ? item.show() : item.show;
					if (!isAllowed) return false;
					if (!q) return true;
					return (
						item.label.toLowerCase().includes(q) ||
						(item.desc && item.desc.toLowerCase().includes(q))
					);
				});
				return { ...cat, visibleItems };
			})
			.filter((cat) => cat.visibleItems.length > 0);
	});

	let totalFilteredCount = $derived(
		filteredCategories.reduce((acc, cat) => acc + cat.visibleItems.length, 0)
	);

	function getBadgeValue(badge?: any): string | number | null {
		if (badge === undefined || badge === null) return null;
		const val = typeof badge === 'function' ? badge() : badge;
		if (typeof val === 'number' && val > 0) return val;
		if (typeof val === 'string' && val.trim() !== '' && val !== '0') return val;
		return null;
	}
</script>

<svelte:head>
	<title>Portal Karyawan (ESS) — Eltama Dashboard</title>
</svelte:head>

<div class="w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6 pb-28">

	<!-- ══════════════════════════════════════════════════════════════════════════
	     1. HERO HEADER: Greeting, Live Clock & Profile Pill
	     ══════════════════════════════════════════════════════════════════════════ -->
	<div class="rounded-3xl p-6 sm:p-7 relative overflow-hidden border transition-all duration-300 shadow-sm"
		style="background: var(--sys-bg2); border-color: var(--sys-sep);">
		
		<!-- Ambient Background Glows -->
		<div class="absolute -top-16 -right-16 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
		<div class="absolute -bottom-16 -left-16 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

		<div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
			<!-- User Info & Greeting -->
			<div class="flex items-center gap-4 sm:gap-5">
				<div class="relative shrink-0">
					<div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center font-black text-xl sm:text-2xl shadow-md border"
						style="background: linear-gradient(135deg, var(--sys-tint) 0%, #0284c7 100%); color: #ffffff; border-color: rgba(255,255,255,0.15)">
						{getUserInitials($authStore.user)}
					</div>
					<div class="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 flex items-center justify-center shadow-sm"
						style="border-color: var(--sys-bg2)" title="Akun Aktif">
						<span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
					</div>
				</div>

				<div>
					<div class="flex items-center gap-2 flex-wrap mb-1">
						<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase border"
							style="background: var(--sys-fill2); color: var(--sys-tint); border-color: var(--sys-sep)">
							Portal Karyawan (ESS)
						</span>
						{#if $authStore.karyawanDivisi}
							<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-800">
								{$authStore.karyawanDivisi}
							</span>
						{/if}
					</div>

					<h1 class="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-tight" style="color: var(--sys-label)">
						Halo, <span class="gradient-text font-black">{getUserDisplay($authStore.user) || 'Karyawan'}</span> 👋
					</h1>
					<p class="text-xs sm:text-sm font-medium mt-0.5" style="color: var(--sys-label3)">
						Akses cepat layanan mandiri, kehadiran kerja, keuangan, dan dokumen personal Anda.
					</p>
				</div>
			</div>

			<!-- Live Clock & Date Badge -->
			<div class="flex flex-row md:flex-col items-start md:items-end justify-between border-t md:border-t-0 pt-4 md:pt-0 gap-2 shrink-0"
				style="border-color: var(--sys-sep)">
				<div class="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl border shadow-inner"
					style="background: var(--sys-fill); border-color: var(--sys-sep2)">
					<div class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></div>
					<span class="text-xs sm:text-sm font-bold font-mono tracking-wider" style="color: var(--sys-label)">
						{pad2(currentTime.getHours())}:{pad2(currentTime.getMinutes())}:{pad2(currentTime.getSeconds())} WIB
					</span>
				</div>
				<span class="text-[11px] font-semibold" style="color: var(--sys-label3)">
					{currentTime.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
				</span>
			</div>
		</div>
	</div>

	<!-- Top Utility Bar: Section Guide & Bookmarks -->
	<div class="space-y-3">
		<SectionGuide
			id="ess.menu.page"
			title={h('menu.page').sectionGuide?.title || 'Panduan Penggunaan Portal Karyawan'}
			steps={h('menu.page').sectionGuide?.steps ?? []}
		/>

		<BookmarkBar />
	</div>

	<!-- Onboarding Progress Banner (Refined Visual Polish) -->
	{#if onboarding && !onboarding.selesai}
		{@const pct = Math.round((onboarding.totalSelesai / Math.max(1, onboarding.totalProgram)) * 100)}
		<div
			role="button"
			tabindex="0"
			class="w-full rounded-2xl p-4 sm:p-5 border relative overflow-hidden transition-all duration-200 hover:shadow-md cursor-pointer group"
			style="background: linear-gradient(135deg, rgba(225, 29, 72, 0.08) 0%, rgba(244, 63, 94, 0.03) 100%); border-color: rgba(225, 29, 72, 0.25);"
			onclick={() => goto('/ess/pelatihan')}
			onkeydown={(e) => e.key === 'Enter' && goto('/ess/pelatihan')}
		>
			<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div class="flex items-start sm:items-center gap-3.5">
					<div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm border border-rose-500/30 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 group-hover:scale-105 transition-transform">
						<IconSchool size={26} stroke={1.8} />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<span class="text-xs font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">Orientasi Karyawan</span>
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
								{pct}% Selesai
							</span>
						</div>
						<p class="text-sm font-bold mt-0.5" style="color: var(--sys-label)">Selesaikan Modul Onboarding Anda</p>
						<p class="text-xs font-medium" style="color: var(--sys-label3)">
							{onboarding.totalSelesai} dari {onboarding.totalProgram} modul selesai
							{#if onboarding.tenggatTerdekat}
								· <span class="text-amber-600 dark:text-amber-400 font-semibold">Tenggat {new Date(onboarding.tenggatTerdekat).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
							{/if}
						</p>
					</div>
				</div>

				<div class="flex items-center gap-3 self-end sm:self-center">
					<div class="hidden md:block w-32 bg-rose-200/50 dark:bg-rose-950/70 h-2.5 rounded-full overflow-hidden border border-rose-300/40 dark:border-rose-900/40">
						<div class="bg-rose-500 h-full rounded-full transition-all duration-500" style="width: {pct}%"></div>
					</div>
					<button
						class="px-4 py-2 rounded-xl text-xs font-bold text-white shadow-sm flex items-center gap-1.5 transition-all group-hover:opacity-95 shrink-0"
						style="background: linear-gradient(135deg, #e11d48 0%, #be123c 100%)">
						<span>Lanjutkan</span>
						<IconArrowRight size={14} />
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- ══════════════════════════════════════════════════════════════════════════
	     2. MAIN BALANCED DASHBOARD: Left Hub (5 col) + Right Services (7 col)
	     ══════════════════════════════════════════════════════════════════════════ -->
	<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

		<!-- ──────────────────────────────────────────────────────────────────────
		     LEFT COLUMN: Attendance Status + Quick Personal Metrics + Mini Agenda
		     ────────────────────────────────────────────────────────────────────── -->
		<div class="lg:col-span-5 flex flex-col gap-5">

			<!-- 2.1 Kartu Kehadiran Hari Ini (Enhanced Attendance Widget) -->
			<div class="rounded-3xl p-5 sm:p-6 border relative overflow-hidden flex flex-col justify-between shadow-sm transition-all duration-300"
				style="background: var(--sys-bg2); border-color: var(--sys-sep);">
				
				<!-- Subtle Ambient Glow -->
				<div class="absolute top-0 right-0 w-36 h-36 bg-blue-500/10 rounded-full blur-2xl pointer-events-none"></div>

				<div class="flex justify-between items-center mb-5 relative z-10">
					<div class="flex items-center gap-2">
						<div class="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/15 text-blue-600 dark:text-blue-400">
							<IconClock size={18} stroke={2} />
						</div>
						<h2 class="text-base font-bold" style="color: var(--sys-label)">Kehadiran Hari Ini</h2>
					</div>

					<span class="px-3 py-1 rounded-full text-[11px] font-bold border shadow-xs"
						style="background: var(--sys-fill); color: var(--sys-label2); border-color: var(--sys-sep2)">
						{tanggal || currentTime.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
					</span>
				</div>

				{#if loading}
					<div class="relative z-10 my-auto"><CircularProgressGauge size={50} strokeWidth={4} label="Memeriksa status absensi..." /></div>
				{:else if errorMsg}
					<div class="relative z-10 flex flex-col items-center justify-center py-6 my-auto text-center">
						<div class="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mb-3 text-amber-600 dark:text-amber-400">
							<IconAlertTriangle size={24} />
						</div>
						<p class="text-xs font-bold mb-1" style="color: var(--sys-label)">Status Kehadiran Belum Dimuat</p>
						<p class="text-[11px] mb-4 max-w-[260px] leading-relaxed" style="color: var(--sys-label3)">{errorMsg}</p>
						<div class="flex items-center gap-2 flex-wrap justify-center">
							<button
								class="px-4 py-2 rounded-xl text-xs font-bold text-white shadow-sm transition-all"
								style="background: var(--sys-tint)"
								onclick={loadAttendance}
							>
								Coba Lagi
							</button>
							<button
								class="px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors"
								style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
								onclick={() => goto('/ess/absen')}
							>
								Buka Absen →
							</button>
						</div>
					</div>
				{:else}
					<!-- Work Status Pill Indicator -->
					<div class="relative z-10 mb-4">
						{#if sudahMasuk && sudahPulang}
							<div class="flex items-center gap-2 px-3 py-1.5 rounded-xl border bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
								<IconCircleCheck size={16} class="text-emerald-500" />
								<span>Presensi Lengkap (Masuk & Pulang)</span>
							</div>
						{:else if sudahMasuk && sedangIstirahat}
							<div class="flex items-center justify-between px-3 py-1.5 rounded-xl border bg-purple-500/10 border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-bold">
								<div class="flex items-center gap-2">
									<span class="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
									<span>Sedang Istirahat{jedaTerbukaKategoriNama ? ` — ${jedaTerbukaKategoriNama}` : ''}</span>
								</div>
								{#if istirahatMenitBerjalan != null}
									<span class="font-mono font-black text-[11px] px-2 py-0.5 rounded-md bg-purple-500/15">
										⏱️ {istirahatMenitBerjalan}m
									</span>
								{/if}
							</div>
						{:else if sudahMasuk}
							<div class="flex items-center justify-between px-3 py-1.5 rounded-xl border bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-bold">
								<div class="flex items-center gap-2">
									<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
									<span>Sedang Bekerja</span>
								</div>
								{#if workDuration}
									<span class="font-mono font-black text-[11px] px-2 py-0.5 rounded-md bg-blue-500/15">
										⏱️ {workDuration}
									</span>
								{/if}
							</div>
						{:else}
							<div class="flex items-center gap-2 px-3 py-1.5 rounded-xl border"
								style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label3)">
								<span class="w-2 h-2 rounded-full bg-amber-500"></span>
								<span class="text-xs font-semibold">Belum melakukan absensi masuk</span>
							</div>
						{/if}
					</div>

					<!-- Time Check-in & Check-out Boxes -->
					<div class="grid grid-cols-2 gap-3 relative z-10 mb-5">
						<!-- Jam Masuk -->
						<div class="p-3.5 sm:p-4 rounded-2xl border transition-all"
							style="background: var(--sys-fill); border-color: var(--sys-sep)">
							<div class="flex items-center justify-between mb-1">
								<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Jam Masuk</span>
								<span class="w-2 h-2 rounded-full {sudahMasuk ? 'bg-emerald-500' : 'bg-slate-400/40'}"></span>
							</div>
							<p class="text-xl sm:text-2xl font-black font-mono tracking-tight" style="color: var(--sys-label)">
								{sudahMasuk ? record?.jam_masuk : '--:--'}
							</p>
							{#if sudahMasuk && record?.masuk_valid === false}
								<div class="mt-2 flex items-center gap-1 text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md w-fit text-[10px] font-bold">
									<IconMapPinOff size={12} />
									<span>Luar Radius</span>
								</div>
							{/if}
						</div>

						<!-- Jam Pulang -->
						<div class="p-3.5 sm:p-4 rounded-2xl border transition-all"
							style="background: var(--sys-fill); border-color: var(--sys-sep)">
							<div class="flex items-center justify-between mb-1">
								<span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Jam Pulang</span>
								<span class="w-2 h-2 rounded-full {sudahPulang ? 'bg-emerald-500' : 'bg-slate-400/40'}"></span>
							</div>
							<p class="text-xl sm:text-2xl font-black font-mono tracking-tight" style="color: var(--sys-label)">
								{sudahPulang ? record?.jam_keluar : '--:--'}
							</p>
							{#if sudahPulang && record?.pulang_valid === false}
								<div class="mt-2 flex items-center gap-1 text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md w-fit text-[10px] font-bold">
									<IconMapPinOff size={12} />
									<span>Luar Radius</span>
								</div>
							{/if}
						</div>
					</div>

					<!-- Fase 3 Absensi Istirahat: baris ringkas + tautan detail -->
					{#if istirahatAktif}
						<div class="relative z-10 mb-4 rounded-2xl p-3 border flex items-center justify-between gap-2" style="background: var(--sys-fill); border-color: var(--sys-sep)">
							<div class="flex items-center gap-2 text-xs" style="color: var(--sys-label2)">
								<IconHourglass size={14} class="text-purple-500 shrink-0" />
								<span
									title="Absen keluar saat mulai istirahat (pilih jenisnya), lalu absen kembali dengan foto saat selesai. Hanya istirahat makan yang dihitung terhadap jatah 60 menit."
								>
									Istirahat hari ini: {record?.istirahat_jumlah_jeda ?? 0} jeda
									{#if (record?.istirahat_overrun_menit ?? 0) > 0}
										<span class="font-bold text-amber-600 dark:text-amber-400">· +{record?.istirahat_overrun_menit} menit lewat</span>
									{/if}
								</span>
							</div>
							{#if (istirahat?.jedaHariIni?.length ?? 0) > 0}
								<button class="text-[11px] font-bold text-sky-600 dark:text-sky-400 shrink-0" onclick={() => (showIstirahatDetail = !showIstirahatDetail)}>
									{showIstirahatDetail ? 'Sembunyikan' : 'Lihat detail'}
								</button>
							{/if}
						</div>
						{#if showIstirahatDetail}
							<div class="relative z-10 mb-4 space-y-1.5">
								{#each istirahat?.jedaHariIni ?? [] as jeda (jeda.id)}
									<div class="flex items-center justify-between p-2.5 rounded-xl border text-[11px]" style="background: var(--sys-fill); border-color: var(--sys-sep)">
										<div>
											<span class="font-bold" style="color: var(--sys-label)">{jeda.kategoriNama ?? 'Istirahat'}</span>
											<span style="color: var(--sys-label3)"> · {jeda.jam_keluar ?? '--:--'} - {jeda.jam_masuk ?? 'berjalan'}</span>
											{#if jeda.durasi_menit != null}<span style="color: var(--sys-label3)"> · {jeda.durasi_menit} menit</span>{/if}
										</div>
										{#if (jeda.tier ?? 0) > 0}
											<span class="px-1.5 py-0.5 rounded-md font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">+{jeda.overrun_menit}m</span>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					{/if}

					<!-- Primary CTA Button (mesin-status: BelumMasuk -> Bekerja -> Istirahat <-> Bekerja -> Selesai) -->
					<div class="relative z-10">
						{#if sudahMasuk && sudahPulang}
							<div class="rounded-2xl p-3.5 flex items-center justify-center gap-3 border bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-200">
								<IconCircleCheck size={22} class="text-emerald-500 shrink-0" />
								<div class="text-left">
									<p class="text-xs font-bold">Presensi Selesai</p>
									<p class="text-[11px] opacity-80">Terima kasih atas dedikasi kerja Anda hari ini.</p>
								</div>
							</div>
						{:else if sudahMasuk && sedangIstirahat}
							<button
								class="w-full h-13 sm:h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 shadow-lg transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
								style="background: linear-gradient(135deg, #9333ea 0%, #7e22ce 100%); box-shadow: 0 4px 15px rgba(147, 51, 234, 0.35);"
								onclick={() => goto('/ess/absen?mode=break-in')}
							>
								<IconClock size={20} />
								<span>Absen Setelah Istirahat</span>
							</button>
							<p class="text-[10.5px] text-center mt-2" style="color: var(--sys-label4)">Absen pulang diblokir sampai Anda absen kembali dari istirahat.</p>
						{:else if sudahMasuk}
							<button
								class="w-full h-13 sm:h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 shadow-lg transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
								style="background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%); box-shadow: 0 4px 15px rgba(234, 88, 12, 0.35);"
								onclick={() => goto('/ess/absen?mode=out')}
							>
								<IconClock size={20} />
								<span>Absen Pulang Sekarang</span>
							</button>
							{#if istirahatAktif}
								<button
									class="w-full h-10 rounded-xl text-xs font-bold mt-2 flex items-center justify-center gap-1.5 border transition-colors"
									style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
									onclick={() => goto('/ess/absen?mode=break-out')}
								>
									<IconHourglass size={14} class="text-purple-500" />
									<span>Mulai Istirahat</span>
								</button>
							{/if}
						{:else}
							<button
								class="w-full h-13 sm:h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 shadow-lg transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
								style="background: linear-gradient(135deg, var(--sys-tint) 0%, #0284c7 100%); box-shadow: 0 4px 15px rgba(2, 132, 199, 0.35);"
								onclick={() => goto('/ess/absen?mode=in')}
							>
								<IconClock size={20} />
								<span>Absen Masuk Sekarang</span>
							</button>
						{/if}

						<!-- Quick Field / Site Visit & Sales Visit Section -->
						{#if canSiteCheckin || canSalesVisit}
							<div class="mt-3.5 pt-3 border-t space-y-2" style="border-color: var(--sys-sep)">
								<div class="flex items-center justify-between px-0.5">
									<span class="text-[10.5px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Kunjungan Lapangan</span>
									{#if activeSiteCheckin}
										<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
											<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
											<span>Sedang di Proyek</span>
										</span>
									{/if}
								</div>

								{#if activeSiteCheckin}
									<div class="p-2.5 sm:p-3 rounded-2xl border bg-emerald-500/10 border-emerald-500/25 flex items-center justify-between gap-2.5">
										<div class="min-w-0 flex-1">
											<p class="text-xs font-bold truncate text-emerald-800 dark:text-emerald-300">
												{activeSiteCheckin.nama_lokasi || 'Kunjungan Proyek'}
											</p>
											<p class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
												Check-in sejak {activeSiteCheckin.check_in_at ? new Date(activeSiteCheckin.check_in_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '--:--'} WIB
											</p>
										</div>
										<button
											type="button"
											class="px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-white shrink-0 shadow-xs transition-all hover:scale-[1.02] active:scale-[0.98]"
											style="background: #059669;"
											onclick={() => goto('/site-checkin')}
										>
											Check-out →
										</button>
									</div>
								{/if}

								<div class="grid {canSiteCheckin && canSalesVisit ? 'grid-cols-2' : 'grid-cols-1'} gap-2">
									{#if canSiteCheckin}
										<button
											type="button"
											class="w-full px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border shadow-2xs hover:opacity-95 active:scale-[0.98]"
											style="background: rgba(2, 132, 199, 0.12); color: #0284c7; border-color: rgba(2, 132, 199, 0.25);"
											onclick={() => goto('/site-checkin')}
										>
											<IconBuildingFactory2 size={15} />
											<span class="truncate">{activeSiteCheckin ? 'Site Check-in' : 'Site Check-in Proyek'}</span>
										</button>
									{/if}
									{#if canSalesVisit}
										<button
											type="button"
											class="w-full px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border shadow-2xs hover:opacity-95 active:scale-[0.98]"
											style="background: rgba(217, 119, 6, 0.12); color: #d97706; border-color: rgba(217, 119, 6, 0.25);"
											onclick={() => goto('/sales')}
										>
											<IconMapPin size={15} />
											<span class="truncate">Kunjungan Sales</span>
										</button>
									{/if}
								</div>
							</div>
						{/if}

						<!-- Bottom Mini Shortcuts -->
						<div class="flex items-center justify-between mt-3 px-1 text-[11px] font-semibold" style="color: var(--sys-label3)">
							<button class="hover:underline flex items-center gap-1" onclick={() => goto('/ess/disiplin')}>
								<IconGauge size={13} />
								<span>Rekap Kehadiran</span>
							</button>
							<button class="hover:underline flex items-center gap-1 text-sky-600 dark:text-sky-400" onclick={() => goto('/ess/izin-sakit')}>
								<IconMedicalCross size={13} />
								<span>Ajukan Izin / Sakit →</span>
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- 2.2 Ringkasan Metrik Personal (Quick Stats) -->
			<div class="rounded-3xl p-5 border shadow-sm"
				style="background: var(--sys-bg2); border-color: var(--sys-sep);">
				
				<div class="flex items-center justify-between mb-3.5">
					<div class="flex items-center gap-2">
						<IconTrendingUp size={16} class="text-blue-500" />
						<h3 class="text-xs font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Ringkasan Saya</h3>
					</div>
					<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background: var(--sys-fill); color: var(--sys-label4)">
						Bulan Ini
					</span>
				</div>

				<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
					<!-- Sisa Cuti -->
					<a href="/ess/cuti" class="p-3 rounded-2xl border text-center transition-all hover:border-blue-400/50 hover-lift no-underline"
						style="background: var(--sys-fill); border-color: var(--sys-sep)">
						<p class="text-lg font-black" style="color: var(--sys-label)">{sisaCuti != null ? sisaCuti : '-'}</p>
						<p class="text-[10px] font-bold mt-0.5" style="color: var(--sys-label3)">Sisa Cuti</p>
					</a>

					<!-- Jam Lembur -->
					<a href="/ess/lembur" class="p-3 rounded-2xl border text-center transition-all hover:border-amber-400/50 hover-lift no-underline"
						style="background: var(--sys-fill); border-color: var(--sys-sep)">
						<p class="text-lg font-black text-amber-600 dark:text-amber-400">
							{lemburBulanIniJam != null ? lemburBulanIniJam.toFixed(1) : '-'}
						</p>
						<p class="text-[10px] font-bold mt-0.5" style="color: var(--sys-label3)">Jam Lembur</p>
					</a>

					<!-- Dokumen TTD -->
					<a href="/ess/dokumen-saya" class="p-3 rounded-2xl border text-center transition-all hover:border-indigo-400/50 hover-lift no-underline"
						style="background: var(--sys-fill); border-color: var(--sys-sep)">
						<p class="text-lg font-black {pendingSignatures > 0 ? 'text-rose-500 font-black animate-pulse' : ''}" style="color: {pendingSignatures > 0 ? '#e11d48' : 'var(--sys-label)'}">
							{pendingSignatures}
						</p>
						<p class="text-[10px] font-bold mt-0.5" style="color: var(--sys-label3)">Perlu TTD</p>
					</a>

					<!-- Pengumuman -->
					<a href="/ess/pengumuman" class="p-3 rounded-2xl border text-center transition-all hover:border-purple-400/50 hover-lift no-underline"
						style="background: var(--sys-fill); border-color: var(--sys-sep)">
						<p class="text-lg font-black {unreadPengumuman > 0 ? 'text-purple-500' : ''}" style="color: {unreadPengumuman > 0 ? '#9333ea' : 'var(--sys-label)'}">
							{unreadPengumuman}
						</p>
						<p class="text-[10px] font-bold mt-0.5" style="color: var(--sys-label3)">Warta HRD</p>
					</a>
				</div>
			</div>

			<!-- 2.3 Agenda 7 Hari & Quick Scratchpad -->
			<div class="rounded-3xl p-5 border shadow-sm space-y-4"
				style="background: var(--sys-bg2); border-color: var(--sys-sep);">
				
				<!-- Agenda Terdekat -->
				<div>
					<div class="flex items-center justify-between mb-2.5">
						<div class="flex items-center gap-1.5">
							<IconCalendarTime size={15} class="text-emerald-500" />
							<h3 class="text-xs font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Agenda 7 Hari Ke Depan</h3>
						</div>
						<a href="/ess/kalender" class="text-[11px] font-bold text-sky-600 dark:text-sky-400 hover:underline">
							Kalender →
						</a>
					</div>

					{#if upcomingEvents.length > 0}
						<div class="space-y-1.5">
							{#each upcomingEvents as ev (ev.id)}
								<a href="/ess/kalender"
									class="flex items-center justify-between p-2 rounded-xl border text-xs transition-all hover:border-blue-300/40 no-underline"
									style="background: var(--sys-fill); border-color: var(--sys-sep)">
									<div class="flex items-center gap-2 min-w-0 pr-2">
										<span class="w-2 h-2 rounded-full shrink-0" style="background: {ev.color || '#3b82f6'}"></span>
										<span class="truncate font-semibold" style="color: var(--sys-label)">{ev.title}</span>
									</div>
									<span class="text-[10px] font-bold shrink-0 px-2 py-0.5 rounded-md"
										style="background: var(--sys-fill2); color: var(--sys-label3)">
										{formatShortDate(ev.start)}
									</span>
								</a>
							{/each}
						</div>
					{:else}
						<div class="p-3 rounded-2xl border text-center text-xs font-medium"
							style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label4)">
							Tidak ada jadwal khusus dalam 7 hari ke depan.
						</div>
					{/if}
				</div>

				<!-- Scratchpad / Quick Notes -->
				<div class="pt-2 border-t" style="border-color: var(--sys-sep)">
					<div class="flex items-center justify-between mb-2">
						<div class="flex items-center gap-1.5">
							<IconNotes size={15} class="text-amber-500" />
							<h3 class="text-xs font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Catatan Cepat</h3>
						</div>
						<a href="/ess/notes" class="text-[11px] font-bold text-sky-600 dark:text-sky-400 hover:underline">
							Semua Catatan →
						</a>
					</div>

					{#if pinnedNotes.length > 0}
						<div class="space-y-1 mb-2.5">
							{#each pinnedNotes as note (note.id)}
								<a href="/ess/notes"
									class="flex items-start gap-2 p-1.5 rounded-lg text-xs hover:bg-slate-500/5 transition-colors no-underline"
									style="color: var(--sys-label2)">
									<IconPin size={13} class="shrink-0 mt-0.5 text-amber-500" />
									<span class="truncate">{note.title || note.content}</span>
								</a>
							{/each}
						</div>
					{/if}

					<!-- Quick Log Input -->
					<div class="flex items-center gap-1.5">
						<input
							type="text"
							placeholder="Tulis catatan cepat (Enter untuk simpan)..."
							bind:value={quickLogText}
							onkeydown={(e) => e.key === 'Enter' && submitQuickLog()}
							class="flex-1 rounded-xl px-3 py-2 text-xs border outline-none transition-colors"
							style="background: var(--sys-fill); border-color: var(--sys-sep2); color: var(--sys-label);"
						/>
						<button
							class="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0 transition-opacity disabled:opacity-40 cursor-pointer"
							style="background: var(--sys-tint)"
							disabled={!quickLogText.trim() || quickLogSubmitting}
							onclick={submitQuickLog}
							title="Simpan Catatan"
							aria-label="Simpan Catatan"
						>
							{#if quickLogSubmitting}
								<IconLoader2 size={14} class="animate-spin" />
							{:else if quickLogSuccess}
								<IconCheck size={14} />
							{:else}
								<IconSend size={14} />
							{/if}
						</button>
					</div>
				</div>

			</div>

		</div>

		<!-- ──────────────────────────────────────────────────────────────────────
		     RIGHT COLUMN: Categorized Services with Instant Search & Filter Tabs
		     ────────────────────────────────────────────────────────────────────── -->
		<div class="lg:col-span-7 flex flex-col gap-6">

			<!-- 2.4 Search Bar & Category Filter Tabs -->
			<div class="rounded-3xl p-4 sm:p-5 border shadow-sm space-y-3"
				style="background: var(--sys-bg2); border-color: var(--sys-sep);">
				
				<!-- Search Input -->
				<div class="relative">
					<IconSearch size={18} class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
					<input
						type="text"
						placeholder="Cari layanan (cth: cuti, slip gaji, kasbon, surat jalan)..."
						bind:value={searchQuery}
						class="w-full pl-10 pr-10 py-2.5 rounded-2xl text-xs sm:text-sm border outline-none transition-all shadow-inner"
						style="background: var(--sys-fill); border-color: var(--sys-sep2); color: var(--sys-label);"
					/>
					{#if searchQuery}
						<button
							class="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
							onclick={() => (searchQuery = '')}
							aria-label="Hapus Pencarian"
						>
							<IconX size={16} />
						</button>
					{/if}
				</div>

				<!-- Category Filter Chips -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
					<button
						class="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer border {activeCategoryTab === 'all' ? 'shadow-sm' : ''}"
						style={activeCategoryTab === 'all'
							? 'background: var(--sys-tint); color: #ffffff; border-color: var(--sys-tint);'
							: 'background: var(--sys-fill); color: var(--sys-label3); border-color: var(--sys-sep);'}
						onclick={() => (activeCategoryTab = 'all')}
					>
						Semua Layanan
					</button>

					{#each categories as cat}
						<button
							class="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer border {activeCategoryTab === cat.id ? 'shadow-sm' : ''}"
							style={activeCategoryTab === cat.id
								? `background: ${cat.accentColor}; color: #ffffff; border-color: ${cat.accentColor};`
								: 'background: var(--sys-fill); color: var(--sys-label3); border-color: var(--sys-sep);'}
							onclick={() => (activeCategoryTab = cat.id)}
						>
							{cat.title}
						</button>
					{/each}
				</div>
			</div>

			<!-- 2.5 Grouped Service Cards Grid -->
			{#if totalFilteredCount === 0}
				<div class="rounded-3xl p-10 border text-center my-4"
					style="background: var(--sys-bg2); border-color: var(--sys-sep);">
					<div class="w-14 h-14 rounded-2xl bg-slate-500/10 flex items-center justify-center mx-auto mb-3 text-slate-400">
						<IconSearch size={28} />
					</div>
					<p class="text-sm font-bold" style="color: var(--sys-label)">Tidak ada layanan yang sesuai</p>
					<p class="text-xs mt-1 max-w-sm mx-auto" style="color: var(--sys-label3)">
						Kata kunci "<span class="font-bold">{searchQuery}</span>" tidak ditemukan pada kategori terpilih.
					</p>
					<button
						class="mt-4 px-4 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer"
						style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
						onclick={() => { searchQuery = ''; activeCategoryTab = 'all'; }}
					>
						Reset Pencarian
					</button>
				</div>
			{:else}
				<div class="space-y-6">
					{#each filteredCategories as category (category.id)}
						<div class="space-y-3">
							<!-- Category Header -->
							<div class="flex items-center justify-between px-1">
								<div class="flex items-center gap-2">
									<span class="w-2.5 h-2.5 rounded-full" style="background: {category.accentColor}"></span>
									<h3 class="text-xs font-extrabold uppercase tracking-wider" style="color: var(--sys-label)">
										{category.title}
									</h3>
								</div>
								<span class="text-[11px] font-bold px-2 py-0.5 rounded-md"
									style="background: var(--sys-fill); color: var(--sys-label4)">
									{category.visibleItems.length} menu
								</span>
							</div>

							<!-- Category Items Grid -->
							<div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
								{#each category.visibleItems as item (item.id)}
									{@const badgeVal = getBadgeValue(item.badge)}
									<a
										href={item.route}
										data-sveltekit-preload-data="hover"
										class="rounded-2xl p-3 sm:p-4.5 flex flex-col items-center justify-center text-center relative group border transition-all duration-200 hover-lift hover:shadow-md cursor-pointer no-underline"
										style="background: var(--sys-bg2); border-color: var(--sys-sep);"
									>
										<!-- Icon Container with Thematic Tint -->
										<div
											class="w-11 h-11 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center mb-2.5 sm:mb-3 transition-transform duration-200 group-hover:scale-110 shadow-xs"
											style="background: {category.accentBg}; color: {category.accentColor};"
										>
											<item.icon size={22} stroke={1.8} />
										</div>

										<!-- Label & Subtitle -->
										<span class="text-xs sm:text-sm font-bold tracking-tight line-clamp-1 group-hover:text-blue-500 transition-colors"
											style="color: var(--sys-label)">
											{item.label}
										</span>

										{#if item.desc}
											<span class="text-[10.5px] font-medium mt-1 line-clamp-1 opacity-80"
												style="color: var(--sys-label3)">
												{item.desc}
											</span>
										{/if}

										<!-- Badge Notification -->
										{#if badgeVal !== null}
											<div class="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full text-[10px] font-black text-white shadow-md border-2 border-white dark:border-slate-900 {item.badgeType === 'alert' ? 'bg-rose-500 animate-bounce' : 'bg-blue-600'}">
												{badgeVal}
											</div>
										{/if}
									</a>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}

		</div>

	</div>

</div>

<style>
	/* Custom scrollbar hiding helper */
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>

