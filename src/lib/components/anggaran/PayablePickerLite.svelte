<!-- src/lib/components/anggaran/PayablePickerLite.svelte -->
<!--
  PA-Rilis Hutang (Rilis Invoice Supplier) v2 — Fase 4 (dashboard lapangan).
  Versi ringkas PayablePicker.svelte (erp-epi) — HANYA tagihan proyek yang
  ditugaskan ke PL ini (projectIds sudah difilter oleh pemanggil lewat
  getProjectsForCurrentUser, Q5). Tanpa chip filter Proyek/Semua — di sini
  memang selalu dalam lingkup proyek sendiri.
-->
<script lang="ts">
  import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { fetchOutstandingPayablesForProject } from '$lib/services/finance';

	let {
		projectIds = [],
		value = $bindable(null),
		onSelect
	}: {
		projectIds: (number | string)[];
		value: number | string | null;
		onSelect?: (invoice: any | null) => void;
	} = $props();

	let rows = $state<any[]>([]);
	let loading = $state(true);
	let selected = $state<any | null>(null);
	let search = $state('');

	$effect(() => {
		const ids = projectIds;
		loading = true;
		fetchOutstandingPayablesForProject(ids).then((r) => {
			rows = r;
			loading = false;
			if (value && !selected) {
				const found = r.find((x: any) => String(x.id) === String(value)) || null;
				selected = found;
				if (found) onSelect?.(found);
			}
		});
	});

	function overdueDays(row: any): number | null {
		if (!row.due_date) return null;
		return Math.floor((Date.now() - new Date(row.due_date).getTime()) / 86400000);
	}
	function overdueClass(days: number | null): string {
		if (days === null) return 'text-gray-400';
		if (days <= 0) return 'text-emerald-600';
		if (days <= 30) return 'text-amber-600';
		return 'text-red-600';
	}
	const fmtRp = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

	let filteredRows = $derived(
		search.trim()
			? rows.filter((r) => {
					const q = search.toLowerCase();
					return (r.invoice_number || '').toLowerCase().includes(q) || (r.supplier_name || '').toLowerCase().includes(q);
				})
			: rows
	);

	function select(row: any) {
		selected = row;
		value = row.id;
		onSelect?.(row);
	}
	function clear() {
		selected = null;
		value = null;
		onSelect?.(null);
	}
</script>

<div>
	<label class="f-label">🧾 Tagihan Supplier Proyek Ini *</label>

	{#if loading}
    <CircularProgressGauge size={32} strokeWidth={3} label="Memuat tagihan..." />
	{:else if selected}
		<div class="flex items-start justify-between px-3 py-2 border rounded-lg border-purple-300 bg-purple-50">
			<div class="flex flex-col gap-0.5">
				<div class="flex items-center gap-2 flex-wrap">
					<span class="text-sm font-semibold text-gray-900">{selected.invoice_number}</span>
					<span class="text-xs text-gray-600">{selected.supplier_name || 'Supplier'}</span>
				</div>
				<div class="text-[11px] text-gray-600 flex flex-wrap gap-x-3">
					<span>Sisa: <strong>{fmtRp(selected.outstanding_amount)}</strong></span>
					{#if selected.due_date}
						<span class={overdueClass(overdueDays(selected))}>Jatuh tempo {selected.due_date}</span>
					{/if}
				</div>
			</div>
			<button type="button" class="text-gray-400 hover:text-red-500 text-lg leading-none ml-2" onclick={clear}>&times;</button>
		</div>
	{:else if rows.length === 0}
		<div class="p-3 bg-gray-50 border border-gray-200 rounded-lg text-[11px] text-gray-500 leading-relaxed">
			Belum ada tagihan supplier yang tertaut ke proyek ini. Banyak tagihan pembelian lama
			belum tertaut proyek — hubungi Finance kalau kamu tahu ada tagihan proyek ini.
		</div>
	{:else}
		<input type="text" bind:value={search} placeholder="Cari nomor invoice / nama supplier..." class="f-input mb-1.5" />
		<div class="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
			{#if filteredRows.length === 0}
				<div class="px-3 py-3 text-[11px] text-gray-400 text-center">Tidak ada tagihan yang cocok.</div>
			{:else}
				{#each filteredRows as row}
					<button type="button" class="w-full text-left px-3 py-2 hover:bg-purple-50" onclick={() => select(row)}>
						<div class="text-sm font-medium text-gray-800">{row.invoice_number} <span class="text-xs text-gray-500 font-normal">{row.supplier_name || 'Supplier'}</span></div>
						<div class="text-[11px] text-gray-500 flex gap-x-3">
							<span>Sisa: {fmtRp(row.outstanding_amount)}</span>
							{#if row.due_date}<span class={overdueClass(overdueDays(row))}>{row.due_date}</span>{/if}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
