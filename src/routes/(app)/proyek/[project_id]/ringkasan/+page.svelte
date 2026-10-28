<!-- src/routes/(app)/proyek/[project_id]/ringkasan/+page.svelte -->
<!-- Project Monthly Health Digest (Penajaman Laporan Bulanan v2 §5.1, Fase E) — 1 halaman -->
<!-- ringkas untuk Project Leader/Mandor: anggaran vs RAP, kepatuhan absensi regu, kesiapan -->
<!-- alat pinjaman (P2H 7 hari terakhir), sisa material kritis. Reuse penuh service yang -->
<!-- sudah ada (projectSummary, projectStockBalanceApi, preventive) — lihat projectFieldDigest.ts. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getProjectById } from '$lib/services/projects';
	import { getProjectHealthDigest, type ProjectHealthDigest } from '$lib/services/projectFieldDigest';
	import { fetchFieldBudgetPct, type FieldBudgetPct } from '$lib/services/projectFinancePct';
	import { openPlaceholderWindow } from '$lib/utils/openWindowAsync';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { calculateProjectProgressPercentage } from '$lib/utils/projectProgress';
	import { IconArrowLeft, IconLoader2, IconWallet, IconUserCheck, IconTool, IconBox, IconAlertTriangle, IconClipboardList, IconClock, IconTrendingUp } from '@tabler/icons-svelte';

	let projectId = $derived(Number($page.params.project_id));
	let loading = $state(true);
	let project = $state<any>(null);
	let digest = $state<ProjectHealthDigest | null>(null);
	// Status pagu dari engine keuangan tunggal (persen saja, sudah memperhitungkan komitmen). null = gagal → pakai angka lokal.
	let pagu = $state<FieldBudgetPct | null>(null);
	let openingPrint = $state(false);

	let actualProgress = $derived(calculateProjectProgressPercentage(project));

	let forecastInfo = $derived.by(() => {
		if (!project?.start_date) return null;
		const start = new Date(project.start_date);
		const end = project.end_date ? new Date(project.end_date) : null;
		const today = new Date();

		const elapsedDays = Math.max(1, Math.round((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
		const totalPlannedDays = end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))) : null;
		const remainingPlannedDays = end ? Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;

		const currentPct = actualProgress;
		const remainingPct = Math.max(0, 100 - currentPct);
		const velocityActual = currentPct / elapsedDays; // % per hari kalender
		const velocityRequired = (remainingPlannedDays && remainingPlannedDays > 0) ? (remainingPct / remainingPlannedDays) : null;

		let forecastDaysNeeded: number | null = null;
		let forecastDate: Date | null = null;
		let slippageDays: number | null = null;

		if (velocityActual > 0.02) {
			forecastDaysNeeded = Math.ceil(remainingPct / velocityActual);
			forecastDate = new Date(today.getTime() + forecastDaysNeeded * 24 * 60 * 60 * 1000);
			if (end) {
				slippageDays = Math.round((forecastDate.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
			}
		}

		return {
			elapsedDays,
			totalPlannedDays,
			remainingPlannedDays,
			currentPct,
			remainingPct,
			velocityActual,
			velocityRequired,
			forecastDaysNeeded,
			forecastDate,
			slippageDays,
			isOverdue: end ? today.getTime() > end.getTime() && currentPct < 100 : false
		};
	});

	let fieldRecommendations = $derived.by(() => {
		const recs: Array<{ category: string; icon: string; title: string; desc: string; type: 'warn' | 'info' | 'success' }> = [];
		if (!forecastInfo) return recs;

		// 1. Jadwal & Kecepatan
		if (forecastInfo.isOverdue) {
			recs.push({
				category: 'Jadwal & Target',
				icon: '🚨',
				title: 'Proyek Melewati Tenggat Kontrak',
				desc: `Target selesai telah terlewat dengan progres fisik ${forecastInfo.currentPct.toFixed(1)}%. Prioritaskan subtask kritis dan koordinasikan dengan project manager untuk eskalasi.`,
				type: 'warn'
			});
		} else if (forecastInfo.slippageDays != null && forecastInfo.slippageDays > 3) {
			recs.push({
				category: 'Jadwal & Kecepatan',
				icon: '⚠️',
				title: `Potensi Deviasi (+${forecastInfo.slippageDays} hari)`,
				desc: `Kecepatan saat ini (${forecastInfo.velocityActual.toFixed(2)}%/hari) perlu akselerasi ke minimal ${forecastInfo.velocityRequired?.toFixed(2) || '—'}%/hari agar selesai sebelum batas ${project.end_date}.`,
				type: 'warn'
			});
		} else {
			recs.push({
				category: 'Jadwal & Kecepatan',
				icon: '🟢',
				title: 'Laju Fisik Terkendali',
				desc: `Kecepatan harian stabil di ${forecastInfo.velocityActual.toFixed(2)}%/hari. Diperkirakan rampung ${forecastInfo.forecastDate ? forecastInfo.forecastDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'sesuai target'}.`,
				type: 'success'
			});
		}

		// 2. Kesiapan Alat P2H
		if (digest?.equipment?.noGoCount && digest.equipment.noGoCount > 0) {
			recs.push({
				category: 'Kesiapan Alat',
				icon: '🛠️',
				title: `${digest.equipment.noGoCount} Unit Alat Berstatus No-Go`,
				desc: 'Laporkan kebutuhan servis/penggantian ke mekanik logistik agar alat kembali fit untuk pekerjaan harian.',
				type: 'warn'
			});
		}

		// 3. Sisa Material Kritis
		if (digest?.material && digest.material.length > 0) {
			recs.push({
				category: 'Logistik Material',
				icon: '📦',
				title: `${digest.material.length} Item Material Menipis`,
				desc: 'Periksa stok di lapangan dan pastikan pengajuan material (SPB) telah diproses untuk menghindari jeda aktivitas kerja.',
				type: 'info'
			});
		}

		// 4. Kasbon & Komitmen
		if (pagu?.commitment_pct && pagu.commitment_pct > 0) {
			recs.push({
				category: 'Pertanggungjawaban (LPJ)',
				icon: '🧾',
				title: 'Tuntaskan LPJ Kasbon Lapangan',
				desc: `Komitmen kasbon aktif tercatat ${pagu.commitment_pct.toFixed(1)}%. Kumpulkan nota fisik dan submit LPJ untuk memudahkan audit termin.`,
				type: 'warn'
			});
		}

		return recs;
	});

	const PAGU_STYLE: Record<string, { text: string; bar: string; label: string }> = {
		safe: { text: 'text-emerald-600', bar: 'bg-emerald-500', label: '🟢 Aman' },
		warn: { text: 'text-amber-600', bar: 'bg-amber-500', label: '🟡 Waspada — mendekati batas' },
		danger: { text: 'text-red-600', bar: 'bg-red-500', label: '🔴 Melebihi pagu' }
	};
	let period = $state(new Date().toISOString().slice(0, 7));

	const STATUS_STYLE: Record<string, { badge: string; label: string }> = {
		sehat: { badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: '🟢 Sehat' },
		perhatian: { badge: 'bg-amber-100 text-amber-700 border-amber-200', label: '🟡 Perlu Perhatian' },
		kritis: { badge: 'bg-red-100 text-red-700 border-red-200', label: '🔴 Kritis' },
		unknown: { badge: 'bg-gray-100 text-gray-600 border-gray-200', label: '⚪ Belum Ada Data' }
	};

	async function load() {
		loading = true;
		try {
			const [proj, d, p] = await Promise.all([getProjectById(projectId), getProjectHealthDigest(projectId, period), fetchFieldBudgetPct(projectId)]);
			project = proj;
			digest = d;
			pagu = p;
		} finally {
			loading = false;
		}
	}

	async function handleOpenPrint(stakeholder: 'operasional' | 'customer', depth: 'summary' | 'detailed' = 'summary', report: string = '') {
		const w = openPlaceholderWindow();
		openingPrint = true;
		try {
			const token = await getIdToken();
			let url = `/api/project/${projectId}/print-url?stakeholder=${stakeholder}&depth=${depth}&customerMoney=technical`;
			if (report) url += `&report=${encodeURIComponent(report)}`;
			const res = await fetch(url, {
				headers: { Authorization: `Bearer ${token}` }
			});
			const body = await res.json();
			if (body?.available && body?.url) {
				w.navigate(body.url);
			} else {
				w.cancel();
				alert(body?.reason || 'Gagal memuat URL cetak dokumen.');
			}
		} catch (e: any) {
			w.cancel();
			alert('Gagal membuka URL cetak laporan: ' + (e?.message || e));
		} finally {
			openingPrint = false;
		}
	}

	onMount(load);
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat ringkasan proyek..." />
	</div>
	{:else if digest}
		<div class="flex items-start justify-between gap-2 mb-1">
			<div>
				<h1 class="text-lg font-bold text-gray-900">Ringkasan Bulanan</h1>
				<p class="text-sm text-gray-500">{project?.name || '-'}</p>
			</div>
			<input type="month" bind:value={period} onchange={load} class="border rounded px-2 py-1 text-xs" />
		</div>

		<div class="my-3 rounded-lg border px-3 py-2 text-sm font-semibold {STATUS_STYLE[digest.overallStatus].badge}">
			{STATUS_STYLE[digest.overallStatus].label} — periode {period}
		</div>

		<!-- Forecast Laju Fisik & Estimasi Selesai (Field-friendly) -->
		{#if forecastInfo}
			<div class="rounded-xl border border-gray-200 bg-white p-4 mb-3">
				<div class="flex items-center justify-between mb-2">
					<div class="flex items-center gap-2">
						<IconTrendingUp size={18} class="text-blue-600" />
						<h2 class="text-sm font-bold text-gray-800">Forecast & Estimasi Selesai</h2>
					</div>
					{#if forecastInfo.isOverdue}
						<span class="text-[10px] px-2 py-0.5 rounded font-bold bg-red-100 text-red-700">🔴 Overdue</span>
					{:else if forecastInfo.slippageDays != null && forecastInfo.slippageDays > 3}
						<span class="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-700">🟡 Deviasi +{forecastInfo.slippageDays} Hari</span>
					{:else}
						<span class="text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-700">🟢 On Track</span>
					{/if}
				</div>

				<div class="grid grid-cols-2 gap-2 my-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs">
					<div>
						<div class="text-[10px] text-gray-400">Progres Fisik Aktual</div>
						<div class="text-base font-bold text-gray-900">{actualProgress.toFixed(1)}%</div>
						<div class="text-[10px] text-gray-500">Sisa: {forecastInfo.remainingPct.toFixed(1)}%</div>
					</div>
					<div>
						<div class="text-[10px] text-gray-400">Laju Kecepatan Harian</div>
						<div class="text-base font-bold {forecastInfo.velocityRequired && forecastInfo.velocityActual < forecastInfo.velocityRequired ? 'text-amber-600' : 'text-emerald-600'}">
							{forecastInfo.velocityActual.toFixed(2)}%<span class="text-[10px] font-normal text-gray-400">/hari</span>
						</div>
						<div class="text-[10px] text-gray-500">
							Target butuh: {forecastInfo.velocityRequired ? `${forecastInfo.velocityRequired.toFixed(2)}%/hari` : '—'}
						</div>
					</div>
				</div>

				<div class="text-[11px] text-gray-600 space-y-1 mt-2">
					<div class="flex justify-between items-center">
						<span class="text-gray-400">Batas Kontrak (Target):</span>
						<span class="font-medium text-gray-800">{project?.end_date || 'Belum diatur'}</span>
					</div>
					<div class="flex justify-between items-center">
						<span class="text-gray-400">Prakiraan Tanggal Selesai:</span>
						<span class="font-bold {forecastInfo.slippageDays != null && forecastInfo.slippageDays > 0 ? 'text-amber-600' : 'text-emerald-700'}">
							{forecastInfo.forecastDate ? forecastInfo.forecastDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Memerlukan data laju'}
						</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- Rekomendasi Preskriptif Tindakan Lapangan -->
		{#if fieldRecommendations.length > 0}
			<div class="rounded-xl border border-blue-200 bg-blue-50/40 p-4 mb-3">
				<div class="flex items-center gap-2 mb-2">
					<span class="text-base">💡</span>
					<h2 class="text-sm font-bold text-blue-950">Rekomendasi Tindakan Lapangan</h2>
				</div>
				<p class="text-[11px] text-blue-800/80 mb-2">
					Prioritas tindakan pengawasan untuk Project Leader dan Mandor Site:
				</p>
				<div class="space-y-2">
					{#each fieldRecommendations as rec}
						<div class="p-2.5 rounded-lg border bg-white/90 text-xs {rec.type === 'warn' ? 'border-amber-200' : rec.type === 'info' ? 'border-blue-200' : 'border-emerald-200'}">
							<div class="flex items-center gap-1.5 font-bold {rec.type === 'warn' ? 'text-amber-900' : rec.type === 'info' ? 'text-blue-900' : 'text-emerald-900'}">
								<span>{rec.icon}</span>
								<span>{rec.title}</span>
							</div>
							<p class="text-[11px] text-gray-600 mt-1 leading-snug">
								{rec.desc}
							</p>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Anggaran vs RAP -->
		<div class="rounded-xl border border-gray-200 bg-white p-4 mb-3">
			<div class="flex items-center gap-2 mb-2">
				<IconWallet size={18} class="text-blue-600" />
				<h2 class="text-sm font-bold text-gray-800">Anggaran vs RAP</h2>
			</div>
			{#if pagu && pagu.status === 'ok' && pagu.used_pct != null}
				{@const st = PAGU_STYLE[pagu.level] ?? PAGU_STYLE.safe}
				<div class="flex items-baseline justify-between">
					<span class="text-xs text-gray-500">Sisa pagu yang bisa diajukan</span>
					<span class="text-lg font-bold {st.text}" data-testid="pagu-remaining">{Math.max(pagu.remaining_pct ?? 0, 0).toFixed(1)}%</span>
				</div>
				<div class="h-1.5 rounded-full bg-gray-100 mt-1">
					<div class="h-1.5 rounded-full {st.bar}" style="width: {Math.min(Math.max(pagu.used_pct, 0), 100)}%"></div>
				</div>
				<p class="text-[11px] font-semibold {st.text} mt-1.5">{st.label}</p>
				<p class="text-[10px] text-gray-400 mt-0.5">
					Terpakai {pagu.used_pct.toFixed(1)}% dari RAP (realisasi {pagu.actual_pct?.toFixed(1) ?? '—'}% + komitmen {pagu.commitment_pct?.toFixed(1) ?? '—'}%).
					Komitmen = pengajuan yang masih menunggu persetujuan. Cek sisa pagu sebelum membuat pengajuan baru.
				</p>
			{:else if pagu && pagu.status === 'unknown'}
				<p class="text-xs text-gray-400">{pagu.note || 'RAP belum diisi untuk proyek ini.'}</p>
			{:else if digest.budget.status === 'unknown'}
				<p class="text-xs text-gray-400">RAP belum diisi untuk proyek ini.</p>
			{:else}
				<!-- Fallback: server admin tidak terjangkau → angka lokal (tanpa komitmen). -->
				<div class="flex items-baseline justify-between">
					<span class="text-xs text-gray-500">Realisasi terpakai</span>
					<span class="text-lg font-bold {digest.budget.status === 'kritis' ? 'text-red-600' : digest.budget.status === 'waspada' ? 'text-amber-600' : 'text-emerald-600'}">
						{digest.budget.usedPct?.toFixed(1)}%
					</span>
				</div>
				<div class="h-1.5 rounded-full bg-gray-100 mt-1">
					<div class="h-1.5 rounded-full {digest.budget.status === 'kritis' ? 'bg-red-500' : digest.budget.status === 'waspada' ? 'bg-amber-500' : 'bg-emerald-500'}" style="width: {Math.min(digest.budget.usedPct ?? 0, 100)}%"></div>
				</div>
				<p class="text-[10px] text-gray-400 mt-1">Angka sementara (belum termasuk komitmen) — data pagu server tidak terjangkau.</p>
			{/if}
		</div>

		<!-- Gate Interlock BAST & Rekonsiliasi (G_PRJ) -->
		<div class="rounded-xl border border-gray-200 bg-white p-4 mb-3">
			<div class="flex items-center justify-between mb-2">
				<div class="flex items-center gap-2">
					<span class="text-base">🛡️</span>
					<h2 class="text-sm font-bold text-gray-800">Gate Kesiapan BAST & Rekonsiliasi</h2>
				</div>
				<span class="text-[10px] px-2 py-0.5 rounded font-mono font-semibold {pagu?.commitment_pct && pagu.commitment_pct > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
					{pagu?.commitment_pct && pagu.commitment_pct > 0 ? 'G_PRJ_REPORT_COST_RECON: WARN' : 'G_PRJ: SIAP'}
				</span>
			</div>

			<div class="space-y-2 text-xs">
				<div class="p-2.5 rounded-lg border {pagu?.commitment_pct && pagu.commitment_pct > 0 ? 'bg-amber-50/70 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-700'}">
					<div class="flex items-center justify-between font-semibold">
						<span>1. Rekonsiliasi Kasbon & Komitmen (G_PRJ_REPORT_COST_RECON)</span>
						<span>{pagu?.commitment_pct && pagu.commitment_pct > 0 ? `🟡 ${pagu.commitment_pct.toFixed(1)}% Komitmen` : '🟢 Bersih'}</span>
					</div>
					<p class="text-[11px] opacity-80 mt-1">
						{#if pagu?.commitment_pct && pagu.commitment_pct > 0}
							Ada pengajuan kasbon/PA yang belum selesai pertanggungjawabannya (LPJ). Segera selesaikan sebelum termin akhir ditutup.
						{:else}
							Tidak ada komitmen kasbon menggantung. Biaya operasional siap dikonsolidasi ke Finance.
						{/if}
					</p>
				</div>

				<div class="p-2.5 rounded-lg border bg-blue-50/50 border-blue-200 text-blue-950">
					<div class="flex items-center justify-between font-semibold">
						<span>2. Rilis Dossier Klien (G_PRJ_CUSTOMER_DOSSIER_RELEASE)</span>
						<span class="text-emerald-700 font-bold">🟢 Tersanitasi</span>
					</div>
					<p class="text-[11px] text-blue-900 opacity-80 mt-1">
						Format untuk owner/klien wajib menggunakan preset Customer (Technical / Commercial) untuk melindungi kerahasiaan HPP dan margin perusahaan.
					</p>
				</div>
			</div>
		</div>

		<!-- Dokumen & Laporan Proyek Multi-Stakeholder -->
		<div class="rounded-xl border border-gray-200 bg-white p-4 mb-3">
			<div class="flex items-center gap-2 mb-2">
				<IconClipboardList size={18} class="text-blue-600" />
				<h2 class="text-sm font-bold text-gray-800">Cetak & Ekspor Laporan Proyek</h2>
			</div>
			<p class="text-xs text-gray-500 mb-3">
				Pilih format dokumen resmi sesuai kebutuhan penerima (lapangan vs perwakilan owner).
			</p>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
				<button
					type="button"
					onclick={() => handleOpenPrint('operasional', 'summary')}
					disabled={openingPrint}
					class="p-3 text-left rounded-xl border border-blue-200 bg-blue-50/50 hover:bg-blue-100/60 active:bg-blue-200/60 transition flex flex-col justify-between cursor-pointer"
				>
					<div>
						<div class="flex items-center gap-1.5 font-bold text-xs text-blue-900">
							<span>👷</span>
							<span>Dossier Lapangan (Operasional)</span>
						</div>
						<p class="text-[10px] text-blue-700 mt-1 leading-snug">
							Kemajuan fisik, status regu, absensi, peralatan kerja, dan checklist K3 site.
						</p>
					</div>
					<div class="mt-2 text-[10px] font-semibold text-blue-600 flex items-center gap-1">
						<span>Lihat & Cetak Ringkasan</span>
						<span>→</span>
					</div>
				</button>

				<button
					type="button"
					onclick={() => handleOpenPrint('customer', 'summary')}
					disabled={openingPrint}
					class="p-3 text-left rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/60 active:bg-emerald-200/60 transition flex flex-col justify-between cursor-pointer"
				>
					<div>
						<div class="flex items-center gap-1.5 font-bold text-xs text-emerald-900">
							<span>🤝</span>
							<span>Progress Pack Klien (Customer)</span>
						</div>
						<p class="text-[10px] text-emerald-700 mt-1 leading-snug">
							Format resmi BAST tersanitasi. Bersih dari HPP internal dan pengeluaran kasbon.
						</p>
					</div>
					<div class="mt-2 text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
						<span>Lihat & Cetak Laporan</span>
						<span>→</span>
					</div>
				</button>
			</div>

			<div class="mt-2">
				<button
					type="button"
					onclick={() => handleOpenPrint('operasional', 'detailed', 'forecast')}
					disabled={openingPrint}
					class="w-full p-2.5 text-left rounded-xl border border-purple-200 bg-purple-50/50 hover:bg-purple-100/60 active:bg-purple-200/60 transition flex items-center justify-between cursor-pointer"
				>
					<div class="flex items-center gap-2">
						<span class="text-base">🔮</span>
						<div>
							<div class="text-xs font-bold text-purple-950">Laporan Forecast & Analisa Proyeksi</div>
							<div class="text-[10px] text-purple-700">Analisa laju harian, estimasi deviasi tanggal rampung, dan rekomendasi manajerial.</div>
						</div>
					</div>
					<div class="text-xs font-semibold text-purple-700 flex items-center gap-0.5">
						<span>Buka</span>
						<span>→</span>
					</div>
				</button>
			</div>
		</div>

		<!-- Kepatuhan Absensi Regu -->
		<div class="rounded-xl border border-gray-200 bg-white p-4 mb-3">
			<div class="flex items-center gap-2 mb-2">
				<IconUserCheck size={18} class="text-blue-600" />
				<h2 class="text-sm font-bold text-gray-800">Kepatuhan Absensi Regu</h2>
			</div>
			{#if !digest.attendance.applicable}
				<p class="text-xs text-gray-400">Tidak ada manpower aktif ditugaskan ke proyek ini.</p>
			{:else}
				<div class="flex items-baseline justify-between">
					<span class="text-xs text-gray-500">{digest.attendance.activeWorkers} pekerja aktif · {digest.attendance.elapsedWorkingDays} hari berjalan</span>
					<span class="text-lg font-bold {digest.attendance.compliancePct != null && digest.attendance.compliancePct < 70 ? 'text-amber-600' : 'text-emerald-600'}">
						{digest.attendance.compliancePct ?? '—'}%
					</span>
				</div>
				<p class="text-[10px] text-gray-400 mt-1">{digest.attendance.actualWorkerDays} dari {digest.attendance.expectedWorkerDays} hari-orang tercatat hadir</p>
			{/if}
		</div>

		<!-- Kesiapan Alat (P2H) -->
		<div class="rounded-xl border border-gray-200 bg-white p-4 mb-3">
			<div class="flex items-center gap-2 mb-2">
				<IconTool size={18} class="text-blue-600" />
				<h2 class="text-sm font-bold text-gray-800">Kesiapan Alat Pinjaman (P2H)</h2>
			</div>
			{#if !digest.equipment.applicable}
				<p class="text-xs text-gray-400">Tidak ada alat pinjaman aktif untuk proyek ini.</p>
			{:else}
				<div class="flex items-baseline justify-between">
					<span class="text-xs text-gray-500">{digest.equipment.totalEquipment} unit dipinjam</span>
					<span class="text-lg font-bold {digest.equipment.noGoCount > 0 ? 'text-red-600' : 'text-emerald-600'}">{digest.equipment.readinessPct ?? '—'}% Go</span>
				</div>
				<div class="flex gap-3 mt-2 text-[11px]">
					<span class="text-emerald-600 font-semibold">{digest.equipment.goCount} Go</span>
					<span class="text-red-600 font-semibold">{digest.equipment.noGoCount} No-Go</span>
					<span class="text-gray-500 font-semibold">{digest.equipment.notCheckedCount} belum dicek (7 hari)</span>
				</div>
				{#if digest.equipment.noGoCount > 0}
					<div class="mt-2 space-y-1">
						{#each digest.equipment.items.filter((i) => i.result === 'No-Go') as it}
							<p class="text-[11px] text-red-600">⚠️ {it.name} — No-Go ({it.checkedAt})</p>
						{/each}
					</div>
				{/if}
			{/if}
		</div>

		<!-- Sisa Material -->
		<div class="rounded-xl border border-gray-200 bg-white p-4 mb-3">
			<div class="flex items-center gap-2 mb-2">
				<IconBox size={18} class="text-blue-600" />
				<h2 class="text-sm font-bold text-gray-800">Sisa Material</h2>
			</div>
			{#if digest.material.length === 0}
				<p class="text-xs text-gray-400">Tidak ada material dengan stok rendah/kritis di proyek ini.</p>
			{:else}
				<div class="space-y-1.5">
					{#each digest.material as m}
						<div class="flex items-center justify-between text-xs">
							<span class="flex items-center gap-1">
								{#if m.status === 'critical'}<IconAlertTriangle size={13} class="text-red-500" />{/if}
								{m.item_name}
							</span>
							<span class="font-semibold {m.status === 'critical' ? 'text-red-600' : 'text-amber-600'}">{m.qty_on_hand} {m.item_satuan}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
