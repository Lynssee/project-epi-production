<!-- src/lib/components/gerbangSj/GerbangWorkshopPanel.svelte -->
<!-- WSK-35 4b — Gerbang satpam untuk SJ Keluar WORKSHOP (Ciketing & Balaraja). Semua lewat /api/gerbang-workshop/*
     (server menulis; layar ini tidak menulis Directus). Dibuka dari antrean atau dari scan QR (bukaDariQr). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { IconBuildingFactory2, IconLoader2 } from '@tabler/icons-svelte';
	import type { GerbangApi, GWsAntrianRow, GWsDetail, GWsKey } from '$lib/services/gerbangSjApi';
	import { menitText, TEKS } from '$lib/data/gerbangSjTeks';

	let { api, onPesan }: { api: GerbangApi; onPesan: (p: { ok?: string; err?: string }) => void } = $props();

	let antrian = $state<GWsAntrianRow[]>([]);
	let memuat = $state(false);
	let buka = $state<GWsDetail | null>(null);
	let jumlahOk = $state(false);
	let catatan = $state('');
	let sibuk = $state(false);
	// WSK-35: satpam yang juga pembuat SJ wajib isi alasan di kolom catatan (fallback bila hanya satu orang bertugas).
	let butuhAlasanDiri = $state(false);
	let nomor = $state('');

	const APPROVAL_LABEL: Record<string, string> = { approved: 'Disetujui Finance', menunggu: 'Menunggu Finance', rejected: 'Ditahan Finance' };
	const APPROVAL_WARNA: Record<string, string> = {
		approved: 'background:#dcfce7;color:#166534',
		menunggu: 'background:#fef3c7;color:#92400e',
		rejected: 'background:#fee2e2;color:#991b1b'
	};

	export async function muat() {
		memuat = true;
		try {
			antrian = (await api.workshop.antrian()).antrian || [];
		} catch (e) {
			console.error('[gate] antrean SJ workshop gagal:', e);
			onPesan({ err: e instanceof Error ? e.message : 'Gagal memuat antrean SJ workshop.' });
		} finally {
			memuat = false;
		}
	}

	function tampilkan(d: GWsDetail) {
		buka = d;
		jumlahOk = false;
		catatan = '';
		butuhAlasanDiri = false;
	}

	async function bukaBaris(r: GWsAntrianRow) {
		if (buka?.header_id === r.header_id && buka.workshop === r.workshop) { buka = null; return; }
		sibuk = true;
		try {
			tampilkan((await api.workshop.detail(r.workshop, r.header_id)).detail);
		} catch (e) {
			onPesan({ err: e instanceof Error ? e.message : 'Gagal membuka SJ.' });
		} finally {
			sibuk = false;
		}
	}

	/** Dipanggil halaman saat QR SJ workshop terbaca, atau dari kolom nomor SJ. */
	export async function bukaDariQr(code: string) {
		await cari({ code });
	}

	async function cari(q: { code?: string; nomor?: string }) {
		sibuk = true;
		onPesan({});
		try {
			tampilkan((await api.workshop.cari(q)).detail);
		} catch (e) {
			onPesan({ err: e instanceof Error ? e.message : 'SJ tidak ditemukan.' });
		} finally {
			sibuk = false;
		}
	}

	async function loloskan() {
		if (!buka || sibuk) return;
		sibuk = true;
		onPesan({});
		try {
			const r = await api.workshop.loloskan(buka.workshop as GWsKey, buka.header_id, {
				client_event_id: crypto.randomUUID(), jumlah_ok: jumlahOk, catatan: catatan.trim() || null,
				...(butuhAlasanDiri ? { alasan_diri: catatan.trim() } : {})
			});
			butuhAlasanDiri = false;
			onPesan({ ok: r.pesan + (r.effects_gagal?.length ? ' ' + TEKS.efekGagal : '') });
			buka = null;
			await muat();
		} catch (e) {
			if ((e as { kode?: string })?.kode === 'VERIFIKASI_SENDIRI_ALASAN_WAJIB') butuhAlasanDiri = true;
			onPesan({ err: e instanceof Error ? e.message : 'Gagal meloloskan SJ.' });
		} finally {
			sibuk = false;
		}
	}

	async function tahan() {
		if (!buka || sibuk) return;
		if (catatan.trim().length < 5) { onPesan({ err: 'Tulis alasan menahan di kolom catatan (min. 5 karakter).' }); return; }
		sibuk = true;
		onPesan({});
		try {
			const r = await api.workshop.tahan(buka.workshop as GWsKey, buka.header_id, { client_event_id: crypto.randomUUID(), alasan: catatan.trim() });
			onPesan({ ok: r.pesan });
			buka = null;
			await muat();
		} catch (e) {
			onPesan({ err: e instanceof Error ? e.message : 'Gagal menahan SJ.' });
		} finally {
			sibuk = false;
		}
	}

	onMount(muat);
</script>

<div class="rounded-xl p-3 mb-4" style="background: #faf5ff; border: 1px solid #e9d5ff">
	<div class="flex items-center gap-1.5 mb-1">
		<IconBuildingFactory2 size={18} class="text-purple-600" />
		<p class="text-[12px] font-bold text-purple-900" title="SJ Keluar dari workshop Ciketing & Balaraja yang belum Anda loloskan.">SJ Workshop Menunggu di Gerbang ({antrian.length})</p>
		{#if memuat}<IconLoader2 size={14} class="animate-spin text-purple-600" />{/if}
	</div>
	<p class="text-[10px] text-purple-800 mb-2">Scan QR di SJ workshop (atau pilih dari daftar). Cocokkan jumlah barang dengan SJ kertas, lalu Loloskan. Barang hanya boleh keluar bila SJ sudah <b>Disetujui Finance</b>. Ada yang tidak cocok? Tahan dan tulis alasannya.</p>

	<div class="flex gap-2 mb-2">
		<input class="flex-1 rounded-lg px-3 py-2 text-[12px]" style="background: white; border: 1px solid var(--sys-sep)" placeholder="Atau ketik nomor SJ…" bind:value={nomor}
			onkeydown={(e) => { if (e.key === 'Enter' && nomor.trim().length >= 3) cari({ nomor: nomor.trim() }); }} />
		<button class="px-3 rounded-lg text-[12px] font-bold text-white bg-purple-600 disabled:opacity-50" disabled={sibuk || nomor.trim().length < 3} onclick={() => cari({ nomor: nomor.trim() })}>Cari</button>
	</div>

	{#if antrian.length === 0 && !memuat}
		<p class="text-[11px] text-purple-800 italic">Tidak ada SJ workshop yang menunggu.</p>
	{/if}

	<div class="space-y-2">
		{#each antrian as r (r.workshop + r.header_id)}
			<div class="bg-white p-2.5 rounded-lg border border-purple-200 text-[12px]">
				<button class="w-full text-left" onclick={() => bukaBaris(r)}>
					<span class="font-bold text-gray-900 break-all">{r.no_sj}</span>
					<span class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#ede9fe;color:#5b21b6">{r.label}</span>
					<span class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style={APPROVAL_WARNA[r.approval]}>{APPROVAL_LABEL[r.approval]}</span>
					{#if r.ditahan}<span class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">DITAHAN</span>{/if}
					<span class="block text-[11px] text-gray-500">{r.tujuan || '-'} · {r.jumlah_item} barang · {menitText(r.menunggu_menit)}</span>
				</button>

				{#if buka && buka.header_id === r.header_id && buka.workshop === r.workshop}
					{@render detailBlok(buka)}
				{/if}
			</div>
		{/each}
	</div>

	<!-- Detail dari scan QR / pencarian nomor yang tidak ada di antrean (mis. sudah > 14 hari) -->
	{#if buka && !antrian.some((a) => a.header_id === buka!.header_id && a.workshop === buka!.workshop)}
		<div class="bg-white p-2.5 rounded-lg border border-purple-300 text-[12px] mt-2">
			<p class="font-bold text-gray-900 break-all">{buka.no_sj} <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#ede9fe;color:#5b21b6">{buka.label}</span></p>
			{@render detailBlok(buka)}
		</div>
	{/if}
</div>

{#snippet detailBlok(d: GWsDetail)}
	<div class="mt-1.5 space-y-1">
		<p class="text-[11px] text-gray-600">Tujuan: <b>{d.tujuan || '-'}</b>{d.project_nama ? ' · ' + d.project_nama : ''}</p>
		<ul class="text-[11px] text-gray-800 list-disc pl-4">
			{#each d.items as it}
				<li>{it.nama_barang}{it.no_part ? ` (${it.no_part})` : ''} — <b>{it.qty}{it.satuan ? ' ' + it.satuan : ''}</b>{it.luasan_m2 ? ` · ${it.luasan_m2} m²` : ''}</li>
			{/each}
		</ul>
		<p class="text-[11px]" style="color:#6b7280">Status Finance: <b>{APPROVAL_LABEL[d.approval]}</b>{d.approval_oleh ? ' oleh ' + d.approval_oleh : ''}{d.catatan_finance ? ' — ' + d.catatan_finance : ''}</p>
		<p class="text-[11px]" style="color:#6b7280">Gudang: {d.siap_gudang ? `siap (${d.siap_gudang.oleh || '-'})` : 'belum menandai siap'}</p>
		{#if d.ditahan}<p class="text-[11px] text-orange-700">Ditahan{d.ditahan.oleh ? ' oleh ' + d.ditahan.oleh : ''}: {d.ditahan.alasan}</p>{/if}
		{#each d.blockers as b}<p class="text-[11px] font-semibold text-red-700">⛔ {b.pesan}</p>{/each}
		{#each d.warnings as w}<p class="text-[11px] text-amber-700">⚠️ {w.pesan}</p>{/each}
	</div>

	{#if !d.sudah_lolos}
		<label class="flex items-center gap-2 mt-2 text-[12px] text-gray-800">
			<input type="checkbox" bind:checked={jumlahOk} disabled={!d.can_pass || sibuk} />
			Jumlah barang sesuai dengan SJ
		</label>
		{#if butuhAlasanDiri}
			<p class="text-[11px] font-semibold text-amber-700 mt-1" role="status">⚠️ Anda pembuat SJ ini. Isi alasan di kolom catatan di bawah (min. 10 karakter), lalu tekan Loloskan lagi — atasan akan diberi tahu.</p>
		{/if}
		<textarea class="w-full rounded-lg px-3 py-2 text-[12px] mt-1" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" rows="2" placeholder="Catatan (opsional). Wajib diisi bila ditahan." bind:value={catatan}></textarea>
		<button class="w-full mt-2 py-2 rounded-lg text-[12px] font-bold text-white bg-green-600 disabled:opacity-50" disabled={sibuk || !d.can_pass || !jumlahOk} onclick={loloskan}
			title={d.can_pass ? 'Barang boleh keluar gerbang.' : 'SJ belum bisa diloloskan — lihat alasan di atas.'}>
			{sibuk ? 'Memproses…' : 'Loloskan'}
		</button>
		<button class="w-full mt-1.5 py-2 rounded-lg text-[12px] font-bold text-red-700 bg-red-50 border border-red-200 disabled:opacity-50" disabled={sibuk} onclick={tahan}
			title="Tahan bila jumlah/barang/plat/driver tidak cocok. Isi alasan di kolom catatan; logistik otomatis diberi tahu.">Tahan</button>
	{/if}
{/snippet}
