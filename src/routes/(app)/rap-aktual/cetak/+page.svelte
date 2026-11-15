<script lang="ts">
	// Lembar Pertanggungjawaban Anggaran Lapangan (Site Cost Statement) — cetak A4 untuk Project Leader.
	// Hanya Pagu RAP vs Realisasi vs Sisa + komitmen terbuka + LPJ tertunggak. TANPA nilai PO klien, laba, atau margin.
	// Aturan #5: tombol Cetak = window.print() sinkron; data sudah dimuat di onMount (tidak ada await sebelum print).
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { loadSiteCostStatement, type SiteCostStatementResult } from '$lib/services/siteCostStatementApi';
	import { LEVEL_LABEL, type CostLevel } from '$lib/shared/siteCostStatement';
	import { IconArrowLeft, IconPrinter } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let project = $state<any>(null);
	let result = $state<SiteCostStatementResult | null>(null);

	const rp = (n: number) => (n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString('id-ID')})` : Math.round(n).toLocaleString('id-ID'));
	const pctTxt = (n: number | null) => (n == null ? '–' : `${n.toFixed(1)}%`);
	const LEVEL_CLASS: Record<CostLevel, string> = {
		aman: 'text-slate-700',
		waspada: 'text-amber-700',
		peringatan: 'text-orange-700 font-semibold',
		lebih: 'text-red-700 font-bold',
		tanpa_pagu: 'text-red-700 font-bold'
	};
	const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

	onMount(async () => {
		try {
			const id = page.url.searchParams.get('project');
			if (!id) {
				errorMsg = 'Proyek belum dipilih. Buka dari halaman RAP vs Aktual.';
				return;
			}
			// Cakupan proyek mengikuti hak akses pengguna (getProjectsForCurrentUser) — bukan query bebas.
			const projects = await getProjectsForCurrentUser(false, { limit: -1 });
			project = projects.find((p) => String(p.id) === id) || null;
			if (!project) {
				errorMsg = 'Proyek tidak ditemukan atau Anda tidak ditugaskan pada proyek ini.';
				return;
			}
			result = await loadSiteCostStatement(project);
		} catch (e: any) {
			console.error(e);
			errorMsg = e?.message || 'Gagal memuat lembar pertanggungjawaban.';
		} finally {
			loading = false;
		}
	});

	const s = $derived(result?.statement ?? null);

	// Cetak: layout (app) tidak punya aturan cetak, dan menyembunyikan elemen lain dengan visibility masih menyisakan tinggi
	// layoutnya (halaman kosong tambahan). Maka saat cetak, lembar dipindah jadi anak langsung <body> dan sisanya display:none;
	// setelah cetak dikembalikan ke posisi semula (tampilan layar tidak berubah).
	let wrap = $state<HTMLElement | null>(null);
	let origParent: Node | null = null;
	let origNext: Node | null = null;
	function beforePrint() {
		if (!wrap || wrap.parentNode === document.body) return;
		origParent = wrap.parentNode;
		origNext = wrap.nextSibling;
		wrap.classList.add('site-cost-print-root');
		document.body.appendChild(wrap);
	}
	function afterPrint() {
		if (!wrap || !origParent) return;
		wrap.classList.remove('site-cost-print-root');
		origParent.insertBefore(wrap, origNext);
		origParent = null;
		origNext = null;
	}
</script>

<svelte:window onbeforeprint={beforePrint} onafterprint={afterPrint} />

<svelte:head>
	<title>Lembar Pertanggungjawaban Anggaran</title>
</svelte:head>

<div bind:this={wrap} class="site-cost-sheet-wrap max-w-4xl mx-auto p-4 text-slate-900">
	<div class="no-print mb-3 flex items-center justify-between gap-2">
		<a href="/rap-aktual{project ? `?project=${project.id}` : ''}" class="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
			<IconArrowLeft size={16} /> Kembali ke RAP vs Aktual
		</a>
		{#if s}
			<button type="button" onclick={() => window.print()} class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
				<IconPrinter size={16} /> Cetak / Simpan PDF
			</button>
		{/if}
	</div>

	<div class="no-print mb-3 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-[12px] text-blue-900">
		💡 <strong>Cara membaca:</strong> <em>Sisa Pagu</em> = RAP − realisasi. <em>Sisa Jatah Aman</em> = sisa pagu dikurangi pengajuan/PR yang masih berjalan —
		jika negatif, rencana belanja sudah melewati pagu. Angka dalam kurung = lebih dari pagu. Lembar ini tidak memuat nilai kontrak klien maupun laba.
	</div>

	{#if loading}
		<div class="flex justify-center py-16"><CircularProgressGauge size={50} strokeWidth={4} label="Menyusun lembar pertanggungjawaban..." /></div>
	{:else if errorMsg}
		<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMsg}</div>
	{:else if s && project}
		<article class="site-cost-sheet bg-white border border-slate-300 p-6 text-[12px]">
			<header class="border-b-2 border-slate-900 pb-2 mb-3">
				<p class="text-[10px] uppercase tracking-wider text-slate-500">PT Eltama Prima Indo</p>
				<h1 class="text-base font-black uppercase">Lembar Pertanggungjawaban Anggaran Lapangan</h1>
				<p class="mt-0.5"><strong>{project.name}</strong>{project.lokasi ? ` — ${project.lokasi}` : ''}</p>
				<p class="text-[11px] text-slate-600">Per {today}</p>
			</header>

			{#if result && result.gagal.length}
				<p class="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
					⚠ Sebagian data gagal dimuat: {result.gagal.join(', ')}. Angka terkait mungkin kurang — muat ulang sebelum dicetak.
				</p>
			{/if}

			<h2 class="font-bold uppercase text-[11px] mb-1">I. Pagu RAP vs Realisasi per Kategori <span class="font-normal normal-case">(Rp)</span></h2>
			<table class="w-full mb-3">
				<thead>
					<tr class="border-y border-slate-900 text-[10px] uppercase">
						<th class="text-left py-1">Kategori</th>
						<th class="text-right">Pagu RAP</th>
						<th class="text-right">Realisasi</th>
						<th class="text-right">Sisa Pagu</th>
						<th class="text-right">Serapan</th>
						<th class="text-left pl-2">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each s.rows as r (r.id)}
						<tr class="border-b border-slate-200">
							<td class="py-0.5">{r.label}</td>
							<td class="text-right font-mono">{rp(r.rap)}</td>
							<td class="text-right font-mono">{rp(r.actual)}</td>
							<td class="text-right font-mono">{rp(r.sisa)}</td>
							<td class="text-right font-mono">{pctTxt(r.serapanPct)}</td>
							<td class="pl-2 {LEVEL_CLASS[r.level]}">{LEVEL_LABEL[r.level]}</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="py-2 text-slate-500">Belum ada RAP maupun realisasi untuk proyek ini.</td></tr>
					{/each}
					<tr class="font-bold border-t border-slate-900">
						<td class="py-1">Total</td>
						<td class="text-right font-mono">{rp(s.total.rap)}</td>
						<td class="text-right font-mono">{rp(s.total.actual)}</td>
						<td class="text-right font-mono">{rp(s.total.sisa)}</td>
						<td class="text-right font-mono">{pctTxt(s.total.serapanPct)}</td>
						<td class="pl-2 {LEVEL_CLASS[s.total.level]}">{LEVEL_LABEL[s.total.level]}</td>
					</tr>
				</tbody>
			</table>

			<h2 class="font-bold uppercase text-[11px] mb-1">II. Komitmen Terbuka <span class="font-normal normal-case">(belum menjadi realisasi)</span></h2>
			<table class="w-full mb-1">
				<tbody>
					<tr class="border-b border-slate-200"><td class="py-0.5">Pengajuan anggaran menunggu persetujuan/proses ({s.komitmen.menunggu.count})</td><td class="text-right font-mono">{rp(s.komitmen.menunggu.amount)}</td></tr>
					<tr class="border-b border-slate-200"><td class="py-0.5">Pengajuan disetujui, dana belum cair ({s.komitmen.disetujuiBelumCair.count})</td><td class="text-right font-mono">{rp(s.komitmen.disetujuiBelumCair.amount)}</td></tr>
					<tr class="border-b border-slate-200"><td class="py-0.5">Pengajuan dibayar sebagian — sisa ({s.komitmen.sebagian.count})</td><td class="text-right font-mono">{rp(s.komitmen.sebagian.amount)}</td></tr>
					<tr class="border-b border-slate-200"><td class="py-0.5">PR/PO belum diterima penuh ({s.komitmen.prBelumDiterima.count})</td><td class="text-right font-mono">{rp(s.komitmen.prBelumDiterima.amount)}</td></tr>
					<tr class="font-bold border-t border-slate-900"><td class="py-1">Total komitmen terbuka</td><td class="text-right font-mono">{rp(s.komitmen.total)}</td></tr>
					<tr class="font-bold"><td class="py-1">Sisa Jatah Aman (Sisa Pagu − Komitmen)</td><td class="text-right font-mono border-t border-b-4 border-double border-slate-900 {s.sisaJatahAman < 0 ? 'text-red-700' : ''}">{rp(s.sisaJatahAman)}</td></tr>
				</tbody>
			</table>
			<p class="text-[10px] text-slate-500 mb-3">PR/PO dan pengajuan bisa saling tumpang tindih bila satu kebutuhan diajukan lewat dua jalur; periksa bila total terasa besar.</p>

			<h2 class="font-bold uppercase text-[11px] mb-1">III. LPJ / Pertanggungjawaban Belum Selesai</h2>
			{#if s.lpj.count === 0}
				<p class="mb-1 text-slate-600">Tidak ada pengajuan bertanda LPJ "belum".</p>
			{:else}
				<table class="w-full mb-3">
					<thead><tr class="border-y border-slate-900 text-[10px] uppercase"><th class="text-left py-1">No. Pengajuan</th><th class="text-left">Tujuan</th><th class="text-right">Nominal</th></tr></thead>
					<tbody>
						{#each s.lpj.items as i}
							<tr class="border-b border-slate-200"><td class="py-0.5 font-mono">{i.nomor}</td><td>{i.tujuan}</td><td class="text-right font-mono">{rp(i.amount)}</td></tr>
						{/each}
						<tr class="font-bold border-t border-slate-900"><td class="py-1" colspan="2">Total {s.lpj.count} pengajuan belum LPJ</td><td class="text-right font-mono">{rp(s.lpj.amount)}</td></tr>
					</tbody>
				</table>
			{/if}

			{#if s.lpj.menungguVerifikasi.count > 0}
				<p class="mb-1 text-[11px]">LPJ sudah dikirim, menunggu verifikasi Finance: <strong>{s.lpj.menungguVerifikasi.count}</strong> pengajuan ({rp(s.lpj.menungguVerifikasi.amount)}).</p>
			{/if}
			{#if s.lpj.tidakTerlacak.count > 0}
				<p class="mb-3 text-[11px] text-amber-800">
					⚠ {s.lpj.tidakTerlacak.count} pengajuan operasional sudah cair ({rp(s.lpj.tidakTerlacak.amount)}) tetapi status LPJ-nya belum tercatat.
					Ini celah pelacakan, bukan tunggakan — minta Finance memeriksa dan mengisinya.
				</p>
			{:else}
				<div class="mb-3"></div>
			{/if}

			{#each s.catatan as c}<p class="text-[10px] text-amber-800">⚠ {c}</p>{/each}

			<div class="grid grid-cols-2 gap-6 mt-8 text-center text-[11px]">
				<div><p class="mb-12">Dibuat oleh (Project Leader)</p><p class="border-t border-slate-400 pt-1">{(typeof project.leader_name === 'string' && project.leader_name) || '( .................................... )'}</p></div>
				<div><p class="mb-12">Diverifikasi (Admin Proyek / Finance)</p><p class="border-t border-slate-400 pt-1">( .................................... )</p></div>
			</div>
		</article>
	{/if}
</div>

<style>
	@media print {
		/* Utama: lembar dipindah ke <body> oleh beforePrint(); semua anak body lain disembunyikan tanpa sisa tinggi. */
		:global(body > :not(.site-cost-print-root)) { display: none !important; }
		:global(.site-cost-print-root) { max-width: none !important; padding: 0 !important; margin: 0 !important; }
		/* Cadangan bila beforeprint tidak terpicu: sembunyikan lewat visibility. */
		:global(body *) { visibility: hidden !important; }
		:global(.site-cost-sheet), :global(.site-cost-sheet *) { visibility: visible !important; }
		:global(.site-cost-sheet) { border: none !important; padding: 8mm !important; }
		:global(.site-cost-sheet-wrap:not(.site-cost-print-root) .site-cost-sheet) { position: absolute; left: 0; top: 0; width: 100%; }
		:global(body) { background: #fff !important; }
		.no-print { display: none !important; }
	}
</style>
