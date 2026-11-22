<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Kuis modul/akhir — consume training_quiz existing, grading selalu di server (F3 Roadmap E-Learning).
	// Penajaman Anti-Searching: Stepper 1-Soal, Dual Timer (Total + Per-Soal Countdown), Acak Opsi, Copy-Lock, & Tab-Switch Guard.
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { getQuiz, submitQuizAttempt, type QuizDetail } from '$lib/services/ess/training';
	import { requestQuizGateRefresh } from '$lib/services/ess/quizGate';
	import {
		IconAlertTriangle,
		IconCircleCheck,
		IconFileText,
		IconLoader2,
		IconXboxX,
		IconClock,
		IconArrowRight,
		IconChevronRight,
		IconChevronLeft,
		IconShieldCheck
	} from '@tabler/icons-svelte';

	let { quizId, onLulus }: { quizId: number; onLulus: () => void } = $props();

	let loading = $state(true);
	let errorMsg = $state('');
	let detail = $state<QuizDetail | null>(null);
	let jawaban = $state<Record<number, string>>({});
	let submitting = $state(false);
	let displayQuestions = $state<QuizDetail['questions']>([]);
	let currentQuestionIdx = $state(0);

	// Timers & Anti-Cheat State
	let totalTimeLeftSeconds = $state<number | null>(null);
	let questionTimeLeftSeconds = $state<number | null>(null);
	let timerInterval = $state<any>(null);
	let quizStartedAt = $state<number>(0);
	let tabSwitchCount = $state<number>(0);
	let tabWarningVisible = $state<boolean>(false);

	// Flashcard persiapan 1 menit: tampil sebelum soal bila admin mengisi ringkasan; bisa dilewati.
	let kartuIdx = $state(0);
	let mulaiKuis = $state(false);
	let adaKartu = $derived((detail?.ringkasanPoin?.length ?? 0) > 0);

	// Auto-save jawaban di HP (sinyal lapangan sering putus): draf per kuis+periode+percobaan, dihapus saat terkirim.
	function draftKey(d: QuizDetail | null): string | null {
		return d ? `quizdraft:${quizId}:${d.periodik?.periodeKe ?? 0}:${d.attempts.length}` : null;
	}
	function restoreDraft() {
		try {
			const k = draftKey(detail);
			const raw = k ? localStorage.getItem(k) : null;
			if (raw) jawaban = { ...JSON.parse(raw) };
		} catch {
			/* penyimpanan lokal tidak tersedia: abaikan */
		}
	}
	$effect(() => {
		const snapshot = JSON.stringify(jawaban);
		const k = draftKey(detail);
		if (!k || snapshot === '{}') return;
		try {
			localStorage.setItem(k, snapshot);
		} catch {
			/* abaikan */
		}
	});

	function shuffle<T>(arr: T[]): T[] {
		const copy = [...arr];
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[copy[i], copy[j]] = [copy[j], copy[i]];
		}
		return copy;
	}

	let totalQuestions = $derived(displayQuestions.length);
	let currentQ = $derived(displayQuestions[currentQuestionIdx] ?? null);
	let isLastQuestion = $derived(currentQuestionIdx === totalQuestions - 1);
	let isSequential = $derived(detail?.quiz.mode_navigasi !== 'bebas');
	let perQuestionBudget = $derived(Number(detail?.quiz.durasi_per_soal_detik) || 0);
	let hasPerQuestionTimer = $derived(perQuestionBudget > 0);
	let hasilTerbaru = $derived(detail?.attempts?.[0] ?? null);
	let batasTercapai = $derived(!!detail && detail.attempts.length >= detail.maxAttempts && !hasilTerbaru?.lulus);
	let tampilkanJawaban = $derived(
		!!detail &&
			!!hasilTerbaru &&
			(detail.showAnswersAfter === 'immediately' || (detail.showAnswersAfter === 'after_pass' && hasilTerbaru.lulus))
	);

	function formatTimer(sec: number): string {
		const m = Math.floor(sec / 60);
		const s = sec % 60;
		return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	}

	function startQuizExecution() {
		mulaiKuis = true;
		quizStartedAt = Date.now();
		tabSwitchCount = 0;

		if (detail?.quiz.durasi_menit && Number(detail.quiz.durasi_menit) > 0) {
			totalTimeLeftSeconds = Number(detail.quiz.durasi_menit) * 60;
		}
		if (hasPerQuestionTimer) {
			questionTimeLeftSeconds = perQuestionBudget;
		}

		startTimerTicker();
	}

	function startTimerTicker() {
		if (timerInterval) clearInterval(timerInterval);
		timerInterval = setInterval(() => {
			// Hitung mundur durasi total
			if (totalTimeLeftSeconds !== null) {
				if (totalTimeLeftSeconds <= 1) {
					totalTimeLeftSeconds = 0;
					clearInterval(timerInterval);
					timerInterval = null;
					submit(true);
					return;
				} else {
					totalTimeLeftSeconds -= 1;
				}
			}

			// Hitung mundur durasi per soal
			if (hasPerQuestionTimer && questionTimeLeftSeconds !== null) {
				if (questionTimeLeftSeconds <= 1) {
					questionTimeLeftSeconds = 0;
					handleQuestionTimeout();
				} else {
					questionTimeLeftSeconds -= 1;
					// Getar haptik pada 10s dan 3s bila didukung perangkat HP
					if ((questionTimeLeftSeconds === 10 || questionTimeLeftSeconds === 3) && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
						try { navigator.vibrate(100); } catch {}
					}
				}
			}
		}, 1000);
	}

	function handleQuestionTimeout() {
		if (isLastQuestion) {
			submit(true);
		} else {
			nextQuestion();
		}
	}

	function nextQuestion() {
		if (currentQuestionIdx < totalQuestions - 1) {
			currentQuestionIdx += 1;
			if (hasPerQuestionTimer) {
				questionTimeLeftSeconds = perQuestionBudget;
			}
		}
	}

	function prevQuestion() {
		if (!isSequential && currentQuestionIdx > 0) {
			currentQuestionIdx -= 1;
			if (hasPerQuestionTimer) {
				questionTimeLeftSeconds = perQuestionBudget;
			}
		}
	}

	function jumpToQuestion(idx: number) {
		if (!isSequential && idx >= 0 && idx < totalQuestions) {
			currentQuestionIdx = idx;
			if (hasPerQuestionTimer) {
				questionTimeLeftSeconds = perQuestionBudget;
			}
		}
	}

	function handleVisibilityChange() {
		if (!mulaiKuis || submitting || !detail || hasilTerbaru?.lulus || batasTercapai) return;
		if (typeof document !== 'undefined' && document.hidden) {
			tabSwitchCount += 1;
			tabWarningVisible = true;
			const maxLimit = Number(detail.quiz.anti_cheat_tab_limit) || 2;
			if (maxLimit > 0 && tabSwitchCount > maxLimit) {
				submit(true);
			}
		}
	}

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			detail = await getQuiz(quizId);
			const qs = detail.quiz.acak_soal ? shuffle(detail.questions) : detail.questions;
			displayQuestions = qs.map((q) => {
				if (q.tipe === 'pilihan_ganda' && Array.isArray(q.opsi) && detail?.quiz.acak_opsi !== false) {
					return { ...q, opsi: shuffle(q.opsi) };
				}
				return q;
			});
			restoreDraft();
			currentQuestionIdx = 0;
			// Jika tidak ada flashcard persiapan, langsung mulai pengerjaan
			if ((!detail.ringkasanPoin || detail.ringkasanPoin.length === 0) && !hasilTerbaru?.lulus && !batasTercapai) {
				startQuizExecution();
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat kuis.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', handleVisibilityChange);
			window.addEventListener('blur', handleVisibilityChange);
		}
	});

	onDestroy(() => {
		if (timerInterval) clearInterval(timerInterval);
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('blur', handleVisibilityChange);
		}
	});

	async function submit(isForced: boolean = false) {
		if (!detail || submitting) return;
		if (!isForced) {
			const belumDijawab = detail.questions.filter((q) => !jawaban[q.id]?.trim());
			if (belumDijawab.length > 0) {
				errorMsg = `Masih ada ${belumDijawab.length} pertanyaan yang belum dijawab.`;
				return;
			}
		}
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		submitting = true;
		errorMsg = '';
		tabWarningVisible = false;
		try {
			const payload = detail.questions.map((q) => ({ question_id: q.id, jawaban: jawaban[q.id] || '' }));
			const kunciDraf = draftKey(detail);
			await submitQuizAttempt(quizId, payload, {
				session_token: detail.sessionToken,
				tab_switch_count: tabSwitchCount,
				client_started_at: quizStartedAt
			});
			try {
				if (kunciDraf) localStorage.removeItem(kunciDraf);
			} catch {
				/* abaikan */
			}
			jawaban = {};
			await load();
			// Gate aplikasi dievaluasi ulang: lulus/remedial membuka kunci tanpa perlu muat ulang halaman.
			requestQuizGateRefresh();
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
	<div class="glass-panel rounded-2xl p-5 select-none" style={detail.quiz.cegah_copy_paste !== false ? 'user-select: none; -webkit-user-select: none;' : ''}>
		<!-- HEADER KUIS & DUAL TIMER -->
		<div class="flex justify-between items-start gap-3 mb-2 flex-wrap">
			<div>
				<h3 class="text-lg font-bold" style="color: var(--sys-label)">{detail.quiz.judul}</h3>
				<p class="text-xs font-medium" style="color: var(--sys-label4)">
					Nilai minimal lulus: {detail.quiz.passing_score ?? 70}%
					{#if detail.periodik}
						· Periode ke-{detail.periodik.periodeKe}
						{#if detail.periodik.tanggalSelesai} · ditutup {new Date(detail.periodik.tanggalSelesai).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })}{/if}
						{#if detail.periodik.bankSoal > detail.periodik.jumlahSoal} · {detail.periodik.jumlahSoal} soal acak dari bank {detail.periodik.bankSoal}{/if}
					{/if}
				</p>
			</div>

			<!-- TIMER TOTAL KUIS BADGE -->
			{#if mulaiKuis && !hasilTerbaru?.lulus && totalTimeLeftSeconds !== null}
				<div
					class="px-3 py-1.5 rounded-xl font-mono text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
					style="background: {totalTimeLeftSeconds < 120 ? 'rgba(239, 68, 68, 0.15)' : 'var(--sys-fill2)'}; color: {totalTimeLeftSeconds < 120 ? '#EF4444' : 'var(--sys-label)'}; border: 1px solid {totalTimeLeftSeconds < 120 ? '#EF4444' : 'var(--sys-sep)'}"
				>
					<IconClock size={15} class={totalTimeLeftSeconds < 120 ? 'animate-spin' : ''} />
					<span>{formatTimer(totalTimeLeftSeconds)}</span>
				</div>
			{/if}
		</div>

		<!-- PERINGATAN TAB SWITCHING -->
		{#if tabWarningVisible && !hasilTerbaru?.lulus}
			<div class="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 flex items-center justify-between text-xs">
				<div class="flex items-center gap-2">
					<IconAlertTriangle size={18} />
					<span>
						<strong>Peringatan!</strong> Pindah tab/aplikasi terdeteksi ({tabSwitchCount}/{detail.quiz.anti_cheat_tab_limit || 2}). Kuis akan disubmit paksa bila melebihi batas!
					</span>
				</div>
				<button class="font-bold underline ml-2" onclick={() => (tabWarningVisible = false)}>Tutup</button>
			</div>
		{/if}

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
					<p class="text-xs font-medium opacity-80">
						Percobaan ke-{detail.attempts.length} dari {detail.maxAttempts}
						{#if hasilTerbaru.durasi_detik} · Durasi: {Math.floor(hasilTerbaru.durasi_detik / 60)}m {hasilTerbaru.durasi_detik % 60}s{/if}
					</p>
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
				{#if detail.periodik}
					Batas {detail.maxAttempts} percobaan periode ini sudah tercapai. Status Anda tercatat <b>Perlu Remedial</b> dan HRD/atasan diberi tahu. Pelajari ulang materi/SOP; kuis dibuka lagi pada periode berikutnya.
				{:else}
					Batas {detail.maxAttempts} percobaan untuk kuis ini sudah tercapai. Hubungi HRD untuk mengulang{detail.perluPembinaan?.mentorNama ? `, atau minta ${detail.perluPembinaan.mentorNama} (atasan/mentor Anda) menyetujui percobaan ulang setelah pembinaan` : ''}.
				{/if}
			</div>
		{:else if !hasilTerbaru?.lulus && adaKartu && !mulaiKuis && detail.attempts.length === 0}
			{@const poin = detail.ringkasanPoin ?? []}
			<div class="rounded-2xl p-5 border" style="background: var(--sys-fill2); border-color: var(--sys-sep)">
				<p class="text-xs font-bold mb-2" style="color: var(--sys-label3)">📇 Ringkasan 1 menit — baca dulu sebelum mulai ({kartuIdx + 1}/{poin.length})</p>
				<p class="text-base font-semibold leading-relaxed min-h-[72px]" style="color: var(--sys-label)">{poin[kartuIdx]}</p>
				<div class="mt-4 flex items-center gap-2">
					{#if kartuIdx < poin.length - 1}
						<button class="px-4 py-2 rounded-xl text-sm font-bold text-white gradient-bg" onclick={() => (kartuIdx += 1)}>Berikutnya →</button>
					{:else}
						<button class="px-4 py-2 rounded-xl text-sm font-bold text-white gradient-bg" onclick={startQuizExecution}>Mulai Kuis</button>
					{/if}
					<button class="px-3 py-2 rounded-xl text-xs font-semibold" style="color: var(--sys-label3)" onclick={startQuizExecution}>Lewati</button>
				</div>
			</div>
		{:else if !hasilTerbaru?.lulus && totalQuestions > 0 && currentQ}
			<!-- ONE-QUESTION STEPPER CARD VIEW (ANTI-SEARCHING) -->
			<div
				class="flex flex-col gap-4 mt-2"
				role="region"
				aria-label="Lembar Soal Kuis"
				oncopy={(e) => { if (detail?.quiz.cegah_copy_paste !== false) e.preventDefault(); }}
				oncontextmenu={(e) => { if (detail?.quiz.cegah_copy_paste !== false) e.preventDefault(); }}
			>
				<!-- PROGRESS BAR PER-SOAL COUNTDOWN -->
				{#if hasPerQuestionTimer && questionTimeLeftSeconds !== null}
					{@const pct = Math.max(0, Math.min(100, (questionTimeLeftSeconds / perQuestionBudget) * 100))}
					{@const isUrgent = questionTimeLeftSeconds <= 10}
					<div class="space-y-1">
						<div class="flex justify-between items-center text-xs font-bold">
							<span class="flex items-center gap-1" style="color: {isUrgent ? '#EF4444' : 'var(--sys-label3)'}">
								<span>⚡ Sisa Waktu Soal #{currentQuestionIdx + 1}:</span>
							</span>
							<span class="font-mono text-sm {isUrgent ? 'text-red-500 font-extrabold animate-pulse' : ''}" style="color: {isUrgent ? '#EF4444' : 'var(--sys-label)'}">
								{questionTimeLeftSeconds}s
							</span>
						</div>
						<div class="w-full h-2 rounded-full overflow-hidden bg-black/10 dark:bg-white/10">
							<div
								class="h-full rounded-full transition-all duration-1000 ease-linear {isUrgent ? 'animate-pulse' : ''}"
								style="width: {pct}%; background: {questionTimeLeftSeconds > 20 ? '#10B981' : questionTimeLeftSeconds > 10 ? '#F59E0B' : '#EF4444'}"
							></div>
						</div>
					</div>
				{/if}

				<!-- QUESTION STEPPER PILLS -->
				<div class="flex items-center justify-between gap-2 border-y py-2.5 my-1" style="border-color: var(--sys-sep)">
					<div class="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar flex-1">
						{#each displayQuestions as qItem, idx (qItem.id)}
							{@const terisi = !!jawaban[qItem.id]?.trim()}
							{@const aktif = idx === currentQuestionIdx}
							<button
								type="button"
								disabled={isSequential}
								onclick={() => jumpToQuestion(idx)}
								class="w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 transition-all"
								style="background: {aktif ? 'var(--color-primary, #6366F1)' : terisi ? 'var(--gg)' : 'var(--sys-fill2)'};
								       color: {aktif ? '#FFFFFF' : terisi ? 'var(--ggd)' : 'var(--sys-label3)'};
								       border: 1px solid {aktif ? 'var(--color-primary, #6366F1)' : 'var(--sys-sep)'}"
								title="Soal #{idx + 1} {terisi ? '(Sudah dijawab)' : '(Belum dijawab)'}"
							>
								{idx + 1}
							</button>
						{/each}
					</div>
					<div class="text-xs font-bold shrink-0 ml-2" style="color: var(--sys-label3)">
						{currentQuestionIdx + 1} / {totalQuestions}
					</div>
				</div>

				<!-- KARTU SOAL AKTIF -->
				<div class="p-4 rounded-2xl bg-white/40 dark:bg-white/5 border space-y-4" style="border-color: var(--sys-sep)">
					<div class="flex items-start justify-between gap-3">
						<p class="text-base font-bold leading-snug" style="color: var(--sys-label)">
							<span class="text-indigo-600 dark:text-indigo-400">#{currentQuestionIdx + 1}.</span> {currentQ.pertanyaan}
						</p>
					</div>

					<!-- PILIHAN JAWABAN -->
					{#if currentQ.tipe === 'pilihan_ganda' && currentQ.opsi}
						<div class="flex flex-col gap-2.5">
							{#each currentQ.opsi as opsi, oIdx}
								{@const dipilih = jawaban[currentQ.id] === opsi}
								<label
									class="flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all border"
									style="background: {dipilih ? 'rgba(99, 102, 241, 0.12)' : 'var(--sys-fill2)'};
									       border-color: {dipilih ? '#6366F1' : 'var(--sys-sep)'}"
								>
									<input type="radio" name={`q-${currentQ.id}`} value={opsi} bind:group={jawaban[currentQ.id]} class="w-4 h-4 text-indigo-600" />
									<span class="text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0" style="background: {dipilih ? '#6366F1' : 'var(--sys-fill)'}; color: {dipilih ? '#FFF' : 'var(--sys-label2)'}">
										{String.fromCharCode(65 + oIdx)}
									</span>
									<span class="text-sm font-medium flex-1 leading-relaxed" style="color: var(--sys-label)">{opsi}</span>
								</label>
							{/each}
						</div>
					{:else if currentQ.tipe === 'benar_salah'}
						<div class="grid grid-cols-2 gap-3">
							{#each ['Benar', 'Salah'] as opsi}
								{@const dipilih = jawaban[currentQ.id] === opsi}
								<label
									class="flex items-center justify-center gap-2 p-3.5 rounded-xl cursor-pointer transition-all border"
									style="background: {dipilih ? 'rgba(99, 102, 241, 0.12)' : 'var(--sys-fill2)'};
									       border-color: {dipilih ? '#6366F1' : 'var(--sys-sep)'}"
								>
									<input type="radio" name={`q-${currentQ.id}`} value={opsi} bind:group={jawaban[currentQ.id]} class="w-4 h-4 text-indigo-600" />
									<span class="text-sm font-bold" style="color: var(--sys-label)">{opsi}</span>
								</label>
							{/each}
						</div>
					{:else}
						<textarea
							class="w-full p-3 rounded-xl text-sm border focus:outline-none"
							style="background: var(--sys-fill2); border-color: var(--sys-sep); color: var(--sys-label)"
							rows="4"
							bind:value={jawaban[currentQ.id]}
							placeholder="Tulis jawaban pemahaman Anda secara jelas..."
						></textarea>
					{/if}
				</div>

				{#if errorMsg}
					<p class="text-xs font-semibold text-red-500">{errorMsg}</p>
				{/if}

				<!-- TOMBOL NAVIGASI STEPPER -->
				<div class="flex items-center justify-between gap-3 pt-2">
					{#if !isSequential}
						<button
							type="button"
							disabled={currentQuestionIdx === 0}
							onclick={prevQuestion}
							class="px-4 py-2.5 rounded-xl text-xs font-bold border disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-1"
							style="border-color: var(--sys-sep); color: var(--sys-label)"
						>
							<IconChevronLeft size={16} /> Sebelumnya
						</button>
					{:else}
						<div class="text-[11px] font-semibold text-gray-400 italic">
							Mode Sekuensial: Jawab sebelum maju
						</div>
					{/if}

					{#if !isLastQuestion}
						<button
							type="button"
							onclick={nextQuestion}
							class="px-5 py-2.5 rounded-xl text-xs font-bold text-white gradient-bg hover:opacity-90 transition flex items-center gap-1.5 shadow"
						>
							<span>Soal Berikutnya</span>
							<IconChevronRight size={16} />
						</button>
					{:else}
						<button
							type="button"
							onclick={() => submit(false)}
							disabled={submitting}
							class="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition flex items-center gap-1.5 shadow disabled:opacity-50"
						>
							<IconCircleCheck size={16} />
							<span>{submitting ? 'Mengirim...' : 'Selesai & Kirim'}</span>
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}

