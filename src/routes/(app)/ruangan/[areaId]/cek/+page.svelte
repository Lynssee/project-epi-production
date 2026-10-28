<!-- src/routes/(app)/ruangan/[areaId]/cek/+page.svelte -->
<!--
	Cek Kelengkapan Ruangan (Barang per Ruangan via QR Patroli, Fase 4).
	Cocokkan fisik dengan daftar -- hanya barang yang TIDAK sesuai yang perlu
	diisi detail, sisanya cukup "Semua sesuai" 1-tap. Laporan rusak langsung jadi
	tiket Service Desk GA; selisih lain menunggu konfirmasi Admin GA (register
	belum berubah sampai dikonfirmasi).
-->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fetchRuangan, submitCekRuangan, type RuanganDetail, type StatusBarisCek } from '$lib/services/gaRuangan';
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-svelte';

	const areaId = Number(page.params.areaId);

	let status = $state<'loading' | 'error' | 'form' | 'done'>('loading');
	let errorMsg = $state('');
	let data = $state<RuanganDetail | null>(null);

	type RowState = { status: StatusBarisCek; qty_aktual: number | null; catatan: string };
	let rows = $state<Record<number, RowState>>({});
	let submitting = $state(false);
	let submitErr = $state('');
	let hasil = $state<{ jml_selisih: number; ticketCount: number } | null>(null);

	const STATUS_LABEL: Record<StatusBarisCek, string> = {
		ada: 'Ada',
		kurang: 'Kurang',
		rusak: 'Rusak',
		tidak_ada: 'Tidak ada'
	};

	async function load() {
		status = 'loading';
		try {
			data = await fetchRuangan(areaId);
			const init: Record<number, RowState> = {};
			for (const a of data.assets) init[a.id] = { status: 'ada', qty_aktual: null, catatan: '' };
			rows = init;
			status = 'form';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat data ruangan.';
			status = 'error';
		}
	}
	onMount(load);

	function semuaSesuai() {
		const next: Record<number, RowState> = {};
		for (const id of Object.keys(rows)) next[Number(id)] = { status: 'ada', qty_aktual: null, catatan: '' };
		rows = next;
	}

	function setStatus(assetId: number, s: StatusBarisCek) {
		rows = { ...rows, [assetId]: { ...rows[assetId], status: s } };
	}

	const jumlahSelisih = $derived(Object.values(rows).filter((r) => r.status !== 'ada').length);

	async function submit() {
		submitErr = '';
		submitting = true;
		try {
			let lat: number | null = null;
			let lng: number | null = null;
			try {
				const pos = await getCurrentPosition();
				lat = pos.lat;
				lng = pos.lng;
			} catch (err) {
				// GPS informasi saja -- TIDAK memblokir submit (gate aman/shadow).
				console.error('[ruangan/cek] GPS tidak tersedia, lanjut tanpa GPS:', err);
			}

			const hasilBaris = Object.entries(rows).map(([assetId, r]) => ({
				asset_id: Number(assetId),
				status: r.status,
				qty_aktual: r.qty_aktual,
				catatan: r.catatan || null
			}));

			const clientEventId =
				(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null) ||
				`cek-${areaId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

			const res = await submitCekRuangan(areaId, {
				client_event_id: clientEventId,
				checkpoint_id: null,
				lat,
				lng,
				hasil: hasilBaris
			});

			const ticketCount = hasilBaris.filter((h) => h.status === 'rusak').length;
			hasil = { jml_selisih: res.room_check?.jml_selisih ?? jumlahSelisih, ticketCount };
			status = 'done';
		} catch (err) {
			submitErr = err instanceof Error ? err.message : 'Gagal mengirim hasil cek.';
		}
		submitting = false;
	}
</script>

<svelte:head><title>Cek Kelengkapan — {data?.room.area_name ?? 'Ruangan'}</title></svelte:head>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background: var(--sys-fill)" onclick={() => goto(`/ruangan/${areaId}`)}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Cek Kelengkapan</h1>
		</div>

		{#if status === 'loading'}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat formulir cek kelengkapan..." />
		</div>
		{:else if status === 'error'}
			<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconAlertTriangle size={28} style="color: var(--red); margin: 0 auto 8px" />
				<p class="text-[12px]" style="color: var(--sys-label3)">{errorMsg}</p>
			</div>
		{:else if status === 'done'}
			<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconCircleCheck size={28} style="color: var(--g); margin: 0 auto 8px" />
				<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Hasil cek terkirim</p>
				<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
					{#if hasil?.jml_selisih}
						{hasil.jml_selisih} selisih dikirim ke Admin GA. Daftar ruangan berubah setelah
						dikonfirmasi.{#if hasil.ticketCount} {hasil.ticketCount} laporan rusak sudah masuk tiket Service Desk GA.{/if}
					{:else}
						Semua barang sesuai daftar. Tidak ada selisih.
					{/if}
				</p>
				<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => goto(`/ruangan/${areaId}`)}>
					Kembali ke Ruangan
				</button>
			</div>
		{:else if data}
			{#if data.assets.length === 0}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label4)">Belum ada barang tercatat di ruangan ini.</p>
			{:else}
				<p class="text-[11px] mb-3" style="color: var(--sys-label4)">
					Cocokkan fisik dengan daftar. Hanya barang yang <strong>tidak sesuai</strong> yang perlu
					diisi detail — sisanya cukup tekan <strong>Semua sesuai</strong>.
				</p>

				<button
					class="w-full rounded-lg py-2 mb-3 text-[12px] font-semibold"
					style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
					onclick={semuaSesuai}
				>
					✓ Semua sesuai ({data.assets.length} barang)
				</button>

				<div class="flex flex-col gap-2">
					{#each data.assets as a (a.id)}
						{@const r = rows[a.id]}
						<div class="rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<div class="flex items-center justify-between gap-2 mb-2">
								<span class="text-[12px] font-medium" style="color: var(--sys-label)">
									{a.nama}{a.mode_lacak === 'kolektif' ? ` × ${a.qty}` : ''}
								</span>
							</div>
							<div class="flex gap-1.5">
								{#each (['ada', 'kurang', 'rusak', 'tidak_ada'] as StatusBarisCek[]) as s}
									<button
										class="flex-1 rounded-lg py-1.5 text-[11px] font-semibold border"
										style={r?.status === s
											? 'background: var(--g); color: #fff; border-color: var(--g)'
											: 'background: var(--sys-bg); color: var(--sys-label); border-color: var(--sys-sep)'}
										onclick={() => setStatus(a.id, s)}
									>
										{STATUS_LABEL[s]}
									</button>
								{/each}
							</div>
							{#if r?.status === 'kurang'}
								<input
									type="number"
									min="0"
									placeholder="Qty aktual sekarang"
									class="w-full mt-2 rounded-lg px-2.5 py-1.5 text-[12px]"
									style="background: var(--sys-bg); border: 1px solid var(--sys-sep); color: var(--sys-label)"
									bind:value={r.qty_aktual}
								/>
							{/if}
							{#if r?.status !== 'ada'}
								<input
									type="text"
									placeholder="Catatan (opsional)"
									class="w-full mt-2 rounded-lg px-2.5 py-1.5 text-[12px]"
									style="background: var(--sys-bg); border: 1px solid var(--sys-sep); color: var(--sys-label)"
									bind:value={r.catatan}
								/>
							{/if}
						</div>
					{/each}
				</div>

				{#if submitErr}
					<p class="text-[11px] mt-3" style="color: var(--red)">{submitErr}</p>
				{/if}

				<button
					class="w-full rounded-lg py-2.5 mt-4 text-[13px] font-semibold text-white disabled:opacity-50"
					style="background: var(--g)"
					disabled={submitting}
					onclick={submit}
				>
					{submitting ? 'Mengirim…' : jumlahSelisih > 0 ? `Kirim Hasil (${jumlahSelisih} selisih)` : 'Kirim Hasil'}
				</button>
			{/if}
		{/if}
	</div>
</div>
