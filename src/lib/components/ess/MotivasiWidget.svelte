<script lang="ts">
	// Widget "Cek Semangat Kerja" di beranda ESS lapangan (Budaya & Motivasi Fase 3). Muncul HANYA bila jatuh tempo
	// (mingguan / survei bulanan Sense of Belonging) dan belum diisi pada periodenya. Fail-soft: mati / skema belum ada /
	// error → tidak tampil. Anonim = bawaan: nama tidak pernah ditampilkan ke HRD. 1 ketuk emoji sudah cukup.
	import { onMount } from 'svelte';
	import { getMotivasiStatus, submitMotivasiCheckin, type MotivasiStatus } from '$lib/services/ess/budaya';

	const EMOJI = ['', '😞', '😕', '😐', '🙂', '🔥'];
	const LABEL = ['', 'Lelah / turun', 'Kurang semangat', 'Biasa saja', 'Semangat', 'Sangat bersemangat'];

	let loading = $state(true);
	let status = $state<MotivasiStatus | null>(null);
	let busy = $state(false);
	let error = $state('');
	let selesai = $state(false);

	let semangat = $state(0);
	let belonging = $state<number | null>(null);
	let kejelasan = $state<number | null>(null);
	let faktor = $state('');
	let catatan = $state('');
	let anonim = $state(true);

	const due = $derived(status?.due ?? null);
	const isPulse = $derived(due?.tipe === 'pulse_belonging');
	const siapKirim = $derived(semangat >= 1 && (!isPulse || (belonging != null && kejelasan != null)));

	function reset() {
		semangat = 0;
		belonging = null;
		kejelasan = null;
		faktor = '';
		catatan = '';
		error = '';
	}

	onMount(async () => {
		try {
			status = await getMotivasiStatus();
		} catch (e: any) {
			console.warn('[MotivasiWidget] gagal memuat:', e?.message);
		} finally {
			loading = false;
		}
	});

	async function kirim() {
		if (!due || busy || !siapKirim) return;
		busy = true;
		error = '';
		try {
			await submitMotivasiCheckin({
				tipe: due.tipe,
				periode_kode: due.periode_kode,
				skor_semangat: semangat,
				skor_belonging: isPulse ? belonging : undefined,
				skor_kejelasan_visi: isPulse ? kejelasan : undefined,
				faktor_utama: faktor || undefined,
				catatan_singkat: catatan.trim() || undefined,
				anonim
			});
			selesai = true;
			// Bila ada cek-in lain yang jatuh tempo (mis. survei bulanan lalu mingguan), tampilkan setelah jeda singkat.
			setTimeout(async () => {
				try {
					const next = await getMotivasiStatus();
					if (next?.due) {
						status = next;
						reset();
						selesai = false;
					}
				} catch {
					/* abaikan */
				}
			}, 1500);
		} catch (e: any) {
			error = e?.message || 'Gagal menyimpan, coba lagi.';
		} finally {
			busy = false;
		}
	}
</script>

{#if !loading && status?.enabled && (due || selesai)}
	<section class="rounded-3xl p-4 sm:p-5 border" style="background: rgba(245,158,11,0.10); border-color: rgba(245,158,11,0.35)" aria-label="Cek semangat kerja">
		{#if selesai}
			<p class="text-sm font-bold text-emerald-600">✅ Terima kasih! Masukan Anda membantu perusahaan memperbaiki alat, keselamatan, dan kenyamanan kerja.</p>
		{:else}
			<p class="text-[11px] font-bold uppercase tracking-wider" style="color: #b45309">💬 {isPulse ? 'Survei Bulanan: Bangga Jadi Bagian EPI' : 'Cek Semangat Kerja Minggu Ini'}</p>
			<p class="text-base font-extrabold mt-0.5" style="color: var(--sys-label)">Bagaimana semangat kerja Anda saat ini?</p>
			<div class="mt-3 flex gap-2" role="radiogroup" aria-label="Tingkat semangat">
				{#each [1, 2, 3, 4, 5] as n}
					<button
						type="button"
						role="radio"
						aria-checked={semangat === n}
						aria-label={LABEL[n]}
						class="w-12 h-12 rounded-2xl text-2xl border transition"
						style="background: {semangat === n ? '#f59e0b' : 'var(--sys-bg2)'}; border-color: {semangat === n ? '#d97706' : 'var(--sys-sep)'}; transform: scale({semangat === n ? 1.1 : 1})"
						onclick={() => (semangat = n)}>{EMOJI[n]}</button
					>
				{/each}
			</div>
			{#if semangat}<p class="text-xs mt-1" style="color: var(--sys-label2)">{LABEL[semangat]}</p>{/if}

			{#if isPulse}
				<div class="mt-4 space-y-3">
					<div>
						<p class="text-sm font-bold" style="color: var(--sys-label)">Seberapa bangga Anda menjadi bagian dari EPI? (0 = tidak sama sekali, 10 = sangat bangga)</p>
						<div class="mt-1.5 flex flex-wrap gap-1.5">
							{#each Array.from({ length: 11 }, (_, i) => i) as n}
								<button type="button" class="w-9 h-9 rounded-xl text-sm font-bold border" style="background: {belonging === n ? '#f59e0b' : 'var(--sys-bg2)'}; border-color: var(--sys-sep); color: {belonging === n ? '#fff' : 'var(--sys-label)'}" onclick={() => (belonging = n)}>{n}</button>
							{/each}
						</div>
					</div>
					<div>
						<p class="text-sm font-bold" style="color: var(--sys-label)">Seberapa jelas arah & target perusahaan bagi Anda? (1–5)</p>
						<div class="mt-1.5 flex gap-1.5">
							{#each [1, 2, 3, 4, 5] as n}
								<button type="button" class="w-10 h-9 rounded-xl text-sm font-bold border" style="background: {kejelasan === n ? '#f59e0b' : 'var(--sys-bg2)'}; border-color: var(--sys-sep); color: {kejelasan === n ? '#fff' : 'var(--sys-label)'}" onclick={() => (kejelasan = n)}>{n}</button>
							{/each}
						</div>
					</div>
				</div>
			{/if}

			{#if semangat}
				<div class="mt-4 space-y-2">
					<p class="text-sm font-bold" style="color: var(--sys-label)">Faktor yang paling memengaruhi (opsional)</p>
					<div class="flex flex-wrap gap-1.5">
						{#each status?.faktor ?? [] as f}
							<button type="button" class="px-3 py-1.5 rounded-full text-xs font-semibold border" style="background: {faktor === f.value ? '#1f2937' : 'var(--sys-bg2)'}; border-color: var(--sys-sep); color: {faktor === f.value ? '#fff' : 'var(--sys-label)'}" onclick={() => (faktor = faktor === f.value ? '' : f.value)}>{f.label}</button>
						{/each}
					</div>
					<textarea class="w-full rounded-xl border px-3 py-2 text-sm" style="background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label)" rows="2" maxlength="500" bind:value={catatan} placeholder="Catatan singkat (opsional)"></textarea>
					<label class="flex items-center gap-2 text-xs" style="color: var(--sys-label2)"><input type="checkbox" bind:checked={anonim} /> Kirim anonim (nama tidak ditampilkan ke HRD)</label>
				</div>
			{/if}

			{#if error}<p class="text-xs mt-2 text-red-600">{error}</p>{/if}
			<button type="button" class="mt-4 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40" style="background: #d97706" disabled={!siapKirim || busy} onclick={kirim}>{busy ? 'Mengirim…' : 'Kirim'}</button>
			<p class="text-[11px] mt-2" style="color: var(--sys-label3)">🔒 Dilindungi: HRD hanya melihat ringkasan per divisi/proyek (dengan jumlah responden minimum), bukan jawaban pribadi — kecuali Anda mematikan opsi anonim.</p>
		{/if}
	</section>
{/if}
