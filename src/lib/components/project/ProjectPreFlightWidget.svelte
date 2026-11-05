<!-- src/lib/components/project/ProjectPreFlightWidget.svelte -->
<!-- Widget Kesiapan Kerja & Prasyarat Lapangan (Pre-Flight Readiness Check) -->
<!-- Memandu Project Leader & Teknisi memastikan K3, Site Check-in, Material, dan SOP sebelum eksekusi -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		IconShieldCheck, IconMapPin, IconPackage, IconBook,
		IconChevronRight, IconCheck, IconAlertTriangle, IconInfoCircle,
		IconExternalLink, IconSparkles
	} from '@tabler/icons-svelte';

	interface Props {
		/** Jumlah proyek aktif yang sedang ditangani */
		activeProjectsCount?: number;
		/** Mode penegakan gate saat ini: 'warn' | 'shadow' | 'soft' | 'hard' */
		enforcementMode?: 'warn' | 'shadow' | 'soft' | 'hard';
		/** Apakah disajikan dalam mode ringkas (compact banner) */
		compact?: boolean;
	}

	let {
		activeProjectsCount = 0,
		enforcementMode = 'warn',
		compact = false
	}: Props = $props();

	let expanded = $state(!compact);

	const CHECK_ITEMS = [
		{
			id: 'safety',
			icon: '🦺',
			label: 'Toolbox Meeting & JSA',
			hint: 'Briefing K3, cek potensi bahaya, dan kelengkapan APD teknisi',
			href: '/toolbox',
			btnLabel: 'Buka Toolbox'
		},
		{
			id: 'checkin',
			icon: '📍',
			label: 'Presensi & Site Check-in',
			hint: 'Presensi GPS lokasi proyek dan cek izin kerja (PTW) klien',
			href: '/site-checkin',
			btnLabel: 'Check-in Site'
		},
		{
			id: 'material',
			icon: '📦',
			label: 'Penerimaan Material & Cat',
			hint: 'Cocokkan fisik barang tiba dengan Packing List & unggah foto SJ',
			href: '/stock-lapangan',
			btnLabel: 'Stok Site'
		},
		{
			id: 'sop',
			icon: '📖',
			label: 'SOP & Titik Kendali (Gate)',
			hint: 'Pelajari 9 langkah alur pelaksanaan proyek & bukti kerja ISO',
			href: '/panduan/alur?alur=project_field_execution',
			btnLabel: 'Lihat SOP'
		}
	];
</script>

<div class="mb-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden transition-all">
	<!-- HEADER WIDGET -->
	<div class="p-3.5 sm:p-4 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white flex items-center justify-between gap-3">
		<div class="flex items-center gap-2.5">
			<span class="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-md flex items-center justify-center text-lg shrink-0 shadow-xs">
				🚦
			</span>
			<div>
				<div class="flex items-center gap-2">
					<h3 class="text-[13px] sm:text-[14px] font-extrabold tracking-tight text-white flex items-center gap-1.5">
						Status Kesiapan Kerja & Prasyarat
					</h3>
					<span class="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-amber-400 text-amber-950 uppercase tracking-wide">
						Mode: {enforcementMode.toUpperCase()}
					</span>
				</div>
				<p class="text-[11px] text-blue-100/80 leading-snug mt-0.5">
					Verifikasi prasyarat operasional harian sebelum pengerjaan blasting & coating site
				</p>
			</div>
		</div>

		<button
			type="button"
			class="text-xs text-blue-200 hover:text-white font-semibold underline px-2 py-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
			onclick={() => (expanded = !expanded)}
		>
			{expanded ? 'Ringkas ▲' : 'Buka Syarat ▼'}
		</button>
	</div>

	<!-- KONTEN RINCIAN CHECKLIST PRASYARAT -->
	{#if expanded}
		<div class="p-3.5 sm:p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
			<!-- Banner Edukatif Mode Peringatan -->
			<div class="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
				<IconInfoCircle size={18} class="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
				<div class="leading-relaxed">
					<strong class="font-bold">Panduan Titik Kendali:</strong> 
					Semua gate proyek aktif dalam <em>Mode Peringatan (Warn)</em>. Bila ada syarat lapangan yang tertunda (misal izin fisik klien sedang proses), Anda tetap dapat menyimpan laporan dengan mencantumkan keterangan kendala.
				</div>
			</div>

			<!-- GRID 4 PILAR KESIAPAN -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
				{#each CHECK_ITEMS as item}
					<div class="p-3 bg-white dark:bg-slate-800/90 rounded-xl border border-slate-200 dark:border-slate-700/70 shadow-2xs hover:border-blue-400 transition-all flex flex-col justify-between">
						<div>
							<div class="flex items-center justify-between gap-2 mb-1">
								<span class="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
									<span>{item.icon}</span>
									<span>{item.label}</span>
								</span>
								<span class="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.2 rounded border border-emerald-200 dark:border-emerald-800">
									Wajib Sedia
								</span>
							</div>
							<p class="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug">
								{item.hint}
							</p>
						</div>

						<div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
							<span class="text-[9.5px] font-mono text-slate-400 uppercase">
								Tahap Pra-Eksekusi
							</span>
							<a
								href={item.href}
								class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
							>
								<span>{item.btnLabel}</span>
								<IconChevronRight size={13} />
							</a>
						</div>
					</div>
				{/each}
			</div>

			<!-- FOOTER LINK KE STANDAR OPERASIONAL PROSEDUR -->
			<div class="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
				<span class="text-[11px] text-slate-500 dark:text-slate-400">
					PT Eltama Prima Indo · Standar Manajemen Mutu Terintegrasi ISO 9001
				</span>
				<a
					href="/panduan/alur?alur=project_field_execution"
					class="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-400 hover:underline"
				>
					<span>Buka Peta 9 Langkah Proyek Lapangan</span>
					<IconExternalLink size={13} />
				</a>
			</div>
		</div>
	{/if}
</div>
