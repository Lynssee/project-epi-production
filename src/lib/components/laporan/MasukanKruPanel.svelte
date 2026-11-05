<script lang="ts">
	// Panel "Masukan kru hari ini" di form Laporan Harian (Rencana Kiosk Proyek, Fase 4).
	// Kru mengirim foto + catatan singkat dari kiosk; leader mencentang yang layak lalu menekan satu tombol —
	// foto masuk ke foto progres/kendala dan teksnya ke catatan umum/kendala. Foto sudah berupa file Directus
	// (tidak diunggah ulang). Status catatan baru berubah jadi "dipakai" setelah laporan benar-benar tersimpan.
	// Panel DIAM bila tidak ada catatan, fitur belum disiapkan di server (503), atau pengguna bukan leader proyek (403).
	import { untrack } from 'svelte';
	import { IconNotes, IconRefresh, IconCheck } from '@tabler/icons-svelte';
	import { secureAssetSrc } from '$lib/actions/secureAsset';
	import { abaikanMasukanKru, getMasukanKru, type JenisMasukan, type MasukanKru, type MasukanPemakaian } from '$lib/services/laporanMasukanKru';
	import { susunImpor, type HasilImpor } from '$lib/utils/kioskCatatan';

	let {
		projectId,
		tanggal,
		disabled = false,
		onImpor,
		onImporPemakaian
	}: {
		projectId: number;
		tanggal: string;
		disabled?: boolean;
		onImpor: (hasil: HasilImpor, ids: number[]) => void;
		onImporPemakaian: (drafs: MasukanPemakaian[]) => void;
	} = $props();

	let daftar = $state<MasukanKru[]>([]);
	let dipilih = $state<Set<number>>(new Set());
	let draf = $state<MasukanPemakaian[]>([]);
	let drafDipilih = $state<Set<number>>(new Set());
	const totalDipilih = $derived(dipilih.size + drafDipilih.size);
	let memuat = $state(false);
	let pesan = $state('');
	let sembunyi = $state(false); // 403/503 → panel tidak relevan

	async function muat() {
		memuat = true;
		pesan = '';
		try {
			const r = await getMasukanKru(projectId, tanggal);
			daftar = r.catatan || [];
			dipilih = new Set(daftar.map((c) => c.id)); // bawaan: semua tercentang, leader hanya mencabut yang tidak layak
			draf = r.pemakaian || [];
			drafDipilih = new Set(draf.map((d) => d.id));
			sembunyi = false;
		} catch (e) {
			const st = (e as { status?: number }).status;
			if (st === 403 || st === 503) sembunyi = true;
			else pesan = (e as Error).message;
			daftar = [];
			draf = [];
		} finally {
			memuat = false;
		}
	}

	// Muat ulang tiap proyek/tanggal laporan berubah (leader bisa mengisi laporan susulan).
	$effect(() => {
		void projectId;
		void tanggal;
		untrack(() => muat());
	});

	function toggle(id: number) {
		const s = new Set(dipilih);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		dipilih = s;
	}

	function toggleDraf(id: number) {
		const s = new Set(drafDipilih);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		drafDipilih = s;
	}

	function masukkan() {
		if (disabled) return;
		const terpilih = daftar.filter((c) => dipilih.has(c.id));
		const drafTerpilih = draf.filter((d) => drafDipilih.has(d.id));
		if (!terpilih.length && !drafTerpilih.length) return;
		if (terpilih.length) {
			onImpor(susunImpor(terpilih), terpilih.map((c) => c.id));
			const ids = new Set(terpilih.map((c) => c.id));
			daftar = daftar.filter((c) => !ids.has(c.id));
			dipilih = new Set();
		}
		if (drafTerpilih.length) {
			onImporPemakaian(drafTerpilih);
			const ids = new Set(drafTerpilih.map((d) => d.id));
			draf = draf.filter((d) => !ids.has(d.id));
			drafDipilih = new Set();
		}
		const bagian = [terpilih.length ? `${terpilih.length} catatan` : '', drafTerpilih.length ? `${drafTerpilih.length} pemakaian barang` : ''].filter(Boolean).join(' + ');
		pesan = `✓ ${bagian} dimasukkan ke form. Periksa isinya${drafTerpilih.length ? ' (jumlah barang bisa diubah di Material Terpakai)' : ''}, lalu kirim laporan seperti biasa.`;
	}

	async function abaikan(c: MasukanKru) {
		if (!confirm('Abaikan catatan ini? Catatan tidak akan muncul lagi di daftar.')) return;
		try {
			await abaikanMasukanKru(projectId, [c.id], 'catatan' satisfies JenisMasukan);
			daftar = daftar.filter((x) => x.id !== c.id);
			const s = new Set(dipilih);
			s.delete(c.id);
			dipilih = s;
		} catch (e) {
			pesan = (e as Error).message;
		}
	}

	async function abaikanDraf(d: MasukanPemakaian) {
		if (!confirm('Abaikan pengajuan barang ini? Tidak akan muncul lagi di daftar, dan stok tidak berubah.')) return;
		try {
			await abaikanMasukanKru(projectId, [d.id], 'pemakaian' satisfies JenisMasukan);
			draf = draf.filter((x) => x.id !== d.id);
			const s = new Set(drafDipilih);
			s.delete(d.id);
			drafDipilih = s;
		} catch (e) {
			pesan = (e as Error).message;
		}
	}
</script>

{#if !sembunyi && (daftar.length > 0 || draf.length > 0 || pesan)}
	<section class="mb-4 p-4 rounded-2xl border border-sky-200 bg-sky-50 dark:bg-slate-800/60 dark:border-slate-700" aria-label="Masukan kru hari ini">
		<div class="flex items-center justify-between gap-2">
			<h3 class="text-sm font-bold flex items-center gap-1.5 text-sky-900 dark:text-sky-200">
				<IconNotes size={18} /> Masukan kru hari ini{daftar.length + draf.length ? ` (${daftar.length + draf.length})` : ''}
			</h3>
			<button type="button" onclick={muat} disabled={memuat} class="p-1.5 rounded-lg hover:bg-sky-100 disabled:opacity-40" title="Muat ulang" aria-label="Muat ulang masukan kru"><IconRefresh size={16} class={memuat ? 'animate-spin' : ''} /></button>
		</div>

		{#if daftar.length || draf.length}
			<p class="text-[11px] text-sky-800 dark:text-sky-300 mt-1">
				Kru mengirim ini dari kiosk. Centang yang layak dipakai, lalu tekan <b>Masukkan ke laporan</b>. Catatan: foto → foto progres/kendala, tulisan → catatan umum/kendala. Hapus centang untuk melewatkan.
			</p>
			{#if draf.length}
				<p class="mt-2 text-[11px] p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
					<b>Pemakaian barang</b> hanya pengajuan kru. Setelah dimasukkan, jadi baris di <i>Material Terpakai</i> — <b>stok baru berkurang saat laporan ini disimpan</b>. Periksa jumlahnya dulu.
				</p>
				<ul class="mt-2 space-y-2">
					{#each draf as d (d.id)}
						<li class="flex gap-3 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200">
							<input type="checkbox" checked={drafDipilih.has(d.id)} onchange={() => toggleDraf(d.id)} disabled={disabled} class="mt-1 w-5 h-5 accent-amber-600 shrink-0" aria-label="Pilih pemakaian {d.nama_barang}" />
							{#if d.foto}
								<img use:secureAssetSrc={d.foto} alt="Foto pemakaian" class="w-16 h-16 rounded-lg object-cover border border-gray-200 shrink-0" />
							{/if}
							<div class="min-w-0 flex-1 text-xs">
								<p class="font-semibold break-words">{d.nama_barang} <span class="text-amber-700">· {d.qty} {d.satuan || ''}</span></p>
								<p class="text-gray-500">diajukan {d.manpower_nama || 'Kru'}{d.catatan ? ` — ${d.catatan}` : ''}</p>
							</div>
							<button type="button" onclick={() => abaikanDraf(d)} disabled={disabled} class="self-start text-[11px] text-gray-400 hover:text-red-600 underline shrink-0" title="Buang pengajuan ini">abaikan</button>
						</li>
					{/each}
				</ul>
			{/if}
			<ul class="mt-3 space-y-2">
				{#each daftar as c (c.id)}
					<li class="flex gap-3 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700">
						<input type="checkbox" checked={dipilih.has(c.id)} onchange={() => toggle(c.id)} disabled={disabled} class="mt-1 w-5 h-5 accent-sky-600 shrink-0" aria-label="Pilih catatan {c.manpower_nama || ''}" />
						{#if c.foto}
							<img use:secureAssetSrc={c.foto} alt="Foto catatan" class="w-16 h-16 rounded-lg object-cover border border-gray-200 shrink-0" />
						{/if}
						<div class="min-w-0 flex-1 text-xs">
							<p class="font-semibold truncate">{c.manpower_nama || 'Kru'}
								{#if c.kategori}<span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold {c.jenis === 'kendala' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}">{c.kategori}</span>{/if}
							</p>
							<p class="text-gray-600 dark:text-slate-300 break-words">{c.catatan || (c.foto ? 'Hanya foto' : '')}</p>
						</div>
						<button type="button" onclick={() => abaikan(c)} disabled={disabled} class="self-start text-[11px] text-gray-400 hover:text-red-600 underline shrink-0" title="Buang catatan ini dari daftar">abaikan</button>
					</li>
				{/each}
			</ul>
			<button type="button" onclick={masukkan} disabled={disabled || totalDipilih === 0}
				class="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold disabled:opacity-40">
				<IconCheck size={16} /> Masukkan {totalDipilih} ke laporan
			</button>
		{/if}
		{#if pesan}<p class="mt-2 text-xs {pesan.startsWith('✓') ? 'text-emerald-700' : 'text-red-600'}">{pesan}</p>{/if}
	</section>
{/if}
