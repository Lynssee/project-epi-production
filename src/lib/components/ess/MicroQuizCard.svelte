<script lang="ts">
	// Micro-Quiz Harian (≈1 menit): 1 soal dari bank soal pelatihan, ditampilkan sebelum Toolbox Meeting.
	// Dinilai di server; hasil hanya untuk penguatan belajar (tidak memengaruhi nilai/gate). Hanya tampil bila diaktifkan & ada soal.
	import { onMount } from 'svelte';
	import { getMicroQuiz, submitMicroQuiz, type MicroQuizState, type MicroQuizResult } from '$lib/services/ess/microQuiz';
	import { IconBulb, IconCircleCheck, IconCircleX, IconLoader2 } from '@tabler/icons-svelte';

	let quizState = $state<MicroQuizState | null>(null);
	let loading = $state(true);
	let error = $state('');
	let pilihan = $state('');
	let sending = $state(false);
	let hasil = $state<MicroQuizResult | null>(null);

	onMount(async () => {
		try {
			quizState = await getMicroQuiz();
		} catch (e: any) {
			// Fail-soft: kartu tambahan tidak boleh mengganggu halaman utama.
			console.warn('[MicroQuizCard] gagal memuat:', e?.message);
			error = e?.message || '';
		} finally {
			loading = false;
		}
	});

	async function kirim() {
		if (!quizState?.question || !pilihan || sending) return;
		sending = true;
		error = '';
		try {
			hasil = await submitMicroQuiz(quizState.question.id, pilihan);
		} catch (e: any) {
			error = e?.message || 'Gagal mengirim jawaban.';
		} finally {
			sending = false;
		}
	}

	// Tampilan hasil: dari jawaban barusan, atau dari status "sudah dijawab" saat halaman dibuka lagi.
	const selesai = $derived(hasil ? { benar: hasil.benar, jawabanBenar: hasil.jawabanBenar } : quizState?.answered ? { benar: quizState.answered.benar, jawabanBenar: quizState.answered.jawabanBenar } : null);
</script>

{#if !loading && quizState?.enabled && quizState.question}
	<div class="card-section" style="border: 1px solid var(--sys-sep)">
		<div class="flex items-center gap-2 mb-1.5">
			<IconBulb size={18} style="color: var(--am, #d97706)" />
			<p class="text-[13px] font-bold" style="color: var(--sys-label)">Micro-Quiz Hari Ini</p>
			<span class="ml-auto text-[10px] font-medium text-right" style="color: var(--sys-label3)" title="Jumlah jawaban benar dalam 7 hari terakhir">
				{#if (quizState.streak ?? 0) > 0}<b style="color: var(--am, #d97706)" title="Hari beruntun menjawab micro-quiz. Menjawab minimal 5 hari seminggu memberi poin bonus.">🔥 {quizState.streak} hari</b> · {/if}Minggu ini: {quizState.minggu.benar}/{quizState.minggu.total} benar
			</span>
		</div>

		<p class="text-[13px] font-medium mb-2" style="color: var(--sys-label)">{quizState.question.pertanyaan}</p>

		{#if selesai}
			<div class="rounded-lg p-2.5 text-[12px]" style="background: {selesai.benar ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}; color: {selesai.benar ? '#16a34a' : '#dc2626'}">
				<div class="flex items-center gap-1.5 font-bold">
					{#if selesai.benar}<IconCircleCheck size={16} /> Benar, mantap!{:else}<IconCircleX size={16} /> Belum tepat{/if}
				</div>
				{#if !selesai.benar && selesai.jawabanBenar}
					<p class="mt-1" style="color: var(--sys-label)">Jawaban yang benar: <b>{selesai.jawabanBenar}</b></p>
				{/if}
			</div>
			<p class="text-[10px] mt-1.5" style="color: var(--sys-label3)">Soal baru muncul besok. Hasil ini hanya untuk latihan, tidak memengaruhi nilai.</p>
		{:else}
			<div class="flex flex-col gap-1.5">
				{#each quizState.question.opsi as o}
					<label class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] cursor-pointer" style="border: 1px solid {pilihan === o ? 'var(--ac, #2563eb)' : 'var(--sys-sep)'}; color: var(--sys-label)">
						<input type="radio" name="microquiz" value={o} bind:group={pilihan} />
						<span>{o}</span>
					</label>
				{/each}
			</div>
			{#if error}<p class="text-[11px] mt-1.5" style="color: #dc2626">{error}</p>{/if}
			<button type="button" onclick={kirim} disabled={!pilihan || sending} class="mt-2 w-full rounded-lg py-2 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--ac, #2563eb)">
				{#if sending}<IconLoader2 size={14} class="inline animate-spin" /> Mengirim…{:else}Jawab{/if}
			</button>
			<p class="text-[10px] mt-1.5" style="color: var(--sys-label3)">Satu soal per hari, diambil dari materi K3/pelatihan. Jawab sebelum mulai Toolbox Meeting.</p>
		{/if}
	</div>
{/if}
