<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Pembaca SOP (Fase 2C) + konfirmasi baca (R1: audit trail ISO 9001).
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getSopDetail, confirmSopRead, submitSopUsulan, type SopDocument } from '$lib/services/ess/sop';
	import { JENIS_USULAN, CATATAN_MIN, CATATAN_MAX } from '$lib/utils/sopUsulan';
	import { cacheSopDetail, getCachedSopDetail, enqueueSopConfirmation, registerSopAutoFlush } from '$lib/utils/offlineSopCache';
	import { IconAlertTriangle, IconArrowLeft, IconCheck, IconClock, IconFileText, IconLoader2, IconPaperclip, IconWifiOff } from '@tabler/icons-svelte';

	const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_API_URL;
	const ERP_BASE_URL =
		import.meta.env.VITE_ERP_EPI1_BASE_URL ||
		(typeof window !== 'undefined' && window.location.hostname.includes('localhost')
			? 'http://localhost:9392'
			: 'https://internal.eltamaprimaindo.com');

	let loading = $state(true);
	let errorMsg = $state('');
	let confirming = $state(false);
	let sop = $state<SopDocument | null>(null);
	let sudahKonfirmasi = $state(false);
	let offlineMode = $state(false);
	let confirmQueued = $state(false);
	const sopId = $page.params.id as string;

	async function load() {
		loading = true;
		errorMsg = '';
		offlineMode = false;
		try {
			const res = await getSopDetail(sopId);
			sop = res.sop;
			sudahKonfirmasi = res.sudahKonfirmasi;
			await cacheSopDetail(res.sop);
		} catch (err: any) {
			// R2: sinyal buruk di lapangan -- pakai salinan tersimpan bila ada, alih-alih error kosong.
			const cached = await getCachedSopDetail(Number(sopId));
			if (cached) {
				sop = cached;
				sudahKonfirmasi = false;
				offlineMode = true;
			} else {
				errorMsg = err?.message || 'Gagal memuat SOP.';
			}
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		registerSopAutoFlush(async (id) => {
			await confirmSopRead(id);
		});
	});

	async function handleConfirm() {
		confirming = true;
		try {
			await confirmSopRead(sopId);
			sudahKonfirmasi = true;
		} catch (err: any) {
			// Fetch gagal total (offline) -> antre lokal, kirim otomatis saat sinyal kembali (pola sama dengan PoD di /scan).
			if (err instanceof TypeError) {
				await enqueueSopConfirmation(Number(sopId));
				confirmQueued = true;
			} else {
				errorMsg = err?.message || 'Gagal mengonfirmasi.';
			}
		} finally {
			confirming = false;
		}
	}

	// Usulan perbaikan SOP dari lapangan (Fase 4c) -> antrean ditinjau tim HRD.
	let usulanOpen = $state(false);
	let usulanJenis = $state<string>(JENIS_USULAN[0].value);
	let usulanCatatan = $state('');
	let usulanSending = $state(false);
	let usulanError = $state('');
	let usulanSent = $state(false);

	async function kirimUsulan() {
		usulanError = '';
		if (usulanCatatan.trim().length < CATATAN_MIN) {
			usulanError = `Jelaskan minimal ${CATATAN_MIN} karakter agar bisa ditindaklanjuti.`;
			return;
		}
		usulanSending = true;
		try {
			await submitSopUsulan(sopId, { jenis: usulanJenis, catatan: usulanCatatan });
			usulanSent = true;
			usulanOpen = false;
			usulanCatatan = '';
		} catch (err: any) {
			usulanError = err instanceof TypeError ? 'Tidak ada koneksi. Coba lagi saat sinyal kembali.' : err?.message || 'Gagal mengirim usulan.';
		} finally {
			usulanSending = false;
		}
	}

	function fileUrl(fileId: string) {
		return `${DIRECTUS_URL}/assets/${fileId}`;
	}
</script>

<div class="w-full p-4 md:p-6 pb-24 max-w-2xl mx-auto">
	<button class="flex items-center gap-1.5 text-sm font-semibold mb-4" style="color: var(--sys-label3)" onclick={() => goto('/ess/pelatihan/sop')}>
		<IconArrowLeft size={16} /> Kembali ke Daftar SOP
	</button>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian SOP..." />
		</div>
	{:else if errorMsg && !sop}
		<div class="glass-panel rounded-2xl p-8 text-center">
			<IconAlertTriangle size={32} style="color: #DC2626" class="mx-auto mb-3" />
			<p class="text-sm text-red-500">{errorMsg}</p>
		</div>
	{:else if sop}
		{#if offlineMode}
			<div class="glass-panel rounded-2xl p-3 mb-4 flex items-center gap-2" style="background: var(--rel)">
				<IconWifiOff size={16} style="color: var(--red)" />
				<p class="text-xs font-semibold" style="color: var(--red)">Mode offline — menampilkan salinan tersimpan terakhir. Lampiran file mungkin tidak terbuka.</p>
			</div>
		{/if}
		<div class="glass-panel rounded-2xl p-5 space-y-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
				<h1 class="text-xl font-extrabold">{sop.title}</h1>
				<p class="text-xs mt-1" style="color: var(--sys-label3)">{sop.department || '-'} · Versi {sop.version} · Berlaku sejak {sop.effective_date || sop.last_updated || '-'}</p>
			</div>
			<a
				href={`${ERP_BASE_URL}/print/sop/${sop.sop_code || sop.id}?format=quicksheet`}
				target="_blank"
				rel="noopener noreferrer"
				class="px-3 py-1.5 rounded-xl text-xs font-bold text-white gradient-bg flex items-center gap-1.5 shadow-md hover:opacity-90 transition-opacity shrink-0"
				title="Buka atau Cetak Lembar Kerja Field Quick-Sheet A4"
			>
				<span>📄</span>
				<span>Cetak Field Quick-Sheet (A4)</span>
			</a>
		</div>

			{#if sop.keterangan}
				<p class="text-sm" style="color: var(--sys-label2)">{sop.keterangan}</p>
			{/if}

			{#if sop.content_source !== 'file' && sop.content}
				<div class="prose prose-sm max-w-none text-sm leading-relaxed" style="color: var(--sys-label1)">
					{@html sop.content}
				</div>
			{/if}

			{#if sop.content_source !== 'richtext' && sop.file?.length}
				<div class="space-y-2">
					<p class="text-xs font-bold" style="color: var(--sys-label3)">Lampiran</p>
					{#each sop.file as f (f.id)}
						<a
							href={fileUrl(f.directus_files_id.id)}
							target="_blank"
							rel="noopener"
							class="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium glass-panel">
							<IconPaperclip size={16} /> {f.directus_files_id.filename_download}
						</a>
					{/each}
				</div>
			{/if}

			<div class="pt-2 border-t" style="border-color: var(--sys-separator)">
				{#if sudahKonfirmasi}
					<div class="flex items-center gap-2 text-sm font-bold" style="color: #16A34A">
						<IconCheck size={18} /> Anda sudah mengonfirmasi membaca SOP versi ini.
					</div>
				{:else if confirmQueued}
					<div class="flex items-center gap-2 text-sm font-bold" style="color: var(--sys-label3)">
						<IconClock size={18} /> Tersimpan — akan dikirim otomatis begitu koneksi kembali.
					</div>
				{:else}
					<button
						class="w-full px-4 py-3 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg disabled:opacity-50"
						disabled={confirming}
						onclick={handleConfirm}>
						{confirming ? 'Menyimpan...' : 'Saya sudah membaca dan memahami'}
					</button>
				{/if}
			</div>

			<div class="pt-2 border-t space-y-2" style="border-color: var(--sys-separator)">
				{#if usulanSent}
					<div class="flex items-center gap-2 text-sm font-bold" style="color: #16A34A">
						<IconCheck size={18} /> Terima kasih — usulan Anda sudah dikirim ke tim HRD untuk ditinjau.
					</div>
				{:else if !usulanOpen}
					<button class="text-xs font-semibold underline" style="color: var(--sys-label3)" onclick={() => (usulanOpen = true)}>
						Ada yang tidak pas di SOP ini? Usulkan perbaikan
					</button>
				{:else}
					<div class="space-y-2">
						<p class="text-xs" style="color: var(--sys-label3)">
							Usulan dikirim ke tim HRD (bukan mengubah SOP langsung). Sebutkan langkah mana dan seharusnya bagaimana. Maksimal 3 usulan per hari.
						</p>
						<label class="block text-xs font-bold" for="usulan-jenis">Jenis masalah</label>
						<select id="usulan-jenis" class="w-full px-3 py-2 rounded-xl text-sm glass-panel" bind:value={usulanJenis}>
							{#each JENIS_USULAN as j (j.value)}<option value={j.value}>{j.label}</option>{/each}
						</select>
						<label class="block text-xs font-bold" for="usulan-catatan">Penjelasan</label>
						<textarea id="usulan-catatan" rows="4" maxlength={CATATAN_MAX} class="w-full px-3 py-2 rounded-xl text-sm glass-panel" placeholder="Contoh: Langkah 3 menyebut cek manual, padahal di lapangan memakai alat ukur X." bind:value={usulanCatatan}></textarea>
						<p class="text-[10px]" style="color: var(--sys-label3)">{usulanCatatan.trim().length}/{CATATAN_MAX} (min. {CATATAN_MIN})</p>
						{#if usulanError}<p class="text-xs text-red-500">{usulanError}</p>{/if}
						<div class="flex gap-2">
							<button class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg disabled:opacity-50" disabled={usulanSending} onclick={kirimUsulan}>
								{usulanSending ? 'Mengirim...' : 'Kirim Usulan'}
							</button>
							<button class="px-4 py-2.5 rounded-xl text-sm font-semibold glass-panel" onclick={() => (usulanOpen = false)}>Batal</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
