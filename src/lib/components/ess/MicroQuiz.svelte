<script lang="ts">
	// Cek pemahaman kilat (latihan) di kartu Pintasan Belajar: soal acak dari kuis modul kursus relevan.
	// Tidak mencatat skor & tidak memengaruhi kelulusan; penilaian di server. Dimuat hanya saat tombol ditekan (hemat API).
	import { getMicroQuiz, submitMicroQuiz, type MicroQuizQuestion, type MicroQuizResult } from '$lib/services/ess/training';
	import { IconBulb, IconCircleCheck, IconCircleX } from '@tabler/icons-svelte';

	let { programId, konteks }: { programId: number; konteks: string } = $props();

	let fase = $state<'idle' | 'memuat' | 'soal' | 'hasil' | 'kosong' | 'gagal'>('idle');
	let questions = $state<MicroQuizQuestion[]>([]);
	let token = $state<string | null>(null);
	let jawaban = $state<Record<string, string>>({});
	let hasil = $state<MicroQuizResult | null>(null);
	let kirim = $state(false);
	let pesan = $state('');

	let lengkap = $derived(questions.length > 0 && questions.every((q) => !!jawaban[String(q.id)]));

	async function mulai() {
		fase = 'memuat';
		pesan = '';
		jawaban = {};
		hasil = null;
		try {
			const r = await getMicroQuiz(programId, konteks);
			if (!r.questions.length || !r.token) { fase = 'kosong'; return; }
			questions = r.questions;
			token = r.token;
			fase = 'soal';
		} catch (e: any) {
			pesan = e?.message || 'Gagal memuat soal.';
			fase = 'gagal';
		}
	}

	async function periksa() {
		if (!token || !lengkap || kirim) return;
		kirim = true;
		try {
			hasil = await submitMicroQuiz(programId, token, jawaban);
			fase = 'hasil';
		} catch (e: any) {
			pesan = e?.message || 'Gagal memeriksa jawaban.';
			fase = 'gagal';
		} finally {
			kirim = false;
		}
	}
	const status = (id: number) => hasil?.results.find((r) => r.id === id);
</script>

<div class="mt-2">
	{#if fase === 'idle'}
		<button class="text-[11px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover-lift" style="background: var(--sys-fill2); color: var(--sys-label3)" title="Latihan singkat — tidak dicatat sebagai nilai" onclick={mulai}>
			<IconBulb size={13} /> Cek pemahaman (latihan)
		</button>
	{:else if fase === 'memuat'}
		<p class="text-[11px] font-medium" style="color: var(--sys-label4)">Memuat soal...</p>
	{:else if fase === 'kosong'}
		<p class="text-[11px] font-medium" style="color: var(--sys-label4)">Belum ada soal latihan untuk kursus ini.</p>
	{:else if fase === 'gagal'}
		<p class="text-[11px] font-semibold" style="color: var(--red)">{pesan} <button class="underline" onclick={mulai}>Coba lagi</button></p>
	{:else}
		<div class="flex flex-col gap-3 rounded-xl p-3" style="background: var(--sys-fill2)">
			{#each questions as q, i (q.id)}
				{@const st = status(q.id)}
				<fieldset class="flex flex-col gap-1.5" disabled={fase === 'hasil'}>
					<legend class="text-xs font-bold" style="color: var(--sys-label)">{i + 1}. {q.pertanyaan}</legend>
					{#each q.opsi as o}
						<label class="flex items-center gap-2 text-xs font-medium rounded-lg px-2 py-1.5" style={fase === 'hasil' && st && o === st.jawabanBenar ? 'background: var(--gg); color: var(--ggd)' : fase === 'hasil' && st && !st.benar && jawaban[String(q.id)] === o ? 'background: var(--aml); color: var(--amd)' : 'color: var(--sys-label3)'}>
							<input type="radio" name={`mq-${q.id}`} value={o} bind:group={jawaban[String(q.id)]} />
							<span>{o}</span>
						</label>
					{/each}
					{#if fase === 'hasil' && st}
						<p class="text-[11px] font-bold flex items-center gap-1" style="color: {st.benar ? 'var(--ggd)' : 'var(--red)'}">
							{#if st.benar}<IconCircleCheck size={13} /> Benar{:else}<IconCircleX size={13} /> Kurang tepat — jawaban: {st.jawabanBenar}{/if}
						</p>
					{/if}
				</fieldset>
			{/each}
			{#if fase === 'soal'}
				<button class="self-start text-xs font-bold px-3 py-1.5 rounded-lg text-white gradient-bg disabled:opacity-50" disabled={!lengkap || kirim} onclick={periksa}>{kirim ? 'Memeriksa...' : 'Periksa jawaban'}</button>
			{:else if hasil}
				<div class="flex items-center gap-3 flex-wrap">
					<p class="text-xs font-extrabold" style="color: var(--sys-label)">Hasil: {hasil.benar} / {hasil.total} benar</p>
					<button class="text-[11px] font-bold underline" style="color: var(--sys-label3)" onclick={mulai}>Coba soal lain</button>
				</div>
				<p class="text-[10px] font-medium" style="color: var(--sys-label4)">Latihan saja — tidak memengaruhi nilai atau kelulusan kursus.</p>
			{/if}
		</div>
	{/if}
</div>
