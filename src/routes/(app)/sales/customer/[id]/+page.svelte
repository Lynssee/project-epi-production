<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getCustomerHistory, PROSPECT_STAGES, type CustomerHistory } from '$lib/services/sales';
	import { getCustomerJenisAndTier, getRecentPurchasesForCustomer } from '$lib/services/pricingApi';
	import { fetchSoListForCustomer, type CustomerSoSummary } from '$lib/services/customerLifecycleApi';
	import {
		IconArrowLeft,
		IconLoader2,
		IconMapPin,
		IconUserSearch,
		IconBuildingStore,
		IconPlus,
		IconArrowRight,
		IconCalendar,
		IconTool,
		IconPhone,
		IconUser,
		IconFileDollar,
		IconTag,
		IconShoppingCart
	} from '@tabler/icons-svelte';

	let customerId = $derived(Number($page.params.id));

	let loading = $state(true);
	let history = $state<CustomerHistory | null>(null);

	// Lifecycle Customer -> PO -> Komisi v2, Fase 6 -- daftar SO customer ini, tiap
	// baris menaut ke stepper lifecycle lengkap di /sales/po/[id] (L1, sudah ada).
	let soList = $state<CustomerSoSummary[]>([]);

	// Fase 5 Multi-Tier Pricelist — badge tier + 3 pembelian terakhir (read-only).
	let tierLabel = $state<string | null>(null);
	let recentPurchases = $state<
		{ nama_barang: string; harga_satuan: number; qty: number; nomor_so: string | null; tanggal: string }[]
	>([]);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	onMount(async () => {
		try {
			const isSuper = $authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin');
			const salesName = isSuper ? null : $authStore.karyawanName;
			history = await getCustomerHistory(customerId, salesName);

			// Best-effort — kegagalan bagian ini tidak boleh menggagalkan halaman utama.
			getCustomerJenisAndTier(customerId)
				.then((r) => (tierLabel = r.tierLabel))
				.catch(() => {});
			if (history?.customer?.kode_customer) {
				getRecentPurchasesForCustomer(history.customer.kode_customer, 3)
					.then((rows) => (recentPurchases = rows))
					.catch(() => {});
				fetchSoListForCustomer(history.customer.kode_customer)
					.then((rows) => (soList = rows))
					.catch(() => {});
			}
		} catch (e) {
			console.error('[sales/customer/[id]] Error loading customer history:', e);
		} finally {
			loading = false;
		}
	});

	function fmtRp(v: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v);
	}

	function stageLabel(stage: string) {
		return PROSPECT_STAGES.find((s) => s.value === stage)?.label || stage;
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<button
			type="button"
			class="flex items-center gap-1.5 text-[12px] font-medium mb-3"
			style="color: var(--sys-label3)"
			onclick={() => goto('/sales')}
		>
			<IconArrowLeft size={15} /> Kembali ke Sales
		</button>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat riwayat transaksi customer..." />
		</div>
		{:else if !history?.customer}
			<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Customer tidak ditemukan.</div>
		{:else}
			<!-- Customer Header Card -->
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-start gap-3">
					<div class="w-11 h-11 rounded-xl bg-blue-500/10 text-[var(--p,var(--g))] flex items-center justify-center shrink-0 mt-0.5">
						<IconBuildingStore size={24} />
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2">
							<h1 class="text-[18px] font-extrabold" style="color: var(--sys-label)">{history.customer.customer_name}</h1>
							<span class="text-[10px] font-mono font-bold px-2 py-0.2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
								{history.customer.kode_customer || `#${history.customer.id}`}
							</span>
							{#if tierLabel}
								<span class="text-[10px] font-bold px-2 py-0.2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center gap-0.5">
									<IconTag size={10} /> {tierLabel}
								</span>
							{/if}
						</div>
						{#if history.customer.alamat || history.customer.alamat_surat_jalan}
							<p class="text-[11px] mt-1 text-[var(--sys-label2)]">
								📍 {history.customer.alamat_surat_jalan || history.customer.alamat}
							</p>
						{/if}
						{#if history.customer.contact_person || history.customer.pic_nama || history.customer.telp}
							<div class="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] font-medium" style="color: var(--sys-label3)">
								{#if history.customer.contact_person || history.customer.pic_nama}
									<span class="flex items-center gap-1"><IconUser size={12} /> PIC: {history.customer.contact_person || history.customer.pic_nama}</span>
								{/if}
								{#if history.customer.telp || history.customer.telepon}
									<a href={`tel:${history.customer.telp || history.customer.telepon}`} class="flex items-center gap-1 text-[var(--p,var(--g))] hover:underline">
										<IconPhone size={12} /> {history.customer.telp || history.customer.telepon}
									</a>
								{/if}
							</div>
						{/if}
					</div>
				</div>

				<!-- Quick Action Shortcuts -->
				<div class="grid grid-cols-3 gap-2 mt-3 pt-3 border-t text-[11px]" style="border-color: var(--sys-sep)">
					<button
						type="button"
						class="p-2 rounded-xl border flex items-center justify-center gap-1 font-bold transition-all hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						onclick={() => goto(`/sales/baru?customer_id=${customerId}`)}
					>
						<IconPlus size={13} /> Check-in
					</button>
					<button
						type="button"
						class="p-2 rounded-xl border flex items-center justify-center gap-1 font-bold transition-all hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						onclick={() => goto(`/sales/survey/baru?customer_id=${customerId}`)}
					>
						<IconTool size={13} /> + Survey
					</button>
					<button
						type="button"
						class="p-2 rounded-xl border flex items-center justify-center gap-1 font-bold text-white shadow-xs active:scale-95 transition-transform"
						style="background: var(--p, var(--g))"
						onclick={() => goto(`/sales/penawaran/baru?customer_id=${customerId}&customer_name=${encodeURIComponent(history?.customer?.customer_name || '')}`)}
					>
						<IconFileDollar size={13} /> Penawaran
					</button>
				</div>
			</div>

			<!-- 3 Pembelian Terakhir (Fase 5 Multi-Tier Pricelist, read-only) -->
			{#if recentPurchases.length > 0}
				<div class="mb-5">
					<h2 class="text-[13px] font-bold flex items-center gap-1.5 mb-2.5" style="color: var(--sys-label)">
						<IconShoppingCart size={15} style="color: var(--p, var(--g))" /> Pembelian Terakhir
					</h2>
					<div class="flex flex-col gap-2">
						{#each recentPurchases as rp}
							<div class="rounded-xl border p-3" style="border-color: var(--sys-sep); background: var(--sys-bg)">
								<div class="flex items-center justify-between">
									<p class="text-[12px] font-semibold truncate flex-1" style="color: var(--sys-label)">{rp.nama_barang}</p>
									<p class="text-[12px] font-bold shrink-0 ml-2" style="color: var(--p, var(--g))">{fmtRp(rp.harga_satuan)}</p>
								</div>
								<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)">
									{rp.nomor_so || ''} · {rp.tanggal?.slice(0, 10)}
								</p>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Lifecycle Customer -> PO -> Komisi v2, Fase 6 -- SO / Sales Order -->
			<div class="mb-5">
				<h2 class="text-[13px] font-bold flex items-center gap-1.5 mb-2.5" style="color: var(--sys-label)">
					🧭 Sales Order ({soList.length})
				</h2>
				{#if soList.length === 0}
					<div class="p-4 rounded-xl border border-dashed text-center text-[12px]" style="border-color: var(--sys-sep); color: var(--sys-label3)">
						Belum ada SO untuk customer ini.
					</div>
				{:else}
					<div class="flex flex-col gap-2">
						{#each soList as so (so.id)}
							<button
								type="button"
								class="text-left rounded-xl border p-3 w-full shadow-sm hover:border-[var(--p,var(--g))] transition-all active:scale-[0.99]"
								style="border-color: var(--sys-sep); background: var(--sys-bg)"
								onclick={() => goto(`/sales/po/${so.id}`)}
								title="Buka detail SO ini — termasuk stepper lifecycle lengkap (verifikasi, PO, SJ, invoice, pelunasan)"
							>
								<div class="flex items-center justify-between mb-1">
									<p class="text-[13px] font-bold font-mono" style="color: var(--sys-label)">{so.nomor_so}</p>
									{#if so.grand_total}<p class="text-[12px] font-bold" style="color: var(--p, var(--g))">{fmtRp(so.grand_total)}</p>{/if}
								</div>
								<div class="flex items-center gap-1.5 flex-wrap text-[10px] font-semibold">
									<span class="px-1.5 py-0.5 rounded-full" style="background: var(--sys-fill); color: var(--sys-label3)">{so.status}</span>
									<span
										class="px-1.5 py-0.5 rounded-full"
										style={so.po_status === 'terverifikasi'
											? 'background: rgba(16,185,129,.12); color: #059669'
											: 'background: rgba(245,158,11,.12); color: #b45309'}
									>
										PO: {so.po_status === 'terverifikasi' ? 'Terverifikasi' : so.po_status === 'terupload' ? 'Menunggu verifikasi' : so.po_status === 'revisi' ? 'Perlu revisi' : 'Belum diunggah'}
									</span>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Surveys Section -->
			<div class="mb-5">
				<div class="flex items-center justify-between mb-2.5">
					<h2 class="text-[13px] font-bold flex items-center gap-1.5" style="color: var(--sys-label)">
						<IconTool size={15} style="color: var(--p, var(--g))" /> Survey Lapangan ({history.surveys.length})
					</h2>
					<button
						type="button"
						class="text-[11px] font-bold flex items-center gap-1 hover:underline"
						style="color: var(--p, var(--g))"
						onclick={() => goto(`/sales/survey/baru?customer_id=${customerId}`)}
					>
						<IconPlus size={13} /> Survey Baru
					</button>
				</div>

				{#if history.surveys.length === 0}
					<div class="p-4 rounded-xl border border-dashed text-center text-[12px]" style="border-color: var(--sys-sep); color: var(--sys-label3)">
						Belum ada survey teknis lapangan untuk customer ini.
					</div>
				{:else}
					<div class="flex flex-col gap-2">
						{#each history.surveys as s (s.id)}
							<button
								type="button"
								class="text-left rounded-xl border p-3 w-full shadow-sm hover:border-[var(--p,var(--g))] transition-all active:scale-[0.99]"
								style="border-color: var(--sys-sep); background: var(--sys-bg)"
								onclick={() => goto(`/sales/survey/${s.id}`)}
							>
								<div class="flex items-center justify-between mb-1">
									<p class="text-[13px] font-bold" style="color: var(--sys-label)">{s.nomor_survey}</p>
									<span class="text-[10px] flex items-center gap-1" style="color: var(--sys-label3)">
										<IconCalendar size={12} /> {s.tanggal_survey}
									</span>
								</div>
								<p class="text-[11px] mt-0.5 line-clamp-1 leading-relaxed" style="color: var(--sys-label2)">📍 {s.lokasi_project}</p>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Visits Section -->
			<div class="mb-5">
				<div class="flex items-center justify-between mb-2.5">
					<h2 class="text-[13px] font-bold flex items-center gap-1.5" style="color: var(--sys-label)">
						<IconMapPin size={15} style="color: var(--p, var(--g))" /> Riwayat Kunjungan ({history.visits.length})
					</h2>
					<button
						type="button"
						class="text-[11px] font-bold flex items-center gap-1 hover:underline"
						style="color: var(--p, var(--g))"
						onclick={() => goto(`/sales/baru?customer_id=${customerId}`)}
					>
						<IconPlus size={13} /> Check-in Kunjungan
					</button>
				</div>

				{#if history.visits.length === 0}
					<div class="p-4 rounded-xl border border-dashed text-center text-[12px]" style="border-color: var(--sys-sep); color: var(--sys-label3)">
						Belum ada kunjungan ke customer ini.
					</div>
				{:else}
					<div class="flex flex-col gap-2">
						{#each history.visits as v (v.id)}
							<button
								type="button"
								class="text-left rounded-xl border p-3 w-full shadow-sm hover:border-[var(--p,var(--g))] transition-all active:scale-[0.99]"
								style="border-color: var(--sys-sep); background: var(--sys-bg)"
								onclick={() => goto(`/sales/${v.id}`)}
							>
								<div class="flex items-center justify-between mb-1">
									<p class="text-[13px] font-bold" style="color: var(--sys-label)">{v.tujuan || 'Kunjungan'}</p>
									<span class="text-[10px] flex items-center gap-1" style="color: var(--sys-label3)">
										<IconCalendar size={12} /> {v.tanggal_kunjungan}
									</span>
								</div>
								{#if v.hasil_kunjungan}
									<p class="text-[11px] mt-0.5 line-clamp-2 leading-relaxed" style="color: var(--sys-label2)">{v.hasil_kunjungan}</p>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- CRM Leads Section -->
			<div>
				<div class="flex items-center justify-between mb-2.5">
					<h2 class="text-[13px] font-bold flex items-center gap-1.5" style="color: var(--sys-label)">
						<IconUserSearch size={15} style="color: var(--p, var(--g))" /> Lead & Peluang Prospek ({history.prospects.length})
					</h2>
					<button
						type="button"
						class="text-[11px] font-bold flex items-center gap-1 hover:underline"
						style="color: var(--p, var(--g))"
						onclick={() => goto('/sales/prospek/baru')}
					>
						<IconPlus size={13} /> Tambah Lead
					</button>
				</div>

				{#if history.prospects.length === 0}
					<div class="p-4 rounded-xl border border-dashed text-center text-[12px]" style="border-color: var(--sys-sep); color: var(--sys-label3)">
						Belum ada lead aktif untuk customer ini.
					</div>
				{:else}
					<div class="flex flex-col gap-2">
						{#each history.prospects as p (p.id)}
							<button
								type="button"
								class="text-left rounded-xl border p-3 w-full shadow-sm hover:border-[var(--p,var(--g))] transition-all active:scale-[0.99]"
								style="border-color: var(--sys-sep); background: var(--sys-bg)"
								onclick={() => goto(`/sales/prospek/${p.id}`)}
							>
								<div class="flex items-center justify-between mb-1">
									<p class="text-[13px] font-bold" style="color: var(--sys-label)">{p.name || p.company}</p>
									<span class="text-[9px] font-bold px-2 py-0.5 rounded-full" style="background:var(--sys-fill); color:var(--sys-label3)">
										{stageLabel(p.stage)}
									</span>
								</div>
								{#each history.followUps.filter((f) => f.prospect_id === p.id).slice(0, 2) as f (f.id)}
									<p class="text-[11px] mt-0.5 truncate" style="color: var(--sys-label3)">• {f.notes}</p>
								{/each}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
