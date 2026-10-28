<!-- src/lib/components/packing-list/ReturnLifecycleStepper.svelte
     Fase 5 — Rencana Unifikasi Lifecycle Pengembalian Barang. Stepper baca-saja posisi tiap retur proyek:
     Diajukan -> Dalam Perjalanan -> Gerbang Gudang -> Pemeriksaan QC -> Selesai. Data: fetchReturTracking(). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import { RETUR_STEPS, type ReturTracking } from '$lib/utils/returLifecycle';
	import { konfirmasiReturBerangkat } from '$lib/services/packingList';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';

	let {
		items = [],
		loading = false,
		onChanged
	}: { items: ReturTracking[]; loading?: boolean; onChanged?: () => void } = $props();
	let showDone = $state(false);

	// RSM-01 §4.1 — konfirmasi berangkat (draft -> dikirim) dari site: foto barang di bak + GPS otomatis.
	let cameraForDoc = $state<ReturTracking | null>(null);
	let busyDocId = $state<number | null>(null);
	let berangkatMsg = $state<Record<number, string>>({});

	async function handleBerangkatPhoto(file: File) {
		const t = cameraForDoc;
		cameraForDoc = null;
		if (!t?.docId) return;
		busyDocId = t.docId;
		berangkatMsg = { ...berangkatMsg, [t.docId]: '' };
		try {
			let gps: DevicePosition | null = null;
			try { gps = await getCurrentPosition(); } catch { /* GPS opsional -- tidak menghalangi konfirmasi */ }
			const wm = await watermarkPhoto(await compressPhoto(file), gps, new Date().toISOString());
			const fileId = await uploadEvidencePhoto(wm as File, `retur_gudang:berangkat:${t.docNo}`);
			if (!fileId) throw new Error('Foto gagal diunggah. Cek sinyal lalu coba lagi.');
			await konfirmasiReturBerangkat(t.docId, {
				fotoKirim: [fileId],
				driverName: t.driverName,
				vehiclePlate: t.vehiclePlate,
				gps: gps ? { lat: gps.lat, lng: gps.lng } : null
			});
			onChanged?.();
		} catch (e: any) {
			berangkatMsg = { ...berangkatMsg, [t.docId]: e?.message || 'Gagal mengonfirmasi berangkat. Coba lagi.' };
		} finally {
			busyDocId = null;
		}
	}

	function fmtTgl(v?: string | null): string {
		if (!v) return '-';
		const d = new Date(v);
		return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: v.length > 10 ? 'short' : undefined });
	}
	function jamPerjalanan(v?: string | null): string {
		const t = v ? new Date(v).getTime() : NaN;
		if (!Number.isFinite(t)) return '';
		const jam = Math.max(0, Math.floor((Date.now() - t) / 3_600_000));
		return jam < 48 ? `${jam} jam` : `${Math.floor(jam / 24)} hari`;
	}

	const active = $derived(items.filter((i) => !i.done && !i.cancelled));
	const finished = $derived(items.filter((i) => i.done || i.cancelled));
</script>

<div class="card-section" data-testid="retur-stepper">
	<div class="flex items-center justify-between gap-2 mb-2">
		<h3 class="text-[13px] font-bold text-slate-800 dark:text-slate-100 m-0">📍 Status Pengembalian Proyek Ini</h3>
		{#if finished.length}
			<button type="button" class="text-[11px] text-slate-500 underline" onclick={() => (showDone = !showDone)}>
				{showDone ? 'Sembunyikan' : 'Lihat'} yang selesai ({finished.length})
			</button>
		{/if}
	</div>
	<p class="text-[11px] text-slate-500 mt-0 mb-3 leading-relaxed">
		Pantau sampai mana barang yang kamu kembalikan. Bila ada yang <strong>ditolak</strong>, baca alasannya lalu hubungi tim Inventory.
		Pengajuan yang lama berhenti di "Diajukan" biasanya menunggu Inventory menerbitkan surat jalan.
	</p>

	{#if loading}
		<CircularProgressGauge size={40} strokeWidth={3} label="Memuat status pengembalian..." />
	{:else if active.length === 0 && !showDone}
		<p class="text-[12px] text-slate-400">Tidak ada pengembalian yang sedang berjalan untuk proyek ini.</p>
	{/if}

	{#each showDone ? items : active as t (t.key)}
		<div class="border rounded-xl p-3 mb-2 {t.rejected ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white dark:bg-slate-900'}">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<div class="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{t.docNo}</div>
					<div class="text-[11px] text-slate-500">
						{t.itemCount} item{t.ageDays != null ? ` · ${t.ageDays} hari lalu` : ''} · {t.itemsPreview.join(', ')}
					</div>
				</div>
				{#if t.rejected}
					<span class="text-[10px] px-1.5 py-0.5 rounded border border-rose-300 text-rose-700 font-semibold shrink-0">Ditolak gudang</span>
				{:else if t.cancelled}
					<span class="text-[10px] px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 font-semibold shrink-0">Dibatalkan</span>
				{/if}
			</div>

			<ol class="flex items-start mt-3 list-none p-0 m-0" aria-label="Tahap pengembalian">
				{#each RETUR_STEPS as s, i (s.key)}
					{@const reached = i <= t.stepIndex}
					<li class="flex-1 min-w-0 flex flex-col items-center text-center relative" title={s.hint}>
						{#if i > 0}
							<span class="absolute top-[7px] right-1/2 w-full h-0.5 {i <= t.stepIndex ? 'bg-emerald-400' : 'bg-slate-200'}"></span>
						{/if}
						<span
							class="relative z-10 w-4 h-4 rounded-full border-2 {reached ? (t.rejected ? 'bg-rose-500 border-rose-500' : 'bg-emerald-500 border-emerald-500') : 'bg-white border-slate-300'} {i === t.stepIndex && !t.done && !t.rejected ? 'ring-2 ring-emerald-200 animate-pulse' : ''}"
						></span>
						<span class="text-[9.5px] leading-tight mt-1 {i === t.stepIndex ? 'font-bold text-slate-800' : 'text-slate-400'}">{s.label}</span>
					</li>
				{/each}
			</ol>

			{#if t.docId && !t.rejected && !t.cancelled && !t.done}
				{#if t.docStatus === 'draft'}
					<div class="mt-2 p-2 rounded-lg bg-sky-50 border border-sky-200 text-[11px] text-sky-900 leading-relaxed">
						{#if t.jadwal}
							Surat jalan <strong>{t.docNo}</strong> sudah terbit. Jadwal jemput: <strong>{fmtTgl(t.jadwal)}</strong>.
							Sopir: <strong>{t.driverName || '-'}</strong>{#if t.driverPhone} (<a class="underline" href="tel:{t.driverPhone}">{t.driverPhone}</a>){/if}.
							Saat barang naik ke mobil, ambil foto lalu tekan <strong>Konfirmasi Berangkat</strong>.
						{:else}
							Nomor pengajuan Anda: <strong>{t.docNo}</strong>. Simpan nomor ini — jangan ajukan ulang barang yang sama.
							Menunggu Inventory menjadwalkan jemput; bila lebih dari 3 hari belum ada kabar, hubungi Admin Inventory.
						{/if}
						<div class="mt-1.5">
							<button
								type="button"
								class="px-2.5 py-1.5 rounded-lg bg-sky-600 text-white text-[11px] font-semibold border-none cursor-pointer disabled:opacity-50"
								disabled={busyDocId === t.docId}
								title="Foto barang di bak kendaraan + lokasi GPS tercatat sebagai bukti berangkat"
								onclick={() => (cameraForDoc = t)}
							>
								{busyDocId === t.docId ? 'Mengirim…' : '📸 Konfirmasi Berangkat'}
							</button>
						</div>
						{#if berangkatMsg[t.docId]}<p class="text-rose-700 mt-1 mb-0">{berangkatMsg[t.docId]}</p>{/if}
					</div>
				{:else if t.docStatus === 'dikirim' && t.shippedAt}
					<p class="text-[11px] text-slate-500 mt-2 mb-0">
						Berangkat {fmtTgl(t.shippedAt)} · {jamPerjalanan(t.shippedAt)} dalam perjalanan{t.stepKey === 'gerbang_gudang' ? ' · sudah lewat gerbang gudang' : ''}.
					</p>
				{/if}
			{/if}

			{#if t.rejected && t.rejectionReason}
				<p class="text-[11px] text-rose-700 mt-2 mb-0">Alasan: {t.rejectionReason}</p>
			{/if}
		</div>
	{/each}
</div>

{#if cameraForDoc}
	<CameraCaptureModal onCapture={handleBerangkatPhoto} onClose={() => (cameraForDoc = null)} />
{/if}
