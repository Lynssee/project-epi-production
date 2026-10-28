<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		fetchPOTracking,
		fetchPOTrackingItems,
		fetchPOTrackingLifecycleFacts,
		fetchPOCodPaymentStatus,
		type POTrackingItem,
		type POTrackingLineItem,
		type CodPayStatus
	} from '$lib/services/procurementApi';
	import { resolveLifecycle, type LifecyclePhaseResult } from '$lib/services/procurementLifecycle';
	import { IconArrowLeft, IconLoader2, IconSearch, IconChevronDown, IconChevronUp } from '@tabler/icons-svelte';

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'submit_pengajuan_pembelian', roles)) {
			goto('/');
		}
	});

	let loading = $state(true);
	let pos = $state<POTrackingItem[]>([]);
	let search = $state('');

	const rupiah = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));

	const statusLabel: Record<string, string> = {
		draft: 'Draft',
		sent: 'Dikirim ke Supplier',
		partial_received: 'Diterima Sebagian',
		received: 'Diterima Penuh',
		cancelled: 'Dibatalkan'
	};

	const statusColor: Record<string, string> = {
		draft: 'bg-slate-100 text-slate-600',
		sent: 'bg-blue-100 text-blue-700',
		partial_received: 'bg-amber-100 text-amber-700',
		received: 'bg-emerald-100 text-emerald-700',
		cancelled: 'bg-red-100 text-red-700'
	};

	// Fase 6 (Audit AR/AP v2, AP9) — status bayar riil PO COD dari payment_status.
	let codPayMap = $state<Record<number, CodPayStatus>>({});

	async function load() {
		loading = true;
		pos = await fetchPOTracking(search || undefined);
		loading = false;
		const codIds = pos.filter((p) => /^(cod|dp)/i.test((p.payment_terms || '').trim())).map((p) => p.id);
		codPayMap = codIds.length ? await fetchPOCodPaymentStatus(codIds) : {};
	}

	const COD_PAY_INFO: Record<CodPayStatus, { label: string; cls: string }> = {
		NONE: { label: 'Menunggu tagihan Finance', cls: 'bg-amber-100 text-amber-800' },
		UNPAID: { label: 'Menunggu pembayaran Finance', cls: 'bg-amber-100 text-amber-800' },
		PARTIAL: { label: 'Dibayar sebagian', cls: 'bg-blue-100 text-blue-700' },
		PAID: { label: 'Sudah dibayar — boleh ambil barang', cls: 'bg-emerald-100 text-emerald-700' }
	};

	onMount(load);

	// Lifecycle Pembelian v2, Fase 2 (11 Sep 2026) — mini-stepper diganti port TypeScript dari
	// resolver yang sama dengan erp-epi (procurementLifecycle.ts), supaya admin & lapangan
	// TIDAK PERNAH menampilkan fase berbeda untuk PO yang sama. F1 (approval PR) & F6/F7
	// (Settlement/Closing) SENGAJA tidak ditampilkan di lapangan — PO yang sudah tampil di
	// sini pasti sudah lolos approval, dan info pembayaran belum diputuskan Lead boleh
	// terlihat di HP lapangan (Q5, masih terbuka). Yang tampil: F2 Procurement, F3 Transit,
	// F4 Penerimaan, F5 Retur (kalau ada).
	const etaSourceLabel: Record<string, string> = {
		supplier: 'Dikonfirmasi supplier',
		estimasi_leadtime: 'Perkiraan dari lead time',
		warisan: 'Data lama, belum diverifikasi'
	};
	const LAPANGAN_VISIBLE_PHASE_IDS = ['F2', 'F3', 'F4', 'F5'];

	let expandedId = $state<number | null>(null);
	let itemsByPo = $state<Record<number, POTrackingLineItem[]>>({});
	let loadingItems = $state<number | null>(null);
	let lifecycleFactsByPo = $state<Record<number, { grns: { status: string | null }[]; returns: { status: string | null }[] }>>({});
	let loadingLifecycle = $state<number | null>(null);

	async function toggleExpand(po: POTrackingItem) {
		if (expandedId === po.id) {
			expandedId = null;
			return;
		}
		expandedId = po.id;
		if (!itemsByPo[po.id]) {
			loadingItems = po.id;
			itemsByPo = { ...itemsByPo, [po.id]: await fetchPOTrackingItems(po.id) };
			loadingItems = null;
		}
		if (!lifecycleFactsByPo[po.id]) {
			loadingLifecycle = po.id;
			lifecycleFactsByPo = { ...lifecycleFactsByPo, [po.id]: await fetchPOTrackingLifecycleFacts(po.id) };
			loadingLifecycle = null;
		}
	}

	function lifecyclePhasesForPo(po: POTrackingItem): LifecyclePhaseResult[] {
		const items = itemsByPo[po.id] || [];
		const facts = lifecycleFactsByPo[po.id] || { grns: [], returns: [] };
		const result = resolveLifecycle({
			po,
			poItems: items.map((it) => ({ quantity: it.quantity, received_qty: it.received_qty })),
			grns: facts.grns,
			returns: facts.returns
		});
		return result.allPhases.filter((p) => LAPANGAN_VISIBLE_PHASE_IDS.includes(p.id) && (p.id !== 'F5' || facts.returns.length > 0));
	}

	function paymentBadge(terms: string | null | undefined) {
		if (!terms) return null;
		const isCodOrDp = /^(cod|dp)/i.test(terms.trim());
		return { label: terms, severity: isCodOrDp ? 'merah' : 'abu' };
	}
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm px-4 py-3 flex items-center gap-3">
		<button onclick={() => goto('/procurement')} class="p-2 -ml-2 rounded-full hover:bg-slate-100">
			<IconArrowLeft size={20} />
		</button>
		<h1 class="text-base font-bold" style="color: var(--sys-label)">Lacak Pesanan</h1>
	</div>

	<div class="flex-1 overflow-y-auto px-4 py-6 pb-24">
		<div class="max-w-xl mx-auto w-full">
			<div class="flex items-center gap-2 mb-4">
				<div class="relative flex-1">
					<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
					<input
						type="text"
						bind:value={search}
						onkeydown={(e) => e.key === 'Enter' && load()}
						placeholder="Cari no. PO / supplier..."
						class="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm"
					/>
				</div>
				<button onclick={load} class="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold">Cari</button>
			</div>

			{#if loading}
				<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat pelacakan purchase order..." />
	</div>
			{:else if pos.length === 0}
				<div class="glass-panel rounded-2xl p-8 text-center border border-white/50 shadow-sm">
					<p class="text-sm" style="color: var(--sys-label3)">Tidak ada PO ditemukan.</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each pos as po (po.id)}
						{@const payment = paymentBadge(po.payment_terms)}
						<div class="glass-panel rounded-2xl border border-white/50 shadow-sm overflow-hidden">
							<button type="button" class="w-full text-left p-4" onclick={() => toggleExpand(po)}>
								<div class="flex items-start justify-between gap-2 mb-1">
									<p class="text-sm font-bold" style="color: var(--sys-label)">{po.po_number}</p>
									<div class="flex items-center gap-1.5 shrink-0">
										<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full {statusColor[po.status] || 'bg-slate-100 text-slate-600'}">
											{statusLabel[po.status] || po.status}
										</span>
										{#if expandedId === po.id}<IconChevronUp size={16} class="text-slate-400" />{:else}<IconChevronDown size={16} class="text-slate-400" />{/if}
									</div>
								</div>
								<p class="text-xs mb-1" style="color: var(--sys-label3)">{po.supplier_name || '-'}</p>
								<div class="flex items-center justify-between text-xs" style="color: var(--sys-label4)">
									<span>{po.po_date ? new Date(po.po_date).toLocaleDateString('id-ID') : '-'}</span>
									<span class="font-bold text-blue-600">{rupiah(po.total_amount)}</span>
								</div>
							</button>

							{#if expandedId === po.id}
								<div class="px-4 pb-4 pt-1 border-t border-white/40 space-y-3">
									<!-- Mini-stepper lifecycle (resolveLifecycle — sama dengan yang dipakai admin) -->
									{#if loadingLifecycle === po.id}
										<div class="flex items-center gap-2 py-1"><IconLoader2 size={14} class="animate-spin text-blue-500" /><span class="text-[11px] text-slate-400">Memuat tahapan...</span></div>
									{:else}
										{@const phases = lifecyclePhasesForPo(po)}
										<div class="flex items-center gap-2">
											{#each phases as p, i}
												{@const active = p.state === 'selesai'}
												{@const inProgress = p.state === 'proses'}
												<div class="flex items-center gap-1.5" title="{p.label} — {p.hint}{p.conflict ? ' ⚠ Status bentrok: ' + p.evidence : ''}">
													<div
														class="w-2 h-2 rounded-full {p.conflict ? 'bg-red-500' : active ? 'bg-emerald-500' : inProgress ? 'bg-blue-500' : 'bg-slate-300'}"
													></div>
													<span class="text-[11px] font-semibold {p.conflict ? 'text-red-600' : active ? 'text-emerald-700' : inProgress ? 'text-blue-700' : 'text-slate-400'}">
														{p.label}{p.conflict ? ' ⚠' : ''}
													</span>
												</div>
												{#if i < phases.length - 1}<div class="flex-1 h-px bg-slate-200"></div>{/if}
											{/each}
										</div>
									{/if}

									<!-- ETA + asal ETA -->
									{#if po.delivery_date}
										<div class="text-xs flex items-center gap-1.5" style="color: var(--sys-label3)">
											<span>ETA {new Date(po.delivery_date).toLocaleDateString('id-ID')}</span>
											<span class="text-slate-400" title={etaSourceLabel[po.eta_source || 'warisan']}>ⓘ {etaSourceLabel[po.eta_source || 'warisan']}</span>
										</div>
									{/if}

									<!-- Lifecycle Pembelian v2, Fase 3 — kurir + resi, read-only (admin ERP yang isi via ShippingTracker) -->
									{#if po.shipping_provider || po.shipping_tracking_no}
										<div class="text-xs flex items-center gap-1.5" style="color: var(--sys-label3)">
											<span>🚚 {po.shipping_provider || 'Ekspedisi belum diisi'}</span>
											{#if po.shipping_tracking_no}<span class="text-slate-400">· Resi: {po.shipping_tracking_no}</span>{/if}
										</div>
									{:else if po.status === 'sent'}
										<p class="text-[11px] italic" style="color: var(--sys-label4)">Menunggu admin catat konfirmasi pengiriman supplier.</p>
									{/if}

									<!-- Badge bayar -->
									{#if payment}
										<span
											class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium {payment.severity === 'merah'
												? 'bg-red-100 text-red-700'
												: 'bg-slate-100 text-slate-600'}"
											title={payment.severity === 'merah'
												? 'Termin COD/DP — supplier menahan barang sampai pembayaran diproses Finance.'
												: 'Termin NET — pembayaran setelah barang diterima.'}
										>💳 {payment.label}</span>
									{/if}

									<!-- Fase 6 (AP9) — status bayar riil PO COD (dari payment_status, bukan finance_processed) -->
									{#if payment?.severity === 'merah' && codPayMap[po.id]}
										{@const info = COD_PAY_INFO[codPayMap[po.id]]}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold {info.cls}">
											{codPayMap[po.id] === 'PAID' ? '✅' : '⏳'} {info.label}
										</span>
									{/if}

									<!-- Progres per item -->
									{#if loadingItems === po.id}
										<div class="text-center py-3"><IconLoader2 size={16} class="animate-spin mx-auto text-blue-500" /></div>
									{:else if itemsByPo[po.id]?.length}
										<div class="space-y-1.5">
											{#each itemsByPo[po.id] as item (item.id)}
												{@const pct = item.quantity > 0 ? Math.min(100, Math.round((item.received_qty / item.quantity) * 100)) : 0}
												<div class="text-xs">
													<div class="flex items-center justify-between mb-0.5">
														<span style="color: var(--sys-label)">{item.item_name}</span>
														<span class="font-semibold {pct >= 100 ? 'text-emerald-600' : pct > 0 ? 'text-blue-600' : 'text-slate-400'}">
															{item.received_qty}/{item.quantity} {item.unit || ''}
														</span>
													</div>
													<div class="w-full h-1 rounded-full bg-black/5 overflow-hidden">
														<div class="h-full rounded-full {pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}" style="width: {pct}%"></div>
													</div>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
