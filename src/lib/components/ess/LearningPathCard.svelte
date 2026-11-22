<script lang="ts">
	// Learning Path lapangan: urutan silabus berjenjang (Basic → Intermediate → Advanced) dengan status per langkah.
	// Murni tampilan dari data silabus yang sudah dimuat — tanpa fetch tambahan. Logika di utils/learningPath.ts.
	import { goto } from '$app/navigation';
	import { buildLearningPath, summarizeLearningPath, findNextMateri, estimasiSisaMenit } from '$lib/utils/learningPath';
	import type { SilabusProgress } from '$lib/services/ess/silabus';

	// durasi: { [programId]: durasi_menit } dari daftar kursus yang sudah dimuat halaman (tanpa fetch tambahan).
	let { silabus, durasi = {} }: { silabus: SilabusProgress[]; durasi?: Record<number, number | null | undefined> } = $props();

	// Langkah berjalan/siap dimulai → program berikutnya di silabus tsb + estimasi sisa menit.
	function lanjut(silabusId: number) {
		const nxt = findNextMateri((silabus || []).find((s) => s.id === silabusId)?.materi);
		return nxt ? { programId: nxt.programId, judul: nxt.programJudul, sisa: estimasiSisaMenit(durasi[nxt.programId], nxt.progressPersen) } : null;
	}

	const steps = $derived(
		buildLearningPath(
			(silabus || []).map((s, i) => ({
				id: s.id,
				namaSilabus: s.namaSilabus,
				kategori: s.kategori,
				level: s.level,
				prerequisiteId: s.prerequisiteId,
				progressPersen: s.progressPersen,
				urutan: i
			}))
		)
	);
	const ringkas = $derived(summarizeLearningPath(steps));

	const CFG = {
		selesai: { label: 'Selesai', icon: '✓', dot: 'bg-emerald-500 text-white' },
		berjalan: { label: 'Berjalan', icon: '▶', dot: 'bg-sky-500 text-white' },
		terbuka: { label: 'Siap dimulai', icon: '●', dot: 'bg-amber-400 text-white' },
		terkunci: { label: 'Terkunci', icon: '🔒', dot: 'bg-slate-300 text-slate-600' }
	} as const;
</script>

{#if steps.length > 0}
	<div class="glass-panel rounded-2xl p-5 mb-8">
		<div class="flex items-center justify-between gap-2 mb-1">
			<h2 class="text-sm font-bold uppercase tracking-wider" style="color: var(--sys-label3)">🗺️ Learning Path Saya</h2>
			<span class="text-[11px] font-semibold" style="color: var(--sys-label3)">{ringkas.selesai}/{ringkas.total} selesai</span>
		</div>
		<p class="text-[11px] mb-3" style="color: var(--sys-label3)">
			{#if ringkas.next}
				Berikutnya: <b>{ringkas.next.nama}</b>. Langkah terkunci terbuka setelah silabus prasyaratnya selesai.
			{:else}
				🎉 Semua langkah selesai.
			{/if}
		</p>
		<ol class="space-y-2">
			{#each steps as st, i (st.id)}
				{@const c = CFG[st.status]}
				<li class="flex gap-3 items-start">
					<div class="flex flex-col items-center self-stretch">
						<span class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 {c.dot}" aria-hidden="true">{c.icon}</span>
						{#if i < steps.length - 1}<span class="flex-1 w-0.5 bg-slate-200 my-1"></span>{/if}
					</div>
					<div class="flex-1 min-w-0 pb-1">
						<div class="flex items-start justify-between gap-2">
							<p class="text-sm font-semibold truncate" style="color: var(--sys-label)">{st.nama}</p>
							<span class="text-[10px] font-bold shrink-0" style="color: var(--sys-label3)">{c.label}{st.status === 'berjalan' ? ` · ${st.persen}%` : ''}</span>
						</div>
						{#if st.level}<span class="text-[10px] font-semibold" style="color: var(--sys-label3)">🎚️ {st.level}</span>{/if}
						{#if st.status === 'berjalan' || st.status === 'terbuka'}
							{@const nx = lanjut(st.id)}
							{#if nx}
								<button class="mt-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg gradient-bg text-white hover:opacity-90 transition-opacity" onclick={() => goto(`/ess/pelatihan/${nx.programId}`)} title={nx.judul}>
									{st.status === 'berjalan' ? 'Lanjutkan' : 'Mulai'} Silabus →{#if nx.sisa} · ±{nx.sisa} mnt lagi{/if}
								</button>
								<p class="text-[10px] mt-0.5 truncate" style="color: var(--sys-label4)">Berikutnya: {nx.judul}</p>
							{/if}
						{/if}
						{#if st.status === 'terkunci' && st.prasyaratNama}
							<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)">Selesaikan dulu: <b>{st.prasyaratNama}</b></p>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	</div>
{/if}
