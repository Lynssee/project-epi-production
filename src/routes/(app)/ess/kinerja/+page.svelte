<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getKpiList, submitSelfAssessment, type KpiRecord, type KriteriaItem, type KpiReview, type LiveKpiRecord, type KpiNotification } from '$lib/services/ess/kpi';
	import { getMyDisputes, submitDispute, type KpiDispute } from '$lib/services/ess/kpiDispute';
	import { getMySkillGap, type SkillGapResult } from '$lib/services/ess/skillGap';
	import { IconLoader2, IconAlertTriangle, IconTrophy, IconClipboardCheck, IconGavel, IconSparkles, IconTargetArrow, IconFileExport } from '@tabler/icons-svelte';
	import EssExportSheet from '$lib/components/ess/EssExportSheet.svelte';
	import GateKpiSayaCard from '$lib/components/ess/GateKpiSayaCard.svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let kpiList = $state<KpiRecord[]>([]);
	let pendingList = $state<KpiRecord[]>([]);
	let liveKpiList = $state<LiveKpiRecord[]>([]);
	let notifications = $state<KpiNotification[]>([]);
	let selfReviews = $state<KpiReview[]>([]);
	let defaultKriteria = $state<KriteriaItem[]>([]);
	let myDisputes = $state<KpiDispute[]>([]);
	let skillGap = $state<SkillGapResult | null>(null);

	let showDisputeModal = $state(false);
	let disputeSaving = $state(false);
	let disputeScorecard = $state<KpiRecord | null>(null);
	let disputeAlasan = $state('');
	let disputeError = $state('');

	let showModal = $state(false);
	let saving = $state(false);
	let activeScorecard = $state<KpiRecord | null>(null);
	let formKriteria = $state<KriteriaItem[]>([]);
	let formKomentar = $state('');

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getKpiList();
			kpiList = res.kpiList;
			pendingList = res.pendingList;
			liveKpiList = res.liveKpiList;
			selfReviews = res.selfReviews;
			defaultKriteria = res.defaultKriteria;
			notifications = res.notifications || [];
			myDisputes = await getMyDisputes().catch(() => []);
			skillGap = await getMySkillGap().catch(() => null);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data kinerja.';
		} finally {
			loading = false;
		}
	}

	function disputeForScorecard(scorecardId: string): KpiDispute | null {
		return myDisputes.find((d) => d.scorecard_id === scorecardId) || null;
	}

	function openDisputeModal(kpi: KpiRecord) {
		disputeScorecard = kpi;
		disputeAlasan = '';
		disputeError = '';
		showDisputeModal = true;
	}

	async function handleSubmitDispute() {
		if (!disputeScorecard) return;
		if (!disputeAlasan.trim()) {
			disputeError = 'Jelaskan alasan keberatan Anda.';
			return;
		}
		disputeSaving = true;
		disputeError = '';
		try {
			await submitDispute(disputeScorecard.id, disputeAlasan.trim());
			showDisputeModal = false;
			await load();
		} catch (err: any) {
			disputeError = err?.message || 'Gagal mengajukan keberatan.';
		} finally {
			disputeSaving = false;
		}
	}

	onMount(load);

	function pct(achievement: number, target: number) {
		if (!target) return 0;
		return Math.min(100, Math.round((achievement / target) * 100));
	}

	// Fase 10 (dashboard visual lapangan): indikator KPI General yang datanya sudah
	// otomatis dari kalkulator (kpiEngine.js sisi Admin) — ditandai badge terpisah,
	// bukan cuma progress bar generik, supaya karyawan tahu ini bukan input manual atasan.
	// 12 Agu 2026 — tambah "dept-wide": konvensi penamaan kpiEngine.js untuk SEMUA indikator
	// tingkat-departemen otomatis (bukan cuma HRD/GA — juga stockout/dead-stock/WO
	// completion/dst, lihat CALCULATOR_REGISTRY) selalu diakhiri "(dept-wide)". Sebelumnya
	// cuma "KPI finalization rate (dept-wide)"/"Kelengkapan data HR karyawan (dept-wide)"/
	// "Turnover rate HRD & GA (dept-wide)" lolos hitung otomatis tapi tidak dapat badge ini
	// karena namanya tidak cocok pola lama — padahal ketiganya otomatis (lihat sumber_perhitungan).
	const KPI_GENERAL_PATTERN = /kehadiran|ketepatan waktu|training|pelatihan|dept-wide/i;
	function isKpiGeneral(name: string) {
		return KPI_GENERAL_PATTERN.test(name || '');
	}

	function cutoffBadge(kpi: KpiRecord): { label: string; tone: 'released' | 'pending' } {
		if (kpi.cutoff_status === 'released') return { label: 'Sudah Dirilis', tone: 'released' };
		return { label: 'Menunggu Rilis Periode', tone: 'pending' };
	}

	// Sparkline histori total_skor — kpiList sudah terurut -tahun,-periode (terbaru dulu),
	// dibalik jadi kronologis utk ditampilkan kiri->kanan.
	function historiPoints(list: KpiRecord[]): { periode: string; skor: number }[] {
		return [...list]
			.filter((k) => k.total_skor != null)
			.reverse()
			.map((k) => ({ periode: k.periode, skor: k.total_skor as number }));
	}

	function sparklinePath(points: { skor: number }[], width: number, height: number): string {
		if (points.length === 0) return '';
		if (points.length === 1) return `M0,${height / 2} L${width},${height / 2}`;
		const max = Math.max(...points.map((p) => p.skor), 5);
		const min = Math.min(...points.map((p) => p.skor), 0);
		const range = max - min || 1;
		const stepX = width / (points.length - 1);
		return points
			.map((p, i) => {
				const x = i * stepX;
				const y = height - ((p.skor - min) / range) * height;
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	// L3 (bonus, General vs Spesifik v2) — "Jika bulan ini berakhir sekarang": bandingkan skor
	// kuantitatif periode berjalan (liveKpiList.skor_objektif) dengan total_skor periode terakhir
	// yang SUDAH final (kpiList[0], terurut -tahun,-periode). Bukan basis identik (kuantitatif vs
	// total) — histori skor_objektif per-periode tidak tersimpan — tapi tetap sinyal arah yang
	// berguna: "dibanding terakhir kali dinilai penuh, saya di jalur naik/turun?".
	function deltaVsPeriodeLalu(skorSekarang: number | null | undefined): { delta: number; periodeLalu: string } | null {
		if (skorSekarang == null) return null;
		const lastFinal = kpiList[0];
		if (!lastFinal || lastFinal.total_skor == null) return null;
		const delta = Math.round((skorSekarang - lastFinal.total_skor) * 10) / 10;
		return { delta, periodeLalu: lastFinal.periode };
	}

	// L4 (bonus, General vs Spesifik v2) — "Kunci Perbaikan Otomatis": tip kontekstual dari
	// sub-indikator terukur dgn skor terendah (General atau Spesifik), diambil dari
	// detail_general/detail_spesifik yang sudah tersimpan (tidak perlu request tambahan).
	function tipPerbaikan(kpi: KpiRecord): { nama: string; skor: number } | null {
		const semua = [...(kpi.detail_general?.breakdown || []), ...(kpi.detail_spesifik?.breakdown || [])].filter(
			(b) => b.terukur && b.skor != null
		);
		if (semua.length === 0) return null;
		const terendah = [...semua].sort((a, b) => (a.skor as number) - (b.skor as number))[0];
		if ((terendah.skor as number) >= 90) return null; // sudah bagus semua, tidak perlu disorot
		return { nama: terendah.nama, skor: terendah.skor as number };
	}

	// L7 (bonus, General vs Spesifik v2) — "Simulator Diri": estimasi Skor Umum (General) bila
	// indikator alpa/mangkir jadi 0 bulan depan. Murni re-weight dari detail_general yang sudah
	// ada (arah rendah, target 0 -> skor sempurna 100 kalau realisasi 0) — tidak butuh request baru.
	let simulasiOpenId = $state<string | null>(null);

	let sheetOpen = $state(false);
	const exportColumns = [
		{ key: 'periode', label: 'Periode' },
		{ key: 'tahun', label: 'Tahun' },
		{ key: 'tipe', label: 'Tipe' },
		{ key: 'total_skor', label: 'Total Skor' },
		{ key: 'skor_general', label: 'General' },
		{ key: 'skor_spesifik', label: 'Spesifik' },
		{ key: 'skor_komposit', label: 'Komposit' },
		{ key: 'skor_pelatihan', label: 'Pelatihan' },
		{ key: 'status', label: 'Status' },
		{ key: 'catatan', label: 'Catatan' }
	];
	const exportRows = $derived(
		kpiList.map((k) => ({
			periode: k.periode ?? '-',
			tahun: k.tahun ?? '-',
			tipe: k.tipe ?? '-',
			total_skor: k.total_skor ?? '-',
			skor_general: k.skor_general ?? '-',
			skor_spesifik: k.skor_spesifik ?? '-',
			skor_komposit: k.skor_komposit ?? '-',
			skor_pelatihan: k.skor_pelatihan ?? '-',
			status: k.status ?? '-',
			catatan: k.catatan ?? '-'
		}))
	);
	function simulasiTanpaAlpa(kpi: KpiRecord): { skorSimulasi: number; delta: number; namaIndikator: string } | null {
		const detail = kpi.detail_general;
		if (!detail?.breakdown?.length || !detail.bobotTerukur) return null;
		const alpaItem = detail.breakdown.find((b) => /alpa|mangkir/i.test(b.nama) && b.terukur);
		if (!alpaItem || (alpaItem.skor as number) >= 100) return null;
		const skorSekarang = detail.skor ?? 0;
		const totalTertimbangBaru = skorSekarang * detail.bobotTerukur - (alpaItem.skor as number) * alpaItem.bobot + 100 * alpaItem.bobot;
		const skorSimulasi = Math.round((totalTertimbangBaru / detail.bobotTerukur) * 10) / 10;
		return { skorSimulasi, delta: Math.round((skorSimulasi - skorSekarang) * 10) / 10, namaIndikator: alpaItem.nama };
	}

	function existingReview(scorecardId: string) {
		return selfReviews.find((r) => r.scorecard_id === scorecardId) || null;
	}

	function openSelfAssessment(kpi: KpiRecord) {
		activeScorecard = kpi;
		const existing = existingReview(kpi.id);
		formKriteria = existing ? existing.kriteria.map((k) => ({ ...k })) : defaultKriteria.map((k) => ({ ...k }));
		formKomentar = existing?.komentar || '';
		showModal = true;
	}

	function totalNilaiLive() {
		const totalWeight = formKriteria.reduce((s, k) => s + (Number(k.weight) || 0), 0);
		if (totalWeight === 0) return 0;
		const weighted = formKriteria.reduce((sum, k) => sum + (Number(k.score) || 0) * (Number(k.weight) || 0), 0);
		return Math.round((weighted / totalWeight) * 10) / 10;
	}

	async function handleSubmit() {
		if (!activeScorecard) return;
		if (formKriteria.some((k) => !k.score || k.score < 1 || k.score > 5)) {
			errorMsg = 'Isi semua skor kriteria (1-5) sebelum submit.';
			return;
		}
		saving = true;
		try {
			await submitSelfAssessment(activeScorecard.id, formKriteria, formKomentar);
			showModal = false;
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal submit self-assessment.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-8 flex items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Kinerja Saya</h1>
			<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Skor KPI final & self-assessment</p>
		</div>
		<button
			class="w-11 h-11 shrink-0 rounded-full flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 text-slate-500 disabled:opacity-40 hover:scale-105 transition-transform"
			onclick={() => (sheetOpen = true)}
			disabled={kpiList.length === 0}
			aria-label="Ekspor scorecard KPI"
			title="Ekspor scorecard KPI final (PDF / CSV)"
		>
			<IconFileExport size={20} />
		</button>
	</div>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data kinerja..." />
	{:else if errorMsg && !showModal}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else}
		{#if notifications.length > 0}
			<div class="mb-8 space-y-2">
				{#each notifications as n (n.id)}
					<div class="rounded-xl p-3 text-sm flex items-start gap-2" style="background: var(--bl, #eff6ff); border: 1px solid var(--bl2, #bfdbfe)">
						<IconTrophy size={18} class="mt-0.5 shrink-0" style="color: var(--b, #2563eb)" />
						<div>
							<p class="font-semibold" style="color: var(--sys-label)">{n.title}</p>
							<p class="text-xs mt-0.5" style="color: var(--sys-label3)">{n.message}</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}
		{#if pendingList.length > 0}
			<div class="mb-8">
				<h2 class="text-lg font-bold mb-4 flex items-center gap-2" style="color: var(--sys-label)">
					Perlu Self-Assessment <span class="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{pendingList.length}</span>
				</h2>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each pendingList as kpi (kpi.id)}
						{@const review = existingReview(kpi.id)}
						<button
							class="hover-lift glass-panel rounded-2xl p-5 text-left flex items-center justify-between group focus:outline-none"
							onclick={() => openSelfAssessment(kpi)}
						>
							<div>
								<p class="text-base font-bold mb-1" style="color: var(--sys-label)">{kpi.periode} {kpi.tahun ? `(${kpi.tahun})` : ''}</p>
								<p class="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 w-fit" style="color: var(--sys-label3)">Status: {kpi.status}</p>
							</div>
							<div class="flex items-center gap-3">
								{#if review}
									<span class="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">Tersimpan</span>
								{:else}
									<span class="text-xs font-bold px-3 py-1 rounded-full text-blue-600 bg-blue-50 border border-blue-200 transition-colors group-hover:bg-blue-600 group-hover:text-white">Isi Sekarang</span>
								{/if}
								<div class="w-10 h-10 rounded-full flex items-center justify-center bg-blue-50 text-blue-600 transition-transform group-hover:scale-110">
									<IconClipboardCheck size={20} />
								</div>
							</div>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<GateKpiSayaCard />

		{#if liveKpiList.length > 0}
			<div class="mb-8">
				<h2 class="text-lg font-bold mb-1 flex items-center gap-2" style="color: var(--sys-label)">
					Progres Berjalan
					<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 animate-pulse">LIVE</span>
				</h2>
				<p class="text-xs mb-4" style="color: var(--sys-label3)">Capaian kuantitatif periode berjalan — dihitung otomatis, belum final. Skor perilaku & total baru tampil setelah dirilis.</p>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each liveKpiList as kpi (kpi.id)}
						{@const delta = deltaVsPeriodeLalu(kpi.skor_objektif)}
						<div class="glass-panel rounded-2xl p-5">
							<div class="flex items-center justify-between mb-1">
								<p class="text-sm font-bold" style="color: var(--sys-label)">{kpi.periode} {kpi.tahun ? `(${kpi.tahun})` : ''}</p>
								{#if kpi.skor_objektif != null}
									<span class="text-lg font-black gradient-text">{kpi.skor_objektif.toFixed(1)}</span>
								{/if}
							</div>
							{#if delta}
								<p class="text-[10px] font-semibold mb-3" style="color: {delta.delta >= 0 ? '#16A34A' : '#DC2626'}">
									{delta.delta >= 0 ? '▲' : '▼'} {delta.delta >= 0 ? '+' : ''}{delta.delta} dibanding skor final {delta.periodeLalu}
								</p>
							{:else}
								<div class="mb-4"></div>
							{/if}
							<div class="flex flex-col gap-3">
								{#each kpi.targets as t (t.name)}
									<div>
										<div class="flex justify-between text-xs font-medium mb-1">
											<span style="color: var(--sys-label)">{t.name}</span>
											<span style="color: var(--sys-label3)">{t.achievement}/{t.target} {t.unit || ''}</span>
										</div>
										<div class="h-1.5 rounded-full overflow-hidden bg-slate-100">
											<div class="h-full rounded-full gradient-bg transition-all duration-1000" style="width: {pct(t.achievement, t.target)}%"></div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if kpiList.length > 1}
			{@const points = historiPoints(kpiList)}
			<div class="glass-panel rounded-2xl p-5 mb-6">
				<p class="text-xs font-bold mb-3" style="color: var(--sys-label3)">Tren Skor Antar Periode</p>
				<div class="flex items-end gap-4">
					<svg viewBox="0 0 240 48" class="w-full max-w-xs h-12" preserveAspectRatio="none">
						<path d={sparklinePath(points, 240, 48)} fill="none" stroke="var(--p, var(--g))" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<div class="flex gap-3 text-[11px] font-semibold shrink-0" style="color: var(--sys-label3)">
						{#each points as p (p.periode)}
							<span>{p.periode}: <span style="color: var(--sys-label)">{p.skor.toFixed(1)}</span></span>
						{/each}
					</div>
				</div>
			</div>
		{/if}

		{#if skillGap && skillGap.total > 0}
			<div class="glass-panel rounded-2xl p-5 mb-6">
				<div class="flex items-center justify-between mb-3">
					<p class="text-xs font-bold flex items-center gap-1.5" style="color: var(--sys-label3)">
						<IconTargetArrow size={15} /> Skill Gap — Kompetensi Jabatan
					</p>
					{#if skillGap.persen != null}
						<span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">{skillGap.persen}% Terpenuhi</span>
					{/if}
				</div>
				<div class="flex flex-col gap-2.5">
					{#each skillGap.detail as s (s.namaSkill)}
						<div>
							<div class="flex justify-between text-xs font-medium mb-1">
								<span style="color: var(--sys-label)">{s.namaSkill} <span class="opacity-60">({s.kategori})</span></span>
								<span
									class="font-bold"
									class:text-emerald-600={s.status === 'terpenuhi'}
									class:text-amber-600={s.status === 'level_kurang' || s.status === 'kedaluwarsa'}
									class:text-red-500={s.status === 'belum'}
								>{s.levelDimiliki || '-'} / min. {s.levelMinimum}</span>
							</div>
							<div class="h-1.5 rounded-full overflow-hidden bg-slate-100">
								<div
									class="h-full rounded-full transition-all duration-1000"
									class:bg-emerald-500={s.status === 'terpenuhi'}
									class:bg-amber-500={s.status === 'level_kurang' || s.status === 'kedaluwarsa'}
									class:bg-red-400={s.status === 'belum'}
									style="width: {s.status === 'terpenuhi' ? 100 : s.status === 'belum' ? 8 : 55}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
				{#if skillGap.kurang.length > 0}
					<p class="text-[11px] mt-3 pt-3 border-t border-slate-200/50" style="color: var(--sys-label4)">
						{skillGap.kurang.length} dari {skillGap.total} skill wajib jabatan belum terpenuhi penuh — cek menu Training untuk program yang bisa menutup gap ini.
					</p>
				{/if}
			</div>
		{/if}

		<h2 class="text-lg font-bold mb-4" style="color: var(--sys-label)">Riwayat Skor Final</h2>
		{#if kpiList.length === 0}
			<div class="glass-panel rounded-2xl p-10 text-center">
				<div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
					<IconTrophy size={32} class="text-slate-400" />
				</div>
				<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada KPI yang difinalisasi untuk Anda.</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				{#each kpiList as kpi (kpi.id)}
					{@const cutoff = cutoffBadge(kpi)}
					{@const tip = tipPerbaikan(kpi)}
					{@const simulasi = simulasiTanpaAlpa(kpi)}
					<div class="glass-panel rounded-3xl p-6 relative overflow-hidden flex flex-col h-full hover-lift">
						<div class="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>

						<div class="flex items-center justify-between mb-3 relative z-10">
							<p class="text-base font-bold" style="color: var(--sys-label)">{kpi.periode} {kpi.tahun ? `(${kpi.tahun})` : ''}</p>
							{#if kpi.total_skor != null}
								<div class="flex items-baseline gap-1 bg-white/50 px-3 py-1.5 rounded-xl border border-white/20 shadow-sm">
									<p class="text-2xl font-black gradient-text tracking-tight">{kpi.total_skor.toFixed(1)}</p>
									<span class="text-xs font-bold" style="color: var(--sys-label4)">/ 5.0</span>
								</div>
							{/if}
						</div>

						<div class="mb-5 relative z-10">
							<span
								class="text-[10px] font-bold px-2.5 py-1 rounded-full border"
								class:bg-emerald-50={cutoff.tone === 'released'}
								class:text-emerald-600={cutoff.tone === 'released'}
								class:border-emerald-200={cutoff.tone === 'released'}
								class:bg-amber-50={cutoff.tone === 'pending'}
								class:text-amber-600={cutoff.tone === 'pending'}
								class:border-amber-200={cutoff.tone === 'pending'}
							>{cutoff.label}</span>
							{#if kpi.peringkat_departemen != null && kpi.total_di_departemen}
								<span class="ml-2 text-[10px] font-bold px-2.5 py-1 rounded-full border" style="background: var(--bl, #eff6ff); border-color: var(--bl2, #bfdbfe); color: var(--b, #2563eb)">
									Peringkat {kpi.peringkat_departemen} dari {kpi.total_di_departemen} di departemen Anda
								</span>
							{/if}
						</div>

						{#if kpi.skor_general != null || kpi.skor_spesifik != null}
							<div class="grid grid-cols-2 gap-3 mb-5 relative z-10">
								<div class="rounded-xl p-3 bg-white/50 border border-white/20">
									<p class="text-[9px] font-bold uppercase tracking-wider" style="color: var(--sys-label4)">Skor Umum</p>
									<p class="text-lg font-black" style="color: var(--sys-label)">{kpi.skor_general ?? '-'}</p>
									<div class="h-1.5 rounded-full overflow-hidden bg-slate-100 mt-1">
										<div class="h-full rounded-full bg-emerald-500" style="width: {Math.min(kpi.skor_general ?? 0, 100)}%"></div>
									</div>
								</div>
								<div class="rounded-xl p-3 bg-white/50 border border-white/20">
									<p class="text-[9px] font-bold uppercase tracking-wider" style="color: var(--sys-label4)">Skor Kinerja</p>
									<p class="text-lg font-black" style="color: var(--sys-label)">{kpi.skor_spesifik ?? '-'}</p>
									<div class="h-1.5 rounded-full overflow-hidden bg-slate-100 mt-1">
										<div class="h-full rounded-full bg-cyan-500" style="width: {Math.min(kpi.skor_spesifik ?? 0, 100)}%"></div>
									</div>
								</div>
							</div>
							{#if kpi.bobot_general_pct != null}
								<p class="text-[10px] font-medium mb-4 -mt-2 relative z-10" style="color: var(--sys-label4)">
									Bobot: Umum {kpi.bobot_general_pct}% &bull; Kinerja {kpi.bobot_spesifik_pct}%
								</p>
							{/if}
						{/if}

						{#if tip}
							<div class="rounded-xl p-3 mb-4 relative z-10" style="background: var(--am, #FFFBEB); border: 1px solid var(--am2, #FDE68A)">
								<p class="text-[10px] font-bold mb-0.5" style="color: #B45309">🔑 Kunci Perbaikan</p>
								<p class="text-[11px]" style="color: #92400E">
									Skor "{tip.nama}" Anda <strong>{tip.skor}</strong> — sub-indikator terendah periode ini. Fokus di sini paling terasa dampaknya ke skor total.
								</p>
							</div>
						{/if}

						{#if simulasi}
							<div class="mb-4 relative z-10">
								<button
									class="text-[11px] font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors hover:bg-slate-50"
									style="border-color: var(--sys-sep); color: var(--sys-label3)"
									onclick={() => (simulasiOpenId = simulasiOpenId === kpi.id ? null : kpi.id)}
								>
									🧮 Simulasi: jika {simulasi.namaIndikator.toLowerCase()} 0 bulan depan?
								</button>
								{#if simulasiOpenId === kpi.id}
									<div class="mt-2 rounded-xl p-3" style="background: var(--bl, #eff6ff); border: 1px solid var(--bl2, #bfdbfe)">
										<p class="text-[11px]" style="color: var(--sys-label)">
											Estimasi Skor Umum (General) Anda naik jadi <strong>{simulasi.skorSimulasi}</strong>
											(<span style="color: #16A34A">+{simulasi.delta}</span>) — berdasarkan bobot indikator saat ini, bukan jaminan skor final.
										</p>
									</div>
								{/if}
							</div>
						{/if}

						{#if kpi.targets && kpi.targets.length > 0}
							<div class="flex flex-col gap-4 relative z-10 flex-grow">
								{#each kpi.targets as t (t.id)}
									<div>
										<div class="flex justify-between text-xs font-medium mb-1.5">
											<span class="flex items-center gap-1.5" style="color: var(--sys-label)">
												{t.name}
												{#if isKpiGeneral(t.name)}
													<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">Otomatis</span>
												{/if}
											</span>
											<span style="color: var(--sys-label3)">{t.achievement}/{t.target} {t.unit || ''}</span>
										</div>
										<div class="h-2 rounded-full overflow-hidden bg-slate-100 shadow-inner">
											<div class="h-full rounded-full gradient-bg transition-all duration-1000" style="width: {pct(t.achievement, t.target)}%"></div>
										</div>
									</div>
								{/each}
							</div>
						{/if}

						{#if kpi.catatan}
							<div class="mt-6 pt-4 border-t border-slate-200/50 relative z-10">
								<p class="text-xs font-medium italic" style="color: var(--sys-label3)">"{kpi.catatan}"</p>
							</div>
						{/if}

						{#if kpi.ai_recommendation}
							<div class="mt-4 pt-4 border-t border-slate-200/50 relative z-10">
								<div class="rounded-2xl p-4" style="background: var(--bl, #eff6ff); border: 1px solid var(--bl2, #bfdbfe)">
									<div class="flex items-center gap-1.5 mb-2">
										<IconSparkles size={15} style="color: var(--b, #2563eb)" />
										<span class="text-xs font-bold" style="color: var(--sys-label)">Rekomendasi HR</span>
									</div>
									<p class="text-xs leading-relaxed whitespace-pre-line" style="color: var(--sys-label3)">{kpi.ai_recommendation}</p>
									{#if kpi.ai_action_items && kpi.ai_action_items.length > 0}
										<ul class="mt-3 space-y-1.5">
											{#each kpi.ai_action_items as item}
												<li class="text-[11px] flex items-start gap-1.5" style="color: var(--sys-label3)">
													<span class="mt-0.5">•</span>
													<span>{item.aksi}{item.deadline_minggu ? ` (~${item.deadline_minggu} minggu)` : ''}</span>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							</div>
						{/if}

						{#if cutoff.tone === 'released'}
							{@const dispute = disputeForScorecard(kpi.id)}
							<div class="mt-4 pt-4 border-t border-slate-200/50 relative z-10">
								{#if dispute}
									<div class="flex items-center gap-2">
										<IconGavel size={14} style="color: var(--sys-label4)" />
										<span class="text-xs font-semibold" style="color: var(--sys-label3)">Keberatan: {dispute.status}</span>
									</div>
									{#if dispute.tanggapan_hrd}
										<p class="text-[11px] mt-1 italic" style="color: var(--sys-label4)">"{dispute.tanggapan_hrd}"</p>
									{/if}
								{:else}
									<button
										class="text-xs font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors hover:bg-slate-50"
										style="border-color: var(--sys-sep); color: var(--sys-label3)"
										onclick={() => openDisputeModal(kpi)}
									>
										<IconGavel size={14} /> Ajukan Keberatan
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

{#if showModal && activeScorecard}
	<div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4 transition-opacity" onclick={(e) => { if (e.target === e.currentTarget) showModal = false; }}>
		<div class="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-xl max-h-[90vh] flex flex-col shadow-2xl transform transition-all">
			<!-- Header -->
			<div class="p-6 border-b border-slate-200 flex items-center justify-between shrink-0">
				<div>
					<h3 class="text-lg font-bold" style="color: var(--sys-label)">Self-Assessment {activeScorecard.periode}</h3>
					<p class="text-xs font-medium mt-1" style="color: var(--sys-label3)">Nilai kinerja Anda (1 = kurang, 5 = sangat baik).</p>
				</div>
				<div class="bg-blue-50 px-4 py-2 rounded-xl text-center">
					<p class="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-0.5">Total</p>
					<p class="text-xl font-black text-blue-700 leading-none">{totalNilaiLive()}</p>
				</div>
			</div>
			
			<!-- Body -->
			<div class="p-6 overflow-y-auto space-y-6">
				{#if errorMsg}
					<div class="bg-red-50 text-red-600 text-xs font-bold p-3 rounded-xl flex items-center gap-2 border border-red-100">
						<IconAlertTriangle size={16} /> {errorMsg}
					</div>
				{/if}

				<div class="flex flex-col gap-4">
					{#each formKriteria as k}
						<div class="bg-slate-50 rounded-2xl p-4 border border-slate-200">
							<div class="flex justify-between items-start mb-4">
								<span class="text-sm font-bold" style="color: var(--sys-label)">{k.name}</span>
								<span class="text-[10px] font-bold bg-slate-200 px-2 py-0.5 rounded text-slate-600">bobot {k.weight}%</span>
							</div>
							
							<!-- Score buttons -->
							<div class="flex gap-2 mb-4">
								{#each [1, 2, 3, 4, 5] as v}
									<button
										class="flex-1 h-10 rounded-xl text-sm font-black transition-all hover:scale-105 active:scale-95"
										style={k.score === v 
											? 'background: var(--p, var(--g)); color: white; box-shadow: 0 4px 10px rgba(31,101,146,0.3); border: none;' 
											: 'background: white; border: 1px solid var(--sys-sep); color: var(--sys-label3);'}
										onclick={() => (k.score = v)}
									>
										{v}
									</button>
								{/each}
							</div>
							
							<input
								type="text"
								placeholder="Tambahkan catatan pencapaian (opsional)..."
								bind:value={k.notes}
								class="w-full px-3 py-2 text-xs rounded-xl bg-white border transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
								style="border-color: var(--sys-sep); color: var(--sys-label)"
							/>
						</div>
					{/each}
				</div>

				<div class="bg-slate-50 rounded-2xl p-4 border border-slate-200">
					<label class="block text-sm font-bold mb-2" style="color: var(--sys-label)">Komentar Umum</label>
					<textarea 
						bind:value={formKomentar} 
						rows="3" 
						placeholder="Bagaimana evaluasi Anda secara keseluruhan pada periode ini?"
						class="w-full px-3 py-3 text-sm rounded-xl bg-white border transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
						style="border-color: var(--sys-sep); color: var(--sys-label)"
					></textarea>
				</div>
			</div>

			<!-- Footer -->
			<div class="p-4 sm:p-6 border-t border-slate-200 flex justify-end gap-3 shrink-0 bg-slate-50 rounded-b-3xl">
				<button 
					class="px-6 py-2.5 text-sm font-bold rounded-xl bg-white border hover:bg-slate-50 transition-colors"
					style="border-color: var(--sys-sep); color: var(--sys-label3)" 
					onclick={() => (showModal = false)}
				>
					Batal
				</button>
				<button
					class="px-6 py-2.5 text-sm font-bold rounded-xl text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:transform-none flex items-center gap-2"
					style="background: var(--p, var(--g))"
					disabled={saving}
					onclick={handleSubmit}
				>
					{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
					{saving ? 'Menyimpan...' : 'Kirim Penilaian'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showDisputeModal && disputeScorecard}
	<div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4 transition-opacity" onclick={(e) => { if (e.target === e.currentTarget) showDisputeModal = false; }}>
		<div class="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] flex flex-col shadow-2xl">
			<div class="p-6 border-b border-slate-200 shrink-0">
				<h3 class="text-lg font-bold" style="color: var(--sys-label)">Ajukan Keberatan</h3>
				<p class="text-xs font-medium mt-1" style="color: var(--sys-label3)">
					Skor periode {disputeScorecard.periode} {disputeScorecard.tahun ? `(${disputeScorecard.tahun})` : ''}. Jelaskan bagian mana yang menurut Anda perlu ditinjau ulang — HRD akan menanggapi.
				</p>
			</div>
			<div class="p-6 overflow-y-auto space-y-3">
				{#if disputeError}
					<div class="bg-red-50 text-red-600 text-xs font-bold p-3 rounded-xl flex items-center gap-2 border border-red-100">
						<IconAlertTriangle size={16} /> {disputeError}
					</div>
				{/if}
				<textarea
					bind:value={disputeAlasan}
					rows="5"
					placeholder="Contoh: pencapaian saya untuk indikator X tercatat 0 padahal saya sudah menyelesaikan Y unit pada periode ini..."
					class="w-full px-3 py-3 text-sm rounded-xl bg-white border transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
				></textarea>
			</div>
			<div class="p-4 sm:p-6 border-t border-slate-200 flex justify-end gap-3 shrink-0 bg-slate-50 rounded-b-3xl">
				<button
					class="px-6 py-2.5 text-sm font-bold rounded-xl bg-white border hover:bg-slate-50 transition-colors"
					style="border-color: var(--sys-sep); color: var(--sys-label3)"
					onclick={() => (showDisputeModal = false)}
				>
					Batal
				</button>
				<button
					class="px-6 py-2.5 text-sm font-bold rounded-xl text-white shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center gap-2"
					style="background: var(--p, var(--g))"
					disabled={disputeSaving}
					onclick={handleSubmitDispute}
				>
					{#if disputeSaving}<IconLoader2 size={16} class="animate-spin" />{/if}
					{disputeSaving ? 'Mengirim...' : 'Ajukan'}
				</button>
			</div>
		</div>
	</div>
{/if}

<EssExportSheet
	open={sheetOpen}
	onClose={() => (sheetOpen = false)}
	judul="Scorecard KPI Final Saya"
	filename="kinerja-saya"
	columns={exportColumns}
	rows={exportRows}
	landscape={true}
/>
