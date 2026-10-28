<!-- Menu Lampiran v2 Fase 4 — pratinjau "lampiran otomatis" di form Packing List, SEBELUM dikirim.
     Baca-saja & informatif (mode dianjurkan/shadow): tidak memblokir kirim. Memuat hanya bila diminta/berubah
     (debounce) supaya hemat API. -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { IconLoader2, IconAlertTriangle, IconChevronDown, IconChevronUp, IconClipboardList } from '@tabler/icons-svelte';
	import { fetchPlLampiranPreview, type PlLampiranPreview, type PreviewDraftItem } from '$lib/services/plLampiranPreview';

	interface Props {
		projectId: number | null;
		items: PreviewDraftItem[];
	}
	let { projectId, items }: Props = $props();

	let open = $state(false);
	let loading = $state(false);
	let errorMsg = $state('');
	let preview = $state<PlLampiranPreview | null>(null);
	let loadedKey = '';
	let timer: ReturnType<typeof setTimeout> | null = null;

	const itemsKey = $derived(JSON.stringify([projectId, items.map((i) => [i.item_id ?? null, i.nama_barang, i.qty_required])]));

	async function load() {
		if (!items.length) { preview = null; return; }
		loading = true;
		errorMsg = '';
		const key = itemsKey;
		const r = await fetchPlLampiranPreview(projectId, items);
		if (key !== itemsKey) return; // input berubah selama menunggu; permintaan berikutnya yang menang
		loading = false;
		if (r.error) { errorMsg = r.error; return; }
		preview = r.data ?? null;
		loadedKey = key;
	}

	// Debounce 800 ms, hanya bila kartu dibuka (hemat API, CLAUDE.md).
	$effect(() => {
		const key = itemsKey;
		if (!open || key === loadedKey) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(load, 800);
		return () => { if (timer) clearTimeout(timer); };
	});

	const saldo = $derived(preview?.saldoLokasi && preview.saldoLokasi.available ? preview.saldoLokasi : null);
	const tangan = $derived(preview?.barangDiTangan ?? null);
	const kepatuhan = $derived(preview?.kepatuhanPemakaian ?? null);
	// R4: berapa lampiran otomatis yang akan berisi data (bukan kosong) bila PL ini dikirim.
	const siap = $derived((saldo && saldo.rows.length ? 1 : 0) + (tangan && tangan.rows.length ? 1 : 0));
	const terlambat = $derived((tangan?.rows ?? []).filter((r) => r.terlambatHari > 0).length);
	const adaBelumDicatat = $derived((saldo?.rows ?? []).some((r) => r.linked && (r.saldoBuku ?? 0) > 0 && !r.terakhirPakaiDicatat));
	const fmt = (v: number | undefined) => String(Math.round((v ?? 0) * 100) / 100);
	const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
</script>

<div class="card-section" id="pkl-lampiran-preview">
	<button type="button" class="w-full flex items-center justify-between text-left" onclick={() => (open = !open)} aria-expanded={open}>
		<h4 class="!mb-0"><IconClipboardList size={16} class="text-[var(--g)]" /> Pratinjau Lampiran Otomatis{#if preview}<Tooltip text="Jumlah lampiran otomatis yang berisi data untuk PL ini" position="bottom" class="ml-2"><span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{siap}/2 berisi data</span></Tooltip>{/if}</h4>
		{#if open}<IconChevronUp size={16} />{:else}<IconChevronDown size={16} />{/if}
	</button>
	<p class="text-[11px] text-gray-400 mt-1">
		Lihat dulu sisa stok di lokasi proyek dan pinjaman Anda yang belum kembali — sama seperti yang akan dilihat approver. Hanya informasi, tidak menghalangi pengiriman.
	</p>

	{#if open}
		<div class="mt-3 space-y-3">
			{#if !items.length}
				<p class="text-[12px] text-gray-400 bg-gray-50 rounded-lg p-3 text-center">Pilih atau tambahkan barang dulu untuk melihat pratinjau.</p>
			{:else if loading}
				<div class="flex justify-center py-3"><IconLoader2 size={20} class="animate-spin text-[var(--g)]" /></div>
			{:else if errorMsg}
				<p class="text-[12px] text-red-600">⚠ {errorMsg}</p>
			{:else if preview}
				<!-- Sisa stok di lokasi -->
				{#if saldo}
					<div>
						<p class="text-[12px] font-semibold text-slate-700 mb-1">Sisa stok di lokasi proyek <span class="font-normal text-gray-400">(saldo buku)</span></p>
						<div class="overflow-x-auto">
							<table class="w-full text-[11px]">
								<thead>
									<tr class="text-left text-gray-400"><th class="py-1 pr-2">Barang</th><th class="pr-2">Diminta</th><th class="pr-2">Saldo buku</th><th class="pr-2">Di perjalanan</th><th>Pakai terakhir dicatat</th></tr>
								</thead>
								<tbody>
									{#each saldo.rows as r}
										<tr class="border-t border-gray-100">
											<td class="py-1 pr-2">{r.nama}</td>
											<td class="pr-2">{fmt(r.diminta)} {r.unit}</td>
											{#if r.linked}
												<td class="pr-2 font-semibold">{fmt(r.saldoBuku)}</td>
												<td class="pr-2">{fmt(r.diPerjalanan)}</td>
												<td>{r.terakhirPakaiDicatat ? fmtDate(r.terakhirPakaiDicatat) : 'belum pernah ⚠'}</td>
											{:else}
												<td class="pr-2 text-amber-600"><Tooltip text="Barang belum tertaut ke master, saldo tidak bisa dibaca" position="top"><span>?</span></Tooltip></td><td class="pr-2">?</td><td>?</td>
											{/if}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<ul class="mt-1.5 text-[10.5px] text-amber-700 list-disc pl-4 space-y-0.5">
							{#each saldo.catatan as c}<li>{c}</li>{/each}
						</ul>
						{#if kepatuhan}
							<p class="mt-1.5 text-[10.5px] {kepatuhan.rasioPct < 10 ? 'text-red-600' : kepatuhan.rasioPct < 50 ? 'text-amber-600' : 'text-emerald-600'}">
								Kepatuhan catat pemakaian proyek ini: <b>{kepatuhan.rasioPct}%</b>{#if kepatuhan.rasioPct < 10} — sangat rendah, saldo buku kemungkinan jauh dari fisik{/if}
								<Tooltip text="Pemakaian tercatat ÷ barang diterima di proyek ini. Rendah = saldo buku kurang bisa dipercaya." position="top"><span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold align-middle">i</span></Tooltip>
							</p>
						{/if}
						{#if adaBelumDicatat && projectId}
							<button
								type="button"
								class="mt-2 text-[12px] font-semibold text-[var(--g)] underline"
								title="Buka Laporan Harian proyek ini untuk mencatat pemakaian material, supaya saldo lebih akurat"
								onclick={() => goto(`/laporan/${projectId}`)}
							>Catat pemakaian dulu →</button>
						{/if}
					</div>
				{:else if preview.saldoLokasi && !preview.saldoLokasi.available}
					<p class="text-[11px] text-gray-400">Sisa stok lokasi: {preview.saldoLokasi.reason}</p>
				{/if}

				<!-- Barang di tangan pemohon -->
				{#if tangan}
					<div>
						<p class="text-[12px] font-semibold text-slate-700 mb-1">Barang di tangan Anda <span class="font-normal text-gray-400">({tangan.pemohon})</span></p>
						{#if tangan.rows.length === 0}
							<p class="text-[11px] text-emerald-600">Tidak ada pinjaman yang belum kembali.</p>
						{:else}
							<ul class="text-[11px] space-y-0.5">
								{#each tangan.rows as r}
									<li class="flex justify-between gap-2 border-t border-gray-100 py-1">
										<span>{r.nama} · {fmt(r.qty)} {r.unit} <span class="text-gray-400">({r.nomorPl})</span></span>
										<span class={r.terlambatHari > 0 ? 'text-red-600 font-semibold' : 'text-gray-500'}>
											{r.tanpaTenggat ? 'tanpa tenggat' : r.terlambatHari > 0 ? `terlambat ${r.terlambatHari} hari` : `kembali ${fmtDate(r.wajibKembali)}`}
										</span>
									</li>
								{/each}
							</ul>
							{#if terlambat > 0}
								<p class="mt-1 text-[10.5px] text-red-600 flex items-center gap-1"><IconAlertTriangle size={12} /> {terlambat} barang terlambat kembali — kembalikan dulu agar pengajuan baru tidak tertahan.</p>
							{/if}
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
