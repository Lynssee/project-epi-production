<!-- src/routes/(app)/workshop/overstay/+page.svelte -->
<!-- Pertajam Modul Ciketing — Denda Overstay, sisi lapangan (Fase 1 lanjutan, 22 Sep 2026).
     View-only + konfirmasi pengambilan. Aksi finansial (lunas/bebaskan) tetap admin-only. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		fetchActiveOverstays,
		confirmOverstayPickup,
		uploadOverstayPickupPhoto,
		TIPE_OVERSTAY_LABEL,
		type OverstayCase
	} from '$lib/services/workshopOverstayApi';
	import { IconArrowLeft, IconCheck, IconLoader2, IconCamera, IconRefresh } from '@tabler/icons-svelte';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';

	let cases = $state<OverstayCase[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');

	let confirmTarget = $state<OverstayCase | null>(null);
	let confirmNote = $state('');
	let namaPenerima = $state('');
	let confirming = $state(false);
	let validationMsg = $state('');

	let showCamera = $state(false);
	let capturedPhotoFile = $state<File | null>(null);
	let capturedPhotoPreview = $state<string | null>(null);

	let signaturePad: any = $state();

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			cases = await fetchActiveOverstays();
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat data overstay.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function openConfirm(c: OverstayCase) {
		confirmTarget = c;
		confirmNote = '';
		namaPenerima = '';
		validationMsg = '';
		capturedPhotoFile = null;
		capturedPhotoPreview = null;
	}

	function onPhotoCapture(file: File) {
		capturedPhotoFile = file;
		capturedPhotoPreview = URL.createObjectURL(file);
		showCamera = false;
	}

	async function submitConfirm() {
		if (!confirmTarget) return;
		validationMsg = '';

		if (!namaPenerima.trim()) {
			validationMsg = 'Nama penerima wajib diisi.';
			return;
		}
		if (!capturedPhotoFile) {
			validationMsg = 'Foto bukti serah-terima wajib diambil.';
			return;
		}
		if (!signaturePad || signaturePad.isEmpty()) {
			validationMsg = 'Tanda tangan penerima wajib diisi.';
			return;
		}

		confirming = true;
		try {
			const fotoFileId = await uploadOverstayPickupPhoto(
				capturedPhotoFile,
				`overstay-pickup-${confirmTarget.id}-${Date.now()}.jpg`
			);
			if (!fotoFileId) throw new Error('Gagal mengunggah foto bukti.');

			await confirmOverstayPickup(confirmTarget.id, {
				catatan: confirmNote.trim() || undefined,
				fotoFileId,
				signatureDataUrl: signaturePad.toDataURL(),
				namaPenerima
			});
			confirmTarget = null;
			await load();
		} catch (e: any) {
			validationMsg = e?.message || 'Gagal konfirmasi pengambilan.';
		} finally {
			confirming = false;
		}
	}

	const STATUS_BADGE: Record<string, string> = {
		dalam_grace: 'background: rgba(59,130,246,0.12); color:#3b82f6;',
		overstay: 'background: rgba(239,68,68,0.12); color:#ef4444;'
	};
</script>

<svelte:head><title>Denda Overstay — Workshop Ciketing</title></svelte:head>

<div class="p-4 max-w-lg mx-auto pb-24">
	<button class="flex items-center gap-1.5 text-sm mb-4" style="color: var(--sys-label2)" onclick={() => goto('/workshop')}>
		<IconArrowLeft size={16} /> Kembali
	</button>

	<h1 class="text-lg font-bold mb-1" style="color: var(--sys-label)">Denda Overstay</h1>
	<p class="text-[12px] mb-4" style="color: var(--sys-label3)">
		Barang customer/vendor/titipan di area Ciketing yang sudah melewati batas waktu bebas denda. Konfirmasi di sini begitu barang diambil pemiliknya.
	</p>

	{#if errorMsg}
		<div class="p-3 rounded-lg mb-3 text-[12px]" style="background: rgba(239,68,68,0.1); color:#ef4444;">{errorMsg}</div>
	{/if}

	{#if loading}
		<div class="flex justify-center py-10">
			<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Data Overstay..." sublabel="Mengecek barang melewati batas waktu" />
		</div>
	{:else if cases.length === 0}
		<div class="text-center py-14 rounded-xl border" style="border-color: var(--sys-sep)">
			<IconCheck size={32} style="color: var(--p, var(--g)); margin: 0 auto;" />
			<p class="text-[13px] font-semibold mt-2" style="color: var(--sys-label)">Tidak ada barang overstay saat ini.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each cases as c (c.id)}
				<div class="p-3.5 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
					<div class="flex items-start justify-between gap-2 mb-1.5">
						<p class="text-[14px] font-bold m-0" style="color: var(--sys-label)">{c.nama_barang}</p>
						{#if c.denda_status}
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={STATUS_BADGE[c.denda_status] || ''}>
								{c.denda_status === 'overstay' ? 'Overstay' : 'Dalam Grace'}
							</span>
						{/if}
					</div>
					<p class="text-[11px] m-0 mb-2" style="color: var(--sys-label3)">
						{c.customer_name || 'Tanpa nama'} · {TIPE_OVERSTAY_LABEL[c.tipe_overstay] || c.tipe_overstay}
					</p>
					<div class="flex items-center justify-between text-[11px] mb-3">
						<span style="color: var(--sys-label3)">Hari overstay: <strong style="color: var(--sys-label)">{c.hari_overstay || 0}</strong></span>
						<span style="color: var(--sys-label3)">Denda: <strong style="color: var(--sys-label)">Rp {(c.total_denda || 0).toLocaleString('id-ID')}</strong></span>
					</div>
					<button
						class="w-full py-2 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5"
						style="background: var(--p, var(--g)); color: white;"
						onclick={() => openConfirm(c)}
					>
						<IconCheck size={15} /> Konfirmasi Sudah Diambil
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if confirmTarget}
	<div class="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4 overflow-y-auto" style="background: rgba(0,0,0,0.4)">
		<div class="rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-sm my-4" style="background: var(--sys-bg, white)">
			<h4 class="font-bold mb-1" style="color: var(--sys-label)">Konfirmasi Pengambilan</h4>
			<p class="text-[12px] mb-3" style="color: var(--sys-label3)">{confirmTarget.nama_barang} — {confirmTarget.customer_name || '-'}</p>

			{#if validationMsg}
				<div class="p-2.5 rounded-lg mb-3 text-[11px]" style="background: rgba(239,68,68,0.1); color:#ef4444;">{validationMsg}</div>
			{/if}

			<label class="text-[11px] font-semibold block mb-1" style="color: var(--sys-label3)">Nama Penerima *</label>
			<input
				type="text"
				bind:value={namaPenerima}
				placeholder="Nama yang mengambil barang"
				class="w-full rounded-lg p-2 text-[13px] mb-3 border"
				style="border-color: var(--sys-sep); background: var(--sys-fill)"
			/>

			<label class="text-[11px] font-semibold block mb-1" style="color: var(--sys-label3)">Foto Bukti Serah-Terima *</label>
			{#if capturedPhotoPreview}
				<div class="relative mb-3">
					<img src={capturedPhotoPreview} alt="Bukti pengambilan" class="w-full rounded-lg border" style="border-color: var(--sys-sep); max-height: 160px; object-fit: cover;" />
					<button
						type="button"
						class="absolute top-1.5 right-1.5 px-2 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1"
						style="background: rgba(0,0,0,0.6); color: white;"
						onclick={() => (showCamera = true)}
					>
						<IconRefresh size={12} /> Ulangi
					</button>
				</div>
			{:else}
				<button
					type="button"
					class="w-full py-3 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5 border mb-3"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => (showCamera = true)}
				>
					<IconCamera size={16} /> Ambil Foto
				</button>
			{/if}

			<label class="text-[11px] font-semibold block mb-1" style="color: var(--sys-label3)">Tanda Tangan Penerima *</label>
			<div class="rounded-lg border mb-1 overflow-hidden" style="border-color: var(--sys-sep)">
				<SignaturePad bind:this={signaturePad} height={140} />
			</div>
			<button type="button" class="text-[10px] mb-3" style="color: var(--sys-label3)" onclick={() => signaturePad?.clear()}>Bersihkan tanda tangan</button>

			<textarea
				bind:value={confirmNote}
				rows="2"
				placeholder="Catatan (opsional)"
				class="w-full rounded-lg p-2 text-[13px] mb-3 border"
				style="border-color: var(--sys-sep); background: var(--sys-fill)"
			></textarea>
			<div class="flex gap-2">
				<button class="flex-1 py-2 rounded-lg text-[12px] font-semibold border" style="border-color: var(--sys-sep); color: var(--sys-label)" onclick={() => (confirmTarget = null)}>Batal</button>
				<button
					class="flex-1 py-2 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5"
					style="background: var(--p, var(--g)); color: white;"
					disabled={confirming}
					onclick={submitConfirm}
				>
					{#if confirming}<IconLoader2 size={14} class="animate-spin" />{/if}
					Konfirmasi
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showCamera}
	<CameraCaptureModal onCapture={onPhotoCapture} onClose={() => (showCamera = false)} />
{/if}
