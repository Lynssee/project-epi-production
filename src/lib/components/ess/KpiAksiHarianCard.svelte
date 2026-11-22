<!-- C:/dev/project-epi/src/lib/components/ess/KpiAksiHarianCard.svelte
     Pusat Aksi Harian KPI Lapangan ("Pencetak Skor Hari Ini" - Fase 5).
     Memberikan instruksi langsung dan link 1-klik ke tugas-tugas lapangan yang berdampak
     langsung terhadap penilaian KPI individu dan divisi agar tetap berstatus On-Target (Hijau). -->
<script lang="ts">
	import {
		IconTargetArrow,
		IconCalendarCheck,
		IconTool,
		IconShieldCheck,
		IconSparkles,
		IconArrowRight,
		IconClock,
		IconInfoCircle
	} from '@tabler/icons-svelte';

	let { userRole = 'Field Team', activeProjectsCount = 1 } = $props();

	// Jam saat ini untuk menghitung sisa waktu batas harian
	const now = new Date();
	const curHour = now.getHours();
	const curMinute = now.getMinutes();

	// Batas Laporan Harian: 20:00 WIB
	const p2hLewat = curHour > 8 || (curHour === 8 && curMinute > 30);
	const laporanLewat = curHour >= 20;

	let simulatorOpen = $state(false);
</script>

<div class="mb-8 glass-panel rounded-2xl p-5 border border-indigo-100 dark:border-indigo-900/40 shadow-xs" data-testid="kpi-aksi-harian">
	<!-- Header -->
	<div class="flex items-start justify-between gap-3 mb-4">
		<div>
			<div class="flex items-center gap-2">
				<div class="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
					<IconTargetArrow size={20} />
				</div>
				<div>
					<h2 class="text-base md:text-lg font-bold flex items-center gap-1.5" style="color: var(--sys-label)">
						<span>Aksi Hari Ini untuk Skor KPI Hijau</span>
						<span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">Pencetak Skor</span>
					</h2>
					<p class="text-xs" style="color: var(--sys-label3)">
						Selesaikan 3 aksi operasional ini tepat waktu agar rapor kinerja Anda bulan ini tetap <strong>On-Target (&ge;85%)</strong>.
					</p>
				</div>
			</div>
		</div>
		<button
			type="button"
			class="text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1 shrink-0 transition-colors shadow-2xs"
			onclick={() => (simulatorOpen = !simulatorOpen)}
		>
			<IconSparkles size={14} class="text-amber-500" />
			<span>{simulatorOpen ? 'Tutup Panduan' : 'Tips Dampak Skor'}</span>
		</button>
	</div>

	<!-- Tips Dampak / Simulator Mini (Expandable) -->
	{#if simulatorOpen}
		<div class="mb-4 rounded-xl p-3.5 bg-gradient-to-r from-amber-50/80 to-indigo-50/80 dark:from-amber-950/30 dark:to-indigo-950/30 border border-amber-200 dark:border-amber-800/40 text-xs text-slate-700 dark:text-slate-300 space-y-1.5">
			<div class="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
				<IconInfoCircle size={15} />
				<span>Kunci Mempertahankan Skor Rapor Maksimal:</span>
			</div>
			<ul class="list-disc list-inside space-y-1 pl-1 text-[11px] leading-relaxed">
				<li><strong>Zero Accident HSE:</strong> Mempertahankan nihil insiden kecelakaan otomatis menghasilkan skor 100% penuh pada pilar K3.</li>
				<li><strong>Disiplin Laporan Harian:</strong> Submit laporan sebelum 20:00 WIB menjamin skor kepatuhan proyek 100%. Terlambat memotong bobot kepatuhan.</li>
				<li><strong>Checklist P2H Awal Shift:</strong> Menutup inspeksi equipment sebelum 08:30 WIB menjaga rekap perawatan alat tetap hijau dan mencegah downtime mesin.</li>
			</ul>
		</div>
	{/if}

	<!-- 3 Kartu Aksi Lapangan -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
		<!-- Aksi 1: Laporan Harian Proyek -->
		<div class="rounded-xl p-3.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex flex-col justify-between hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors shadow-2xs">
			<div>
				<div class="flex items-center justify-between gap-2 mb-2">
					<div class="flex items-center gap-1.5">
						<IconCalendarCheck size={16} class="text-indigo-600 dark:text-indigo-400" />
						<span class="text-xs font-bold text-slate-800 dark:text-slate-200">Laporan Proyek</span>
					</div>
					<span class="text-[10px] font-semibold px-2 py-0.5 rounded-md {laporanLewat ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'}">
						{laporanLewat ? 'Lewat Batas 20:00' : 'Maks 20:00 WIB'}
					</span>
				</div>
				<p class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mb-3">
					Laporkan progres fisik, cuaca, man-hours, dan material hari ini untuk proyek aktif Anda.
				</p>
			</div>
			<a
				href="/laporan"
				class="w-full py-1.5 px-3 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-1.5 transition-colors shadow-xs"
			>
				<span>Isi Laporan Harian</span>
				<IconArrowRight size={13} />
			</a>
		</div>

		<!-- Aksi 2: Checklist P2H Equipment -->
		<div class="rounded-xl p-3.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex flex-col justify-between hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors shadow-2xs">
			<div>
				<div class="flex items-center justify-between gap-2 mb-2">
					<div class="flex items-center gap-1.5">
						<IconTool size={16} class="text-emerald-600 dark:text-emerald-400" />
						<span class="text-xs font-bold text-slate-800 dark:text-slate-200">Inspeksi P2H Alat</span>
					</div>
					<span class="text-[10px] font-semibold px-2 py-0.5 rounded-md {p2hLewat ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}">
						{p2hLewat ? 'Shift Pagi Lewat' : 'Maks 08:30 WIB'}
					</span>
				</div>
				<p class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mb-3">
					Periksa kelayakan oli, hidrolik, dan rem genset/mesin sebelum jam operasional dimulai.
				</p>
			</div>
			<a
				href="/preventive/p2h"
				class="w-full py-1.5 px-3 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-1.5 transition-colors shadow-xs"
			>
				<span>Buka Checklist P2H</span>
				<IconArrowRight size={13} />
			</a>
		</div>

		<!-- Aksi 3: Safety & APD Zero Accident -->
		<div class="rounded-xl p-3.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex flex-col justify-between hover:border-teal-400 dark:hover:border-teal-600 transition-colors shadow-2xs">
			<div>
				<div class="flex items-center justify-between gap-2 mb-2">
					<div class="flex items-center gap-1.5">
						<IconShieldCheck size={16} class="text-teal-600 dark:text-teal-400" />
						<span class="text-xs font-bold text-slate-800 dark:text-slate-200">K3 & APD Lapangan</span>
					</div>
					<span class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
						Zero Accident
					</span>
				</div>
				<p class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mb-3">
					Pastikan rompi, helm, dan sepatu safety tim aktif dipakai. Laporkan segera potensi bahaya di lokasi.
				</p>
			</div>
			<a
				href="/hse"
				class="w-full py-1.5 px-3 rounded-lg text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white flex items-center justify-center gap-1.5 transition-colors shadow-xs"
			>
				<span>Lapor Temuan K3</span>
				<IconArrowRight size={13} />
			</a>
		</div>
	</div>
</div>
