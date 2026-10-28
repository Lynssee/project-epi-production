<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		fetchSjiMeta,
		searchSjiItems,
		createSji,
		type SjiMeta,
		type SjiSearchItem,
		type SjiCreateItem
	} from '$lib/services/sjiApi';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconAlertTriangle, IconSearch, IconTrash, IconPlus } from '@tabler/icons-svelte';
	import TunggakanFisikWidget from '$lib/components/TunggakanFisikWidget.svelte';

	let meta = $state<SjiMeta | null>(null);
	let metaError = $state('');

	let gudangId = $state('');
	let urgency = $state<'normal' | 'urgent'>('normal');
	let keperluan = $state('');

	interface CartLine {
		itemId: number;
		nama: string;
		satuan: string | null;
		stokTersedia: number;
		quantity: number;
		tipe: 'ambil_pakai' | 'pinjam';
	}
	let cart = $state<CartLine[]>([]);

	let searchQuery = $state('');
	let searchResults = $state<SjiSearchItem[]>([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	let successRef = $state('');

	onMount(async () => {
		try {
			meta = await fetchSjiMeta();
			if (meta.gudang.length === 1) gudangId = String(meta.gudang[0].id);
		} catch (e: any) {
			metaError = e?.message || 'Gagal memuat data awal.';
		}
	});

	function onSearchInput() {
		clearTimeout(searchTimer);
		if (searchQuery.trim().length < 2) {
			searchResults = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			searching = true;
			try {
				searchResults = await searchSjiItems(searchQuery);
			} catch {
				searchResults = [];
			} finally {
				searching = false;
			}
		}, 300);
	}

	function addToCart(item: SjiSearchItem) {
		if (cart.some((c) => c.itemId === item.id)) return;
		cart = [
			...cart,
			{
				itemId: item.id,
				nama: item.nama_barang_lengkap,
				satuan: item.satuan,
				stokTersedia: parseFloat(item.stok_tersedia) || 0,
				quantity: 1,
				tipe: item.is_borrowable ? 'pinjam' : 'ambil_pakai'
			}
		];
		searchQuery = '';
		searchResults = [];
	}

	function removeFromCart(itemId: number) {
		cart = cart.filter((c) => c.itemId !== itemId);
	}

	let canSubmit = $derived(!!gudangId && cart.length > 0 && cart.every((c) => c.quantity > 0) && !submitting);

	async function handleSubmit() {
		if (!canSubmit) return;
		submitting = true;
		errorMsg = '';
		try {
			const items: SjiCreateItem[] = cart.map((c) => ({ itemId: c.itemId, quantity: c.quantity, tipe: c.tipe }));
			const res = await createSji({ gudangId: Number(gudangId), urgency, keperluan: keperluan.trim(), items });
			successRef = res.reference_no;
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengajukan SJI.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/sji')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">SJI {successRef} terkirim</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Menunggu persetujuan.</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/sji')}>
				Kembali ke Daftar SJI
			</button>
		</div>
	{:else if metaError}
		<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
			<div>{metaError}</div>
		</div>
	{:else if !meta}
		<div class="flex flex-col items-center justify-center py-16">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat formulir pengajuan SJI..." />
	</div>
	{:else if !meta.settings['inventory.sji.enabled']}
		<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-800 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-amber-600" />
			<div>Fitur Surat Jalan Internal belum diaktifkan admin.</div>
		</div>
	{:else}
		<TunggakanFisikWidget compact />
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Ajukan Surat Jalan Internal</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Ambil barang habis-pakai atau pinjam alat, bisa dicampur dalam satu pengajuan</p>

		<div class="flex flex-col gap-4">
			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="gudang">Lokasi (ambil dari gudang / dipakai di proyek)</label>
				<select id="gudang" class="w-full rounded-lg border text-[13px] p-3 bg-white" style="border-color: var(--sys-sep)" bind:value={gudangId}>
					<option value="">— Pilih lokasi —</option>
					{#if meta.gudang.some((g) => g.kategori === 'gudang')}
						<optgroup label="Gudang">
							{#each meta.gudang.filter((g) => g.kategori === 'gudang') as g (g.id)}
								<option value={String(g.id)}>{g.nama_gudang}</option>
							{/each}
						</optgroup>
					{/if}
					{#if meta.gudang.some((g) => g.kategori === 'proyek')}
						<optgroup label="Proyek Berjalan">
							{#each meta.gudang.filter((g) => g.kategori === 'proyek') as g (g.id)}
								<option value={String(g.id)}>{g.nama_gudang}</option>
							{/each}
						</optgroup>
					{/if}
				</select>
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="urgency">Urgensi</label>
				<select id="urgency" class="w-full rounded-lg border text-[13px] p-3 bg-white" style="border-color: var(--sys-sep)" bind:value={urgency}>
					<option value="normal">Normal</option>
					<option value="urgent">Urgent</option>
				</select>
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="keperluan">Keperluan</label>
				<textarea id="keperluan" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" rows="2" placeholder="Untuk pekerjaan apa" bind:value={keperluan}></textarea>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Cari & Tambah Item</p>
				<div class="relative">
					<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
					<input
						class="w-full rounded-lg border text-[13px] p-3 pl-9"
						style="border-color: var(--sys-sep)"
						placeholder="Ketik nama barang..."
						bind:value={searchQuery}
						oninput={onSearchInput}
					/>
				</div>
				{#if searching}
					<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)">Mencari...</p>
				{:else if searchResults.length > 0}
					<div class="mt-1.5 rounded-lg border overflow-hidden" style="border-color: var(--sys-sep)">
						{#each searchResults as r (r.id)}
							<button
								class="w-full flex items-center justify-between p-2.5 text-left text-[12px] border-b last:border-b-0 hover:bg-slate-50"
								style="border-color: var(--sys-sep)"
								onclick={() => addToCart(r)}
							>
								<div>
									<div class="font-medium" style="color: var(--sys-label)">{r.nama_barang_lengkap}</div>
									<div style="color: var(--sys-label3)">Stok: {parseFloat(r.stok_tersedia) || 0} {r.satuan || ''}</div>
								</div>
								<IconPlus size={16} style="color: var(--sys-label3)" />
							</button>
						{/each}
					</div>
				{/if}
			</div>

			{#if cart.length > 0}
				<div class="flex flex-col gap-2">
					<p class="text-[12px] font-semibold" style="color: var(--sys-label)">Item Diajukan ({cart.length})</p>
					{#each cart as line (line.itemId)}
						<div class="p-3 rounded-lg border flex flex-col gap-2" style="border-color: var(--sys-sep)">
							<div class="flex items-start justify-between gap-2">
								<div class="text-[13px] font-medium" style="color: var(--sys-label)">{line.nama}</div>
								<button onclick={() => removeFromCart(line.itemId)} aria-label="Hapus"><IconTrash size={16} class="text-red-500" /></button>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<div>
									<label class="text-[10px] block mb-1" style="color: var(--sys-label3)" for="qty-{line.itemId}">Qty</label>
									<input
										id="qty-{line.itemId}"
										type="number"
										min="0.01"
										step="0.01"
										class="w-full rounded-lg border text-[13px] p-2"
										style="border-color: var(--sys-sep)"
										bind:value={line.quantity}
									/>
								</div>
								<div>
									<label class="text-[10px] block mb-1" style="color: var(--sys-label3)" for="tipe-{line.itemId}">Tipe</label>
									<select id="tipe-{line.itemId}" class="w-full rounded-lg border text-[13px] p-2 bg-white" style="border-color: var(--sys-sep)" bind:value={line.tipe}>
										<option value="ambil_pakai">Ambil Pakai (habis)</option>
										<option value="pinjam">Pinjam (kembalikan)</option>
									</select>
								</div>
							</div>
							{#if line.quantity > line.stokTersedia}
								<p class="text-[10px] text-amber-600">Peringatan: stok tersedia hanya {line.stokTersedia}. Pengajuan tetap bisa dikirim, approver akan melihat catatan ini.</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if errorMsg}
				<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
					<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
					<div>{errorMsg}</div>
				</div>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Kirim Pengajuan
			</button>
		</div>
	{/if}
</div>
