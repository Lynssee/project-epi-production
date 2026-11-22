<script lang="ts">
	// Jalur Karier R&D: timeline level sertifikat (Onboarding → … → Manager Ready) + progres tiap program Track.
	// Level, prasyarat, dan masa berlaku diatur admin (Pengaturan Pelatihan LMS) — halaman ini hanya membaca.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getJalurKarier, type JalurKarierClient } from '$lib/services/ess/silabus';
	import { IconChevronLeft, IconCircleCheck, IconCircleDashed, IconLock, IconLoader2, IconInfoCircle } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let data = $state<JalurKarierClient | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			data = await getJalurKarier();
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat jalur karier.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	const STATUS: Record<string, { teks: string; warna: string }> = {
		lulus: { teks: 'Lulus', warna: 'var(--g)' },
		proses: { teks: 'Sedang berjalan', warna: '#D97706' },
		kedaluwarsa: { teks: 'Kedaluwarsa — ulangi', warna: '#EA580C' },
		belum: { teks: 'Belum dimulai', warna: 'var(--sys-label4)' }
	};

	const total = $derived(data?.levels.length ?? 0);
	const tercapai = $derived(data?.levels.filter((l) => l.achieved).length ?? 0);
	const nextLevel = $derived(data?.levels.find((l) => l.key === data?.next) ?? null);
	const namaLevel = (k: string) => data?.levels.find((l) => l.key === k)?.nama ?? k;
</script>

<div class="w-full p-4 md:p-6 pb-24 max-w-3xl mx-auto">
	<button class="flex items-center gap-1 text-xs font-bold mb-4" style="color: var(--sys-label3)" onclick={() => goto('/ess/pelatihan')}>
		<IconChevronLeft size={16} /> Pelatihan
	</button>
	<h1 class="text-2xl font-extrabold tracking-tight gradient-text">Jalur Karier R&amp;D</h1>
	<p class="text-sm mt-1 font-medium" style="color: var(--sys-label3)">Selesaikan program tiap level secara berurutan untuk meraih sertifikat berikutnya.</p>

	{#if loading}
		<div class="flex items-center gap-2 py-10 justify-center text-sm" style="color: var(--sys-label3)"><IconLoader2 size={18} class="animate-spin" /> Memuat jalur karier…</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-xl p-4 mt-4 text-sm" style="color:#DC2626">{errorMsg} <button class="underline font-bold ml-1" onclick={load}>Coba lagi</button></div>
	{:else if !data || !data.adaProgram}
		<div class="glass-panel rounded-xl p-4 mt-4 text-sm" style="color: var(--sys-label3)">Jalur karier R&amp;D belum tersedia. Program belum dibuat atau dipublikasikan oleh HRD.</div>
	{:else}
		<div class="glass-panel rounded-2xl p-4 mt-4">
			<div class="flex items-center justify-between text-xs font-bold">
				<span>Level tercapai: {tercapai} dari {total}</span>
				<span style="color: var(--sys-label3)">{data.current ? namaLevel(data.current) : 'Belum ada sertifikat'}</span>
			</div>
			<div class="h-2 rounded-full mt-2 overflow-hidden" style="background: var(--sys-fill, #e5e7eb)">
				<div class="h-full rounded-full" style="width:{total ? Math.round((tercapai / total) * 100) : 0}%; background: var(--g)"></div>
			</div>
			{#if nextLevel}
				<p class="text-xs mt-2" style="color: var(--sys-label3)">Berikutnya: <b>{nextLevel.nama}</b>{nextLevel.blockedBy.length ? ` — selesaikan dulu ${nextLevel.blockedBy.map(namaLevel).join(', ')}.` : '.'}</p>
			{:else}
				<p class="text-xs mt-2 font-bold" style="color: var(--g)">Semua level tercapai 🎉</p>
			{/if}
		</div>

		<ol class="mt-5 space-y-4">
			{#each data.levels as l, i (l.key)}
				{@const terkunci = !l.achieved && l.blockedBy.length > 0}
				<li class="glass-panel rounded-2xl p-4" style="opacity:{terkunci ? 0.75 : 1}">
					<div class="flex items-start gap-3">
						<div class="mt-0.5 shrink-0">
							{#if l.achieved}<IconCircleCheck size={22} style="color: var(--g)" />
							{:else if terkunci}<IconLock size={22} style="color: var(--sys-label4)" />
							{:else}<IconCircleDashed size={22} style="color: #D97706" />{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="text-sm font-extrabold">{i + 1}. {l.nama}</div>
							<div class="text-[11px]" style="color: var(--sys-label3)">
								Berlaku {l.masaBerlakuBulan} bulan{terkunci ? ` · butuh: ${l.blockedBy.map(namaLevel).join(', ')}` : ''}
							</div>
							<ul class="mt-2 space-y-2">
								{#each l.programs as p (p.kode)}
									{@const s = STATUS[p.status]}
									<li class="flex items-center justify-between gap-2 text-xs">
										<div class="min-w-0">
											<div class="font-semibold truncate">{p.judul}</div>
											<div style="color:{s.warna}" class="text-[11px] font-bold">{s.teks}{p.status === 'proses' ? ` · ${Math.round(p.progress)}%` : ''}</div>
										</div>
										{#if p.programId && p.terbuka && p.status !== 'lulus' && !terkunci}
											<button class="px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 glass-panel" onclick={() => goto(`/ess/pelatihan/${p.programId}`)}>
												{p.status === 'proses' ? 'Lanjutkan' : 'Mulai'}
											</button>
										{:else if p.programId && p.terbuka && p.status === 'lulus'}
											<button class="px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0" style="color: var(--sys-label3)" onclick={() => goto(`/ess/pelatihan/${p.programId}`)}>Lihat</button>
										{:else if !p.terbuka}
											<span class="text-[10px] shrink-0" style="color: var(--sys-label4)">Segera hadir</span>
										{/if}
									</li>
								{/each}
							</ul>
							{#if l.manual}
								<p class="mt-2 text-[11px] flex items-start gap-1" style="color: var(--sys-label3)"><IconInfoCircle size={14} class="shrink-0 mt-px" /> Level ini juga butuh: {l.manual} (dinilai manual oleh atasan/HRD).</p>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ol>
	{/if}
</div>
