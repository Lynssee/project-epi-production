<script lang="ts">
	// Performa Tim Proyek Saya — tampil untuk Project Leader / Co-Leader yang punya tim outsource aktif DAN/ATAU atasan yang punya bawahan
	// langsung dengan skor KPI yang sudah dirilis (bagian internal: hanya skor ringkas, dari garis komando andal).
	// Gagal/bukan leader/tim kosong => kartu tidak tampil (tidak merusak halaman Kinerja). Data: skor komposit pekerja,
	// kelengkapan penilaian; penilaian dilakukan di Manpower → Nilai Pekerja.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getTimProyekSaya, type TimProyekSaya } from '$lib/services/ess/timProyekSaya';
	import { getTimTren, type TimTren, type TimCadence } from '$lib/services/ess/kinerjaTren';
	import TimMiniMatrix from './TimMiniMatrix.svelte';

	let data = $state<TimProyekSaya | null>(null);
	let loading = $state(true);
	let bukaId = $state<number | null>(null);
	// Mini-matriks: dimuat saat proyek pertama dibuka (hemat kuota), bukan saat kartu muncul.
	let tren = $state<TimTren | null>(null);
	let trenCadence = $state<TimCadence>('mingguan');
	let trenLoading = $state(false);

	async function muatTren() {
		trenLoading = true;
		try {
			tren = await getTimTren(trenCadence);
		} finally {
			trenLoading = false;
		}
	}
	function bukaProyek(id: number) {
		bukaId = bukaId === id ? null : id;
		if (bukaId !== null && tren === null && !trenLoading) muatTren();
	}
	function gantiCadence(c: TimCadence) {
		trenCadence = c;
		muatTren();
	}

	onMount(async () => {
		try {
			data = await getTimProyekSaya();
		} finally {
			loading = false;
		}
	});

	const adaOutsource = $derived(!!data?.available && !!data.adalahLeader && (data.proyek?.length ?? 0) > 0);
	const internal = $derived(data?.available && data.internal && data.internal.anggota.length > 0 ? data.internal : null);
	const tampil = $derived(adaOutsource || !!internal);
	const BADGE: Record<string, { label: string; cls: string }> = {
		kandidat_leader: { label: 'Kandidat Leader', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
		direkomendasikan: { label: 'Direkomendasikan', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
		perlu_pembinaan: { label: 'Perlu Pembinaan', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
		usulan_blacklist: { label: 'Ditinjau HRD', cls: 'bg-red-50 text-red-700 border-red-200' },
		belum_dinilai: { label: 'Belum dinilai', cls: 'bg-gray-50 text-gray-500 border-gray-200' }
	};
	const b = (k: string) => BADGE[k] || BADGE.belum_dinilai;
</script>

{#if loading}
	<div class="mb-8 rounded-2xl bg-white/60 border border-slate-100 p-4 text-sm text-slate-400" data-testid="tim-loading">Memuat performa tim…</div>
{:else if tampil && data}
	<section class="mb-8" data-testid="tim-proyek">
		<div class="flex items-start justify-between gap-2 mb-1">
			<h2 class="text-lg font-bold" style="color: var(--sys-label)">Performa Tim Proyek Saya</h2>
			{#if adaOutsource}<button type="button" class="text-xs font-semibold text-amber-600 shrink-0" onclick={() => goto('/manpower/rating')}>Nilai pekerja →</button>{/if}
		</div>
		{#if adaOutsource}
			<p class="text-[11px] mb-3" style="color: var(--sys-label3)">
				Pekerja outsource/harian/borongan yang aktif di proyek yang Anda pimpin. Skor 0–100 dari kehadiran, penilaian lapangan, skill, dan dokumen.
				{#if data.ringkas?.belumDinilai}<b class="text-amber-700">{data.ringkas.belumDinilai} dari {data.ringkas.total} belum pernah dinilai.</b>{/if}
			</p>
		{/if}

		{#if internal}
			<div class="mb-3 rounded-2xl bg-white border border-slate-200 overflow-hidden" data-testid="tim-internal">
				<div class="px-4 py-3">
					<p class="text-sm font-bold" style="color: var(--sys-label)">Anggota Tim (karyawan)</p>
					<p class="text-[11px] text-slate-500">
						{internal.ringkas.anggota} bawahan langsung · {internal.ringkas.denganSkor} punya skor yang sudah dirilis
						{#if internal.ringkas.rataSkor != null} · rata-rata {internal.ringkas.rataSkor}{/if}
						{#if internal.ringkas.turun > 0} · <b class="text-red-600">{internal.ringkas.turun} turun ≥ 10 poin</b>{/if}
					</p>
					<p class="text-[10px] text-slate-400 mt-0.5">Hanya skor final periode yang sudah dirilis HRD — sama dengan yang dilihat masing-masing karyawan. Untuk pembinaan, bukan penilaian ulang.</p>
				</div>
				<ul class="divide-y divide-slate-100 border-t border-slate-100">
					{#each internal.anggota as a (a.karyawan_id)}
						<li class="px-4 py-2.5 flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{a.nama}</p>
								<p class="text-[11px] text-slate-500 truncate">{a.posisi || '-'}{#if a.periode} · {a.periode}{/if}{#if a.skor_general != null || a.skor_spesifik != null} · General {a.skor_general ?? '-'} / Spesifik {a.skor_spesifik ?? '-'}{/if}</p>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								{#if a.total_skor != null}
									<span class="text-lg font-black {a.turun ? 'text-red-600' : 'text-slate-800'}">{a.total_skor}</span>
									{#if a.delta != null}<span class="text-[10px] font-bold {a.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}" title="Dibanding rilis sebelumnya">{a.delta >= 0 ? '▲' : '▼'} {Math.abs(a.delta)}</span>{/if}
								{:else}
									<span class="text-[11px] text-slate-400" title="Belum ada skor final dari periode yang sudah dirilis">belum ada skor</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="space-y-3">
			{#each data.proyek || [] as p (p.project_id)}
				<div class="rounded-2xl bg-white border border-slate-200 overflow-hidden">
					<button type="button" class="w-full flex items-center justify-between gap-2 px-4 py-3 text-left" aria-expanded={bukaId === p.project_id} onclick={() => bukaProyek(p.project_id)}>
						<div class="min-w-0">
							<p class="text-sm font-bold truncate" style="color: var(--sys-label)">{p.nama}</p>
							<p class="text-[11px] text-slate-500">{p.ringkas.total} pekerja
								{#if p.ringkas.belumDinilai} · <span class="text-amber-700">{p.ringkas.belumDinilai} belum dinilai</span>{/if}
								{#if p.ringkas.perluPerhatian} · <span class="text-red-600">{p.ringkas.perluPerhatian} perlu perhatian</span>{/if}
							</p>
						</div>
						<span class="text-slate-400 text-xs">{bukaId === p.project_id ? '▾' : '▸'}</span>
					</button>
					{#if bukaId === p.project_id}
						<TimMiniMatrix {tren} projectId={p.project_id} cadence={trenCadence} loading={trenLoading} onCadence={gantiCadence} />
						<ul class="divide-y divide-slate-100 border-t border-slate-100">
							{#each p.anggota as m (m.manpower_id)}
								<li class="px-4 py-2.5 flex items-center justify-between gap-3">
									<div class="min-w-0">
										<p class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{m.nama}</p>
										<p class="text-[11px] text-slate-500 truncate">{m.jabatan || '-'}{#if m.kehadiranPct != null} · hadir {m.kehadiranPct}%{/if} · {m.ratingCount} penilaian</p>
									</div>
									<div class="flex items-center gap-2 shrink-0">
										<span class="text-lg font-black {m.perluPerhatian ? 'text-red-600' : 'text-slate-800'}">{m.composite ?? '-'}</span>
										<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border {b(m.badge).cls}">{b(m.badge).label}</span>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}
