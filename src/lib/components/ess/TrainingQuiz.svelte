<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Kuis modul/akhir — consume training_quiz existing, grading selalu di server (F3 Roadmap E-Learning).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getQuiz, submitQuizAttempt, type QuizDetail } from '$lib/services/ess/training';
	import { IconAlertTriangle, IconCircleCheck, IconFileText, IconLoader2, IconXboxX } from '@tabler/icons-svelte';

	let { quizId, onLulus }: { quizId: number; onLulus: () => void } = $props();

	let loading = $state(true);
	let errorMsg = $state('');
	let detail = $state<QuizDetail | null>(null);
	let jawaban = $state<Record<number, string>>({});
	let submitting = $state(false);
	let displayQuestions = $state<QuizDetail['questions']>([]);

	function shuffle<T>(arr: T[]): T[] {
		const copy = [...arr];
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[copy[i], copy[j]] = [copy[j], copy[i]];
		}
		return copy;
	}
	let hasilTerbaru = $derived(detail?.attempts?.[0] ?? null);
	let batasTercapai = $derived(!!detail && detail.attempts.length >= detail.maxAttempts && !hasilTerbaru?.lulus);
	let tampilkanJawaban = $derived(
		!!detail &&
			!!hasilTerbaru &&
			(detail.showAnswersAfter === 'immediately' || (detail.showAnswersAfter === 'after_pass' && hasilTerbaru.lulus))
	);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			detail = await getQuiz(quizId);
			displayQuestions = detail.quiz.acak_soal ? shuffle(detail.questions) : detail.questions;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat kuis.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function submit() {
		if (!detail) return;
		const belumDijawab = detail.questions.filter((q) => !jawaban[q.id]?.trim());
		if (belumDijawab.length > 0) {
			errorMsg = 'Semua pertanyaan wajib dijawab.';
			return;
		}
		submitting = true;
		errorMsg = '';
		try {
			const payload = detail.questions.map((q) => ({ question_id: q.id, jawaban: jawaban[q.id] }));
			await submitQuizAttempt(quizId, payload);
			await load();
			jawaban = {};
			if (detail && hasilTerbaru?.lulus) onLulus();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim jawaban.';
		} finally {
			submitting = false;
		}
	}
</script>

{#if loading}
	<CircularProgressGauge size={50} strokeWidth={4} label="Memuat kuis pelatihan..." />
{:else if errorMsg && !detail}
	<div class="glass-panel rounded-2xl p-6 text-center">
		<IconAlertTriangle size={28} class="mx-auto mb-2" style="color: #DC2626" />
		<p class="text-sm font-semibold text-red-500">{errorMsg}</p>
	</div>
{:else if detail}
	<div class="glass-panel rounded-2xl p-5">
		<h3 class="text-lg font-bold mb-1" style="color: var(--sys-label)">{detail.quiz.judul}</h3>
		<p class="text-xs font-medium mb-4" style="color: var(--sys-label4)">Nilai minimal lulus: {detail.quiz.passing_score ?? 70}</p>

		{#if hasilTerbaru}
			<div
				class="mb-5 p-4 rounded-xl flex items-center gap-3"
				style="background: {hasilTerbaru.lulus ? 'var(--gg)' : 'var(--rel)'}; color: {hasilTerbaru.lulus ? 'var(--ggd)' : 'var(--red)'}"
			>
				{#if hasilTerbaru.lulus}
					<IconCircleCheck size={22} />
				{:else}
					<IconXboxX size={22} />
				{/if}
				<div>
					<p class="text-sm font-bold">{hasilTerbaru.lulus ? 'Lulus' : 'Belum Lulus'} — Skor {hasilTerbaru.skor}</p>
					<p class="text-xs font-medium opacity-80">Percobaan ke-{detail.attempts.length} dari {detail.maxAttempts}</p>
				</div>
			</div>
		{/if}

		{#if detail.attempts.length > 1}
			<div class="mb-5">
				<p class="text-xs font-bold mb-2" style="color: var(--sys-label3)">Riwayat Percobaan</p>
				<div class="flex flex-wrap gap-2">
					{#each [...detail.attempts].reverse() as a, idx}
						<span
							class="px-3 py-1.5 rounded-full text-xs font-bold"
							style="background: {a.lulus ? 'var(--gg)' : 'var(--rel)'}; color: {a.lulus ? 'var(--ggd)' : 'var(--red)'}">
							#{idx + 1}: {a.skor ?? '-'}
						</span>
					{/each}
				</div>
			</div>
		{/if}

		{#if tampilkanJawaban && hasilTerbaru}
			<div class="mb-5 space-y-2">
				<p class="text-xs font-bold" style="color: var(--sys-label3)">Umpan Balik Jawaban</p>
				{#each detail.questions as q, i (q.id)}
					{@const jd = hasilTerbaru.jawaban.find((j) => j.question_id === q.id)}
					{#if jd && jd.benar !== null}
						<div class="p-3 rounded-xl text-sm" style="background: {jd.benar ? 'var(--gg)' : 'var(--rel)'}">
							<p class="font-semibold" style="color: var(--sys-label)">{i + 1}. {q.pertanyaan}</p>
							<p class="text-xs mt-1" style="color: {jd.benar ? 'var(--ggd)' : 'var(--red)'}">
								Jawaban Anda: {jd.jawaban} {jd.benar ? '✓ Benar' : '✗ Salah'}
							</p>
						</div>
					{/if}
				{/each}
			</div>
		{/if}

		{#if hasilTerbaru && !hasilTerbaru.lulus && detail.sopTerkait}
			<button
				class="w-full mb-5 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold glass-panel hover:opacity-90 transition-opacity"
				onclick={() => goto(`/ess/pelatihan/sop/${detail?.sopTerkait?.id}`)}>
				<IconFileText size={18} /> Baca ulang SOP: {detail.sopTerkait.title}
			</button>
		{/if}

		{#if detail.sudahLulus && !hasilTerbaru?.lulus}
			<div class="p-4 rounded-xl text-sm font-semibold" style="background: var(--gg); color: var(--ggd)">
				Anda sudah dinyatakan Lulus di kursus ini. Kuis akhir tidak perlu dikerjakan ulang — nilai dan sertifikat Anda tetap berlaku.
			</div>
		{:else if batasTercapai}
			<div class="p-4 rounded-xl text-sm font-semibold" style="background: var(--rel); color: var(--red)">
				Batas {detail.maxAttempts} percobaan untuk kuis ini sudah tercapai. Hubungi HRD untuk mengulang.
			</div>
		{:else if !hasilTerbaru?.lulus}
			<div class="flex flex-col gap-5">
				{#each displayQuestions as q, i (q.id)}
					<div>
						<p class="text-sm font-bold mb-2" style="color: var(--sys-label)">{i + 1}. {q.pertanyaan}</p>
						{#if q.tipe === 'pilihan_ganda' && q.opsi}
							<div class="flex flex-col gap-2">
								{#each q.opsi as opsi}
									<label class="flex items-center gap-2 p-3 rounded-xl bg-white/40 cursor-pointer hover:bg-white/60 transition-colors">
										<input type="radio" name={`q-${q.id}`} value={opsi} bind:group={jawaban[q.id]} />
										<span class="text-sm" style="color: var(--sys-label)">{opsi}</span>
									</label>
								{/each}
							</div>
						{:else if q.tipe === 'benar_salah'}
							<div class="flex gap-3">
								{#each ['Benar', 'Salah'] as opsi}
									<label class="flex items-center gap-2 p-3 rounded-xl bg-white/40 cursor-pointer hover:bg-white/60 transition-colors flex-1 justify-center">
										<input type="radio" name={`q-${q.id}`} value={opsi} bind:group={jawaban[q.id]} />
										<span class="text-sm font-medium" style="color: var(--sys-label)">{opsi}</span>
									</label>
								{/each}
							</div>
						{:else}
							<textarea
								class="w-full p-3 rounded-xl bg-white/40 text-sm"
								rows="3"
								bind:value={jawaban[q.id]}
								placeholder="Tulis jawaban Anda..."
							></textarea>
						{/if}
					</div>
				{/each}

				{#if errorMsg}
					<p class="text-sm font-semibold text-red-500">{errorMsg}</p>
				{/if}

				<button
					class="px-5 py-3 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg disabled:opacity-50"
					onclick={submit}
					disabled={submitting}
				>
					{submitting ? 'Mengirim...' : 'Kirim Jawaban'}
				</button>
			</div>
		{/if}
	</div>
{/if}
