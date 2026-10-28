<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { downloadMyHrDocument, signMyHrDocument } from '$lib/services/ess/hrDocuments';
	import { IconLoader2, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-svelte';

	const docId = Number($page.params.id);

	let loading = $state(true);
	let errorMsg = $state('');
	let pdfUrl = $state('');
	let sudahMembaca = $state(false);
	let signaturePad: any = $state();
	let submitting = $state(false);
	let done = $state(false);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const blob = await downloadMyHrDocument(docId);
			pdfUrl = URL.createObjectURL(blob);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat dokumen.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function handleSubmit() {
		if (!sudahMembaca) {
			errorMsg = 'Centang dulu bahwa Anda telah membaca dan memahami isi dokumen.';
			return;
		}
		if (!signaturePad || signaturePad.isEmpty()) {
			errorMsg = 'Tanda tangan belum diisi.';
			return;
		}
		errorMsg = '';
		submitting = true;
		try {
			const ttdDataUrl = signaturePad.toDataURL();
			await signMyHrDocument(docId, ttdDataUrl);
			done = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim tanda tangan.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-24 max-w-2xl mx-auto">
	<div class="mb-6">
		<h1 class="text-2xl font-extrabold tracking-tight gradient-text">Tanda Tangan Dokumen</h1>
		<p class="text-sm mt-1 font-medium" style="color: var(--sys-label3)">Baca sampai bawah sebelum menandatangani</p>
	</div>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat dokumen..." />
	{:else if done}
		<div class="glass-panel rounded-2xl p-8 text-center">
			<div class="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
				<IconCircleCheck size={32} class="text-green-600" />
			</div>
			<h3 class="text-lg font-bold mb-2" style="color: var(--sys-label)">Tanda Tangan Terkirim</h3>
			<p class="text-sm mb-6" style="color: var(--sys-label3)">Dokumen ini sudah tercatat sebagai ditandatangani atas nama Anda.</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg shadow-lg" onclick={() => goto('/ess/dokumen-saya')}>
				Kembali ke Dokumen Saya
			</button>
		</div>
	{:else}
		{#if errorMsg}
			<div class="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium mb-4">
				<IconAlertTriangle size={18} class="shrink-0" />
				{errorMsg}
			</div>
		{/if}

		<div class="glass-panel rounded-2xl overflow-hidden mb-4" style="height: 60vh;">
			{#if pdfUrl}
				<iframe src={pdfUrl} title="Dokumen" class="w-full h-full border-0"></iframe>
			{/if}
		</div>

		<label class="flex items-start gap-3 p-4 glass-panel rounded-2xl mb-4 cursor-pointer">
			<input type="checkbox" bind:checked={sudahMembaca} class="mt-0.5 w-5 h-5 shrink-0" />
			<span class="text-sm font-medium" style="color: var(--sys-label)">
				Saya telah membaca dan memahami seluruh isi dokumen ini, dan menyetujuinya dengan membubuhkan tanda tangan di bawah.
			</span>
		</label>

		<div class="glass-panel rounded-2xl p-4 mb-4">
			<p class="text-xs font-bold mb-2" style="color: var(--sys-label3)">Tanda Tangan Anda</p>
			<SignaturePad bind:this={signaturePad} height={180} />
		</div>

		<button
			class="w-full h-14 rounded-2xl text-[15px] font-bold text-white flex items-center justify-center gap-2 gradient-bg shadow-lg disabled:opacity-40"
			disabled={submitting}
			onclick={handleSubmit}
		>
			{#if submitting}<IconLoader2 size={20} class="animate-spin" />{/if}
			Kirim Tanda Tangan
		</button>
	{/if}
</div>
