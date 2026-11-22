<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Beranda E-Learning lapangan (Fase 2.1 ala Coursera): hero "Lanjutkan Belajar" + baris
	// bertumpuk (Wajib/Direkomendasikan/Selesai) menggantikan tab Wajib/Tersedia/Selesai lama.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getKursusList, getMySkills, type KursusListItem, type MySkillRecord, type PilarKnowledge } from '$lib/services/ess/training';
	import { getSilabusSaya, getTimSilabus, type SilabusProgress } from '$lib/services/ess/silabus';
	import { getMyTrainingFeedback } from '$lib/services/ess/trainingFeedback';
	import { getQuizGateStatus, type QuizGateClientStatus } from '$lib/services/ess/quizGate';
	import SopSayaCard from '$lib/components/ess/SopSayaCard.svelte';
	import MicroQuizCard from '$lib/components/ess/MicroQuizCard.svelte';
	import OfflineSiapCard from '$lib/components/ess/OfflineSiapCard.svelte';
	import { cacheKursusList, getCachedKursusList } from '$lib/utils/offlineTrainingCache';
	import LearningPathCard from '$lib/components/ess/LearningPathCard.svelte';
	import { IconAlertTriangle, IconChevronRight, IconClock, IconLoader2, IconLock, IconMedal, IconPlayerPlay, IconSchool, IconAward, IconCircleCheck, IconCircleDashed, IconProgressCheck } from '@tabler/icons-svelte';

	const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_API_URL;

	let loading = $state(true);
	let errorMsg = $state('');
	let kursus = $state<KursusListItem[]>([]);
	let offlineList = $state(false); // true = daftar berasal dari salinan tersimpan (tanpa sinyal)
	let pilarList = $state<PilarKnowledge[]>([]);
	// Panduan alur belajar (diatur HRD di erp-epi → Panduan Kurikulum); ikut respons daftar kursus, tanpa panggilan tambahan.
	let panduan = $state<string[]>([]);
	// Filter 5 Pilar Knowledge: 'semua' atau kode pilar. Hanya menyaring daftar kursus di bawah;
	// kartu "Lanjutkan Belajar" tetap menampilkan kursus yang sedang berjalan.
	let pilarAktif = $state('semua');
	// Filter Sumber Materi (asal pelatihan: Inventory 360°, SOP, TDS/MSDS, dst.). Menyaring bersama filter pilar.
	let sumberAktif = $state('semua');
	let durasiByProgram = $derived(Object.fromEntries(kursus.map((k) => [k.program.id, k.program.durasi_menit])) as Record<number, number | null>);
	let skills = $state<MySkillRecord[]>([]);
	let silabusList = $state<SilabusProgress[]>([]);
	let silabusLoading = $state(true);
	let timCount = $state(0);
	let pendingFeedbackCount = $state(0);
	let quizGateStatus = $state<QuizGateClientStatus | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		offlineList = false;
		try {
			const res = await getKursusList();
			kursus = res.kursus;
			pilarList = res.pilar ?? [];
			cacheKursusList(res.kursus, res.pilar ?? []); // untuk membuka daftar saat tanpa sinyal
			panduan = res.panduan ?? [];
			if (pilarAktif !== 'semua' && !pilarList.some((p) => p.code === pilarAktif)) pilarAktif = 'semua';
			if (sumberAktif !== 'semua' && !kursus.some((k) => k.sumber?.key === sumberAktif)) sumberAktif = 'semua';
		} catch (err: any) {
			const offline = err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
			const cached = offline ? getCachedKursusList<KursusListItem>() : null;
			if (cached) {
				kursus = cached.kursus;
				pilarList = cached.pilar as PilarKnowledge[];
				offlineList = true;
			} else {
				errorMsg = offline ? 'Tidak ada sinyal dan belum ada daftar tersimpan. Buka halaman ini sekali saat ada sinyal.' : err?.message || 'Gagal memuat daftar kursus.';
			}
		} finally {
			loading = false;
		}
	}

	onMount(load);
	onMount(() => {
		getMySkills()
			.then((res) => (skills = res.skills))
			.catch(() => {});
	});
	onMount(() => {
		getSilabusSaya()
			.then((res) => (silabusList = res.silabusList))
			.catch(() => {})
			.finally(() => (silabusLoading = false));
	});
	onMount(() => {
		getTimSilabus()
			.then((res) => (timCount = res.anggota.length))
			.catch(() => {});
	});
	onMount(() => {
		getMyTrainingFeedback()
			.then((rows) => (pendingFeedbackCount = rows.filter((r) => r.status === 'pending').length))
			.catch(() => {});
	});
	onMount(() => {
		getQuizGateStatus()
			.then((st) => (quizGateStatus = st))
			.catch(() => {});
	});

	function thumbUrl(fileId: string | null): string | null {
		return fileId ? `${DIRECTUS_URL}/assets/${fileId}?width=400&height=225&fit=cover` : null;
	}

	// Hero: kursus sedang berjalan (ada progress, belum lulus) — prioritas wajib, lalu progres tertinggi.
	let sedangBerjalan = $derived(
		kursus
			.filter((k) => k.enrollment && k.enrollment.status !== 'Lulus' && k.enrollment.progress_persen > 0)
			.sort((a, b) => (b.program.wajib ? 1 : 0) - (a.program.wajib ? 1 : 0) || b.enrollment!.progress_persen - a.enrollment!.progress_persen)
	);
	let hero = $derived(sedangBerjalan[0] ?? null);

	let sumberList = $derived.by(() => {
		const m = new Map<string, { key: string; label: string; icon: string; jumlah: number }>();
		for (const k of kursus) {
			if (!k.sumber) continue;
			const cur = m.get(k.sumber.key);
			if (cur) cur.jumlah++;
			else m.set(k.sumber.key, { ...k.sumber, jumlah: 1 });
		}
		return [...m.values()].sort((a, b) => b.jumlah - a.jumlah);
	});
	let kursusTampil = $derived(kursus.filter((k) => (pilarAktif === 'semua' || k.pilar === pilarAktif) && (sumberAktif === 'semua' || k.sumber?.key === sumberAktif)));
	let pilarInfo = $derived(pilarList.find((p) => p.code === pilarAktif) ?? null);

	let wajibDiselesaikan = $derived(kursusTampil.filter((k) => k.program.wajib && k.enrollment?.status !== 'Lulus'));
	let direkomendasikan = $derived(kursusTampil.filter((k) => !k.program.wajib && k.enrollment?.status !== 'Lulus' && k.program.id !== hero?.program.id));
	let selesai = $derived(kursusTampil.filter((k) => k.enrollment?.status === 'Lulus'));

	function formatTenggat(tenggat: string | null) {
		if (!tenggat) return null;
		const d = new Date(tenggat);
		if (Number.isNaN(d.getTime())) return null;
		const now = new Date();
		const hari = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		if (hari < 0) return { label: 'Lewat tenggat', warn: true };
		if (hari === 0) return { label: 'Tenggat hari ini', warn: true };
		return { label: `${hari} hari lagi`, warn: hari <= 3 };
	}

	function modulProgressLabel(k: KursusListItem): string {
		// progress_persen adalah rata-rata status modul (lihat recomputeEnrollmentProgress) — dipakai
		// sebagai estimasi "x dari y modul" karena beranda tidak memuat daftar modul per kursus.
		return `${k.enrollment?.progress_persen ?? 0}%`;
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-8 flex items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Pelatihan / E-Learning</h1>
			<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Belajar mandiri, kuis, & sertifikat dari HP Anda</p>
		</div>
		<div class="flex flex-col gap-2 shrink-0">
			<button
				class="px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap glass-panel hover:opacity-90 transition-opacity"
				title="Kalkulator cat, cek dew point, dan kartu cepat lapangan"
				onclick={() => goto('/ess/pelatihan/buku-saku')}>
				📘 Buku Saku Cat
			</button>
			{#if kursus.some((k) => k.program.kode?.startsWith('KUR-RND-'))}
				<button
					class="px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap glass-panel hover:opacity-90 transition-opacity"
					title="Lihat tahapan sertifikat R&D dan progres Anda"
					onclick={() => goto('/ess/pelatihan/jalur-karier')}>
					🧪 Jalur Karier R&D
				</button>
			{/if}
			<button
				class="px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap glass-panel hover:opacity-90 transition-opacity"
				title="Semua sertifikat Anda + kode QR untuk ditunjukkan ke klien (tetap bisa dibuka offline)"
				onclick={() => goto('/ess/pelatihan/sertifikat')}>
				🎓 Sertifikat Saya
			</button>
			<button
				class="px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap glass-panel hover:opacity-90 transition-opacity"
				onclick={() => goto('/ess/pelatihan/sop')}>
				📄 SOP Perusahaan
			</button>
			{#if timCount > 0}
				<button
					class="px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap glass-panel hover:opacity-90 transition-opacity"
					onclick={() => goto('/ess/pelatihan/tim')}>
					👥 Progress Tim ({timCount})
				</button>
				<button
					class="px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap glass-panel hover:opacity-90 transition-opacity"
					title="Nilai praktik bawahan langsung di lapangan"
					onclick={() => goto('/ess/pelatihan/ojt')}>
					🛠️ Penilaian OJT
				</button>
			{/if}
			{#if pendingFeedbackCount > 0}
				<button
					class="px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap text-white hover:opacity-90 transition-opacity"
					style="background: #DC2626"
					onclick={() => goto('/ess/pelatihan/feedback')}>
					🔁 Feedback Training ({pendingFeedbackCount})
				</button>
			{/if}
		</div>
	</div>

	{#if !offlineList}<MicroQuizCard />{/if}
	{#if !loading}<OfflineSiapCard {kursus} offline={offlineList} />{/if}
	{#if panduan.length > 0}
		<details class="glass-panel rounded-2xl px-4 py-3 mb-6 group">
			<summary class="cursor-pointer text-sm font-bold flex items-center gap-2 list-none" style="color: var(--sys-label)">
				<span>🧭</span> Cara Kerja Kurikulum, Kuis & Sertifikat
				<span class="ml-auto text-[11px] font-semibold" style="color: var(--sys-label4)">ketuk untuk buka</span>
			</summary>
			<ol class="list-decimal pl-5 mt-3 space-y-1.5 text-xs font-medium" style="color: var(--sys-label2)">
				{#each panduan as langkah}<li>{langkah}</li>{/each}
			</ol>
		</details>
	{/if}
	<SopSayaCard variant="training" />

	{#if !silabusLoading && silabusList.some((s) => s.level || s.prerequisiteId)}
		<LearningPathCard silabus={silabusList} durasi={durasiByProgram} />
	{/if}

	{#if !silabusLoading && silabusList.length > 0}
		<div class="mb-8">
			<h2 class="text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style="color: var(--sys-label3)">
				<IconProgressCheck size={16} /> Silabus Jabatan Saya
			</h2>
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
				{#each silabusList as s (s.id)}
					<div class="glass-panel rounded-2xl p-5 flex flex-col gap-3">
						<div class="flex items-start justify-between gap-2">
							<div>
								<h3 class="text-sm font-bold" style="color: var(--sys-label)">{s.namaSilabus}</h3>
								<div class="flex items-center gap-1.5 flex-wrap mt-1">
									{#if s.isWajib}
										<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background: var(--rel); color: var(--red)">Wajib</span>
									{/if}
									{#if s.kategori}
										<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{s.kategori}</span>
									{/if}
									{#if s.target?.targetHari}
										<span class="text-[11px] font-semibold flex items-center gap-1" style="color: var(--sys-label4)">
											<IconClock size={11} /> Target {s.target.targetHari} hari
										</span>
									{/if}
								</div>
							</div>
							{#if s.selesai}
								<span class="text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 shrink-0" style="background: var(--rel); color: var(--g)">
									<IconCircleCheck size={13} /> Selesai
								</span>
							{/if}
						</div>

						<div class="flex items-center gap-2">
							<div class="flex-1 h-2 rounded-full bg-white/40 overflow-hidden">
								<div class="h-full rounded-full gradient-bg" style="width: {s.progressPersen}%"></div>
							</div>
							<span class="text-xs font-bold shrink-0" style="color: var(--sys-label3)">{s.wajibSelesai}/{s.totalWajib}</span>
						</div>

						<div class="flex flex-col gap-1.5">
							{#each s.materi as m (m.id)}
								<button
									class="flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded-lg transition-colors {m.locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/40'}"
									disabled={m.locked}
									onclick={() => !m.locked && goto(`/ess/pelatihan/${m.programId}`)}
									title={m.locked ? `Selesaikan dulu: ${m.prerequisiteProgramJudul}` : ''}
								>
									<span class="flex items-center gap-2 text-xs font-medium min-w-0" style="color: var(--sys-label2)">
										{#if m.locked}
											<IconLock size={15} style="color: var(--sys-label4)" class="shrink-0" />
										{:else if m.status === 'Lulus'}
											<IconCircleCheck size={15} style="color: var(--g)" class="shrink-0" />
										{:else if m.status === 'Ongoing' || m.status === 'Enrolled'}
											<IconProgressCheck size={15} style="color: var(--p, var(--g))" class="shrink-0" />
										{:else}
											<IconCircleDashed size={15} style="color: var(--sys-label4)" class="shrink-0" />
										{/if}
										<span class="truncate">{m.programJudul}</span>
										{#if !m.isWajib}
											<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">Opsional</span>
										{/if}
									</span>
									{#if m.locked}
										<span class="text-[10px] font-semibold shrink-0" style="color: var(--sys-label4)">Terkunci</span>
									{:else if m.status !== 'Belum Terdaftar' && m.status !== 'Lulus'}
										<span class="text-[11px] font-bold shrink-0" style="color: var(--sys-label4)">{m.progressPersen}%</span>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ==================== WIDGET TIMELINE: AGENDA KUIS & BELAJAR MINGGU INI ==================== -->
	{#if quizGateStatus && (quizGateStatus.items.some((it) => it.state === 'pending' || it.state === 'remedial') || (quizGateStatus.upcoming && quizGateStatus.upcoming.length > 0))}
		<div class="glass-panel rounded-2xl p-4 md:p-5 mb-6 border border-indigo-200/60 dark:border-indigo-900/40">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<span class="text-lg">🗓️</span>
					<div>
						<h3 class="text-sm font-extrabold" style="color: var(--sys-label)">Agenda Kuis & Belajar Minggu Ini</h3>
						<p class="text-[11px]" style="color: var(--sys-label3)">Jadwal ujian periodik, materi persiapan, dan gate wajib kepatuhan</p>
					</div>
				</div>
				{#if quizGateStatus.pendingCount > 0}
					<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 shrink-0">
						{quizGateStatus.pendingCount} Perlu Dikerjakan
					</span>
				{/if}
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
				<!-- Kuis Aktif yang Harus Dikerjakan -->
				{#each quizGateStatus.items.filter((it) => it.state === 'pending' || it.state === 'remedial') as it}
					<div class="p-3 rounded-xl border border-indigo-100 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 flex flex-col justify-between gap-2 shadow-2xs">
						<div>
							<div class="flex items-center justify-between gap-1 mb-1">
								<span class="px-1.5 py-0.2 rounded text-[9px] font-bold {it.state === 'remedial' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}">
									{it.state === 'remedial' ? '⚠️ Perlu Remedial' : '⏱️ Periode Aktif'}
								</span>
								{#if it.durasiMenit}
									<span class="text-[10px] text-slate-400 font-medium">{it.durasiMenit} menit</span>
								{/if}
							</div>
							<h4 class="text-xs font-bold line-clamp-2" style="color: var(--sys-label)">{it.judul}</h4>
							{#if it.tanggalSelesai}
								<p class="text-[10px] text-rose-600 mt-1 flex items-center gap-1 font-semibold">
									<span>⏳</span> Batas Waktu: {new Date(it.tanggalSelesai).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
								</p>
							{/if}
						</div>
						<button
							class="w-full py-1.5 px-3 rounded-lg text-xs font-bold text-white gradient-bg hover:opacity-90 transition flex items-center justify-center gap-1 shadow-xs"
							onclick={() => goto(`/ess/pelatihan/${it.programId}`)}
						>
							<span>Kerjakan Kuis</span>
							<span>→</span>
						</button>
					</div>
				{/each}

				<!-- Kuis Akan Datang (H-N Persiapan Belajar) -->
				{#each (quizGateStatus.upcoming || []) as up}
					<div class="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col justify-between gap-2">
						<div>
							<div class="flex items-center justify-between gap-1 mb-1">
								<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-100 text-sky-700">
									📢 Persiapan H-{up.hariLagi}
								</span>
								<span class="text-[10px] text-slate-400 font-medium">Buka {new Date(up.tanggalMulai).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
							</div>
							<h4 class="text-xs font-bold line-clamp-2" style="color: var(--sys-label)">{up.judul}</h4>
							<p class="text-[10px] text-slate-500 mt-1">Pelajari modul silabus sebelum kuis dibuka</p>
						</div>
						<button
							class="w-full py-1.5 px-3 rounded-lg text-xs font-bold text-slate-700 bg-white dark:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 transition flex items-center justify-center gap-1"
							onclick={() => goto(`/ess/pelatihan/${up.programId}`)}
						>
							<span>Pelajari Materi</span>
							<span>📖</span>
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat daftar kursus pelatihan..." />
		</div>
	{:else if errorMsg}
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
	{:else if kursus.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<IconSchool size={32} class="mx-auto mb-3" style="color: var(--sys-label4)" />
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada kursus tersedia untuk Anda.</p>
		</div>
	{:else}
		{#if hero}
			{@const t = thumbUrl(hero.program.thumbnail)}
			{@const tenggatInfo = formatTenggat(hero.enrollment?.tenggat ?? null)}
			<button
				class="w-full glass-panel rounded-3xl mb-8 overflow-hidden text-left hover-lift flex flex-col md:flex-row"
				onclick={() => goto(`/ess/pelatihan/${hero.program.id}`)}
			>
				<div class="md:w-72 aspect-video shrink-0 bg-slate-100 flex items-center justify-center overflow-hidden">
					{#if t}
						<img src={t} alt={hero.program.judul} class="w-full h-full object-cover" />
					{:else}
						<IconPlayerPlay size={40} style="color: var(--sys-label4)" />
					{/if}
				</div>
				<div class="p-5 md:p-6 flex-1 flex flex-col justify-center gap-3">
					<span class="text-xs font-bold uppercase tracking-wider" style="color: var(--p, var(--g))">Lanjutkan Belajar</span>
					<h2 class="text-lg md:text-xl font-extrabold" style="color: var(--sys-label)">{hero.program.judul}</h2>
					<div class="flex items-center gap-2">
						<div class="flex-1 max-w-xs h-2 rounded-full bg-white/40 overflow-hidden">
							<div class="h-full rounded-full gradient-bg" style="width: {hero.enrollment?.progress_persen ?? 0}%"></div>
						</div>
						<span class="text-xs font-bold shrink-0" style="color: var(--sys-label3)">{modulProgressLabel(hero)}</span>
					</div>
					{#if tenggatInfo}
						<span
							class="text-xs font-semibold flex items-center gap-1 w-fit px-2.5 py-1 rounded-lg"
							style={tenggatInfo.warn ? 'background: var(--rel); color: var(--red)' : 'color: var(--sys-label4)'}
						>
							<IconClock size={12} /> {tenggatInfo.label}
						</span>
					{/if}
					<span class="text-sm font-bold px-4 py-2 rounded-xl w-fit gradient-bg text-white mt-1">Lanjutkan</span>
				</div>
			</button>
		{/if}

		{#if sumberList.length > 1}
			<!-- Filter Sumber Materi -->
			<div class="mb-4">
				<div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Filter sumber materi">
					<button class="shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-opacity {sumberAktif === 'semua' ? 'gradient-bg text-white' : 'glass-panel hover:opacity-90'}" aria-pressed={sumberAktif === 'semua'} onclick={() => (sumberAktif = 'semua')}>Semua sumber</button>
					{#each sumberList as s (s.key)}
						<button class="shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-opacity {sumberAktif === s.key ? 'gradient-bg text-white' : 'glass-panel hover:opacity-90'}" aria-pressed={sumberAktif === s.key} onclick={() => (sumberAktif = s.key)}>{s.icon} {s.label} ({s.jumlah})</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if pilarList.length > 1}
			<!-- Filter 5 Pilar Knowledge -->
			<div class="mb-6">
				<div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Filter pilar pelatihan">
					<button
						class="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-opacity {pilarAktif === 'semua' ? 'gradient-bg text-white' : 'glass-panel hover:opacity-90'}"
						aria-pressed={pilarAktif === 'semua'}
						onclick={() => (pilarAktif = 'semua')}>
						Semua ({kursus.length})
					</button>
					{#each pilarList as p (p.code)}
						<button
							class="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-opacity {pilarAktif === p.code ? 'gradient-bg text-white' : 'glass-panel hover:opacity-90'}"
							aria-pressed={pilarAktif === p.code}
							title={p.hint}
							onclick={() => (pilarAktif = p.code)}>
							{p.icon} {p.short} ({p.jumlah})
						</button>
					{/each}
				</div>
				<p class="text-xs font-medium mt-2" style="color: var(--sys-label4)">
					{#if pilarInfo}
						<b>{pilarInfo.label}</b> — {pilarInfo.hint}
					{:else}
						Ketuk salah satu pilar untuk menyaring kursus berdasarkan bidang pengetahuan.
					{/if}
				</p>
			</div>
		{/if}

		{#snippet kursusRow(items: KursusListItem[], judul: string, kosongMsg: string)}
			<div class="mb-8">
				<h2 class="text-sm font-bold uppercase tracking-wider mb-3" style="color: var(--sys-label3)">{judul} ({items.length})</h2>
				{#if items.length === 0}
					<p class="text-sm font-medium py-4" style="color: var(--sys-label4)">{kosongMsg}</p>
				{:else}
					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
						{#each items as k (k.program.id)}
							{@const t = thumbUrl(k.program.thumbnail)}
							{@const tenggatInfo = formatTenggat(k.enrollment?.tenggat ?? null)}
							<button class="hover-lift glass-panel rounded-2xl overflow-hidden text-left flex flex-col" onclick={() => goto(`/ess/pelatihan/${k.program.id}`)}>
								<div class="aspect-video bg-slate-100 flex items-center justify-center overflow-hidden">
									{#if t}
										<img src={t} alt={k.program.judul} class="w-full h-full object-cover" />
									{:else}
										<IconSchool size={28} style="color: var(--sys-label4)" />
									{/if}
								</div>
								<div class="p-4 flex flex-col gap-2 flex-1">
									<div class="flex items-start justify-between gap-2">
										<h3 class="text-sm font-bold" style="color: var(--sys-label)">{k.program.judul}</h3>
										<IconChevronRight size={18} class="shrink-0 mt-0.5" style="color: var(--sys-label4)" />
									</div>
									<div class="flex items-center gap-2 flex-wrap">
										{#if k.program.is_onboarding || k.program.kategori === 'Compliance & Etika'}
											<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">⚖️ Kepatuhan & Etika</span>
										{:else if k.program.kategori}
											<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{k.program.kategori}</span>
										{/if}
										{#if k.sumber && k.sumber.key !== 'manual_hrd'}
											<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200" title="Asal materi">{k.sumber.icon} {k.sumber.label}</span>
										{/if}
										{#if k.program.wajib}
											<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background: var(--rel); color: var(--red)">Wajib</span>
										{/if}
										{#if k.program.durasi_menit}
											<span class="text-[11px] font-semibold flex items-center gap-1" style="color: var(--sys-label4)">
												<IconClock size={11} /> {k.program.durasi_menit} mnt
											</span>
										{/if}
									</div>

									{#if k.enrollment}
										<div class="flex items-center gap-2 mt-1">
											<div class="flex-1 h-2 rounded-full bg-white/40 overflow-hidden">
												<div class="h-full rounded-full gradient-bg" style="width: {k.enrollment.progress_persen}%"></div>
											</div>
											<span class="text-xs font-bold shrink-0" style="color: var(--sys-label3)">{k.enrollment.progress_persen}%</span>
										</div>
										{#if tenggatInfo}
											<span
												class="text-xs font-semibold flex items-center gap-1 w-fit px-2 py-1 rounded-lg"
												style={tenggatInfo.warn ? 'background: var(--rel); color: var(--red)' : 'color: var(--sys-label4)'}
											>
												<IconClock size={12} /> {tenggatInfo.label}
											</span>
										{/if}
									{:else if !k.bisaSelfEnroll}
										<span class="text-xs font-semibold flex items-center gap-1 mt-1" style="color: var(--sys-label4)">
											<IconLock size={12} /> Menunggu penugasan
										</span>
									{:else}
										<span class="text-xs font-bold px-3 py-1.5 rounded-xl w-fit gradient-bg text-white mt-1">Daftar Mandiri</span>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/snippet}

		{@render kursusRow(wajibDiselesaikan, 'Wajib Diselesaikan', 'Tidak ada kursus wajib tersisa.')}
		{@render kursusRow(direkomendasikan, 'Direkomendasikan untuk Anda', 'Belum ada kursus opsional tersedia.')}
		{@render kursusRow(selesai, 'Selesai', 'Belum ada kursus yang diselesaikan.')}

		{#if selesai.length > 0}
			<p class="text-xs font-medium -mt-4 mb-8" style="color: var(--sys-label4)">
				<IconAward size={12} class="inline -mt-0.5" /> Buka detail kursus untuk unduh sertifikat.
			</p>
		{/if}

		{#if skills.length > 0}
			<div class="glass-panel rounded-2xl p-5">
				<h2 class="text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style="color: var(--sys-label3)">
					<IconMedal size={16} /> Skill Saya dari Pelatihan
				</h2>
				<div class="flex flex-wrap gap-2">
					{#each skills as s (s.id)}
						<span class="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-700">{s.skill_nama} · {s.level}</span>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>
