<script lang="ts">
	// Lembar "Pakai barang" di kiosk proyek (Fase 5): kru memilih barang dari stok proyek + jumlah + foto.
	// Ini hanya DRAF — stok TIDAK berkurang di sini. Leader memasukkannya ke Laporan Harian; stok berkurang saat laporan disimpan.
	import { onDestroy, onMount } from 'svelte';
	import { IconCamera, IconCircleCheck, IconLoader2, IconSearch, IconTrash, IconX } from '@tabler/icons-svelte';
	import { ambilBarang, kirimPemakaian, PemakaianKioskError, type BarangKiosk } from '$lib/services/kioskProyekPemakaian';
	import { parseQty } from '$lib/utils/kioskPemakaian';
	import { kompresFotoKiosk } from '$lib/services/kioskProyekAbsen';

	let {
		nama,
		manpowerId,
		fotoWajib,
		fotoMaxKb,
		onTutup,
		onGagalPerangkat
	}: {
		nama: string;
		manpowerId: number | null;
		fotoWajib: boolean;
		fotoMaxKb: number;
		onTutup: () => void;
		onGagalPerangkat: (reason: string) => void;
	} = $props();

	let barang = $state<BarangKiosk[]>([]);
	let muat = $state<'memuat' | 'siap' | 'gagal'>('memuat');
	let pesanMuat = $state('');
	let q = $state('');
	let dipilih = $state<BarangKiosk | null>(null);
	let qty = $state('');
	let teks = $state('');
	let foto = $state<File | null>(null);
	let fotoUrl = $state('');
	let inputFoto = $state<HTMLInputElement | null>(null);
	let tahap = $state<'isi' | 'kirim' | 'sukses' | 'gagal'>('isi');
	let fotoKecil = $state<File | null>(null); // dikompres sekali; kirim ulang memakai yang sama
	let bisaUlang = $state(false);
	let pesan = $state('');
	let sudahAda = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	const tampil = $derived(q.trim() ? barang.filter((b) => b.nama.toLowerCase().includes(q.trim().toLowerCase())) : barang);
	const qtyAngka = $derived(parseQty(qty));
	const melebihi = $derived(!!dipilih && qtyAngka != null && qtyAngka > dipilih.sisa);
	const bisaKirim = $derived(!!dipilih && qtyAngka != null && !melebihi && (!fotoWajib || !!foto) && tahap !== 'kirim');

	onMount(async () => {
		try {
			barang = await ambilBarang();
			muat = 'siap';
		} catch (e) {
			const ex = e as PemakaianKioskError;
			pesanMuat = ex.message;
			muat = 'gagal';
			if (ex.reason) onGagalPerangkat(ex.reason);
		}
	});

	function pilihFoto(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		input.value = '';
		if (!f) return;
		if (fotoUrl) URL.revokeObjectURL(fotoUrl);
		foto = f;
		fotoKecil = null;
		bisaUlang = false;
		fotoUrl = URL.createObjectURL(f);
	}
	function hapusFoto() {
		if (fotoUrl) URL.revokeObjectURL(fotoUrl);
		foto = null;
		fotoKecil = null;
		bisaUlang = false;
		fotoUrl = '';
	}

	async function kirim() {
		if (!bisaKirim || !dipilih) return;
		tahap = 'kirim'; // tombol langsung mati → ketuk ganda tidak mengirim dua kali
		pesan = '';
		try {
			if (foto && !fotoKecil) fotoKecil = await kompresFotoKiosk(foto, fotoMaxKb, 1280);
			const r = await kirimPemakaian({ manpowerId, expenseId: dipilih.expense_id, qty, catatan: teks.trim(), foto: fotoKecil });
			sudahAda = r.sudah_ada;
			tahap = 'sukses';
			timer = setTimeout(onTutup, 3000);
		} catch (e) {
			const ex = e as PemakaianKioskError;
			pesan = ex.message;
			tahap = 'gagal';
			bisaUlang = ex.bisaUlang === true;
			if (ex.reason) onGagalPerangkat(ex.reason);
		}
	}

	onDestroy(() => {
		if (timer) clearTimeout(timer);
		if (fotoUrl) URL.revokeObjectURL(fotoUrl);
	});
</script>

<div class="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Pakai barang">
	<div class="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4">
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="text-xl font-bold leading-tight">Pakai barang</p>
				<p class="text-sm text-gray-500 truncate">diajukan oleh {nama}</p>
			</div>
			{#if tahap !== 'kirim'}
				<button onclick={onTutup} class="p-2 rounded-xl border border-gray-300" aria-label="Tutup"><IconX size={22} /></button>
			{/if}
		</div>

		{#if tahap === 'sukses'}
			<div class="flex flex-col items-center gap-2 py-6 text-center">
				<IconCircleCheck size={64} class="text-emerald-600" />
				<p class="text-2xl font-bold">{sudahAda ? 'Sudah terkirim' : 'Pengajuan terkirim'}</p>
				<p class="text-base text-gray-600">Stok belum berkurang. Leader akan memeriksa lalu memasukkannya ke laporan harian.</p>
				<button onclick={onTutup} class="mt-2 px-8 py-3 rounded-xl bg-gray-900 text-white text-lg font-semibold">Selesai</button>
			</div>

		{:else if muat === 'memuat'}
			<div class="flex flex-col items-center gap-3 py-10 text-gray-500"><IconLoader2 class="animate-spin" size={36} /><p>Memuat stok proyek…</p></div>

		{:else if muat === 'gagal'}
			<p class="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-base">{pesanMuat}</p>

		{:else if !dipilih}
			<p class="text-sm text-gray-600">Langkah: <b>1</b> pilih barang → <b>2</b> isi jumlah → <b>3</b> foto → <b>4</b> kirim. Ini <b>pengajuan</b>, stok belum berkurang.</p>
			<label class="flex items-center gap-2 px-3 py-3 rounded-xl border border-gray-300 bg-white">
				<IconSearch size={20} class="text-gray-400 shrink-0" />
				<input bind:value={q} placeholder="Cari nama barang…" class="w-full text-lg outline-none bg-transparent" autocomplete="off" />
			</label>
			{#if barang.length === 0}
				<p class="p-4 text-center text-gray-500 rounded-xl bg-gray-50">Belum ada barang dengan sisa stok di proyek ini. Hubungi leader.</p>
			{:else if tampil.length === 0}
				<p class="p-4 text-center text-gray-500">Tidak ada barang yang cocok dengan “{q}”.</p>
			{:else}
				<ul class="space-y-2">
					{#each tampil as b (b.expense_id)}
						<li>
							<button type="button" onclick={() => (dipilih = b)} class="w-full text-left p-3 rounded-2xl bg-white border border-gray-200 active:bg-emerald-50">
								<p class="text-lg font-semibold leading-tight">{b.nama}</p>
								<p class="text-sm text-gray-500">Sisa stok: <b>{b.sisa}</b> {b.satuan}</p>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

		{:else}
			<div class="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="text-lg font-bold leading-tight">{dipilih.nama}</p>
					<p class="text-sm text-emerald-800">Sisa stok: {dipilih.sisa} {dipilih.satuan}</p>
				</div>
				{#if tahap !== 'kirim'}<button onclick={() => { dipilih = null; qty = ''; }} class="text-sm underline text-emerald-900 shrink-0">ganti</button>{/if}
			</div>

			<div>
				<label for="pb-qty" class="text-sm font-semibold text-gray-700">Jumlah dipakai ({dipilih.satuan || 'satuan'})</label>
				<input id="pb-qty" bind:value={qty} inputmode="decimal" autocomplete="off" placeholder="0"
					class="mt-1 w-full text-center text-4xl font-bold py-4 rounded-2xl border {melebihi ? 'border-red-400 bg-red-50' : 'border-gray-300'} bg-white" />
				{#if melebihi}<p class="mt-1 text-sm text-red-600">Melebihi sisa stok ({dipilih.sisa} {dipilih.satuan}). Cek ulang jumlahnya.</p>{/if}
				{#if qty && qtyAngka == null}<p class="mt-1 text-sm text-red-600">Isi angka lebih dari 0 (boleh pakai koma, maksimal 3 desimal).</p>{/if}
			</div>

			<div>
				{#if fotoUrl}
					<div class="relative">
						<img src={fotoUrl} alt="Foto pemakaian" class="w-full max-h-56 object-cover rounded-2xl border border-gray-200" />
						<button type="button" onclick={hapusFoto} class="absolute top-2 right-2 p-2 rounded-full bg-black/60 text-white" aria-label="Hapus foto"><IconTrash size={18} /></button>
					</div>
				{:else}
					<button type="button" onclick={() => inputFoto?.click()} class="w-full flex items-center justify-center gap-3 py-5 rounded-2xl border-2 border-dashed {fotoWajib ? 'border-emerald-400' : 'border-gray-300'} text-gray-700 text-lg font-semibold">
						<IconCamera size={26} /> Ambil foto{fotoWajib ? ' (wajib)' : ''}
					</button>
				{/if}
				<input bind:this={inputFoto} type="file" accept="image/*" capture="environment" class="hidden" onchange={pilihFoto} />
			</div>

			<div>
				<label for="pb-cat" class="text-sm font-semibold text-gray-700">Keterangan (boleh kosong)</label>
				<input id="pb-cat" bind:value={teks} maxlength="300" placeholder="Contoh: dipakai untuk primer tangki 250 KL" class="mt-1 w-full px-3 py-3 text-lg rounded-2xl border border-gray-300 bg-white" />
			</div>

			{#if tahap === 'gagal'}<p class="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-base">{pesan}</p>{/if}

			<button onclick={kirim} disabled={!bisaKirim} class="w-full flex items-center justify-center gap-2 py-5 rounded-2xl bg-emerald-600 text-white text-2xl font-bold disabled:opacity-40">
				{#if tahap === 'kirim'}<IconLoader2 class="animate-spin" size={26} /> Mengirim…{:else if bisaUlang}Kirim ulang{:else}Ajukan pemakaian{/if}
			</button>
			{#if fotoWajib && !foto}<p class="text-center text-sm text-gray-500">Ambil foto dulu untuk bisa mengirim.</p>{/if}
		{/if}
	</div>
</div>
