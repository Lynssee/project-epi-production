<script lang="ts">
	// Kalkulator Kebutuhan Cat (Inventory 360° Fase 5 — alat lapangan). Hitung liter/kaleng & thinner dari luas, target DFT, solid volume (dari TDS),
	// dan faktor kehilangan. Hitungan murni di perangkat (tetap jalan di area minim sinyal); pemilih produk opsional memakai 1 panggilan jaringan dan disembunyikan bila gagal.
	import { IconArrowLeft, IconPlus, IconTrash } from '@tabler/icons-svelte';
	import { hitungKebutuhan, type LapisInput } from '$lib/utils/kebutuhanCat';
	import { onMount } from 'svelte';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { PAIR_ROLE_LABEL } from '$lib/shared/plSet';

	type LapisForm = { nama: string; dftUm: string; solidVolumePct: string };

	let luas = $state('');
	let loss = $state('30');
	let thinner = $state('');
	let kemasan = $state('20');
	// Pemilih produk (opsional, Product Pairing Fase 3): mengisi % thinner & menampilkan jenis thinner resmi dari aturan Admin.
	// Butuh 1 panggilan jaringan; gagal/offline => pemilih disembunyikan dan kalkulator tetap manual.
	let aturan = $state<any[]>([]);
	let produkKey = $state('');
	onMount(async () => {
		try {
			const token = await getIdToken();
			const res = await fetch('/api/packing-list/set-rules', { headers: { Authorization: `Bearer ${token}` } });
			const j = res.ok ? await res.json() : null;
			if (j?.success) aturan = j.product || [];
		} catch (e) {
			console.warn('[kalkulator-cat] aturan pasangan thinner tidak dimuat (mode manual):', e);
		}
	});
	let produk = $derived(aturan.find((a) => a.key === produkKey) || null);
	let pasangan = $derived((produk?.pairs || []).filter((p: any) => p.requirement === 'wajib' || p.ratio_pct));
	// Memilih produk mengisi % thinner dari rasio pasangan campuran (bisa diubah manual setelahnya).
	function pilihProduk(key: string) {
		produkKey = key;
		const mix = (aturan.find((a) => a.key === key)?.pairs || []).find((p: any) => p.role === 'mixing' && p.ratio_pct);
		if (mix) thinner = String(mix.ratio_pct).replace('.', ',');
	}
	let lapis = $state<LapisForm[]>([{ nama: 'Lapis 1', dftUm: '', solidVolumePct: '' }]);

	let hasil = $derived(
		hitungKebutuhan({
			luasM2: Number(String(luas).replace(',', '.')),
			lossPct: Number(String(loss).replace(',', '.')),
			thinnerPct: Number(String(thinner).replace(',', '.')) || 0,
			kemasanLiter: Number(String(kemasan).replace(',', '.')) || 0,
			lapis: lapis.map<LapisInput>((l) => ({
				nama: l.nama,
				dftUm: Number(String(l.dftUm).replace(',', '.')),
				solidVolumePct: Number(String(l.solidVolumePct).replace(',', '.'))
			}))
		})
	);
	// Tampilkan hasil hanya setelah user mulai mengisi (hindari pesan galat saat form masih kosong).
	let sudahIsi = $derived(!!luas || lapis.some((l) => l.dftUm || l.solidVolumePct));

	function tambahLapis() {
		lapis = [...lapis, { nama: `Lapis ${lapis.length + 1}`, dftUm: '', solidVolumePct: '' }];
	}
	function hapusLapis(i: number) {
		if (lapis.length > 1) lapis = lapis.filter((_, k) => k !== i);
	}
	const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
</script>

<div class="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/inventory-proyek/opname" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> Inventaris Proyek
		</a>
		<h1 class="text-xl font-bold text-gray-900">Kalkulator Kebutuhan Cat</h1>
		<p class="text-sm text-gray-500">Hitung berapa liter / kaleng cat dan thinner yang dibutuhkan untuk luas pekerjaan, sebelum mengajukan permintaan material.</p>
	</div>

	<div class="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[12px] text-blue-900">
		<p class="font-semibold">Cara pakai</p>
		<ol class="mt-1 list-decimal pl-4 space-y-0.5">
			<li>Isi <b>luas area</b> yang akan dicat.</li>
			<li>Untuk tiap lapis isi <b>DFT target</b> dan <b>Solid Volume (%)</b> — ambil dari TDS produk (bukan perkiraan).</li>
			<li><b>Faktor kehilangan</b> 20–40% umum untuk semprot di lapangan (angin, sisa di selang, permukaan kasar).</li>
			<li>Hasil dihitung langsung di HP, tidak butuh sinyal.</li>
		</ol>
	</div>

	<div class="grid grid-cols-2 gap-3">
		<label class="block text-[12px] font-semibold text-gray-700">Luas area (m²)
			<input type="text" inputmode="decimal" bind:value={luas} placeholder="mis. 250" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-[14px] font-normal focus:outline-none focus:ring-2 focus:ring-[var(--g)]" />
		</label>
		<label class="block text-[12px] font-semibold text-gray-700" title="Cat yang hilang saat aplikasi: angin, sisa di selang/kaleng, permukaan kasar.">Faktor kehilangan (%)
			<input type="text" inputmode="decimal" bind:value={loss} class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-[14px] font-normal focus:outline-none focus:ring-2 focus:ring-[var(--g)]" />
		</label>
		<label class="block text-[12px] font-semibold text-gray-700">Volume kemasan (liter)
			<input type="text" inputmode="decimal" bind:value={kemasan} class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-[14px] font-normal focus:outline-none focus:ring-2 focus:ring-[var(--g)]" />
		</label>
		{#if aturan.length}
			<label class="block text-[12px] font-semibold text-gray-700 sm:col-span-2" title="Opsional. Memilih produk mengisi % thinner dan menampilkan jenis thinner resmi sesuai aturan Admin.">Produk cat (opsional)
				<select value={produkKey} onchange={(e) => pilihProduk((e.currentTarget as HTMLSelectElement).value)} class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-[14px] font-normal bg-white focus:outline-none focus:ring-2 focus:ring-[var(--g)]">
					<option value="">— pilih produk untuk mengisi thinner otomatis —</option>
					{#each aturan as a (a.key)}<option value={a.key}>{a.label}</option>{/each}
				</select>
			</label>
			{#if produk}
				<div class="rounded-xl bg-sky-50 border border-sky-200 p-3 text-[12px] text-sky-900 space-y-1 sm:col-span-2" data-testid="kalkulator-pasangan">
					{#each pasangan as p (p.key)}
						<p><b>{PAIR_ROLE_LABEL[p.role] || p.role}</b> ({p.requirement === 'wajib' ? 'wajib' : 'opsional'}{p.ratio_pct ? `, ${p.ratio_pct}%` : ''}): {p.options.map((o: any) => o.label).join(' atau ')}{p.note ? ` — ${p.note}` : ''}</p>
					{/each}
				</div>
			{/if}
		{/if}
		<label class="block text-[12px] font-semibold text-gray-700" title="Pengencer sebagai persen volume cat. Kosongkan bila tidak dipakai.">Thinner (% dari cat)
			<input type="text" inputmode="decimal" bind:value={thinner} placeholder="mis. 10" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-[14px] font-normal focus:outline-none focus:ring-2 focus:ring-[var(--g)]" />
		</label>
	</div>

	<div class="space-y-2">
		<div class="flex items-center justify-between">
			<p class="text-[13px] font-bold text-gray-800">Lapis cat</p>
			<button class="inline-flex items-center gap-1 rounded-lg bg-gray-800 px-2.5 py-1.5 text-[12px] font-semibold text-white" onclick={tambahLapis}><IconPlus size={14} /> Tambah lapis</button>
		</div>
		{#each lapis as l, i (i)}
			<div class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end rounded-xl border border-gray-200 p-2.5">
				<label class="block text-[11px] font-semibold text-gray-600">Nama
					<input type="text" bind:value={l.nama} class="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] font-normal" />
				</label>
				<label class="block text-[11px] font-semibold text-gray-600">DFT (µm)
					<input type="text" inputmode="decimal" bind:value={l.dftUm} placeholder="mis. 100" class="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] font-normal" />
				</label>
				<label class="block text-[11px] font-semibold text-gray-600">Solid vol. (%)
					<input type="text" inputmode="decimal" bind:value={l.solidVolumePct} placeholder="mis. 60" class="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] font-normal" />
				</label>
				<button class="rounded-lg border border-red-200 p-2 text-red-600 disabled:opacity-30" onclick={() => hapusLapis(i)} disabled={lapis.length === 1} aria-label="Hapus lapis {i + 1}"><IconTrash size={14} /></button>
			</div>
		{/each}
	</div>

	{#if sudahIsi}
		<div class="rounded-2xl border {hasil.valid ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'} p-4 space-y-3">
			{#if !hasil.valid}
				<p class="text-[13px] font-semibold text-amber-800">{hasil.pesan}</p>
			{/if}
			{#if hasil.valid}
				<div class="grid grid-cols-3 gap-2 text-center">
					<div class="rounded-xl bg-white p-3"><p class="text-[11px] text-gray-500">Total cat</p><p class="text-xl font-black text-gray-900">{fmt(hasil.totalLiter)} <span class="text-[12px] font-semibold">L</span></p></div>
					<div class="rounded-xl bg-white p-3"><p class="text-[11px] text-gray-500">Kaleng</p><p class="text-xl font-black text-gray-900">{hasil.totalKaleng ?? '—'}</p></div>
					<div class="rounded-xl bg-white p-3"><p class="text-[11px] text-gray-500">Thinner</p><p class="text-xl font-black text-gray-900">{fmt(hasil.totalThinnerLiter)} <span class="text-[12px] font-semibold">L</span></p></div>
				</div>
			{/if}
			<div class="space-y-1.5">
				{#each hasil.lapis as l}
					<div class="rounded-lg bg-white px-3 py-2 text-[12px] text-gray-700">
						<p class="font-semibold text-gray-900">{l.nama || 'Lapis'}</p>
						{#if l.valid}
							<p>Daya sebar teoritis <b>{fmt(l.dayaSebarTeoritis)}</b> m²/L → praktis <b>{fmt(l.dayaSebarPraktis)}</b> m²/L · Kebutuhan <b>{fmt(l.liter)} L</b> · WFT acuan <b>{fmt(l.wftUm)} µm</b></p>
						{:else}
							<p class="text-amber-700">{l.alasan}</p>
						{/if}
					</div>
				{/each}
			</div>
			<p class="text-[11px] text-gray-500">Hasil ini perkiraan hitung dari data TDS yang Anda masukkan. Ikuti TDS resmi untuk jumlah lapis, pengenceran, dan jeda antar lapis; tambahkan cadangan untuk sambungan/area sulit.</p>
		</div>
	{/if}
</div>
