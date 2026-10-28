<!-- src/routes/(app)/ruangan/[areaId]/tambah/+page.svelte -->
<!--
	Sensus barang — form cepat BERULANG (Barang per Ruangan via QR Patroli, Fase 3).
	Cari katalog (identitas_barang perabotan/elektronik/peralatan) -> qty -> kondisi
	-> foto opsional -> "Simpan & Tambah Lagi". Chip preset untuk barang umum.

	Akses digerbangi di klien oleh permission kelola_aset_ruangan (pola sama
	/stock-lapangan/cek-area & /api/sji — identitas pencatat tetap di-resolve
	server-side, tidak bisa dipalsukan).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { cariKatalog, tambahBarang, type KatalogHit } from '$lib/services/gaRuangan';
	import { secureDirectusFetch } from '$lib/services/secureDirectus';
	import { IconArrowLeft, IconLoader2, IconCheck, IconSearch, IconCamera } from '@tabler/icons-svelte';

	const areaId = Number(page.params.areaId);

	const canKelola = $derived(hasPermission($authStore.roleId, 'kelola_aset_ruangan', $rolesStore, $authStore.roleIds));

	const PRESET = ['Meja kerja', 'Kursi kerja', 'AC Split', 'Lemari arsip', 'Dispenser', 'Kipas angin', 'TV', 'Proyektor'];
	const KATEGORI_OPTIONS = [
		{ value: 'perabotan', label: 'Perabotan' },
		{ value: 'elektronik', label: 'Elektronik' },
		{ value: 'peralatan', label: 'Peralatan' },
		{ value: 'lainnya', label: 'Lainnya' }
	];

	let q = $state('');
	let hits = $state<KatalogHit[]>([]);
	let searching = $state(false);
	let searchErr = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;

	let selectedKatalog = $state<KatalogHit | null>(null);
	let kategori = $state('perabotan');
	let modeLacak = $state<'unit' | 'kolektif'>('unit');
	let qty = $state(1);
	let qtyRusak = $state(0);
	let kondisi = $state<'baik' | 'perlu_perbaikan' | 'rusak'>('baik');
	let catatan = $state('');
	let fotoFile = $state<File | null>(null);

	let saving = $state(false);
	let saveErr = $state('');
	let savedCount = $state(0);

	function onSearch() {
		if (timer) clearTimeout(timer);
		selectedKatalog = null;
		const term = q.trim();
		if (term.length < 2) {
			hits = [];
			return;
		}
		timer = setTimeout(async () => {
			searching = true;
			searchErr = '';
			try {
				const { hasil } = await cariKatalog(term, kategori);
				hits = hasil;
			} catch (err) {
				searchErr = err instanceof Error ? err.message : 'Gagal mencari katalog.';
			}
			searching = false;
		}, 300);
	}

	function pickPreset(name: string) {
		q = name;
		onSearch();
	}

	function pick(h: KatalogHit) {
		selectedKatalog = h;
		q = h.nama;
		kategori = h.kategori;
		hits = [];
	}

	async function uploadFoto(): Promise<string | null> {
		if (!fotoFile) return null;
		const fd = new FormData();
		fd.append('file', fotoFile);
		const res = await secureDirectusFetch('/files', { method: 'POST', body: fd });
		if (!res.ok) throw new Error('Gagal unggah foto.');
		const j = await res.json();
		return j?.data?.id ?? null;
	}

	function resetForm(keepKategori = true) {
		q = '';
		selectedKatalog = null;
		hits = [];
		qty = 1;
		qtyRusak = 0;
		kondisi = 'baik';
		catatan = '';
		fotoFile = null;
		if (!keepKategori) kategori = 'perabotan';
	}

	// Keputusan Lead (10 Sep 2026): katalog TETAP WAJIB (izinkan_barang_tanpa_katalog=false
	// di app_settings). Server menolak (400) kalau identitas_barang_id kosong -- klien
	// menegakkan hal yang sama lebih dulu supaya error terasa jelas, bukan gagal diam-diam.
	// Katalog perabotan/elektronik/peralatan sudah diisi daftar umum kantor (lihat seed
	// scripts/seed-identitas-barang-kantor.mjs) agar sensus jarang mentok di sini.
	const bisaSimpan = $derived(!!selectedKatalog);

	async function simpan(tambahLagi: boolean) {
		saveErr = '';
		if (!selectedKatalog) {
			saveErr = 'Pilih salah satu barang dari hasil pencarian katalog dulu.';
			return;
		}
		saving = true;
		try {
			let fotoId: string | null = null;
			try {
				fotoId = await uploadFoto();
			} catch (err) {
				// Foto opsional — jangan gagalkan penyimpanan barang karena unggah foto gagal.
				console.error('[ruangan/tambah] gagal unggah foto, lanjut tanpa foto:', err);
			}
			await tambahBarang(areaId, {
				identitas_barang_id: selectedKatalog.id,
				kategori,
				mode_lacak: modeLacak,
				qty: modeLacak === 'kolektif' ? qty : 1,
				qty_rusak: qtyRusak,
				kondisi,
				foto: fotoId,
				catatan: catatan.trim() || null
			});
			savedCount += 1;
			if (tambahLagi) {
				resetForm(true);
			} else {
				await goto(`/ruangan/${areaId}`);
			}
		} catch (err) {
			saveErr = err instanceof Error ? err.message : 'Gagal menyimpan barang.';
		}
		saving = false;
	}
</script>

<svelte:head><title>Tambah Barang — Barang per Ruangan</title></svelte:head>

<div class="scroll-body">
	<div class="max-w-md mx-auto p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto(`/ruangan/${areaId}`)}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Tambah Barang</h1>
			{#if savedCount > 0}
				<span class="text-[11px] ml-auto flex items-center gap-1" style="color: var(--g)">
					<IconCheck size={13} /> {savedCount} tersimpan
				</span>
			{/if}
		</div>

		{#if !canKelola}
			<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<p class="text-[12px]" style="color: var(--sys-label3)">
					Anda tidak memiliki akses untuk menambah barang ruangan. Hubungi Admin GA.
				</p>
			</div>
		{:else}
			<p class="text-[11px] mb-3" style="color: var(--sys-label4)">
				Cari barang di katalog lalu ketuk hasilnya untuk memilih — atau ketuk salah satu
				preset di bawah. Barang harus dipilih dari katalog sebelum disimpan.
			</p>

			<div class="flex flex-wrap gap-1.5 mb-3">
				{#each PRESET as p (p)}
					<button
						class="rounded-full px-2.5 py-1 text-[11px]"
						style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
						onclick={() => pickPreset(p)}
					>
						{p}
					</button>
				{/each}
			</div>

			<label class="flex items-center gap-2 rounded-xl px-3 py-2 mb-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconSearch size={14} style="color: var(--sys-label3)" />
				<input
					bind:value={q}
					oninput={onSearch}
					placeholder="Cari nama barang di katalog…"
					class="flex-1 bg-transparent outline-none py-0.5"
					style="color: var(--sys-label)"
				/>
			</label>
			{#if searching}
				<p class="text-[11px] mb-2" style="color: var(--sys-label4)">Mencari…</p>
			{:else if hits.length > 0}
				<div class="rounded-xl overflow-hidden mb-2" style="border: 1px solid var(--sys-sep)">
					{#each hits as h, i (h.id)}
						<button
							class="w-full text-left px-3 py-2 text-[12px]"
							style="background: var(--sys-fill); {i > 0 ? 'border-top: 1px solid var(--sys-sep)' : ''}"
							onclick={() => pick(h)}
						>
							{h.nama}
						</button>
					{/each}
				</div>
			{/if}
			{#if selectedKatalog}
				<div class="rounded-lg px-2.5 py-1.5 mb-3 text-[11px]" style="background: rgba(34,197,94,.12); color: #15803d">
					✓ Tertaut katalog: {selectedKatalog.nama}
				</div>
			{:else if q.trim().length >= 2 && !searching && hits.length === 0}
				<div class="rounded-lg px-2.5 py-1.5 mb-3 text-[11px]" style="background: rgba(234,179,8,.14); color: #a16207">
					Tidak ditemukan di katalog. Minta Admin GA menambahkan "{q.trim()}" ke katalog dulu
					(Setelan GA Aset), baru bisa disensus.
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-2 mb-3">
				<label class="text-[11px]" style="color: var(--sys-label3)">
					Kategori
					<select bind:value={kategori} class="w-full mt-1 rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)">
						{#each KATEGORI_OPTIONS as o (o.value)}
							<option value={o.value}>{o.label}</option>
						{/each}
					</select>
				</label>
				<label class="text-[11px]" style="color: var(--sys-label3)">
					Mode lacak
					<select bind:value={modeLacak} class="w-full mt-1 rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)">
						<option value="unit">Unit per barang</option>
						<option value="kolektif">Kolektif (mis. 6 kursi)</option>
					</select>
				</label>
			</div>
			<p class="text-[10px] mb-3" style="color: var(--sys-label4)">
				<strong>Unit</strong> untuk barang bernilai yang perlu dilacak satu per satu (AC, TV, laptop).
				<strong>Kolektif</strong> untuk barang serupa yang tidak perlu dibedakan (kursi, meja).
			</p>

			{#if modeLacak === 'kolektif'}
				<div class="grid grid-cols-2 gap-2 mb-3">
					<label class="text-[11px]" style="color: var(--sys-label3)">
						Jumlah
						<input type="number" min="1" bind:value={qty} class="w-full mt-1 rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
					</label>
					<label class="text-[11px]" style="color: var(--sys-label3)">
						Jumlah rusak
						<input type="number" min="0" max={qty} bind:value={qtyRusak} class="w-full mt-1 rounded-lg px-2.5 py-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)" />
					</label>
				</div>
			{/if}

			<label class="text-[11px] block mb-3" style="color: var(--sys-label3)">
				Kondisi
				<div class="flex gap-2 mt-1">
					{#each [['baik', 'Baik'], ['perlu_perbaikan', 'Perlu perbaikan'], ['rusak', 'Rusak']] as [val, label]}
						<button
							class="flex-1 rounded-lg py-2 text-[12px] font-semibold border"
							style={kondisi === val
								? 'background: var(--g); color: #fff; border-color: var(--g)'
								: 'background: var(--sys-bg); color: var(--sys-label); border-color: var(--sys-sep)'}
							onclick={() => (kondisi = val as typeof kondisi)}
						>{label}</button>
					{/each}
				</div>
			</label>

			<label class="rounded-xl flex items-center gap-2 px-3 py-2.5 mb-3 text-[12px] cursor-pointer" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label3)">
				<IconCamera size={16} />
				<span class="flex-1">{fotoFile ? fotoFile.name : 'Foto (opsional)'}</span>
				<input type="file" accept="image/*" capture="environment" class="hidden" onchange={(e) => (fotoFile = (e.target as HTMLInputElement).files?.[0] || null)} />
			</label>

			<textarea bind:value={catatan} rows="2" placeholder="Catatan (opsional)" class="w-full rounded-lg p-2.5 mb-3 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"></textarea>

			{#if saveErr}
				<p class="text-[11px] mb-2" style="color: var(--red)">{saveErr}</p>
			{/if}

			<div class="flex gap-2">
				<button
					class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold disabled:opacity-50"
					style="background: var(--sys-fill); color: var(--sys-label)"
					disabled={saving || !bisaSimpan}
					onclick={() => simpan(true)}
				>
					{saving ? 'Menyimpan…' : 'Simpan & Tambah Lagi'}
				</button>
				<button
					class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
					style="background: var(--g)"
					disabled={saving || !bisaSimpan}
					onclick={() => simpan(false)}
				>
					Simpan & Selesai
				</button>
			</div>
		{/if}
	</div>
</div>
