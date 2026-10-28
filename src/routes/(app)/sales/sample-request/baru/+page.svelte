<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getCustomerOptions, getCustomerById, type CustomerOption } from '$lib/services/sales';
	import {
		createSampleRequest,
		UKURAN_SAMPLE_OPTIONS,
		TUJUAN_SAMPLE_OPTIONS,
		KATEGORI_SAMPLE_OPTIONS
	} from '$lib/services/salesSampleRequest';
	import { IconArrowLeft, IconLoader2, IconSearch, IconX, IconFlask } from '@tabler/icons-svelte';

	let search = $state('');
	let customers = $state<CustomerOption[]>([]);
	let selectedCustomer = $state<CustomerOption | null>(null);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout>;

	let prospectId = $state<number | null>(null);
	let tanggal = $state(new Date().toISOString().slice(0, 10));
	let produkCat = $state('');
	let warna = $state('');
	let ukuran = $state('250ml');
	let jumlah = $state(1);
	let tujuan = $state('demo_presentasi');
	let kategori = $state('');
	let keterangan = $state('');

	let saving = $state(false);
	let errorMsg = $state('');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	onMount(async () => {
		const params = $page.url.searchParams;
		const qProspect = params.get('prospect_id');
		if (qProspect && Number(qProspect) > 0) prospectId = Number(qProspect);
		const qCustomerId = params.get('customer_id');
		if (qCustomerId && Number(qCustomerId) > 0) {
			const c = await getCustomerById(Number(qCustomerId));
			if (c) pickCustomer(c);
		}
	});

	function onSearchInput() {
		clearTimeout(searchTimer);
		const q = search.trim();
		if (!q) {
			customers = [];
			return;
		}
		searching = true;
		searchTimer = setTimeout(async () => {
			customers = await getCustomerOptions(q);
			searching = false;
		}, 250);
	}

	function pickCustomer(c: CustomerOption) {
		selectedCustomer = c;
		customers = [];
		search = c.customer_name;
	}

	function clearCustomer() {
		selectedCustomer = null;
		search = '';
		customers = [];
	}

	async function submit(asDraft: boolean) {
		if (saving) return;
		errorMsg = '';
		if (!produkCat.trim()) return (errorMsg = 'Produk cat wajib diisi.');
		if (!warna.trim()) return (errorMsg = 'Warna wajib diisi.');
		if (!kategori) return (errorMsg = 'Kategori sample wajib dipilih.');
		saving = true;
		try {
			await createSampleRequest({
				client_txn_id: crypto.randomUUID(),
				tanggal,
				customer_id: selectedCustomer?.id ?? null,
				customer_name: selectedCustomer?.customer_name ?? (search.trim() || null),
				prospect_id: prospectId,
				produk_cat: produkCat.trim(),
				warna: warna.trim(),
				ukuran_sample: ukuran,
				jumlah: Number(jumlah) || 1,
				tujuan,
				kategori,
				keterangan: keterangan.trim(),
				submit: !asDraft
			});
			goto('/sales/sample-request');
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan request sample.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<button
			class="flex items-center gap-1.5 text-[12px] font-medium mb-3"
			style="color: var(--sys-label3)"
			onclick={() => goto('/sales/sample-request')}
		>
			<IconArrowLeft size={15} /> Kembali
		</button>

		<div class="flex items-center gap-2 mb-4">
			<span class="p-2 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"><IconFlask size={18} /></span>
			<div>
				<h1 class="text-[16px] font-extrabold" style="color: var(--sys-label)">Ajukan Sample Cat</h1>
				<p class="text-[11px]" style="color: var(--sys-label3)">Permintaan sample untuk customer / prospect — perlu approval SPV.</p>
			</div>
		</div>

		<div class="flex flex-col gap-3">
			<!-- Customer -->
			<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Customer Tujuan</label>
				{#if !selectedCustomer}
					<div class="relative">
						<IconSearch size={15} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
						<input
							class="w-full h-10 pl-9 pr-8 rounded-lg border text-[13px]"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							placeholder="Cari nama customer (master_customer)"
							bind:value={search}
							oninput={onSearchInput}
						/>
						{#if searching}
							<IconLoader2 size={14} class="absolute right-3 top-1/2 -translate-y-1/2 animate-spin" style="color: var(--sys-label4)" />
						{/if}
						{#if customers.length > 0}
							<div class="absolute z-20 w-full mt-1 rounded-lg border shadow-lg max-h-52 overflow-y-auto" style="border-color: var(--sys-sep); background: var(--sys-bg)">
								{#each customers as c (c.id)}
									<button
										class="w-full text-left px-3 py-2 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
										style="color: var(--sys-label)"
										onclick={() => pickCustomer(c)}
									>
										{c.customer_name}
										{#if c.kode_customer}<span class="text-[10px]" style="color: var(--sys-label3)"> · {c.kode_customer}</span>{/if}
									</button>
								{/each}
							</div>
						{/if}
					</div>
					<p class="text-[10px] mt-1" style="color: var(--sys-label4)">Kosongkan bila belum ada di master (nama diketik akan disimpan sebagai teks).</p>
				{:else}
					<div class="flex items-center justify-between gap-2 p-2.5 rounded-lg" style="background: var(--sys-fill)">
						<span class="text-[13px] font-semibold" style="color: var(--sys-label)">{selectedCustomer.customer_name}</span>
						<button class="text-[11px] font-bold text-rose-500 flex items-center gap-1" onclick={clearCustomer}>
							<IconX size={12} /> Ganti
						</button>
					</div>
				{/if}
			</div>

			<!-- Detail sample -->
			<div class="rounded-xl border p-3.5 flex flex-col gap-3" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="grid grid-cols-2 gap-2.5">
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Tanggal Pengajuan</label>
						<input type="date" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={tanggal} />
					</div>
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Jumlah Unit</label>
						<input type="number" min="1" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={jumlah} />
					</div>
				</div>
				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Produk Cat</label>
					<input class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" placeholder="mis. Epoxy Primer / PU Topcoat" bind:value={produkCat} />
				</div>
				<div class="grid grid-cols-2 gap-2.5">
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Warna</label>
						<input class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" placeholder="mis. RAL 9010 / Abu-abu" bind:value={warna} />
					</div>
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Ukuran Sample</label>
						<select class="w-full h-10 px-2 rounded-lg border text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={ukuran}>
							{#each UKURAN_SAMPLE_OPTIONS as o}<option value={o.value}>{o.label}</option>{/each}
						</select>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-2.5">
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Tujuan</label>
						<select class="w-full h-10 px-2 rounded-lg border text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={tujuan}>
							{#each TUJUAN_SAMPLE_OPTIONS as o}<option value={o.value}>{o.label}</option>{/each}
						</select>
					</div>
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Kategori Sample <span style="color:#DC2626">*</span></label>
						<select
							class="w-full h-10 px-2 rounded-lg border text-[13px]"
							style="border-color: {kategori ? 'var(--sys-sep)' : '#DC2626'}; background: var(--sys-fill); color: var(--sys-label)"
							bind:value={kategori}
						>
							<option value="" disabled>— Pilih kategori —</option>
							{#each KATEGORI_SAMPLE_OPTIONS as o}<option value={o.value}>{o.label}</option>{/each}
						</select>
					</div>
				</div>
				<p class="text-[10px] -mt-1.5" style="color: var(--sys-label4)">
					Bentuk sample yang diminta (mis. plat kering, tarikan warna) — dipakai R&D &amp; gudang untuk menyiapkan dan menyalurkan permintaan.
				</p>
				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Keterangan</label>
					<textarea rows="2" class="w-full px-3 py-2 rounded-lg border text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" placeholder="Catatan tambahan untuk approver / gudang" bind:value={keterangan}></textarea>
				</div>
			</div>

			{#if errorMsg}
				<p class="text-[12px] font-semibold" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<div class="flex gap-2">
				<button
					class="flex-1 h-11 rounded-xl text-[13px] font-bold disabled:opacity-40"
					style="background: var(--sys-fill); color: var(--sys-label)"
					disabled={saving}
					onclick={() => submit(true)}
				>
					{saving ? '...' : 'Simpan Draft'}
				</button>
				<button
					class="flex-1 h-11 rounded-xl text-[13px] font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
					style="background: var(--p, var(--g))"
					disabled={saving}
					onclick={() => submit(false)}
				>
					{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
					Ajukan untuk Approval
				</button>
			</div>
		</div>
	</div>
</div>
