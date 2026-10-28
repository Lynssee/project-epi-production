<!-- src/lib/components/ess/GateKpiSayaCard.svelte
     "Dampak Gate ke KPI Saya" (Fase 4 Gate-KPI). Transparan: skor administrasi pengajuan bulan ini, dokumen yang tertahan
     beserta sisa waktu sebelum berpengaruh ke skor, dan jarak ke ambang SP. Gagal gate pertama = edukasi (tidak memotong skor).
     Fail-soft: bila data tak tersedia / belum ada dokumen, kartu tidak tampil. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { getGateKpiSaya, type GateKpiSaya } from '$lib/services/ess/gateKpiSaya';
	import { IconShieldCheck, IconAlertTriangle, IconClockHour4 } from '@tabler/icons-svelte';

	let data = $state<GateKpiSaya | null>(null);
	let open = $state(false);
	let tab = $state('semua');

	onMount(async () => {
		data = await getGateKpiSaya();
	});

	let r = $derived(data?.ringkas);
	let tampil = $derived(Boolean(data?.available && r && r.total_dokumen > 0));
	// Tab per kategori hanya muncul bila ada >1 kelompok sumber (selain itu cukup satu daftar).
	let kategori = $derived(data?.per_kategori ?? []);
	let daftar = $derived((data?.tertahan ?? []).filter((d) => tab === 'semua' || d.kategori === tab));
	// Sisa waktu < 12 jam = mendesak (merah); selebihnya amber.
	const mendesak = (jam: number) => jam <= 12;
	let skorWarna = $derived(
		r?.skor_kpi == null ? 'var(--sys-label3)' : r.skor_kpi >= (data?.settings?.target_lolos_persen ?? 90) ? '#059669' : '#DC2626'
	);
</script>

{#if tampil && r && data}
	<div class="mb-8 glass-panel rounded-2xl p-5" data-testid="gate-kpi-saya">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h2 class="text-lg font-bold flex items-center gap-2" style="color: var(--sys-label)">
					<IconShieldCheck size={20} style="color: var(--p, var(--g))" /> Dampak Gate ke KPI Saya
				</h2>
				<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
					Administrasi pengajuan {data.periode}. Gagal gate pertama kali hanya edukasi — skor baru berkurang bila dokumen dibiarkan tertahan &gt; {data.settings?.aging_jam_batas} jam atau kesalahan yang sama berulang.
				</p>
			</div>
			<div class="text-right shrink-0">
				<p class="text-2xl font-extrabold" style="color: {skorWarna}">{r.dinilai && r.skor_kpi != null ? `${r.skor_kpi}%` : '–'}</p>
				<p class="text-[10px]" style="color: var(--sys-label3)">{r.dinilai ? 'skor administrasi' : 'belum cukup data'}</p>
			</div>
		</div>

		{#if !data.berlaku}
			<p class="text-[11px] mt-3 rounded-lg px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200">
				Informasi saja — penilaian ini <strong>belum diberlakukan</strong> ke KPI & SP. Gunakan untuk membiasakan diri membenahi data lebih cepat.
			</p>
		{/if}

		<div class="grid grid-cols-3 gap-2 mt-4 text-center">
			<div class="rounded-xl p-2.5 bg-slate-50"><p class="text-lg font-bold" style="color: var(--sys-label)">{r.total_dokumen}</p><p class="text-[10px]" style="color: var(--sys-label3)">pengajuan</p></div>
			<div class="rounded-xl p-2.5 bg-amber-50"><p class="text-lg font-bold text-amber-700">{r.edukasi}</p><p class="text-[10px] text-amber-700">perlu dibenahi</p></div>
			<div class="rounded-xl p-2.5 bg-red-50"><p class="text-lg font-bold text-red-600">{r.penalti}</p><p class="text-[10px] text-red-600">berpengaruh ke skor</p></div>
		</div>

		{#if (data.sp?.aktif_6_bulan ?? 0) === 0}
			<p class="text-[11px] mt-3 flex items-center gap-1.5 text-emerald-700"><IconShieldCheck size={14} /> Tidak ada SP aktif dalam 6 bulan terakhir.</p>
		{/if}
		{#if r.penalti > 0 && r.sisa_ke_ambang_sp > 0}
			<p class="text-[11px] mt-1 flex items-center gap-1.5" style="color: var(--sys-label3)"><IconAlertTriangle size={14} /> {r.sisa_ke_ambang_sp} dokumen berpenalti lagi bulan ini dapat memicu draf teguran/SP untuk ditinjau HRD.</p>
		{:else if r.penalti > 0}
			<p class="text-[11px] mt-1 flex items-center gap-1.5 text-red-600"><IconAlertTriangle size={14} /> Jumlah dokumen berpenalti bulan ini sudah mencapai ambang tinjauan HRD.</p>
		{/if}

		{#if (data.tertahan?.length ?? 0) > 0}
			<button class="mt-4 text-xs font-bold underline" style="color: var(--p, var(--g))" onclick={() => (open = !open)}>
				{open ? 'Sembunyikan' : 'Lihat'} {data.tertahan?.length} pengajuan yang perlu dibenahi
			</button>
			{#if open}
				{#if kategori.length > 1}
					<div class="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Kategori dokumen">
						<button role="tab" aria-selected={tab === 'semua'} class="text-[11px] font-bold px-2.5 py-1 rounded-full border" style="border-color: {tab === 'semua' ? 'var(--p, var(--g))' : 'var(--sys-label3)'}" onclick={() => (tab = 'semua')}>Semua ({data.tertahan?.length ?? 0})</button>
						{#each kategori as k (k.key)}
							<button role="tab" aria-selected={tab === k.key} title="{k.total_dokumen} dokumen bulan ini, {k.penalti} berpengaruh ke skor" class="text-[11px] font-bold px-2.5 py-1 rounded-full border" style="border-color: {tab === k.key ? 'var(--p, var(--g))' : 'var(--sys-label3)'}" onclick={() => (tab = k.key)}>{k.label} ({k.tertahan})</button>
						{/each}
					</div>
				{/if}
				<ul class="mt-2 space-y-2">
					{#each daftar as d (d.sumber + d.id)}
						<li class="rounded-xl border p-3 text-xs" style="border-color: {d.status === 'penalti' ? '#FECACA' : '#FDE68A'}">
							<div class="flex items-center justify-between gap-2">
								<span class="font-bold" style="color: var(--sys-label)">{d.nomor}</span>
								{#if d.status === 'penalti'}
									<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{d.alasan === 'berulang' ? 'Kesalahan berulang' : 'Tertahan lewat batas'}</span>
								{:else}
									<Tooltip text="Benahi sebelum batas {data.settings?.aging_jam_batas} jam agar tidak memengaruhi skor" position="left"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 {mendesak(d.sisa_jam) ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}"><IconClockHour4 size={11} /> sisa {Math.ceil(d.sisa_jam)} jam</span></Tooltip>
								{/if}
							</div>
							<p class="mt-1" style="color: var(--sys-label3)">Gate: <span class="font-mono">{d.gate_keys.join(', ')}</span> · tertahan {Math.round(d.aging_jam)} jam</p>
							{#if d.link}
								<a href={d.link} class="inline-block mt-1.5 font-bold" style="color: var(--p, var(--g))">Benahi Dokumen ↗</a>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
{/if}
