<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Detail kursus (F1) + pemutar modul (F2) + kuis akhir (F3) — Roadmap E-Learning YouTube.
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getKursusDetail, selfEnrollKursus, downloadKursusSertifikatInfo, type KursusDetail } from '$lib/services/ess/training';
	import TrainingPlayer from '$lib/components/ess/TrainingPlayer.svelte';
	import TrainingQuiz from '$lib/components/ess/TrainingQuiz.svelte';
	import {
		IconAlertTriangle, IconArrowLeft, IconAward, IconCircleCheck, IconClipboardCheck, IconDownload, IconLoader2, IconLock, IconPlayerPlay
	} from '@tabler/icons-svelte';

	const programId = Number($page.params.id);

	let loading = $state(true);
	let errorMsg = $state('');
	let detail = $state<KursusDetail | null>(null);
	let activeModuleId = $state<number | null>(null);
	let enrolling = $state(false);
	let showQuiz = $state(false);
	let downloadingSertifikat = $state(false);
	let sertifikatBelumBerQr = $state(false);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			detail = await getKursusDetail(programId);
			if (!activeModuleId && detail.modules.length > 0) activeModuleId = detail.modules[0].modul.id;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat detail kursus.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function daftar() {
		enrolling = true;
		try {
			await selfEnrollKursus(programId);
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mendaftar.';
		} finally {
			enrolling = false;
		}
	}

	let activeModule = $derived(detail?.modules.find((m) => m.modul.id === activeModuleId) ?? null);
	let semuaModulSelesai = $derived(detail ? detail.modules.every((m) => m.progress?.status === 'Selesai') : false);
	let activeModuleIndex = $derived(detail ? detail.modules.findIndex((m) => m.modul.id === activeModuleId) : -1);
	let hasNextModule = $derived(detail ? activeModuleIndex >= 0 && activeModuleIndex < detail.modules.length - 1 : false);

	function handleModuleSelesai() {
		load();
	}

	function gotoNextModule() {
		if (!detail || activeModuleIndex < 0) return;
		const next = detail.modules[activeModuleIndex + 1];
		if (next) {
			activeModuleId = next.modul.id;
			showQuiz = false;
		}
	}

	async function unduhSertifikat() {
		downloadingSertifikat = true;
		try {
			const { blob, berQr } = await downloadKursusSertifikatInfo(programId);
			sertifikatBelumBerQr = !berQr;
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Sertifikat-${(detail?.enrollment?.sertifikat_no || detail?.program.judul || 'training').replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengunduh sertifikat.';
		} finally {
			downloadingSertifikat = false;
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<button class="flex items-center gap-2 mb-4 text-sm font-bold" style="color: var(--sys-label3)" onclick={() => goto('/ess/pelatihan')}>
		<IconArrowLeft size={18} /> Kembali
	</button>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat materi kursus..." />
		</div>
	{:else if errorMsg && !detail}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<IconAlertTriangle size={32} class="mx-auto mb-4" style="color: #DC2626" />
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg" onclick={load}>Coba Lagi</button>
		</div>
	{:else if detail}
		<div class="mb-6">
			<div class="flex items-center gap-2 mb-2 flex-wrap">
				{#if detail.program.wajib}
					<span class="text-xs font-bold px-2.5 py-1 rounded-full" style="background: var(--rel); color: var(--red)">Wajib</span>
				{/if}
				{#if detail.program.kategori}
					<span class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{detail.program.kategori}</span>
				{/if}
			</div>
			<h1 class="text-2xl font-extrabold tracking-tight gradient-text">{detail.program.judul}</h1>
			{#if detail.program.deskripsi}
				<p class="text-sm mt-2" style="color: var(--sys-label3)">{detail.program.deskripsi}</p>
			{/if}
		</div>

		{#if !detail.enrollment}
			<div class="glass-panel rounded-2xl p-6 text-center mb-6">
				{#if detail.bisaSelfEnroll}
					<p class="text-sm font-medium mb-4" style="color: var(--sys-label3)">Kursus ini terbuka untuk pendaftaran mandiri.</p>
					<button
						class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg disabled:opacity-50"
						onclick={daftar}
						disabled={enrolling}
					>
						{enrolling ? 'Mendaftar...' : 'Daftar Kursus'}
					</button>
				{:else}
					<IconLock size={28} class="mx-auto mb-2" style="color: var(--sys-label4)" />
					<p class="text-sm font-medium" style="color: var(--sys-label3)">Anda belum terdaftar. Kursus ini menunggu penugasan dari HRD.</p>
				{/if}
			</div>
		{:else}
			{#if detail.enrollment.status === 'Lulus'}
				<div class="glass-panel rounded-2xl p-5 mb-6 flex items-center justify-between gap-4 flex-wrap">
					<div class="flex items-center gap-3">
						<div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style="background: var(--gg)">
							<IconAward size={22} style="color: var(--ggd)" />
						</div>
						<div>
							<p class="text-sm font-bold" style="color: var(--sys-label)">Selamat, Anda Lulus!</p>
							{#if detail.enrollment.sertifikat_no}
								<p class="text-xs font-medium" style="color: var(--sys-label4)">No. Sertifikat: {detail.enrollment.sertifikat_no}</p>
							{:else}
								<p class="text-xs font-medium" style="color: var(--sys-label4)">Sertifikat sedang diproses...</p>
							{/if}
						</div>
					</div>
					{#if detail.enrollment.sertifikat_file}
						<button
							class="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg disabled:opacity-50"
							onclick={unduhSertifikat}
							disabled={downloadingSertifikat}
						>
							<IconDownload size={16} /> {downloadingSertifikat ? 'Mengunduh...' : 'Unduh Sertifikat'}
						</button>
					{/if}
				</div>
			{/if}

			<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
				<div class="lg:col-span-8 order-2 lg:order-1">
					{#if showQuiz && detail.finalQuizId}
						<TrainingQuiz quizId={detail.finalQuizId} onLulus={load} />
					{:else if activeModule}
						{#key activeModule.modul.id}
							<div class="glass-panel rounded-2xl p-5">
								<h3 class="text-lg font-bold mb-4" style="color: var(--sys-label)">{activeModule.modul.judul}</h3>
								<TrainingPlayer
									modul={activeModule.modul}
									progress={activeModule.progress}
									minBacaDetik={activeModule.minBacaDetik ?? 0}
									wajib={detail.program.wajib}
									onSelesai={handleModuleSelesai}
									hasNextModule={hasNextModule}
									onNextModule={gotoNextModule}
								/>
							</div>
						{/key}
					{/if}
				</div>

				<div class="lg:col-span-4 order-1 lg:order-2 flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
					<h2 class="text-sm font-bold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Rail Silabus</h2>
					{#each detail.modules as m (m.modul.id)}
						<button
							class="glass-panel rounded-xl p-3.5 text-left flex items-center gap-3 transition-colors"
							class:hover-lift={activeModuleId !== m.modul.id}
							style={activeModuleId === m.modul.id ? 'outline: 2px solid var(--p)' : ''}
							onclick={() => {
								activeModuleId = m.modul.id;
								showQuiz = false;
							}}
						>
							{#if m.progress?.status === 'Selesai'}
								<IconCircleCheck size={18} class="shrink-0" style="color: var(--ggd)" />
							{:else}
								<IconPlayerPlay size={18} class="shrink-0" style="color: var(--sys-label4)" />
							{/if}
							<span class="text-sm font-semibold flex-1" style="color: var(--sys-label)">{m.modul.judul}</span>
							{#if m.modul.durasi_menit}
								<span class="text-[11px] font-semibold shrink-0" style="color: var(--sys-label4)">{m.modul.durasi_menit} mnt</span>
							{/if}
						</button>
					{/each}

					{#if detail.finalQuizId}
						<button
							class="glass-panel rounded-xl p-3.5 text-left flex items-center gap-3 mt-2 disabled:opacity-50"
							style={showQuiz ? 'outline: 2px solid var(--p)' : ''}
							disabled={!semuaModulSelesai}
							onclick={() => (showQuiz = true)}
						>
							{#if !semuaModulSelesai}
								<IconLock size={18} class="shrink-0" style="color: var(--sys-label4)" />
							{:else}
								<IconClipboardCheck size={18} class="shrink-0" style="color: var(--p, var(--g))" />
							{/if}
							<span class="text-sm font-semibold flex-1" style="color: var(--sys-label)">Kuis Akhir</span>
						</button>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>
