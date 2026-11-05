<!-- src/lib/components/help/ProcessTrainingStatus.svelte -->
<!-- "Training terkait" satu langkah alur + STATUS SAYA (✅ Lulus / ⏳ Berjalan / ○ Belum) dan tombol ke menu Pelatihan. Dimuat malas, hanya bila
     ada tautan; gagal memuat status → tautan tetap tampil tanpa status (bukan galat layar). Penanda "Wajib" hanya informasi. -->
<script lang="ts">
	import { loadTrainingStatus, type TrainingStatus } from '$lib/services/processGuidanceTrainingApi';
	import type { NodeTraining } from '$lib/utils/processTraining';

	interface Props {
		links: NodeTraining[];
	}
	let { links }: Props = $props();

	let items = $state<TrainingStatus[]>([]);
	let ok = $state<boolean | null>(null); // null = memuat
	let ids = $derived(links.map((l) => l.program_id));

	$effect(() => {
		const list = ids;
		if (list.length === 0) return;
		let batal = false;
		ok = null;
		loadTrainingStatus(list).then((r) => {
			if (batal) return;
			items = r.items;
			ok = r.ok;
		});
		return () => {
			batal = true;
		};
	});

	const byId = $derived(new Map(items.map((i) => [i.id, i])));
	const STATUS_LABEL = { lulus: '✅ Lulus', berjalan: '⏳ Berjalan', belum: '○ Belum diikuti' } as const;
	const STATUS_CLS = {
		lulus: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		berjalan: 'bg-sky-50 text-sky-700 border-sky-200',
		belum: 'bg-gray-50 text-gray-600 border-gray-200'
	} as const;
</script>

{#if links.length > 0}
	<div class="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2" data-testid="training-status">
		<p class="text-[11px] font-bold text-indigo-700 uppercase tracking-wide">🎓 Training terkait</p>
		<ul class="mt-1.5 space-y-1.5">
			{#each links as l (l.program_id)}
				{@const it = byId.get(l.program_id)}
				<li class="text-[11px] bg-white/70 rounded-lg border border-indigo-100 p-2" data-testid="training-item">
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="font-semibold text-gray-800">{it ? it.judul : `Program #${l.program_id}`}</span>
						{#if l.wajib}<span class="px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-amber-50 text-amber-700 border-amber-200" title="Penanda informasi; tidak mendaftarkan siapa pun otomatis.">Wajib</span>{/if}
						{#if it}
							<span class="px-1.5 py-0.5 rounded border text-[10px] font-semibold {STATUS_CLS[it.status_saya]}" data-testid="status-saya">
								{STATUS_LABEL[it.status_saya]}{it.status_saya === 'berjalan' && it.progress != null ? ` ${Math.round(it.progress)}%` : ''}
							</span>
						{/if}
					</div>
					{#if l.catatan}<p class="text-gray-500 mt-0.5">{l.catatan}</p>{/if}
					{#if it?.tenggat && it.status_saya !== 'lulus'}<p class="text-amber-700 mt-0.5">Tenggat: {it.tenggat}</p>{/if}
					<div class="mt-1">
						{#if it && !it.terbit}
							<span class="text-gray-400">Belum tersedia (masih disiapkan HRD).</span>
						{:else if ok === true && !it}
							<span class="text-gray-400">Program tidak tersedia.</span>
						{:else if it}
							<a href="/ess/pelatihan/{it.id}" class="font-semibold text-[var(--p,#1d6fa5)]" data-testid="buka-training">
								{it.status_saya === 'lulus' ? 'Buka lagi' : it.status_saya === 'berjalan' ? 'Lanjutkan' : it.self_enroll ? 'Mulai belajar' : 'Lihat program'} →
							</a>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if ok === false}
			<p class="mt-1 text-[10px] text-amber-700" data-testid="status-gagal">Status belajar Anda belum bisa dimuat (sinyal?). Daftar training tetap benar.</p>
		{/if}
		<p class="mt-1 text-[10px] text-gray-400">Penanda "Wajib" hanya informasi. Training dikerjakan di menu Pelatihan.</p>
	</div>
{/if}
