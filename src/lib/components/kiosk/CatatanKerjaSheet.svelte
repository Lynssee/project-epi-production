<script lang="ts">
	// Lembar "Catatan Kerja" di kiosk proyek (Fase 4): pilihan cepat + foto + 1-2 kalimat. Bukan laporan resmi —
	// leader yang menggabungkannya ke Laporan Harian. Tanpa ketik wajib: foto saja atau pilihan + foto sudah cukup.
	import { onDestroy } from 'svelte';
	import { IconCamera, IconCircleCheck, IconLoader2, IconTrash, IconX } from '@tabler/icons-svelte';
	import { CatatanKioskError, kirimCatatan, type PengaturanCatatan } from '$lib/services/kioskProyekCatatan';
	import { kompresFotoKiosk } from '$lib/services/kioskProyekAbsen';
	import { buatTxnId } from '$lib/utils/kioskProyekRetry';

	let {
		nama,
		manpowerId,
		pengaturan,
		fotoMaxKb,
		onTutup,
		onGagalPerangkat
	}: {
		nama: string;
		manpowerId: number | null;
		pengaturan: PengaturanCatatan;
		fotoMaxKb: number;
		onTutup: () => void;
		onGagalPerangkat: (reason: string) => void;
	} = $props();

	let kategori = $state('');
	let teks = $state('');
	let foto = $state<File | null>(null);
	let fotoUrl = $state('');
	let inputFoto = $state<HTMLInputElement | null>(null);
	let tahap = $state<'isi' | 'kirim' | 'sukses' | 'gagal'>('isi');
	// Foto terkompres di-cache sekali; id transaksi tetap sama selama isi tidak berubah, jadi kirim ulang
	// setelah respons hilang tidak menggandakan catatan di sisi server.
	let fotoKecil = $state<File | null>(null);
	let txnId = $state<string | null>(null);
	let bisaUlang = $state(false);
	const isiBerubah = () => {
		txnId = null;
		bisaUlang = false;
	};
	let pesan = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;

	const kelompok = $derived([
		{ judul: 'Progres', daftar: pengaturan.progres, kendala: false },
		{ judul: 'Kendala', daftar: pengaturan.kendala, kendala: true }
	]);

	const bisaKirim = $derived(!!kategori && (!!foto || teks.trim().length > 0) && tahap !== 'kirim');

	function pilihFoto(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		input.value = '';
		if (!f) return;
		if (fotoUrl) URL.revokeObjectURL(fotoUrl);
		foto = f;
		fotoKecil = null;
		isiBerubah();
		fotoUrl = URL.createObjectURL(f);
	}
	function hapusFoto() {
		if (fotoUrl) URL.revokeObjectURL(fotoUrl);
		foto = null;
		fotoKecil = null;
		isiBerubah();
		fotoUrl = '';
	}

	async function kirim() {
		if (!bisaKirim) return;
		tahap = 'kirim';
		pesan = '';
		try {
			if (foto && !fotoKecil) fotoKecil = await kompresFotoKiosk(foto, fotoMaxKb, 1280);
			txnId ??= buatTxnId();
			await kirimCatatan({ manpowerId, kategori, catatan: teks.trim(), foto: fotoKecil, txnId });
			tahap = 'sukses';
			timer = setTimeout(onTutup, 2500);
		} catch (e) {
			const ex = e as CatatanKioskError;
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

<div class="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Catatan kerja">
	<div class="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4">
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="text-xl font-bold leading-tight">Catatan kerja</p>
				<p class="text-sm text-gray-500 truncate">dari {nama}</p>
			</div>
			{#if tahap !== 'kirim'}
				<button onclick={onTutup} class="p-2 rounded-xl border border-gray-300" aria-label="Tutup"><IconX size={22} /></button>
			{/if}
		</div>

		{#if tahap === 'sukses'}
			<div class="flex flex-col items-center gap-2 py-6 text-center">
				<IconCircleCheck size={64} class="text-emerald-600" />
				<p class="text-2xl font-bold">Catatan terkirim</p>
				<p class="text-base text-gray-600">Leader akan memasukkannya ke laporan harian.</p>
				<button onclick={onTutup} class="mt-2 px-8 py-3 rounded-xl bg-gray-900 text-white text-lg font-semibold">Selesai</button>
			</div>
		{:else}
			<p class="text-sm text-gray-600">Langkah: <b>1</b> pilih jenis → <b>2</b> ambil foto (boleh tanpa tulisan) → <b>3</b> kirim.</p>

			<div class="space-y-3">
				{#each kelompok as g (g.judul)}
					{#if g.daftar.length}
						<div>
							<p class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">{g.judul}</p>
							<div class="flex flex-wrap gap-2">
								{#each g.daftar as k (k)}
									<button type="button" onclick={() => { kategori = k; isiBerubah(); }} aria-pressed={kategori === k}
										class="px-4 py-3 rounded-2xl text-base font-semibold border {kategori === k ? (g.kendala ? 'bg-red-600 text-white border-red-600' : 'bg-emerald-600 text-white border-emerald-600') : 'bg-white text-gray-700 border-gray-300'}">{k}</button>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			</div>

			<div>
				{#if fotoUrl}
					<div class="relative">
						<img src={fotoUrl} alt="Foto catatan" class="w-full max-h-64 object-cover rounded-2xl border border-gray-200" />
						<button type="button" onclick={hapusFoto} class="absolute top-2 right-2 p-2 rounded-full bg-black/60 text-white" aria-label="Hapus foto"><IconTrash size={18} /></button>
					</div>
				{:else}
					<button type="button" onclick={() => inputFoto?.click()} class="w-full flex items-center justify-center gap-3 py-5 rounded-2xl border-2 border-dashed border-gray-300 text-gray-700 text-lg font-semibold">
						<IconCamera size={26} /> Ambil foto
					</button>
				{/if}
				<input bind:this={inputFoto} type="file" accept="image/*" capture="environment" class="hidden" onchange={pilihFoto} />
			</div>

			<div>
				<label for="catatan-teks" class="text-sm font-semibold text-gray-700">Tulisan (boleh kosong bila ada foto)</label>
				<textarea id="catatan-teks" bind:value={teks} oninput={isiBerubah} maxlength={pengaturan.maks_karakter} rows="3" placeholder="Contoh: cat primer lantai 2 selesai ±40 m²"
					class="mt-1 w-full px-3 py-3 text-lg rounded-2xl border border-gray-300 bg-white"></textarea>
				<p class="text-xs text-gray-400 text-right">{teks.length}/{pengaturan.maks_karakter}</p>
			</div>

			{#if tahap === 'gagal'}
				<p class="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-base">{pesan}</p>
			{/if}

			<button onclick={kirim} disabled={!bisaKirim} class="w-full flex items-center justify-center gap-2 py-5 rounded-2xl bg-emerald-600 text-white text-2xl font-bold disabled:opacity-40">
				{#if tahap === 'kirim'}<IconLoader2 class="animate-spin" size={26} /> Mengirim…{:else if bisaUlang}Kirim ulang{:else}Kirim catatan{/if}
			</button>
			{#if !kategori}<p class="text-center text-sm text-gray-500">Pilih jenis catatan dulu.</p>{/if}
		{/if}
	</div>
</div>
