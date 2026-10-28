<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// B4 Fase 4 restrukturisasi navigasi Lapangan (5 Agustus 2026): Equipment Timeline
	// all-time (WO + P2H + Tiket + PM terakhir) -- halaman baru, murni baca, dipisah dari
	// form P2H/PM yang sudah padat supaya tidak menambah risiko ke alur input yang sudah jalan.
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getEquipmentById, getEquipmentTimeline, getDuePmTasks, type EquipmentTimelineEntry } from '$lib/services/preventive';
	import { getAssetOwnershipSummary, type AssetOwnershipSummary } from '$lib/services/assetOwnership';
	import IconArrowLeft from '@tabler/icons-svelte/icons/arrow-left';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';
	import IconTool from '@tabler/icons-svelte/icons/tool';
	import IconClipboardCheck from '@tabler/icons-svelte/icons/clipboard-check';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconClock from '@tabler/icons-svelte/icons/clock';
	import IconShare2 from '@tabler/icons-svelte/icons/share-2';
	import FieldExportSheet from '$lib/components/shared/FieldExportSheet.svelte';

	// Fase 4 (implementation_plan_ai_pertajam.md, rekomendasi #6 lapangan "Equipment QR Hub"):
	// halaman ini SUDAH punya timeline gabungan WO+P2H+Tiket+PM sejak restrukturisasi B4 —
	// diperkaya di sini dengan status unit saat ini, WO aktif (dipisah dari histori penuh), dan
	// jadwal PM mendatang, supaya scan QR → satu halaman ini menjawab "semua info sekaligus"
	// tanpa perlu halaman hub terpisah yang menduplikasi query timeline yang sudah ada.
	const STATUS_OPERASIONAL_LABEL: Record<string, string> = {
		available: 'Tersedia',
		rental_out: 'Disewakan ke Klien',
		rental_in: 'Sedang Disewa dari Pihak Ketiga',
		on_project: 'Di Proyek',
		under_repair: 'Dalam Perbaikan',
		broken: 'Rusak / Non-Aktif'
	};

	let equipmentId = $derived($page.params.equipment_id as string);

	let loading = $state(true);
	let equipment = $state<any>(null);
	let entries = $state<EquipmentTimelineEntry[]>([]);
	let pmDue = $state<any[]>([]);
	let ownership = $state<AssetOwnershipSummary | null>(null);
	let errorMsg = $state('');

	let woAktif = $derived(entries.filter((e) => e.type === 'wo' && e.subtitle === 'Dalam proses'));
	let showExportSheet = $state(false);

	// F5 (Fase 4 "Export Maintenance v2" rencana) — Riwayat PM per unit, CSV saja
	// (data lapangan lebih untuk diolah lanjut daripada ditunjukkan; PDF di HP jarang dipakai).
	const TYPE_LABEL: Record<EquipmentTimelineEntry['type'], string> = {
		wo: 'Work Order',
		p2h: 'P2H',
		ticket: 'Tiket',
		pm: 'PM'
	};
	const exportColumns = [
		{ key: 'tanggal', label: 'Tanggal' },
		{ key: 'jenis', label: 'Jenis' },
		{ key: 'judul', label: 'Judul' },
		{ key: 'keterangan', label: 'Keterangan' }
	];
	let exportRows = $derived(
		entries.map((e) => ({
			tanggal: formatDate(e.date),
			jenis: TYPE_LABEL[e.type],
			judul: e.title,
			keterangan: e.subtitle || '-'
		}))
	);

	onMount(async () => {
		try {
			[equipment, entries, pmDue, ownership] = await Promise.all([
				getEquipmentById(equipmentId),
				getEquipmentTimeline(equipmentId),
				getDuePmTasks(equipmentId),
				getAssetOwnershipSummary(equipmentId)
			]);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat riwayat unit.';
		} finally {
			loading = false;
		}
	});

	function iconFor(type: EquipmentTimelineEntry['type']) {
		if (type === 'wo') return IconTool;
		if (type === 'p2h') return IconClipboardCheck;
		if (type === 'ticket') return IconAlertTriangle;
		return IconClock;
	}

	function formatDate(d: string | null) {
		if (!d) return '-';
		return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<div class="max-w-2xl mx-auto p-4 md:p-6 pb-24">
	<div class="flex items-center justify-between mb-4">
		<button
			class="flex items-center gap-1.5 text-sm font-semibold"
			style="color: var(--sys-label3)"
			onclick={() => goto(`/preventive/p2h/${equipmentId}`)}
		>
			<IconArrowLeft size={16} /> Kembali
		</button>
		{#if entries.length > 0}
			<button
				onclick={() => (showExportSheet = true)}
				title="Bagikan riwayat unit sebagai CSV"
				class="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border"
				style="border-color: var(--sys-sep); color: var(--sys-label3)"
			>
				<IconShare2 size={13} /> Ekspor
			</button>
		{/if}
	</div>

	<h1 class="text-xl font-bold mb-1" style="color: var(--sys-label)">
		Info Unit{equipment?.name ? `: ${equipment.name}` : ''}
	</h1>
	<p class="text-[12px] mb-6" style="color: var(--sys-label3)">Status, WO aktif, jadwal PM, dan riwayat lengkap unit ini</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat riwayat servis alat..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-6 text-center text-sm text-red-500">{errorMsg}</div>
	{:else}
		{#if equipment}
			<div class="glass-panel rounded-2xl p-4 mb-4 flex items-center justify-between">
				<div class="min-w-0">
					<p class="text-[11px] font-medium" style="color: var(--sys-label3)">{equipment.code || '-'}</p>
					<p class="text-sm font-bold" style="color: var(--sys-label)">
						{STATUS_OPERASIONAL_LABEL[equipment.status_operational] || equipment.status_operational || 'Status tidak diketahui'}
					</p>
				</div>
				{#if equipment.last_hoursmeter != null}
					<div class="text-right shrink-0">
						<p class="text-[11px]" style="color: var(--sys-label3)">Hoursmeter</p>
						<p class="text-sm font-bold" style="color: var(--sys-label)">{equipment.last_hoursmeter}</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Fase 6.1 (Penajaman Aset Produktif, 29 Agu 2026): kartu ringkas Biaya Kepemilikan (TCO).
		     TANPA revenue/profit — data itu sengaja tidak diturunkan ke lapangan. -->
		{#if ownership}
			<div class="glass-panel rounded-2xl p-4 mb-4">
				<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label3)">Biaya Kepemilikan Aset</p>
				{#if ownership.hargaBeliKosong}
					<p class="text-[12px]" style="color: #D97706">Harga beli belum tercatat — rasio biaya perawatan belum bisa dihitung.</p>
				{:else}
					<div class="grid grid-cols-2 gap-3">
						<div>
							<p class="text-[10px]" style="color: var(--sys-label4)">Nilai Aset</p>
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">Rp{ownership.hargaBeli.toLocaleString('id-ID')}</p>
						</div>
						<div>
							<p class="text-[10px]" style="color: var(--sys-label4)">Total Biaya Perawatan ({ownership.woCount}×)</p>
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">Rp{ownership.totalBiaya.toLocaleString('id-ID')}</p>
						</div>
						<div>
							<p class="text-[10px]" style="color: var(--sys-label4)">Rasio Biaya/Nilai</p>
							<p
								class="text-[13px] font-bold"
								style="color: {ownership.statusLevel === 'kritis' ? '#DC2626' : ownership.statusLevel === 'peringatan' ? '#D97706' : '#16A34A'}"
							>
								{ownership.rasioPct?.toFixed(1)}%
								{ownership.statusLevel === 'kritis' ? '🔴' : ownership.statusLevel === 'peringatan' ? '🟡' : '🟢'}
							</p>
						</div>
						<div>
							<p class="text-[10px]" style="color: var(--sys-label4)">Sisa Umur Manfaat</p>
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">
								{ownership.sisaUmurTahun === null
									? '—'
									: ownership.sisaUmurTahun <= 0
										? 'Habis'
										: `± ${ownership.sisaUmurTahun.toFixed(1)} thn`}
							</p>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		{#if woAktif.length > 0}
			<div class="mb-4">
				<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label3)">WO Aktif ({woAktif.length})</p>
				<ul class="space-y-2">
					{#each woAktif as w (w.id)}
						<li class="glass-panel rounded-xl p-3 flex items-center gap-3">
							<IconTool size={16} style="color: var(--sys-label3)" />
							<span class="text-[13px] font-semibold flex-1 truncate" style="color: var(--sys-label)">{w.title}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if pmDue.length > 0}
			<div class="mb-4">
				<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label3)">Jadwal PM Mendatang ({pmDue.length})</p>
				<ul class="space-y-2">
					{#each pmDue as p (p.id)}
						<li class="glass-panel rounded-xl p-3 flex items-center justify-between gap-3">
							<span class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{p.template?.task_name || 'Tugas PM'}</span>
							<span class="text-[11px] font-medium shrink-0" style="color: var(--sys-label4)">{formatDate(p.due_date)}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label3)">Riwayat Lengkap</p>
	{/if}

	{#if !loading && !errorMsg && entries.length === 0}
		<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Belum ada riwayat untuk unit ini.</div>
	{:else if !loading && !errorMsg}
		<ul class="space-y-3">
			{#each entries as e (e.type + e.id)}
				<li class="glass-panel rounded-xl p-4 flex items-start gap-3">
					<div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--sys-fill, #f1f5f9)">
						{#if true}
							{@const Icon = iconFor(e.type)}
							<Icon size={18} style="color: var(--sys-label3)" />
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-bold truncate" style="color: var(--sys-label)">{e.title}</p>
						{#if e.subtitle}
							<p class="text-[12px]" style="color: var(--sys-label3)">{e.subtitle}</p>
						{/if}
					</div>
					<span class="text-[11px] font-medium shrink-0" style="color: var(--sys-label4)">{formatDate(e.date)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<FieldExportSheet
	open={showExportSheet}
	onClose={() => (showExportSheet = false)}
	judul={`Riwayat Unit — ${equipment?.name || equipmentId}`}
	filename={`riwayat-pm-${equipmentId}`}
	columns={exportColumns}
	rows={exportRows}
	formats={['csv']}
/>
