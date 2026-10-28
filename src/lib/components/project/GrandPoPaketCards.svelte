<!-- GrandPoPaketCards.svelte — Grand PO Fase 5. Kartu READ-ONLY di ringkasan proyek:
     (1) "Paket Grand PO": PO saudara + progres per PO jasa. (2) "Material dari Customer": kiriman PO cat/material
     yang memasok proyek ini. TANPA Rupiah. Tidak menampilkan apa pun bila proyek bukan anggota Grand PO. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { fetchGrandPoLapangan, type GrandPoLapangan } from '$lib/services/grandPoLapangan';
	import { IconPackages, IconTruckDelivery, IconLoader2, IconInfoCircle, IconScale } from '@tabler/icons-svelte';

	let { project = null } = $props<{ project?: any }>();

	let data = $state<GrandPoLapangan | null>(null);
	let loading = $state(false);
	let error = $state('');

	const PERAN: Record<string, string> = { jasa: 'Jasa', material: 'Material', manpower_supply: 'Manpower Supply', sewa_alat: 'Sewa Alat', lainnya: 'Lainnya' };
	const SJ_LABEL: Record<string, [string, string]> = {
		dalam_perjalanan: ['Dalam perjalanan', 'bg-sky-100 text-sky-700'],
		terkirim: ['Terkirim', 'bg-indigo-100 text-indigo-700'],
		diterima: ['Diterima', 'bg-emerald-100 text-emerald-700'],
		belum_dikirim: ['Belum dikirim', 'bg-gray-100 text-gray-600'],
		dibatalkan: ['Dibatalkan', 'bg-red-100 text-red-700']
	};
	const REKON_LEVEL: Record<string, [string, string]> = {
		ok: ['Sesuai', 'bg-emerald-100 text-emerald-700'],
		perhatian: ['Cek kiriman', 'bg-amber-100 text-amber-700'],
		melebihi_po: ['Melebihi PO', 'bg-red-100 text-red-700']
	};
	const fmt = (n: number) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });

	$effect(() => {
		const id = Number(project?.id);
		if (!id) {
			data = null;
			return;
		}
		loading = true;
		error = '';
		fetchGrandPoLapangan(id)
			.then((d) => {
				data = d;
			})
			.catch((e) => {
				console.error('[GrandPoPaketCards]', e);
				error = e?.message || 'Gagal memuat';
				data = null;
			})
			.finally(() => {
				loading = false;
			});
	});
</script>

{#if loading}
	<div class="py-2" data-testid="gpo-lap-loading"><CircularProgressGauge size={40} strokeWidth={3} label="Memuat paket Grand PO..." /></div>
{:else if error}
	<p class="text-[11px] text-amber-600 py-1" data-testid="gpo-lap-error">Paket Grand PO belum bisa dimuat ({error}).</p>
{:else if data?.paket?.length}
	{#each data.paket as p (p.grand_po_id)}
		<div class="bg-white dark:bg-[#1B2530] rounded-2xl shadow-xs border border-gray-200/80 dark:border-[#2B3844] p-4 sm:p-5" data-testid="gpo-lap-paket">
			<div class="flex items-center gap-2.5 mb-2">
				<div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-violet-500/10 border border-violet-500/20 text-violet-600"><IconPackages size={18} /></div>
				<div class="min-w-0">
					<h3 class="text-sm font-extrabold text-gray-900 dark:text-white leading-tight">Paket Grand PO — {p.nama}</h3>
					<p class="text-[11px] text-gray-500 font-medium">{p.nomor_gpo || ''} · proyek ini bagian dari paket beberapa PO</p>
				</div>
			</div>
			<ul class="divide-y divide-gray-100 dark:divide-[#2B3844]">
				{#each p.anggota as a (a.so_id)}
					<li class="py-2 flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">PO {a.nomor_po}{#if a.proyek_ini}<span class="ml-1.5 text-[10px] font-semibold text-violet-600 bg-violet-50 rounded px-1.5 py-0.5">proyek ini</span>{/if}</p>
							<p class="text-[10px] text-gray-500">{PERAN[a.peran] || a.peran}</p>
						</div>
						{#if a.progres_pct !== null}
							<div class="w-28 shrink-0">
								<div class="h-1.5 rounded-full bg-gray-100 dark:bg-[#2B3844] overflow-hidden"><div class="h-full bg-emerald-500" style="width:{a.progres_pct}%"></div></div>
								<p class="text-[10px] text-gray-500 text-right mt-0.5">{a.progres_pct}%</p>
							</div>
						{:else if a.peran === 'jasa'}
							<span class="text-[10px] text-gray-400">Belum ada progres</span>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="text-[10px] text-gray-400 mt-2 flex items-start gap-1"><IconInfoCircle size={12} class="shrink-0 mt-px" />Progres tiap PO jasa dihitung dari proyeknya. PO yang berbagi proyek ini menunjukkan progres proyek yang sama.</p>
		</div>
	{/each}

	{#each data.material as m (m.so_id)}
		<div class="bg-white dark:bg-[#1B2530] rounded-2xl shadow-xs border border-gray-200/80 dark:border-[#2B3844] p-4 sm:p-5" data-testid="gpo-lap-material">
			<div class="flex items-center gap-2.5 mb-2">
				<div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-amber-500/10 border border-amber-500/20 text-amber-600"><IconTruckDelivery size={18} /></div>
				<div class="min-w-0">
					<h3 class="text-sm font-extrabold text-gray-900 dark:text-white leading-tight">Material dari Customer — PO {m.nomor_po}</h3>
					<p class="text-[11px] text-gray-500 font-medium" data-testid="gpo-lap-estimasi">{m.estimasi_tiba}</p>
				</div>
			</div>
			<div class="bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 text-[11px] rounded-lg p-2.5 mb-3 flex items-start gap-1.5" data-testid="gpo-lap-hint">
				<IconInfoCircle size={13} class="shrink-0 mt-px" />
				<span>Ini material milik customer (PO {m.nomor_po}), <strong>bukan dari gudang proyek</strong>. Jangan buat Packing List proyek untuk item ini kecuali memang kurang. Halaman ini hanya untuk melihat status kiriman.{#if m.memasok_belum_ditentukan} Admin belum menentukan PO jasa mana yang dipasok, jadi kartu ini tampil untuk semua proyek paket.{/if}</span>
			</div>
			{#if m.items.length}
				<div class="overflow-x-auto">
					<table class="w-full text-[11px]" data-testid="gpo-lap-material-items">
						<thead class="text-gray-400 text-left"><tr><th class="py-1 pr-2 font-semibold">Item</th><th class="py-1 px-2 text-right font-semibold">Dipesan</th><th class="py-1 px-2 text-right font-semibold">Dikirim</th><th class="py-1 px-2 text-right font-semibold">Diterima</th><th class="py-1 pl-2 text-right font-semibold">Belum</th></tr></thead>
						<tbody>
							{#each m.items as it (it.so_detail_id)}
								<tr class="border-t border-gray-100 dark:border-[#2B3844]">
									<td class="py-1.5 pr-2 text-gray-800 dark:text-gray-200">{it.nama_barang}</td>
									<td class="py-1.5 px-2 text-right">{fmt(it.qty_pesan)} {it.unit}</td>
									<td class="py-1.5 px-2 text-right">{fmt(it.qty_kirim)}</td>
									<td class="py-1.5 px-2 text-right">{fmt(it.qty_terima)}</td>
									<td class="py-1.5 pl-2 text-right font-semibold {it.qty_belum > 0 ? 'text-amber-600' : 'text-emerald-600'}">{fmt(it.qty_belum)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="text-[11px] text-gray-400">PO ini belum memiliki rincian item.</p>
			{/if}
			{#if m.surat_jalan.length}
				<div class="flex flex-wrap gap-1.5 mt-3" data-testid="gpo-lap-sj">
					{#each m.surat_jalan as s (s.id)}
						{@const lbl = SJ_LABEL[s.status] || SJ_LABEL.belum_dikirim}
						<span class="text-[10px] rounded-full px-2 py-0.5 {lbl[1]}" title={s.tanggal || ''}>{s.nomor_sj} · {lbl[0]}</span>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
	{#if data.rekonsiliasi?.baris?.length}
		<div class="bg-white dark:bg-[#1B2530] rounded-2xl shadow-xs border border-gray-200/80 dark:border-[#2B3844] p-4 sm:p-5" data-testid="gpo-lap-rekon">
			<div class="flex items-center gap-2.5 mb-2">
				<div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600"><IconScale size={18} /></div>
				<div class="min-w-0">
					<h3 class="text-sm font-extrabold text-gray-900 dark:text-white leading-tight">Dikirim vs Dipakai vs Sisa</h3>
					<p class="text-[11px] text-gray-500 font-medium">Cat dari PO customer: kiriman dibanding pemakaian di Coating Log</p>
				</div>
			</div>
			<div class="overflow-x-auto">
				<table class="w-full text-[11px]" data-testid="gpo-lap-rekon-table">
					<thead class="text-gray-400 text-left"><tr><th class="py-1 pr-2 font-semibold">Produk</th><th class="py-1 px-2 text-right font-semibold">Dipesan</th><th class="py-1 px-2 text-right font-semibold">Dikirim</th><th class="py-1 px-2 text-right font-semibold">Dipakai</th><th class="py-1 px-2 text-right font-semibold">Sisa di site</th><th class="py-1 pl-2 font-semibold"></th></tr></thead>
					<tbody>
						{#each data.rekonsiliasi.baris as r (r.product_id)}
							{@const lv = REKON_LEVEL[r.level] || REKON_LEVEL.ok}
							<tr class="border-t border-gray-100 dark:border-[#2B3844]" title={r.catatan}>
								<td class="py-1.5 pr-2 text-gray-800 dark:text-gray-200">{r.nama_barang}</td>
								<td class="py-1.5 px-2 text-right">{fmt(r.qty_pesan)}</td>
								<td class="py-1.5 px-2 text-right">{fmt(r.qty_kirim)}</td>
								<td class="py-1.5 px-2 text-right">{fmt(r.qty_dipakai)}</td>
								<td class="py-1.5 px-2 text-right font-semibold {r.qty_sisa < 0 ? 'text-red-600' : ''}">{fmt(r.qty_sisa)} {r.unit}</td>
								<td class="py-1.5 pl-2"><span class="text-[10px] rounded-full px-2 py-0.5 {lv[1]}">{lv[0]}</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<ul class="text-[10px] text-gray-400 mt-2 space-y-0.5" data-testid="gpo-lap-rekon-notes">
				<li class="flex items-start gap-1"><IconInfoCircle size={12} class="shrink-0 mt-px" />Sisa di site = dikirim − dipakai. Kelonggaran {data.rekonsiliasi.toleransi_pct}% (diatur admin). Selisih besar dicatat untuk klaim ke customer atau PO tambahan.</li>
				{#if data.rekonsiliasi.tanpa_produk}<li>• {data.rekonsiliasi.tanpa_produk} catatan Coating Log belum memilih produk PO, jadi belum ikut hitungan.</li>{/if}
				{#if data.rekonsiliasi.satuan_beda}<li>• {data.rekonsiliasi.satuan_beda} catatan memakai satuan berbeda dari PO, tidak dijumlahkan.</li>{/if}
			</ul>
		</div>
	{/if}
	{#if data.warnings?.length}
		<p class="text-[10px] text-amber-600" data-testid="gpo-lap-warnings">{data.warnings.join(' ')}</p>
	{/if}
{/if}
