<!-- src/lib/components/anggaran/RekeningSelect.svelte -->
<!-- Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep 2026).
     Pengganti input teks bebas rekening penerima di form lapangan. Versi RINGAN dari
     RekeningPenerimaPicker (erp-epi) — tanpa track record nominal (privasi lapangan,
     §5 Fase 4), tanpa browse karyawan/manpower/vendor. "Rekening terakhir saya" tampil
     duluan begitu form dibuka (1 tap pakai lagi). -->
<script lang="ts">
	import { IconSearch, IconX } from '@tabler/icons-svelte';
	import { searchRekeningPenerima, selectRekeningTerdaftar, registerRekeningBaru, type RekeningRow } from '$lib/services/rekeningPenerimaApi';

	let {
		bankName = $bindable(''),
		bankAccountNumber = $bindable(''),
		bankAccountName = $bindable(''),
		rekeningPenerimaId = $bindable<number | null>(null),
		isTagihan = $bindable(false)
	}: {
		bankName?: string;
		bankAccountNumber?: string;
		bankAccountName?: string;
		rekeningPenerimaId?: number | null;
		isTagihan?: boolean;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let terdaftar = $state<RekeningRow[]>([]);
	let terakhirSaya = $state<RekeningRow[]>([]);
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	let showBaruForm = $state(false);
	let baruBank = $state('');
	let baruRekening = $state('');
	let baruAtasNama = $state('');
	let submittingBaru = $state(false);
	let containerEl: HTMLElement | undefined = $state();
	let debounceTimer: ReturnType<typeof setTimeout>;
	// Ditautkan tapi belum diverifikasi Finance — keputusan user §9.4: rekening baru dari
	// lapangan WAJIB verifikasi Finance dulu. Kita TIDAK menahan submit (Aturan #6), tapi
	// peringatan ini dibuat tegas & selalu terlihat sampai Finance memverifikasi.
	let selected = $state<RekeningRow | null>(null);

	$effect(() => {
		if (!selected && bankAccountNumber && !isTagihan && rekeningPenerimaId) {
			selected = { id: rekeningPenerimaId, bank_kode: bankName, rekening_norm: bankAccountNumber, atas_nama: bankAccountName, status_verifikasi: 'terverifikasi', status: 'aktif' } as RekeningRow;
		}
	});

	function toggleOpen() {
		open = !open;
		if (open && !terakhirSaya.length && !terdaftar.length) doSearch();
	}

	function onQueryInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(doSearch, 300);
	}

	async function doSearch() {
		searching = true;
		searchError = null;
		try {
			const r = await searchRekeningPenerima(query.trim());
			terdaftar = r.terdaftar || [];
			terakhirSaya = r.terakhirSaya || [];
		} catch (e: any) {
			searchError = e?.message || 'Gagal mencari rekening';
		} finally {
			searching = false;
		}
	}

	function applyRow(row: RekeningRow) {
		bankName = row.bank_kode || bankName;
		bankAccountNumber = row.rekening_norm || bankAccountNumber;
		bankAccountName = row.atas_nama || bankAccountName;
		rekeningPenerimaId = row.id;
		selected = row;
		open = false;
		query = '';
	}

	async function pick(item: RekeningRow) {
		if (item.status === 'diblokir') return;
		try {
			const row = await selectRekeningTerdaftar(item.id);
			applyRow(row);
		} catch (e: any) {
			searchError = e?.message || 'Gagal memilih rekening';
		}
	}

	async function submitBaru() {
		if (!baruRekening.trim()) {
			searchError = 'Nomor rekening wajib diisi';
			return;
		}
		submittingBaru = true;
		searchError = null;
		try {
			const row = await registerRekeningBaru({ bankNameRaw: baruBank, rekeningRaw: baruRekening, atasNama: baruAtasNama });
			applyRow(row);
			showBaruForm = false;
			baruBank = ''; baruRekening = ''; baruAtasNama = '';
		} catch (e: any) {
			searchError = e?.message || 'Gagal mendaftarkan rekening';
		} finally {
			submittingBaru = false;
		}
	}

	function gantiPilihan() {
		selected = null;
		rekeningPenerimaId = null;
		bankAccountNumber = '';
		bankAccountName = '';
	}

	function toggleTagihan() {
		isTagihan = !isTagihan;
		if (isTagihan) { gantiPilihan(); bankName = ''; }
	}

	function onWindowClick(e: MouseEvent) {
		if (open && containerEl && !containerEl.contains(e.target as Node)) open = false;
	}

	function badge(item: RekeningRow) {
		if (item.status === 'diblokir') return { text: '⛔ Diblokir', cls: 'text-red-600' };
		if (item.status_verifikasi === 'terverifikasi') return { text: '✅ Terverifikasi', cls: 'text-emerald-600' };
		return { text: '⚠️ Belum diverifikasi', cls: 'text-amber-600' };
	}
</script>

<svelte:window onclick={onWindowClick} />

<div class="space-y-2">
	<div class="flex items-center justify-between">
		<span class="f-label mb-0">Rekening Penerima Transfer</span>
		<button type="button" class="text-[11px] font-medium {isTagihan ? 'text-amber-700' : 'text-gray-400'}" onclick={toggleTagihan}>
			{isTagihan ? '✓ Tagihan / Virtual Account' : 'Ini Tagihan/VA?'}
		</button>
	</div>

	{#if isTagihan}
		<input type="text" placeholder="Nama tagihan (mis. PLN, BPJS)" bind:value={bankName} class="f-input">
		<input type="text" placeholder="Kode VA / referensi" bind:value={bankAccountNumber} class="f-input mt-1.5">
	{:else if selected}
		<div class="rounded-xl border p-2.5" style="border-color: var(--sys-sep); background: var(--sys-bg2)">
			<div class="flex items-center justify-between gap-2">
				<div class="text-[13px]">
					<span class="font-semibold">{selected.bank_kode}</span> {selected.rekening_norm || selected.rekening_mask}
					{#if selected.atas_nama}<span style="color: var(--sys-label3)"> — a.n {selected.atas_nama}</span>{/if}
				</div>
				<button type="button" class="text-[11px] font-medium shrink-0" style="color: var(--sys-label4)" onclick={gantiPilihan}>Ganti</button>
			</div>
			{#if selected.status_verifikasi !== 'terverifikasi'}
				<p class="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mt-1.5">
					⚠️ Rekening ini belum diverifikasi Finance — pencairan pertama bisa lebih lama sampai diverifikasi. PA tetap bisa dikirim.
				</p>
			{/if}
		</div>
	{:else}
		<div class="relative" bind:this={containerEl}>
			<button type="button" class="f-select w-full text-left" onclick={toggleOpen}>
				<span style="color: var(--sys-label4)">Cari / pilih rekening…</span>
			</button>
			{#if open}
				<div class="absolute z-30 w-full mt-1.5 rounded-xl border shadow-2xl overflow-hidden" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<div class="relative p-2 border-b" style="border-color: var(--sys-sep)">
						<IconSearch size={14} class="absolute left-4.5 top-1/2 -translate-y-1/2 pointer-events-none" style="color: var(--sys-label4)" />
						<input type="text" class="f-input !py-2 !pl-8 !text-[13px]" placeholder="Nama / nomor rekening / bank…" bind:value={query} oninput={onQueryInput} />
						{#if query}
							<button type="button" class="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-black/10" style="color: var(--sys-label4)" onclick={() => (query = '')}>
								<IconX size={13} />
							</button>
						{/if}
					</div>
					<div class="max-h-64 overflow-y-auto">
						{#if searching}
							<div class="px-3.5 py-3 text-center text-[12px]" style="color: var(--sys-label4)">Mencari…</div>
						{/if}
						{#if searchError}
							<div class="px-3.5 py-2 text-[12px] text-red-600">{searchError}</div>
						{/if}
						{#if !query && terakhirSaya.length}
							<div class="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wide" style="color: var(--sys-label4)">Rekening Terakhir Saya</div>
							{#each terakhirSaya as item (item.id)}
								<button type="button" disabled={item.status === 'diblokir'} class="w-full text-left px-3.5 py-2 text-[13px] hover:bg-black/5 disabled:opacity-50 flex items-center justify-between gap-2" onclick={() => pick(item)}>
									<span>{item.bank_label || item.bank_kode} {item.rekening_mask} {#if item.atas_nama}<span style="color: var(--sys-label4)">— {item.atas_nama}</span>{/if}</span>
									<span class="text-[10px] font-bold shrink-0 {badge(item).cls}">{badge(item).text}</span>
								</button>
							{/each}
						{/if}
						{#if query && terdaftar.length}
							<div class="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wide" style="color: var(--sys-label4)">Terdaftar</div>
							{#each terdaftar as item (item.id)}
								<button type="button" disabled={item.status === 'diblokir'} class="w-full text-left px-3.5 py-2 text-[13px] hover:bg-black/5 disabled:opacity-50 flex items-center justify-between gap-2" onclick={() => pick(item)}>
									<span>{item.bank_label || item.bank_kode} {item.rekening_mask} {#if item.atas_nama}<span style="color: var(--sys-label4)">— {item.atas_nama}</span>{/if}</span>
									<span class="text-[10px] font-bold shrink-0 {badge(item).cls}">{badge(item).text}</span>
								</button>
							{/each}
						{:else if query && !searching}
							<div class="px-3.5 py-3 text-center text-[12px]" style="color: var(--sys-label4)">Tidak ditemukan — daftarkan sebagai rekening baru di bawah.</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<button type="button" class="text-[12px] font-medium text-blue-600" onclick={() => (showBaruForm = !showBaruForm)}>
			{showBaruForm ? '− Batal daftar baru' : '➕ Rekening baru'}
		</button>

		{#if showBaruForm}
			<div class="rounded-xl border p-2.5 space-y-2" style="border-color: var(--sys-sep); background: var(--sys-bg2)">
				<p class="text-[11px] text-amber-700">⚠️ Rekening baru butuh verifikasi Finance sebelum pencairan pertama.</p>
				<input type="text" placeholder="Nama bank" bind:value={baruBank} class="f-input">
				<input type="text" inputmode="numeric" placeholder="Nomor rekening" bind:value={baruRekening} class="f-input">
				<input type="text" placeholder="Atas nama rekening" bind:value={baruAtasNama} class="f-input">
				<button type="button" disabled={submittingBaru} class="w-full text-[13px] font-semibold text-white rounded-lg py-2 disabled:opacity-60" style="background: var(--p)" onclick={submitBaru}>
					{submittingBaru ? 'Menyimpan…' : 'Daftarkan & Pakai'}
				</button>
			</div>
		{/if}
	{/if}
</div>
