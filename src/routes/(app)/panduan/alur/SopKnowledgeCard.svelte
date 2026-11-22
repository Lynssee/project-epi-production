<script lang="ts">
	// Kartu "Skor Pengetahuan SOP Saya" per alur: skor + langkah berikutnya (baca → uji pemahaman). Memakai kuis yang sudah ada di
	// /ess/pelatihan (anti-cheat & batas percobaan tetap berlaku) — tidak ada mesin kuis kedua. Gagal memuat → kartu tersembunyi (tidak mengganggu SOP).
	let { flowKey, refreshKey = 0 }: { flowKey: string; refreshKey?: number } = $props();

	type Quiz = { program_id: number; quiz_id: number | null; enrolled: boolean; best: number | null; lulus: boolean };
	type Data = { score: number | null; status: string; passing: number; read: string; has_quiz: boolean; quizzes: Quiz[] };

	let data = $state<Data | null>(null);
	let loading = $state(true);

	const CLS: Record<string, string> = {
		kompeten: 'bg-emerald-100 text-emerald-800 border-emerald-300',
		penguatan: 'bg-amber-100 text-amber-800 border-amber-300',
		remedial: 'bg-rose-100 text-rose-800 border-rose-300',
		belum_diuji: 'bg-gray-100 text-gray-600 border-gray-300'
	};
	const LABEL: Record<string, string> = { kompeten: 'Kompeten', penguatan: 'Perlu Penguatan', remedial: 'Perlu Belajar Lagi', belum_diuji: 'Belum Diuji' };

	async function load() {
		if (!flowKey) return;
		loading = true;
		try {
			const r = await fetch(`/api/process-guidance/sop-knowledge?flow_key=${encodeURIComponent(flowKey)}`);
			data = r.ok ? ((await r.json()) as Data) : null;
		} catch {
			data = null;
		}
		loading = false;
	}
	$effect(() => {
		flowKey;
		refreshKey; // dimuat ulang setelah "Tandai Paham"
		load();
	});

	const nextQuiz = $derived(data?.quizzes.find((q) => q.quiz_id != null && !q.lulus) ?? data?.quizzes.find((q) => q.quiz_id != null) ?? null);
	const hint = $derived(
		!data
			? ''
			: data.read !== 'sudah'
				? data.read === 'versi_lama'
					? 'SOP sudah direvisi — baca versi terbaru lalu ketuk "Tandai Paham".'
					: 'Langkah 1: baca SOP ini lalu ketuk "Tandai Paham".'
				: data.has_quiz
					? data.score != null && data.score >= data.passing
						? 'Bagus! Anda sudah memahami SOP ini.'
						: 'Langkah 2: kerjakan kuis pemahaman untuk menaikkan skor Anda.'
					: 'SOP ini belum punya kuis — cukup konfirmasi baca.'
	);
</script>

{#if !loading && data}
	<div class="p-2.5 bg-white border border-gray-200 rounded-xl text-xs space-y-1.5" data-testid="sop-knowledge-card">
		<div class="flex items-center justify-between gap-2">
			<p class="font-bold text-gray-800" title="Skor = nilai kuis × bobot + kepatuhan baca versi terkini × bobot. KKM {data.passing}.">🎯 Skor Pengetahuan SOP Saya</p>
			<span class="px-2 py-0.5 rounded-full border text-[11px] font-semibold {CLS[data.status] ?? CLS.belum_diuji}" data-testid="sop-knowledge-score">
				{data.score != null ? `${data.score}/100` : LABEL.belum_diuji}{data.score != null ? ` · ${LABEL[data.status] ?? ''}` : ''}
			</span>
		</div>
		<p class="text-[11px] text-gray-500" data-testid="sop-knowledge-hint">{hint}</p>
		{#if nextQuiz && data.read === 'sudah' && !(data.score != null && data.score >= data.passing)}
			<a href={`/ess/pelatihan/${nextQuiz.program_id}`} class="inline-block px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700" data-testid="sop-knowledge-quiz-link">
				📝 Uji Pemahaman{nextQuiz.best != null ? ` (terbaik ${nextQuiz.best})` : ''}
			</a>
		{/if}
	</div>
{/if}
