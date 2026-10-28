<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getMyOnboardingStatus, submitTaskEvidence, rateMentor, type OnboardingStatus, type OnboardingTaskRecord } from '$lib/services/ess/onboarding';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconCircleCheck, IconClock, IconUpload, IconPaperclip, IconStar, IconStarFilled } from '@tabler/icons-svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	let ratingSkor = $state(0);
	let ratingCatatan = $state('');
	let submittingRating = $state(false);

	async function handleRateMentor() {
		if (!data?.kasus || ratingSkor < 1) return;
		submittingRating = true;
		try {
			await rateMentor(data.kasus.id, ratingSkor, ratingCatatan);
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim penilaian.';
		} finally {
			submittingRating = false;
		}
	}

	let loading = $state(true);
	let errorMsg = $state('');
	let data = $state<OnboardingStatus | null>(null);

	let activeTaskId = $state<number | null>(null);
	let selectedFile = $state<File | null>(null);
	let catatan = $state('');
	let submitting = $state(false);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			data = await getMyOnboardingStatus();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data onboarding.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function openSubmitForm(taskId: number) {
		activeTaskId = activeTaskId === taskId ? null : taskId;
		selectedFile = null;
		catatan = '';
	}

	function onFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		selectedFile = target.files?.[0] || null;
	}

	async function handleSubmitTask() {
		if (!data?.kasus || !activeTaskId) return;
		submitting = true;
		try {
			const compressedFile = selectedFile && selectedFile.type.startsWith('image/') ? await compressPhoto(selectedFile) : selectedFile;
			await submitTaskEvidence(data.kasus.id, activeTaskId, compressedFile, catatan);
			activeTaskId = null;
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal submit.';
		} finally {
			submitting = false;
		}
	}

	function groupByKategori(tasks: OnboardingTaskRecord[]) {
		const groups = new Map<string, OnboardingTaskRecord[]>();
		for (const t of tasks) {
			const key = t.kategori || 'Lainnya';
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(t);
		}
		return [...groups.entries()];
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold mb-1" style="color: var(--sys-label)">Onboarding Saya</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Checklist adaptasi karyawan baru — upload dokumen pendukung per task</p>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat proses onboarding..." />
		</div>
	{:else if errorMsg}
		<div class="rounded-lg p-4" style="background: var(--rel)">
			<p class="text-[12px] flex items-center gap-1.5" style="color: #DC2626"><IconAlertTriangle size={14} /> {errorMsg}</p>
			<button class="mt-2 text-[11px] font-semibold underline" style="color: #DC2626" onclick={load}>Coba lagi</button>
		</div>
	{:else if !data?.kasus}
		<div class="glass-panel rounded-2xl p-6 text-center">
			<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada proses onboarding untuk Anda saat ini.</p>
		</div>
	{:else}
		<div class="glass-panel rounded-2xl p-5 mb-4">
			<div class="flex items-center justify-between mb-2">
				<p class="text-[13px] font-bold" style="color: var(--sys-label)">{data.kasus.jenis}</p>
				<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">{data.kasus.status}</span>
			</div>
			<div class="w-full h-2 rounded-full bg-gray-100 overflow-hidden mb-1">
				<div class="h-full bg-blue-500 rounded-full" style="width: {data.kasus.progress}%"></div>
			</div>
			<p class="text-[10px]" style="color: var(--sys-label4)">Progress {data.kasus.progress}%</p>
		</div>

		{#if data.kasus.mentor_id}
			<div class="glass-panel rounded-2xl p-5 mb-4">
				<p class="text-[13px] font-bold mb-1" style="color: var(--sys-label)">Mentor Anda: {data.kasus.mentor_nama}</p>
				{#if data.kasus.mentor_dinilai_pada}
					<p class="text-[11px] flex items-center gap-1" style="color: var(--sys-label3)">
						<IconCircleCheck size={14} class="text-green-600" /> Terima kasih, Anda sudah menilai mentor ({data.kasus.skor_mentor}/5).
					</p>
				{:else}
					<p class="text-[11px] mb-3" style="color: var(--sys-label3)">Bagaimana pengalaman Anda dibimbing mentor ini?</p>
					<div class="flex gap-1 mb-3">
						{#each [1, 2, 3, 4, 5] as bintang}
							<button onclick={() => (ratingSkor = bintang)} aria-label={`Beri skor ${bintang}`}>
								{#if bintang <= ratingSkor}
									<IconStarFilled size={22} style="color: #f59e0b" />
								{:else}
									<IconStar size={22} style="color: var(--sys-label4)" />
								{/if}
							</button>
						{/each}
					</div>
					<textarea
						bind:value={ratingCatatan}
						placeholder="Catatan (opsional)"
						class="w-full text-[11px] p-2 rounded-lg border border-gray-200 resize-none mb-2"
						rows="2"
					></textarea>
					<button
						class="px-4 py-2 rounded-xl text-[12px] font-bold text-white gradient-bg disabled:opacity-50"
						disabled={submittingRating || ratingSkor < 1}
						onclick={handleRateMentor}
					>
						{submittingRating ? 'Mengirim...' : 'Kirim Penilaian'}
					</button>
				{/if}
			</div>
		{/if}

		{#each groupByKategori(data.tasks) as [kategori, tasks]}
			<h3 class="text-[11px] font-bold uppercase tracking-wider mt-4 mb-2 px-1" style="color: var(--sys-label3)">{kategori}</h3>
			<div class="flex flex-col gap-2">
				{#each tasks as task}
					<div class="glass-panel rounded-2xl p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="flex-1">
								<p class="text-[12px] font-semibold" style="color: var(--sys-label)">{task.nama_task}</p>
								{#if task.pic_department}
									<p class="text-[10px] mt-0.5" style="color: var(--sys-label4)">PIC: {task.pic_department}</p>
								{/if}
							</div>
							{#if task.completed}
								<span class="flex items-center gap-1 text-[10px] font-bold text-green-600 shrink-0">
									<IconCircleCheck size={14} /> Selesai
								</span>
							{:else if task.submitted_by_karyawan}
								<span class="flex items-center gap-1 text-[10px] font-bold text-amber-600 shrink-0">
									<IconClock size={14} /> Menunggu Verifikasi
								</span>
							{:else}
								<span class="text-[10px] font-bold text-gray-400 shrink-0">Pending</span>
							{/if}
						</div>

						{#if task.lampiran}
							<p class="text-[10px] mt-2 flex items-center gap-1" style="color: var(--sys-label4)">
								<IconPaperclip size={12} /> Lampiran sudah diunggah
							</p>
						{/if}

						{#if !task.completed}
							<button
								class="mt-3 text-[11px] font-semibold flex items-center gap-1.5"
								style="color: var(--p, #2563EB)"
								onclick={() => openSubmitForm(task.id)}
							>
								<IconUpload size={13} /> {task.submitted_by_karyawan ? 'Update Bukti' : 'Upload Bukti / Konfirmasi Selesai'}
							</button>

							{#if activeTaskId === task.id}
								<div class="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-2">
									<input type="file" onchange={onFileChange} class="text-[11px]" />
									<textarea
										bind:value={catatan}
										placeholder="Catatan (opsional)"
										class="text-[11px] p-2 rounded-lg border border-gray-200 resize-none"
										rows="2"
									></textarea>
									<button
										class="px-4 py-2 rounded-xl text-[12px] font-bold text-white gradient-bg disabled:opacity-50"
										disabled={submitting}
										onclick={handleSubmitTask}
									>
										{submitting ? 'Mengirim...' : 'Kirim'}
									</button>
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	{/if}
</div>
