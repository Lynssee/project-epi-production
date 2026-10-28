<!-- src/lib/components/anggaran/GateRequestDispensasi.svelte -->
<!-- "Minta dispensasi" dari kartu gate G10_HARIAN / G_MOM_BRIEFING yang gagal. Alasan (min. 20 karakter) + foto bukti
     opsional -> proxy /api/dispensasi-request -> admin erp-epi (WA ke penerima yang diatur admin; GM/Direktur memutuskan
     di Kalibrasi Gate PA). Dispensasi yang disetujui berlaku per proyek sampai akhir hari berikutnya (WIB).
     Anti Aturan #5: <input type=file capture> dipicu klik user langsung, tanpa await sebelumnya. -->
<script lang="ts">
	import { submitDispensasiRequest } from '$lib/services/dispensasiRequest';
	import { validateAlasan, MIN_ALASAN } from '$lib/utils/dispensasiAlasan';

	const GATE_LABEL: Record<string, string> = { G10_HARIAN: 'Laporan Harian (G10)', G_MOM_BRIEFING: 'MOM Briefing' };

	let {
		open = false,
		projectId,
		gateKey,
		onClose = () => {},
		onSuccess = () => {}
	}: {
		open?: boolean;
		projectId: number | string | null;
		gateKey: string | null;
		onClose?: () => void;
		onSuccess?: () => void;
	} = $props();

	let alasan = $state('');
	let foto = $state<File | null>(null);
	let saving = $state(false);
	let errorMsg = $state('');
	let doneMsg = $state('');

	$effect(() => {
		if (!open) return;
		alasan = '';
		foto = null;
		errorMsg = '';
		doneMsg = '';
	});

	function onFile(e: Event) {
		foto = (e.target as HTMLInputElement).files?.[0] || null;
	}

	async function kirim() {
		errorMsg = '';
		if (!projectId || !gateKey) { errorMsg = 'Pilih proyek terlebih dahulu.'; return; }
		const bad = validateAlasan(alasan);
		if (bad) { errorMsg = bad; return; }
		saving = true;
		const res = await submitDispensasiRequest({ projectId, gateKey, alasan, foto });
		saving = false;
		if (!res.ok) { errorMsg = res.message; return; }
		doneMsg = res.duplicate
			? 'Permintaan untuk gate ini sudah diajukan dan masih menunggu keputusan. Tidak perlu mengirim lagi.'
			: res.waTerkirim
				? 'Permintaan terkirim dan manajemen sudah diberi tahu lewat WA. Setelah disetujui, tekan Cek Ulang.'
				: 'Permintaan tercatat dan menunggu keputusan GM/Direktur. Setelah disetujui, tekan Cek Ulang.';
		onSuccess();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div role="presentation" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style="background: rgba(0,0,0,0.45)" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
		<div class="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 flex flex-col gap-3" style="background: var(--sys-bg, #fff); max-height: 90vh; overflow-y: auto">
			<div class="flex items-center justify-between">
				<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">Minta Dispensasi — {GATE_LABEL[gateKey || ''] || gateKey}</h3>
				<button type="button" onclick={onClose} aria-label="Tutup" style="color: var(--sys-label3)">✕</button>
			</div>

			{#if doneMsg}
				<p class="text-[12px] rounded-lg p-3" style="background:#dcfce7;color:#166534">{doneMsg}</p>
				<button type="button" onclick={onClose} class="w-full rounded-xl py-2.5 text-[13px] font-bold" style="background: var(--p); color: #fff">Tutup</button>
			{:else}
				<p class="text-[11px]" style="color: var(--sys-label3)">
					Gunakan hanya bila syarat ini benar-benar tidak bisa dipenuhi hari ini (mis. tidak ada sinyal). Permintaan dikirim ke GM/Direktur;
					bila disetujui, gate ini dibebaskan untuk proyek Anda sampai akhir hari berikutnya.
				</p>

				{#if errorMsg}
					<p class="text-[12px] rounded-lg p-2" style="background:#fee2e2;color:#b91c1c">{errorMsg}</p>
				{/if}

				<label for="dsp-alasan" class="text-[11px] font-semibold" style="color: var(--sys-label2)">Alasan (min. {MIN_ALASAN} karakter)</label>
				<textarea id="dsp-alasan" bind:value={alasan} rows="3" maxlength="1000" placeholder="mis. Jaringan di lokasi terputus seharian, briefing pagi tidak bisa diunggah"
					class="rounded-xl px-3 py-2 text-[13px]" style="border: 1px solid var(--sys-border, #e2e8f0); background: transparent"></textarea>
				<p class="text-[10px] -mt-2" style="color: var(--sys-label3)">{alasan.trim().length}/{MIN_ALASAN}</p>

				<label for="dsp-foto" class="text-[11px] font-semibold" style="color: var(--sys-label2)">Foto bukti (opsional, otomatis dikompres)</label>
				<input id="dsp-foto" type="file" accept="image/*" capture="environment" onchange={onFile} class="text-[11px]" />

				<button type="button" disabled={saving} onclick={kirim}
					class="mt-1 w-full rounded-xl py-2.5 text-[13px] font-bold disabled:opacity-50" style="background: var(--p); color: #fff">
					{saving ? 'Mengirim…' : 'Kirim Permintaan'}
				</button>
			{/if}
		</div>
	</div>
{/if}
