<script lang="ts">
	// PMT-49: form "Tutup Pemakaian" ringkas — KONDISI + TANDA TANGAN (+ catatan opsional).
	// Foto wajib hanya bila kondisi bukan "baik" (ada temuan). Dipakai di halaman P2H unit
	// (sesi hari ini & banner sesi lama) — satu komponen supaya perilaku sama di semua tempat.
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';
	import { closeP2hSessionAtomic, type P2hKondisiTutup } from '$lib/services/preventive';
	import {
		preparePhotoForUpload,
		sendPreparedPhoto,
		p2hPhotoFileName,
		P2hPhotoCompressFailed,
		P2hPhotoUploadFailed,
		tandaiKonteksFoto
	} from '$lib/utils/p2hPhotoUpload';
	import { FieldHint } from '$lib/components/hints';

	let {
		sessionId,
		unitName = '',
		unitCode = '',
		onclosed,
		oncancel
	}: {
		sessionId: string;
		unitName?: string;
		unitCode?: string;
		onclosed: (r: { queued: boolean; session: any | null; kondisi: P2hKondisiTutup }) => void;
		oncancel?: () => void;
	} = $props();

	const KONDISI: Array<{ value: P2hKondisiTutup; label: string; desc: string; color: string }> = [
		{ value: 'baik', label: 'Baik', desc: 'Siap dipakai lagi', color: '#16A34A' },
		{ value: 'perlu_periksa', label: 'Perlu diperiksa', desc: 'Ada temuan, minta Maintenance cek', color: '#D97706' },
		{ value: 'dilarang', label: 'Dilarang dipakai', desc: 'Unit dikunci & Maintenance diberi tahu', color: '#DC2626' }
	];

	let kondisi = $state<P2hKondisiTutup>('baik');
	let catatan = $state('');
	let fotoId = $state<string | null>(null);
	let fotoUploading = $state(false);
	let fotoMsg = $state('');
	let fotoRetryFile = $state<File | null>(null);
	let fotoNeedsOriginal = $state(false);
	let saving = $state(false);
	let error = $state('');
	let pad: any = $state();

	const butuhFoto = $derived(kondisi !== 'baik');

	async function uploadFoto(file: File, sendOriginal = false) {
		fotoMsg = '';
		fotoNeedsOriginal = false;
		fotoRetryFile = null;
		fotoUploading = true;
		const mode = sendOriginal ? 'direct' : 'compress';
		try {
			tandaiKonteksFoto(file, 'p2h-tutup');
			const prepared = await preparePhotoForUpload(file, mode);
			fotoId = await sendPreparedPhoto(prepared, p2hPhotoFileName(unitCode || sessionId, 'tutup', prepared), mode);
		} catch (err: any) {
			console.error('[P2H tutup] unggah foto gagal:', err);
			if (err instanceof P2hPhotoCompressFailed) {
				fotoRetryFile = err.original;
				fotoNeedsOriginal = true;
			} else if (err instanceof P2hPhotoUploadFailed) {
				fotoRetryFile = err.file;
			}
			fotoMsg = err?.message || 'Gagal mengunggah foto. Silakan coba lagi.';
		} finally {
			fotoUploading = false;
		}
	}

	async function onFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		await uploadFoto(file);
		input.value = '';
	}

	async function simpan() {
		if (saving) return;
		error = '';
		if (butuhFoto && !fotoId) {
			error = 'Foto temuan wajib dilampirkan bila kondisi unit bukan "Baik".';
			return;
		}
		if (!pad || pad.isEmpty()) {
			error = 'Tanda tangan wajib diisi.';
			return;
		}
		saving = true;
		try {
			const result = await closeP2hSessionAtomic(sessionId, pad.toDataURL(), catatan.trim() || undefined, {
				kondisi,
				fotoSelesai: butuhFoto ? fotoId : null
			});
			if ('queued' in result) onclosed({ queued: true, session: null, kondisi });
			else onclosed({ queued: false, session: result.session, kondisi });
		} catch (err: any) {
			error = err?.message || 'Gagal menutup sesi P2H.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="text-left rounded-xl border p-4 space-y-3" style="border-color: var(--sys-sep)">
	<p class="text-[12px] font-bold" style="color: var(--sys-label)">Tutup Pemakaian{unitName ? ` — ${unitName}` : ''}</p>
	<FieldHint text="Isi kondisi unit saat selesai dipakai lalu tanda tangan. Foto hanya diminta bila ada temuan." />

	<fieldset class="space-y-1.5">
		<legend class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label2)">Kondisi unit saat selesai</legend>
		{#each KONDISI as k (k.value)}
			<label
				class="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer"
				style="border-color: {kondisi === k.value ? k.color : 'var(--sys-sep)'}; background: {kondisi === k.value ? k.color + '14' : 'transparent'}"
			>
				<input type="radio" name="kondisi-{sessionId}" value={k.value} bind:group={kondisi} class="mt-0.5" />
				<span>
					<span class="block text-[12px] font-semibold" style="color: {k.color}">{k.label}</span>
					<span class="block text-[10px]" style="color: var(--sys-label3)">{k.desc}</span>
				</span>
			</label>
		{/each}
	</fieldset>

	{#if butuhFoto}
		<div class="rounded-lg border p-3 space-y-2" style="border-color: #D97706; background: rgba(217,119,6,0.06)">
			<p class="text-[11px] font-semibold" style="color: #B45309">Foto temuan (wajib)</p>
			<input
				type="file"
				accept="image/*"
				capture="environment"
				class="text-[11px] w-full"
				disabled={fotoUploading}
				onchange={onFotoChange}
			/>
			{#if fotoUploading}
				<p class="text-[11px] animate-pulse" style="color: var(--sys-label3)">Mengunggah foto…</p>
			{:else if fotoId}
				<p class="text-[11px]" style="color: #16A34A">✓ Foto terlampir.</p>
			{/if}
			{#if fotoMsg}
				<p role="alert" class="text-[11px]" style="color: #DC2626">⚠️ {fotoMsg}</p>
				{#if fotoRetryFile}
					<div class="flex flex-wrap gap-2">
						{#if !fotoNeedsOriginal}
							<button type="button" class="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 text-white" onclick={() => fotoRetryFile && uploadFoto(fotoRetryFile)}>
								🔄 Coba lagi
							</button>
						{:else}
							<button type="button" class="px-2.5 py-1 rounded-md text-[11px] font-semibold border" style="border-color: var(--sys-sep); color: var(--sys-label2)" onclick={() => fotoRetryFile && uploadFoto(fotoRetryFile, true)}>
								📤 Kirim foto asli (lambat)
							</button>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<div>
		<label for="tutup-catatan-{sessionId}" class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label2)">Catatan (opsional)</label>
		<textarea
			id="tutup-catatan-{sessionId}"
			class="w-full rounded-lg border text-[12px] p-2 bg-transparent"
			style="border-color: var(--sys-sep); color: var(--sys-label)"
			placeholder="Mis. ada kerusakan baru selama dipakai..."
			rows="2"
			bind:value={catatan}
		></textarea>
	</div>

	<div>
		<span class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label2)">Tanda Tangan Digital (Wajib)</span>
		<SignaturePad bind:this={pad} height={120} />
	</div>

	{#if error}
		<p class="text-[11px]" style="color: #DC2626">{error}</p>
	{/if}

	<div class="flex gap-2">
		{#if oncancel}
			<button
				type="button"
				class="flex-1 h-10 rounded-lg text-[12px] font-semibold border"
				style="border-color: var(--sys-sep); color: var(--sys-label2)"
				onclick={oncancel}
			>
				Batal
			</button>
		{/if}
		<button
			type="button"
			class="flex-1 h-10 rounded-lg text-[12px] font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
			style="background: var(--g)"
			disabled={saving || fotoUploading}
			onclick={simpan}
		>
			{#if saving}<IconLoader2 size={14} class="animate-spin" />{/if}
			Simpan
		</button>
	</div>
</div>
